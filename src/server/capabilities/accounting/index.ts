import { z } from "zod";
import { registerContribution } from "@/server/platform/contribution";
import { registerCommand, ValidationError, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import type { TenantScopedClient } from "@/server/platform/tenancy";
import {
  balanceSheet,
  endExclusiveUtc,
  profitAndLoss,
  startOfDayUtc,
  type AccountTotals,
  type BalanceSheet,
  type ProfitAndLoss,
} from "@/lib/financial-statements";

/**
 * CAPABILITY: Accounting — `verity.capability.accounting` (Task 72, MVP scope)
 *
 * Authority: `taskplans/72_erpclaw_capability_accounting.md`. Built ahead of
 * its stated demand trigger (a second client needing real books) under an
 * explicit product-owner override 2026-09-04 — the taskplan's own trigger
 * language still applies to everything past this MVP slice.
 *
 * REGISTERED 2026-09-04 via `registry.ts` (`registerAccountingCapability`),
 * after the shared database's migration-checksum drift was resolved
 * (`prisma migrate resolve --rolled-back` on a dead failed-attempt row, plus
 * a checksum re-stamp on the successful row it duplicated — see
 * `taskplans/96_pending_roadmap_phases.md` Phase 4 for the full account) and
 * migration `20260904120000_capability_accounting_inventory_hr_billing`
 * applied.
 *
 * SCOPE BUILT: chart of accounts, append-only journal entries with
 * balance-before-commit, reversal (never in-place correction), trial
 * balance. NOT built, per Task 72's own scope: fiscal-year period close,
 * budgets, dimensions/cost centers, or the statement reports (P&L, balance
 * sheet, cash flow). Those remain that taskplan's open follow-on.
 */

export const ACCOUNTING_CAPABILITY = "verity.capability.accounting";
export const ENTITY_ACCOUNT = "verity.accounting.account";
export const ENTITY_JOURNAL_ENTRY = "verity.accounting.journal_entry";

export const ACCOUNT_TYPES = ["Asset", "Liability", "Equity", "Income", "Expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/* =============================== accounts ================================ */

export const createAccount: CommandDefinition<
  { code: string; name: string; type: AccountType },
  { id: string }
> = {
  key: "verity.accounting.create_account",
  entity: ENTITY_ACCOUNT,
  verb: "Create",
  input: z.object({
    code: z.string().min(1).max(20),
    name: z.string().min(1).max(200),
    type: z.enum(ACCOUNT_TYPES),
  }),
  preconditions: async (ctx, input) => {
    const clash = await ctx.tx.account.findFirst({ where: { code: input.code } });
    if (clash) throw new ValidationError("E_VALIDATION: an account with that code already exists");
  },
  handler: async (ctx, input) => {
    const account = await ctx.tx.account.create({
      data: { tenantId: ctx.actor.tenantId, code: input.code, name: input.name, type: input.type },
    });
    return {
      result: { id: account.id },
      events: [{ name: "verity.accounting.account_created", entityId: account.id }],
    };
  },
};

/** Deactivated, never deleted — a posted JournalLine references it forever. */
export const setAccountActive: CommandDefinition<{ accountId: string; active: boolean }, { id: string }> = {
  key: "verity.accounting.set_account_active",
  entity: ENTITY_ACCOUNT,
  verb: "Edit",
  input: z.object({ accountId: z.string().uuid(), active: z.boolean() }),
  handler: async (ctx, input) => {
    const account = await ctx.tx.account.update({
      where: { id: input.accountId },
      data: { active: input.active, version: { increment: 1 } },
    });
    return {
      result: { id: account.id },
      events: [
        {
          name: input.active ? "verity.accounting.account_activated" : "verity.accounting.account_deactivated",
          entityId: account.id,
        },
      ],
    };
  },
};

export const listAccounts: QueryDefinition<
  { includeInactive?: boolean; type?: AccountType },
  Array<{ id: string; code: string; name: string; type: AccountType; active: boolean }>
> = {
  key: "verity.accounting.list_accounts",
  entity: ENTITY_ACCOUNT,
  input: z.object({ includeInactive: z.boolean().optional(), type: z.enum(ACCOUNT_TYPES).optional() }),
  handler: async (ctx, input) => {
    const rows = await ctx.tx.account.findMany({
      where: {
        ...(input.includeInactive ? {} : { active: true }),
        ...(input.type ? { type: input.type } : {}),
      },
      orderBy: { code: "asc" },
    });
    return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, type: r.type as AccountType, active: r.active }));
  },
};

/* ============================ journal entries ============================= */

const journalLineInput = z.object({
  accountId: z.string().uuid(),
  debitMinor: z.number().int().min(0).default(0),
  creditMinor: z.number().int().min(0).default(0),
});

