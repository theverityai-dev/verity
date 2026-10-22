import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { ACCOUNTING_CAPABILITY } from "@/server/capabilities/accounting";
import type { PostingSetup as Setup } from "@/server/capabilities/accounting/posting";
import { ROLE_LABELS, KIND_LABELS, type AccountRole, type SourceKind } from "@/lib/ledger-posting";
import { runQuery } from "@/server/actions/platform";
import { ErrorState, PageHeader } from "@/components/ui/primitives";
import { day } from "@/components/ui/business/format";
import { PostingSetup } from "./PostingSetup";

export const dynamic = "force-dynamic";

type AccountRow = { id: string; code: string; name: string; type: string; active: boolean };

/**
 * Posting setup (ADR-044, Task 130): the accounts invoices and receipts post to, what is waiting, and why.
 * Reads go through the capability's own queries, so the read permission is the accounting one.
 */
async function PostingSetupPage() {
  const [setup, accounts] = await Promise.all([
    runQuery<Setup>("verity.accounting.posting_setup", {}),
    runQuery<AccountRow[]>("verity.accounting.list_accounts", {}),
  ]);
  if (!setup.ok) return <ErrorState title="Could not load posting setup" message={setup.message} issues={setup.issues} retryable={setup.retryable} />;
  if (!accounts.ok) return <ErrorState title="Could not load the accounts" message={accounts.message} issues={accounts.issues} retryable={accounts.retryable} />;

  return (
    <>
      <PageHeader
        back={{ href: "/accounting", label: "Accounting" }}
        title="Posting setup"
        description="Choose which account each kind of money goes to. Invoices and receipts then post to the ledger by themselves."
      />
      <PostingSetup
        roles={setup.data.roles.map((r) => ({
          role: r.role,
          label: ROLE_LABELS[r.role as AccountRole],
          requiredType: r.requiredAccountType,
          accountId: r.accountId,
          accountText: r.code ? `${r.code} ${r.name}` : null,
        }))}
        accounts={accounts.data.map((a) => ({ id: a.id, text: `${a.code} ${a.name}`, type: a.type }))}
        kinds={setup.data.kinds.map((k) => ({ kind: k.kind, label: k.label, needs: k.needs, waiting: k.waiting, posted: k.posted }))}
        pending={setup.data.pending.map((p) => ({
          key: `${p.kind}-${p.sourceId}`,
          kindLabel: KIND_LABELS[p.kind as SourceKind] ?? p.kind,
          reason: p.reason,
          since: day(p.since),
        }))}
      />
    </>
  );
}

export default withCapabilityPageAccess(ACCOUNTING_CAPABILITY, PostingSetupPage);
