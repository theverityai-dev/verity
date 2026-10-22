import { z } from "zod";
import { registerCommand, ValidationError, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { isCapabilityActive } from "@/server/platform/capability";
import type { TenantScopedClient } from "@/server/platform/tenancy";
import {
  ACCOUNT_ROLES,
  KIND_LABELS,
  KIND_ROLES,
  VOID_KIND,
  customerReceiptLines,
  isBalanced,
  jobInvoiceLines,
  jobReceiptLines,
  reverseLines,
  salesInvoiceLines,
  type AccountMapping,
  type AccountRole,
  type PostingResult,
  type SourceKind,
} from "@/lib/ledger-posting";

/**
 * Business documents post to the ledger (ADR-044, Task 130).
 *
 * HOW IT RUNS. A scheduled consumer (and the "Post now" command) looks for documents that have no journal entry for their source
 * key, builds the entry from the document's own figures, and writes it. The unique key (tenant, source kind, source id) on
 * `journal_entry` is the cursor AND the idempotency guarantee, so a rerun, a retry and a backfill are all the same code path, and
 * `domain_event.delivered_at` (the notification dispatcher's marker, ADR-039) is never touched.
 *
 * AUTHORITY. The consumer has no actor of its own and gains no authority: it writes inside the tenant-scoped transaction the
 * scheduler gives every unit of work (RLS applies), and attributes each entry to the person who raised the document. "Post now"
 * is an ordinary command behind `enforcePolicy()`. Neither can post to an account nobody mapped.
 *
 * DEPENDENCY IS SOFT (ADR-044 amendment 3). Accounting reads trading tables only when trading is active for the tenant. A declared
 * hard dependency would mark every existing accounting-only activation incompatible and fail readiness.
 */

export const TRADING_CAPABILITY_ID = "verity.capability.trading";
export const PROJECT_CAPABILITY_ID = "verity.capability.project";
const ENTITY_ACCOUNT = "verity.accounting.account";
const ENTITY_JOURNAL_ENTRY = "verity.accounting.journal_entry";
const BATCH = 200;

/** The type an account must have to play a role, so a receivable cannot be pointed at an expense account. */
const ROLE_ACCOUNT_TYPE: Record<AccountRole, string> = {
  receivable: "Asset",
  sales_income: "Income",
  gst_output: "Liability",
  cash: "Asset",
  bank: "Asset",
};

export type PostRun = { posted: number; pending: number; alreadyPosted: number };

type InvoiceRow = {
  id: string;
  invoice_number: string;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  issued_at: Date;
  actor_user_id: string | null;
};

type ReceiptRow = {
  id: string;
  method: string;
  amount_paise: number;
  reference: string | null;
  received_at: Date;
  by_user_id: string;
};

async function loadMapping(tx: TenantScopedClient): Promise<AccountMapping> {
  const rows = await tx.accountMap.findMany({ include: { account: { select: { active: true } } } });
  const mapping: AccountMapping = {};
  for (const row of rows) {
    // A deactivated account is treated as unmapped: posting to it would be refused by postJournalEntry too.
    if (row.account.active && (ACCOUNT_ROLES as readonly string[]).includes(row.role)) mapping[row.role as AccountRole] = row.accountId;
  }
  return mapping;
}

async function unpostedInvoices(tx: TenantScopedClient, take = BATCH): Promise<InvoiceRow[]> {
  return tx.$queryRaw<InvoiceRow[]>`
    SELECT i.id, i.invoice_number, i.taxable_paise, i.cgst_paise, i.sgst_paise, i.igst_paise, i.total_paise, i.issued_at,
           (SELECT d.actor_user_id FROM domain_event d
             WHERE d.entity_id = i.id AND d.name = 'verity.trading.sales_invoice_raised'
             ORDER BY d.occurred_at LIMIT 1) AS actor_user_id
    FROM trading_invoice i
    WHERE i.customer_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM journal_entry j
                       WHERE j.tenant_id = i.tenant_id AND j.source_kind = 'trading.sales_invoice' AND j.source_id = i.id)
    ORDER BY i.issued_at ASC, i.id ASC
    LIMIT ${take}`;
}

async function unpostedReceipts(tx: TenantScopedClient, take = BATCH): Promise<ReceiptRow[]> {
  return tx.$queryRaw<ReceiptRow[]>`
    SELECT p.id, p.method, p.amount_paise, p.reference, p.received_at, p.by_user_id
    FROM trading_payment p
    WHERE p.direction = 'in' AND p.customer_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM journal_entry j
                       WHERE j.tenant_id = p.tenant_id AND j.source_kind = 'trading.customer_receipt' AND j.source_id = p.id)
    ORDER BY p.received_at ASC, p.id ASC
    LIMIT ${take}`;
}

type JobInvoiceRow = { id: string; number: string; amount_minor: number; tax_minor: number; issued_on: Date; created_by_id: string | null };
type JobReceiptRow = { id: string; method: string; amount_minor: number; reference: string | null; received_on: Date; created_by_id: string | null };

async function unpostedJobInvoices(tx: TenantScopedClient, take = BATCH): Promise<JobInvoiceRow[]> {
  // A voided invoice that never posted is never posted: it is a mistake that was cancelled, not a sale.
  return tx.$queryRaw<JobInvoiceRow[]>`
    SELECT i.id, i.number, i.amount_minor, i.tax_minor, i.issued_on, i.created_by_id
    FROM project_invoice i
    WHERE i.voided_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM journal_entry j WHERE j.tenant_id = i.tenant_id AND j.source_kind = 'project.invoice' AND j.source_id = i.id)
    ORDER BY i.issued_on ASC, i.id ASC
    LIMIT ${take}`;
}

async function unpostedJobReceipts(tx: TenantScopedClient, take = BATCH): Promise<JobReceiptRow[]> {
  return tx.$queryRaw<JobReceiptRow[]>`
    SELECT r.id, r.method, r.amount_minor, r.reference, r.received_on, r.created_by_id
    FROM project_receipt r
    WHERE r.voided_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM journal_entry j WHERE j.tenant_id = r.tenant_id AND j.source_kind = 'project.receipt' AND j.source_id = r.id)
    ORDER BY r.received_on ASC, r.id ASC
    LIMIT ${take}`;
}

type VoidedRow = { entry_id: string; source_id: string; voided_at: Date; memo: string | null; posted_by_id: string; actor: string | null };

/**
 * Reverses the entry of every job invoice or receipt that was voided after it posted (ADR-044 clause 5): a new entry with every
 * line swapped, linked by reversal_of_id, never an edit. Needs no account mapping, because it undoes exactly what was posted.
 */
async function reverseVoided(tx: TenantScopedClient, tenantId: string, kind: "project.invoice" | "project.receipt", run: PostRun): Promise<void> {
  const voidKind = VOID_KIND[kind];
  const rows =
    kind === "project.invoice"
      ? await tx.$queryRaw<VoidedRow[]>`
          SELECT j.id AS entry_id, j.source_id, d.voided_at, j.memo, j.posted_by_id,
                 (SELECT e.actor_user_id FROM domain_event e WHERE e.entity_id = d.id AND e.name = 'verity.project.invoice_voided' ORDER BY e.occurred_at DESC LIMIT 1) AS actor
            FROM journal_entry j JOIN project_invoice d ON d.id = j.source_id AND d.tenant_id = j.tenant_id
           WHERE j.source_kind = ${kind} AND d.voided_at IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM journal_entry v WHERE v.tenant_id = j.tenant_id AND v.source_kind = ${voidKind} AND v.source_id = j.source_id)
           ORDER BY d.voided_at ASC LIMIT ${BATCH}`
      : await tx.$queryRaw<VoidedRow[]>`
          SELECT j.id AS entry_id, j.source_id, d.voided_at, j.memo, j.posted_by_id,
                 (SELECT e.actor_user_id FROM domain_event e WHERE e.entity_id = d.id AND e.name = 'verity.project.receipt_voided' ORDER BY e.occurred_at DESC LIMIT 1) AS actor
            FROM journal_entry j JOIN project_receipt d ON d.id = j.source_id AND d.tenant_id = j.tenant_id
           WHERE j.source_kind = ${kind} AND d.voided_at IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM journal_entry v WHERE v.tenant_id = j.tenant_id AND v.source_kind = ${voidKind} AND v.source_id = j.source_id)
           ORDER BY d.voided_at ASC LIMIT ${BATCH}`;
  for (const row of rows) {
    const original = await tx.journalLine.findMany({ where: { journalEntryId: row.entry_id } });
    const lines = reverseLines(original.map((l) => ({ accountId: l.accountId, debitMinor: l.debitMinor, creditMinor: l.creditMinor })));
    const memo = `Reversal of: ${row.memo ?? kind}`;
    const by = row.actor ?? row.posted_by_id;
    const inserted = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO journal_entry (id, tenant_id, memo, posted_at, posted_by_id, reversal_of_id, source_kind, source_id)
      VALUES (gen_random_uuid(), ${tenantId}::uuid, ${memo}, ${row.voided_at}, ${by}::uuid, ${row.entry_id}::uuid, ${voidKind}, ${row.source_id}::uuid)
      ON CONFLICT (tenant_id, source_kind, source_id) DO NOTHING
      RETURNING id`;
    const entryId = inserted[0]?.id;
    if (!entryId) {
      run.alreadyPosted += 1;
      continue;
    }
    await tx.journalLine.createMany({
      data: lines.map((line) => ({ tenantId, journalEntryId: entryId, accountId: line.accountId, debitMinor: line.debitMinor, creditMinor: line.creditMinor })),
    });
    run.posted += 1;
  }
}

async function post(
  tx: TenantScopedClient,
  tenantId: string,
  kind: SourceKind,
  sourceId: string,
  postedAt: Date,
  postedById: string | null,
  result: PostingResult,
  run: PostRun,
): Promise<void> {
  const key = { tenantId_sourceKind_sourceId: { tenantId, sourceKind: kind, sourceId } };
  if (!result.ok || !postedById || !isBalanced(result.lines)) {
    const reason = !result.ok ? result.reason : !postedById ? "who raised this document was not recorded, so the entry cannot be attributed" : "the entry would not balance";
    await tx.ledgerPostingPending.upsert({
      where: key,
      create: { tenantId, sourceKind: kind, sourceId, reason },
      update: { reason, lastCheckedAt: new Date() },
    });
    run.pending += 1;
    return;
  }

  // ON CONFLICT DO NOTHING on the source key: a concurrent run that posted first wins, and this one posts nothing twice.
  const inserted = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO journal_entry (id, tenant_id, memo, posted_at, posted_by_id, source_kind, source_id)
    VALUES (gen_random_uuid(), ${tenantId}::uuid, ${result.memo}, ${postedAt}, ${postedById}::uuid, ${kind}, ${sourceId}::uuid)
    ON CONFLICT (tenant_id, source_kind, source_id) DO NOTHING
    RETURNING id`;
  const entryId = inserted[0]?.id;
  if (!entryId) {
    run.alreadyPosted += 1;
  } else {
    await tx.journalLine.createMany({
      data: result.lines.map((line) => ({
        tenantId,
        journalEntryId: entryId,
        accountId: line.accountId,
        debitMinor: line.debitMinor,
        creditMinor: line.creditMinor,
      })),
    });
    run.posted += 1;
  }
  await tx.ledgerPostingPending.deleteMany({ where: { sourceKind: kind, sourceId } });
}

/** One pass for one tenant. Idempotent; safe to run from the scheduler, a retry, or a button. */
export async function postPendingDocuments(tx: TenantScopedClient, tenantId: string): Promise<PostRun> {
  const run: PostRun = { posted: 0, pending: 0, alreadyPosted: 0 };
  const [tradingActive, projectActive] = await Promise.all([
    isCapabilityActive(tx, tenantId, TRADING_CAPABILITY_ID),
    isCapabilityActive(tx, tenantId, PROJECT_CAPABILITY_ID),
  ]);
  if (!tradingActive && !projectActive) return run;
  const mapping = await loadMapping(tx);

  if (projectActive) {
    for (const invoice of await unpostedJobInvoices(tx)) {
      const result = jobInvoiceLines({ number: invoice.number, amountMinor: invoice.amount_minor, taxMinor: invoice.tax_minor }, mapping);
      await post(tx, tenantId, "project.invoice", invoice.id, invoice.issued_on, invoice.created_by_id, result, run);
    }
    for (const receipt of await unpostedJobReceipts(tx)) {
      const result = jobReceiptLines({ method: receipt.method, amountMinor: receipt.amount_minor, reference: receipt.reference }, mapping);
      await post(tx, tenantId, "project.receipt", receipt.id, receipt.received_on, receipt.created_by_id, result, run);
    }
    // Receipts first: an invoice cannot be voided while it has live payments, so this is the order the voids happened in.
    await reverseVoided(tx, tenantId, "project.receipt", run);
    await reverseVoided(tx, tenantId, "project.invoice", run);
  }
  if (!tradingActive) return run;

  for (const invoice of await unpostedInvoices(tx)) {
    const result = salesInvoiceLines(
      {
        invoiceNumber: invoice.invoice_number,
        taxablePaise: invoice.taxable_paise,
        cgstPaise: invoice.cgst_paise,
        sgstPaise: invoice.sgst_paise,
        igstPaise: invoice.igst_paise,
        totalPaise: invoice.total_paise,
      },
      mapping,
    );
    await post(tx, tenantId, "trading.sales_invoice", invoice.id, invoice.issued_at, invoice.actor_user_id, result, run);
  }
  for (const receipt of await unpostedReceipts(tx)) {
    const result = customerReceiptLines({ reference: receipt.reference, method: receipt.method, amountPaise: receipt.amount_paise }, mapping);
    await post(tx, tenantId, "trading.customer_receipt", receipt.id, receipt.received_at, receipt.by_user_id, result, run);
  }
  return run;
}

/* ============================ account mapping ============================ */

export const setAccountMapping: CommandDefinition<{ role: AccountRole; accountId: string }, { role: AccountRole; accountId: string }> = {
  key: "verity.accounting.set_account_mapping",
  entity: ENTITY_ACCOUNT,
  verb: "Edit",
  input: z.object({ role: z.enum(ACCOUNT_ROLES), accountId: z.string().uuid() }),
  preconditions: async (ctx, input) => {
    const account = await ctx.tx.account.findFirst({ where: { id: input.accountId } });
    if (!account) throw new ValidationError("E_VALIDATION: that account was not found in this workspace");
    if (!account.active) throw new ValidationError(`E_VALIDATION: account ${account.code} is deactivated`);
    if (account.type !== ROLE_ACCOUNT_TYPE[input.role]) {
      throw new ValidationError(
        `E_VALIDATION: this role needs a ${ROLE_ACCOUNT_TYPE[input.role]} account, but ${account.code} is a ${account.type} account`,
      );
    }
  },
  handler: async (ctx, input) => {
    await ctx.tx.accountMap.upsert({
      where: { tenantId_role: { tenantId: ctx.actor.tenantId, role: input.role } },
      create: { tenantId: ctx.actor.tenantId, role: input.role, accountId: input.accountId },
      update: { accountId: input.accountId },
    });
    return {
      result: { role: input.role, accountId: input.accountId },
      events: [{ name: "verity.accounting.account_mapped", entityId: input.accountId, payload: { role: input.role } }],
    };
  },
};

/** The same pass the scheduler runs, behind the ordinary command gate, for the moment after the accounts are mapped. */
export const postDocumentsNow: CommandDefinition<Record<string, never>, PostRun> = {
  key: "verity.accounting.post_documents_now",
  entity: ENTITY_JOURNAL_ENTRY,
  verb: "Create",
  impact: "destructive",
  input: z.object({}),
  handler: async (ctx) => {
    const result = await postPendingDocuments(ctx.tx, ctx.actor.tenantId);
    return {
      result,
      events: result.posted > 0 ? [{ name: "verity.accounting.documents_posted", payload: { posted: result.posted } }] : [],
    };
  },
};

export type PostingSetup = {
  roles: Array<{ role: AccountRole; accountId: string | null; code: string | null; name: string | null; requiredAccountType: string }>;
  kinds: Array<{ kind: SourceKind; label: string; needs: AccountRole[]; waiting: number; posted: number }>;
  pending: Array<{ kind: SourceKind; sourceId: string; reason: string; since: Date }>;
};

export const postingSetup: QueryDefinition<Record<string, never>, PostingSetup> = {
  key: "verity.accounting.posting_setup",
  entity: ENTITY_ACCOUNT,
  input: z.object({}),
  handler: async (ctx) => {
    const [maps, pending, tradingActive] = await Promise.all([
      ctx.tx.accountMap.findMany({ include: { account: { select: { code: true, name: true } } } }),
      ctx.tx.ledgerPostingPending.findMany({ orderBy: { firstSeenAt: "asc" }, take: 100 }),
      isCapabilityActive(ctx.tx, ctx.actor.tenantId, TRADING_CAPABILITY_ID),
    ]);
    const byRole = new Map(maps.map((m) => [m.role, m]));
    const projectActive = await isCapabilityActive(ctx.tx, ctx.actor.tenantId, PROJECT_CAPABILITY_ID);
    const counts = async (kind: SourceKind) => {
      const active = kind.startsWith("project.") ? projectActive : tradingActive;
      if (!active) return { waiting: 0, posted: 0 };
      const waitingRows =
        kind === "trading.sales_invoice"
          ? await ctx.tx.$queryRaw<Array<{ n: bigint }>>`
              SELECT count(*) AS n FROM trading_invoice i
              WHERE i.customer_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM journal_entry j WHERE j.source_kind = ${kind} AND j.source_id = i.id)`
          : kind === "trading.customer_receipt"
            ? await ctx.tx.$queryRaw<Array<{ n: bigint }>>`
                SELECT count(*) AS n FROM trading_payment p
                WHERE p.direction = 'in' AND p.customer_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM journal_entry j WHERE j.source_kind = ${kind} AND j.source_id = p.id)`
            : kind === "project.invoice"
              ? await ctx.tx.$queryRaw<Array<{ n: bigint }>>`
                  SELECT count(*) AS n FROM project_invoice i
                  WHERE i.voided_at IS NULL
                    AND NOT EXISTS (SELECT 1 FROM journal_entry j WHERE j.source_kind = ${kind} AND j.source_id = i.id)`
              : await ctx.tx.$queryRaw<Array<{ n: bigint }>>`
                  SELECT count(*) AS n FROM project_receipt r
                  WHERE r.voided_at IS NULL
                    AND NOT EXISTS (SELECT 1 FROM journal_entry j WHERE j.source_kind = ${kind} AND j.source_id = r.id)`;
      return { waiting: Number(waitingRows[0]?.n ?? 0), posted: await ctx.tx.journalEntry.count({ where: { sourceKind: kind } }) };
    };
    const kinds = await Promise.all(
      (Object.keys(KIND_ROLES) as SourceKind[]).map(async (kind) => ({
        kind,
        label: KIND_LABELS[kind],
        needs: [...KIND_ROLES[kind]] as AccountRole[],
        ...(await counts(kind)),
      })),
    );
    return {
      roles: ACCOUNT_ROLES.map((role) => ({
        role,
        accountId: byRole.get(role)?.accountId ?? null,
        code: byRole.get(role)?.account.code ?? null,
        name: byRole.get(role)?.account.name ?? null,
        requiredAccountType: ROLE_ACCOUNT_TYPE[role],
      })),
      kinds,
      pending: pending.map((p) => ({ kind: p.sourceKind as SourceKind, sourceId: p.sourceId, reason: p.reason, since: p.firstSeenAt })),
    };
  },
};

export function registerPosting(): void {
  registerCommand(setAccountMapping);
  registerCommand(postDocumentsNow);
  registerQuery(postingSetup);
}
