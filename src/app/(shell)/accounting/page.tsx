import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { ACCOUNTING_CAPABILITY, ACCOUNT_TYPES } from "@/server/capabilities/accounting";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { runQuery } from "@/server/actions/platform";
import { ErrorState, PageHeader, Stat, StatRow } from "@/components/ui/primitives";
import { day, rupees } from "@/components/ui/business/format";
import { AccountingDesk, type AccountRow, type EntryRow } from "./AccountingDesk";

export const dynamic = "force-dynamic";

type TrialRow = { accountId: string; code: string; name: string; type: string; debitMinor: number; creditMinor: number };

/**
 * The general ledger: chart of accounts, posted journal entries, and the trial
 * balance. Entries are append-only; a mistake is corrected by a reversal, never
 * an edit (Task 72).
 */
async function AccountingPage() {
  const actor = await requireActor();

  // The capability's own query carries the read permission.
  const trial = await runQuery<TrialRow[]>("verity.accounting.trial_balance", {});
  if (!trial.ok) {
    return <ErrorState title="Could not load accounting" message={trial.message} issues={trial.issues} retryable={trial.retryable} />;
  }

  const [accounts, entries] = await Promise.all([
    withTenant(actor.tenantId, (tx) => tx.account.findMany({ orderBy: { code: "asc" } })),
    withTenant(actor.tenantId, (tx) =>
      tx.journalEntry.findMany({
        include: {
          lines: { include: { account: { select: { code: true, name: true } } } },
          reversedBy: { select: { id: true } },
        },
        orderBy: { postedAt: "desc" },
        take: 200,
      }),
    ),
  ]);

  const posterIds = [...new Set(entries.map((e) => e.postedById))];
  const posters = posterIds.length
    ? await withTenant(actor.tenantId, (tx) =>
        tx.user.findMany({ where: { id: { in: posterIds } }, select: { id: true, party: { select: { displayName: true } } } }),
      )
    : [];
  const posterName = new Map(posters.map((u) => [u.id, u.party.displayName]));
  const totals = new Map(trial.data.map((t) => [t.accountId, t]));

  const accountRows: AccountRow[] = accounts.map((a) => {
    const t = totals.get(a.id);
    const debit = t?.debitMinor ?? 0;
    const credit = t?.creditMinor ?? 0;
    // Normal balance side: assets and expenses carry debits, the rest credits.
    const debitNormal = a.type === "Asset" || a.type === "Expense";
    const balance = debitNormal ? debit - credit : credit - debit;
    return {
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      debit: rupees(debit),
      credit: rupees(credit),
      balance: rupees(balance),
      active: a.active,
      status: a.active ? "Active" : "Inactive",
    };
  });

  const entryRows: EntryRow[] = entries.map((e) => {
    const amount = e.lines.reduce((sum, l) => sum + l.debitMinor, 0);
    return {
      id: e.id,
      date: day(e.postedAt),
      memo: e.memo ?? "",
      accounts: [...new Set(e.lines.map((l) => `${l.account.code} ${l.account.name}`))].join(", "),
      amount: rupees(amount),
      postedBy: posterName.get(e.postedById) ?? "Unknown",
      status: e.reversalOfId ? "Reversal" : e.reversedBy.length > 0 ? "Reversed" : "Posted",
      canReverse: !e.reversalOfId && e.reversedBy.length === 0,
    };
  });

  const totalDebit = trial.data.reduce((sum, t) => sum + t.debitMinor, 0);
  const totalCredit = trial.data.reduce((sum, t) => sum + t.creditMinor, 0);

  return (
    <>
      <PageHeader title="Accounting" description="Chart of accounts, journal entries and the trial balance." />
      <StatRow cols={4} className="mb-6">
        <Stat label="Active accounts" value={accounts.filter((a) => a.active).length} />
        <Stat label="Journal entries" value={entries.length} />
        <Stat label="Total debits" value={rupees(totalDebit)} />
        <Stat
          label={totalDebit === totalCredit ? "Books balance" : "Out of balance by"}
          value={totalDebit === totalCredit ? "Yes" : rupees(Math.abs(totalDebit - totalCredit))}
        />
      </StatRow>
      <AccountingDesk accounts={accountRows} entries={entryRows} accountTypes={[...ACCOUNT_TYPES]} />
    </>
  );
}

export default withCapabilityPageAccess(ACCOUNTING_CAPABILITY, AccountingPage);