/**
 * Posts a balanced journal entry. Fails closed on the first thing an
 * accountant would reject by hand: fewer than two lines, a line that is
 * simultaneously (or neither) a debit and a credit, or a debit total that
 * does not equal the credit total. All checked in `preconditions` so a
 * failing entry never reaches a write.
 */
export const postJournalEntry: CommandDefinition<
  { memo?: string; lines: Array<z.infer<typeof journalLineInput>> },
  { id: string }
> = {
  key: "verity.accounting.post_journal_entry",
  entity: ENTITY_JOURNAL_ENTRY,
  verb: "Create",
  impact: "destructive",
  input: z.object({ memo: z.string().max(500).optional(), lines: z.array(journalLineInput).min(2) }),
  preconditions: async (ctx, input) => {
    let debits = 0;
    let credits = 0;
    for (const line of input.lines) {
      if ((line.debitMinor > 0) === (line.creditMinor > 0)) {
        throw new ValidationError(
          "E_VALIDATION: each line must be a debit or a credit, never both or neither",
        );
      }
      debits += line.debitMinor;
      credits += line.creditMinor;
    }
    if (debits !== credits) {
      throw new ValidationError(
        `E_VALIDATION: entry does not balance -- debits ${debits}, credits ${credits}`,
      );
    }
    if (debits === 0) {
      throw new ValidationError("E_VALIDATION: an entry that moves nothing is not a journal entry");
    }
    const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
    const accounts = await ctx.tx.account.findMany({ where: { id: { in: accountIds } } });
    if (accounts.length !== accountIds.length) {
      throw new ValidationError("E_VALIDATION: one or more accounts were not found in this tenant");
    }
    const inactive = accounts.find((a) => !a.active);
    if (inactive) {
      throw new ValidationError(`E_VALIDATION: account ${inactive.code} is deactivated`);
    }
  },
  handler: async (ctx, input) => {
    const entry = await ctx.tx.journalEntry.create({
      data: {
        tenantId: ctx.actor.tenantId,
        memo: input.memo ?? null,
        postedById: ctx.actor.userId,
        lines: {
          create: input.lines.map((l) => ({
            tenantId: ctx.actor.tenantId,
            accountId: l.accountId,
            debitMinor: l.debitMinor,
            creditMinor: l.creditMinor,
          })),
        },
      },
    });
    return {
      result: { id: entry.id },
      events: [{ name: "verity.accounting.journal_entry_posted", entityId: entry.id }],
    };
  },
};

/**
 * The ONLY way to correct a posted entry (Task 72's own critical
 * requirement). Never edits or deletes the original — posts a new entry
 * with every line's debit/credit swapped, linked back via `reversalOfId`.
 */
export const reverseJournalEntry: CommandDefinition<{ journalEntryId: string; memo?: string }, { id: string }> = {
  key: "verity.accounting.reverse_journal_entry",
  entity: ENTITY_JOURNAL_ENTRY,
  verb: "Create",
  impact: "destructive",
  input: z.object({ journalEntryId: z.string().uuid(), memo: z.string().max(500).optional() }),
  preconditions: async (ctx, input) => {
    const original = await ctx.tx.journalEntry.findUnique({
      where: { id: input.journalEntryId },
      include: { lines: true },
    });
    if (!original) throw new ValidationError("E_VALIDATION: journal entry not found in this tenant");
    const already = await ctx.tx.journalEntry.findFirst({ where: { reversalOfId: original.id } });
    if (already) throw new ValidationError("E_VALIDATION: this entry has already been reversed");
  },
  handler: async (ctx, input) => {
    const original = await ctx.tx.journalEntry.findUniqueOrThrow({
      where: { id: input.journalEntryId },
      include: { lines: true },
    });
    const reversal = await ctx.tx.journalEntry.create({
      data: {
        tenantId: ctx.actor.tenantId,
        memo: input.memo ?? `Reversal of ${original.id}`,
        postedById: ctx.actor.userId,
        reversalOfId: original.id,
        lines: {
          create: original.lines.map((l) => ({
            tenantId: ctx.actor.tenantId,
            accountId: l.accountId,
            debitMinor: l.creditMinor,
            creditMinor: l.debitMinor,
          })),
        },
      },
    });
    return {
      result: { id: reversal.id },
      events: [
        {
          name: "verity.accounting.journal_entry_reversed",
          entityId: reversal.id,
          payload: { reversalOf: original.id },
        },
      ],
    };
  },
};

/* ================================ queries ================================= */

export const trialBalance: QueryDefinition<
  Record<string, never>,
  Array<{ accountId: string; code: string; name: string; type: AccountType; debitMinor: number; creditMinor: number }>
