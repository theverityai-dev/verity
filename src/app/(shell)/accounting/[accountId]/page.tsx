import Link from "next/link";
import { notFound } from "next/navigation";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { ACCOUNTING_CAPABILITY } from "@/server/capabilities/accounting";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { runQuery } from "@/server/actions/platform";
import { DataTable } from "@/components/ui/DataTable";
import { ErrorState, PageHeader, Stat, StatRow } from "@/components/ui/primitives";
import { day, rupees } from "@/components/ui/business/format";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

type LedgerLine = { journalEntryId: string; postedAt: string; memo: string | null; debitMinor: number; creditMinor: number };

/** One account's ledger: every posted line, oldest first, with a running balance. */
async function AccountLedgerPage({ params }: { params: Promise<{ accountId: string }> }) {
  const actor = await requireActor();
  const { accountId } = await params;
  if (!UUID.test(accountId)) notFound();

  const ledger = await runQuery<LedgerLine[]>("verity.accounting.account_ledger", { accountId });
  if (!ledger.ok) {
    return <ErrorState title="Could not load the ledger" message={ledger.message} issues={ledger.issues} retryable={ledger.retryable} />;
  }
  const account = await withTenant(actor.tenantId, (tx) => tx.account.findUnique({ where: { id: accountId } }));
  if (!account) notFound();

  // Balance on the account's normal side: assets and expenses grow with debits.
  const debitNormal = account.type === "Asset" || account.type === "Expense";
  const signed = ledger.data.map((line) =>
    debitNormal ? line.debitMinor - line.creditMinor : line.creditMinor - line.debitMinor,
  );
  const balances = signed.map((_, index) => signed.slice(0, index + 1).reduce((sum, n) => sum + n, 0));
  const running = balances.at(-1) ?? 0;
  const rows = ledger.data.map((line, index) => ({
    id: `${line.journalEntryId}-${index}`,
    date: day(line.postedAt),
    memo: line.memo ?? "",
    debit: line.debitMinor ? rupees(line.debitMinor) : "",
    credit: line.creditMinor ? rupees(line.creditMinor) : "",
    balance: rupees(balances[index] ?? 0),
  }));
  const debits = ledger.data.reduce((sum, l) => sum + l.debitMinor, 0);
  const credits = ledger.data.reduce((sum, l) => sum + l.creditMinor, 0);

  return (
    <>
      <PageHeader
        title={`${account.code} ${account.name}`}
        description={`${account.type} account${account.active ? "" : " · inactive"}. Balance shown on its normal ${debitNormal ? "debit" : "credit"} side.`}
        actions={
          <Link href="/accounting" className="text-[15px] text-accent-ink no-underline hover:opacity-70">
            All accounts
          </Link>
        }
      />
      <StatRow cols={3} className="mb-6">
        <Stat label="Debits" value={rupees(debits)} />
        <Stat label="Credits" value={rupees(credits)} />
        <Stat label="Balance" value={rupees(running)} />
      </StatRow>
      <DataTable
        caption="Ledger, oldest first"
        emptyTitle="Nothing posted to this account yet"
        columns={[
          { key: "date", header: "Date" },
          { key: "memo", header: "Memo" },
          { key: "debit", header: "Debit", numeric: true },
          { key: "credit", header: "Credit", numeric: true },
          { key: "balance", header: "Balance", numeric: true },
        ]}
        rows={rows}
      />
    </>
  );
}

export default withCapabilityPageAccess(ACCOUNTING_CAPABILITY, AccountLedgerPage);