> = {
  key: "verity.accounting.trial_balance",
  entity: ENTITY_ACCOUNT,
  input: z.object({}),
  handler: async (ctx) => {
    const accounts = await ctx.tx.account.findMany({
      where: { active: true },
      orderBy: { code: "asc" },
      include: { lines: true },
    });
    return accounts.map((a) => ({
      accountId: a.id,
      code: a.code,
      name: a.name,
      type: a.type as AccountType,
      debitMinor: a.lines.reduce((sum, l) => sum + l.debitMinor, 0),
      creditMinor: a.lines.reduce((sum, l) => sum + l.creditMinor, 0),
    }));
  },
};

export const accountLedger: QueryDefinition<
  { accountId: string },
  Array<{ journalEntryId: string; postedAt: Date; memo: string | null; debitMinor: number; creditMinor: number }>
> = {
  key: "verity.accounting.account_ledger",
  entity: ENTITY_ACCOUNT,
  input: z.object({ accountId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const lines = await ctx.tx.journalLine.findMany({
      where: { accountId: input.accountId },
      include: { journalEntry: true },
      orderBy: { journalEntry: { postedAt: "asc" } },
    });
    return lines.map((l) => ({
      journalEntryId: l.journalEntryId,
      postedAt: l.journalEntry.postedAt,
      memo: l.journalEntry.memo,
      debitMinor: l.debitMinor,
      creditMinor: l.creditMinor,
    }));
  },
};

/* ============================== statements ================================ */

/**
 * Per-account totals for entries posted inside a window. Inactive accounts are kept: an
 * account retired after it carried a balance still belongs in the figures, which the trial
 * balance above (active only) would silently drop.
 */
async function ledgerTotals(
  tx: TenantScopedClient,
  window: { from?: Date | null; toExclusive?: Date | null },
): Promise<AccountTotals[]> {
  const postedAt = {
    ...(window.from ? { gte: window.from } : {}),
    ...(window.toExclusive ? { lt: window.toExclusive } : {}),
  };
  const [grouped, accounts] = await Promise.all([
    tx.journalLine.groupBy({
      by: ["accountId"],
      where: Object.keys(postedAt).length ? { journalEntry: { postedAt } } : {},
      _sum: { debitMinor: true, creditMinor: true },
    }),
    tx.account.findMany({ orderBy: { code: "asc" } }),
  ]);
  const sums = new Map(grouped.map((g) => [g.accountId, g._sum]));
  return accounts.map((a) => ({
    accountId: a.id,
    code: a.code,
    name: a.name,
    type: a.type as AccountType,
    debitMinor: sums.get(a.id)?.debitMinor ?? 0,
    creditMinor: sums.get(a.id)?.creditMinor ?? 0,
  }));
}

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use a date like 2026-10-16").optional();

/**
 * Profit and loss for a period (both ends inclusive, UTC days; omit either for open-ended).
 * Reads the ledger only, so it shows what has been posted, nothing more (ADR-044).
 */
export const profitAndLossReport: QueryDefinition<{ from?: string; to?: string }, ProfitAndLoss> = {
  key: "verity.accounting.profit_and_loss",
  entity: ENTITY_ACCOUNT,
  input: z.object({ from: dateOnly, to: dateOnly }),
  handler: async (ctx, input) =>
    profitAndLoss(
      await ledgerTotals(ctx.tx, { from: startOfDayUtc(input.from), toExclusive: endExclusiveUtc(input.to) }),
    ),
};

/** Balance sheet as at the end of a day (inclusive, UTC; omit for everything posted to date). */
export const balanceSheetReport: QueryDefinition<{ asOf?: string }, BalanceSheet> = {
  key: "verity.accounting.balance_sheet",
  entity: ENTITY_ACCOUNT,
  input: z.object({ asOf: dateOnly }),
  handler: async (ctx, input) => balanceSheet(await ledgerTotals(ctx.tx, { toExclusive: endExclusiveUtc(input.asOf) })),
};

/* ============================== registration ============================== */

/** Called by `registry.ts`'s `installCapabilities()`. */
export function registerAccountingCapability(): void {
  registerContribution({
    capabilityId: ACCOUNTING_CAPABILITY,
    navigation: [
      {
        href: "/accounting",
        label: "Accounting",
        group: "Money",
        order: 45,
        icon: "ledger",
        requiresEntity: ENTITY_JOURNAL_ENTRY,
        shells: ["platform"],
      },
    ],
  });
  registerCommand(createAccount);
  registerCommand(setAccountActive);
  registerCommand(postJournalEntry);
  registerCommand(reverseJournalEntry);
  registerQuery(listAccounts);
  registerQuery(trialBalance);
  registerQuery(accountLedger);
  registerQuery(profitAndLossReport);
  registerQuery(balanceSheetReport);
}
