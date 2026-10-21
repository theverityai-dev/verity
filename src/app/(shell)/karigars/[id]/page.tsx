import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_PAYMENT, ENTITY_PIECEWORK_WORKER, PIECEWORK_CAPABILITY, listStages, workerLedger } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { DataTable } from "@/components/ui/DataTable";
import { DefinitionList, PageHeader, Panel, PermissionDenied, Stat, StatRow } from "@/components/ui/primitives";
import { ActiveToggle, ChangeRate, PaymentLedger, RecordMoney } from "./KarigarActions";
import { BASIS_LABEL, rupees, shortDate } from "../../lots/format";

export const dynamic = "force-dynamic";

async function KarigarPage({ params }: { params: Promise<{ id: string }> }) {
  installCapabilities();
  const { id } = await params;
  const actor = await requireActor();

  const { allowed, canMoney } = await withTenant(actor.tenantId, async (tx) => ({
    allowed: await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_WORKER),
    canMoney: await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_PAYMENT),
  }));
  if (!allowed) return <PermissionDenied what="viewing this karigar" />;

  const [ledger, stages] = await Promise.all([executeQuery(actor, workerLedger, { workerId: id }), executeQuery(actor, listStages, {})]);
  if (!ledger) notFound();

  // The rate in force today per stage: the newest effective date on or before today.
  const today = new Date().toISOString().slice(0, 10);
  const current = new Map<string, (typeof ledger.rates)[number]>();
  for (const r of ledger.rates) if (r.effectiveFrom <= today && (!current.has(r.stageId) || r.effectiveFrom > current.get(r.stageId)!.effectiveFrom)) current.set(r.stageId, r);
  const { money } = ledger;
  const out = ledger.workInHand.reduce((s, w) => s + w.open, 0);

  return (
    <>
      <PageHeader
        title={ledger.worker.name}
        description={[ledger.worker.kind === "outside" ? "Outside unit" : "In the factory", ledger.worker.mobile ? `Mobile ${ledger.worker.mobile}` : null, ledger.worker.address].filter(Boolean).join(" · ")}
        actions={
          <>
            <ChangeRate workerId={ledger.worker.id} name={ledger.worker.name} stages={stages.map((s) => ({ id: s.id, label: s.label }))} />
            {canMoney && <RecordMoney workerId={ledger.worker.id} name={ledger.worker.name} balanceMinor={money.balanceMinor} advanceOutstandingMinor={money.advanceOutstandingMinor} />}
            <ActiveToggle workerId={ledger.worker.id} active={ledger.worker.active} />
          </>
        }
      />

      <StatRow cols={canMoney ? 4 : 2} className="mb-6">
        <Stat label="Pieces given" value={ledger.piecesGiven} />
        <Stat label="Pieces accounted for" value={ledger.piecesReturned} hint={`${out} still out`} />
        {canMoney && <Stat label="Gross wages" value={rupees(money.wagesMinor)} hint={`Recovered ${rupees(money.recoveredMinor)} · Deductions ${rupees(money.deductionMinor)} · Paid ${rupees(money.paidMinor)}`} />}
        {canMoney && <Stat label="Balance due" value={rupees(money.balanceMinor)} hint={`Advance not yet recovered ${rupees(money.advanceOutstandingMinor)}`} />}
      </StatRow>

      <div className="grid items-start gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="flex flex-col gap-6">
          <Panel title="Work in hand" flush>
            <DataTable
              caption="Issues this karigar still holds"
              rows={ledger.workInHand.map((w) => ({ id: w.issueId, bundleId: w.bundleId, bundle: w.bundleNumber, lot: w.lotNumber, stage: `${w.stageLabel}${w.isRework ? " (rework)" : ""}`, issued: w.issued, open: w.open, date: shortDate(w.entryDate), due: w.dueDate ? `${shortDate(w.dueDate)}${w.overdue ? " (overdue)" : ""}` : "—" }))}
              columns={[
                { key: "bundle", header: "Bundle", variant: "link", href: "/lots/bundles/{bundleId}", subKey: "lot" }, { key: "stage", header: "Stage" }, { key: "date", header: "Issued" }, { key: "due", header: "Due" },
                { key: "issued", header: "Pieces", numeric: true }, { key: "open", header: "Still out", numeric: true, sortable: true },
              ]}
              emptyTitle="Nothing out"
              emptyDescription="This karigar holds no pieces."
            />
          </Panel>

          <Panel title="Account of work" flush>
            <DataTable
              caption="Pieces given and returned, and wages earned"
              rows={ledger.work.map((w) => ({
                id: w.id, date: shortDate(w.entryDate), lot: w.lotNumber, bundle: w.bundleNumber, work: w.stageLabel,
                type: `${w.isReversal ? "Reversal: " : ""}${w.kind === "issue" ? "Given" : "Returned"}${w.reversed ? " (reversed)" : ""}`,
                pieces: w.pieces, split: w.kind === "receive" ? `${w.good} · ${w.rejected} · ${w.rework} · ${w.short}` : "—", wages: canMoney && w.wageMinor !== 0 ? rupees(w.wageMinor) : "—",
              }))}
              columns={[
                { key: "date", header: "Date" }, { key: "bundle", header: "Bundle", subKey: "lot" }, { key: "work", header: "Work" }, { key: "type", header: "Entry" },
                { key: "pieces", header: "Pieces", numeric: true }, { key: "split", header: "Good · rej · rework · short" },
                ...(canMoney ? [{ key: "wages", header: "Wages", numeric: true }] : []),
              ]}
              emptyTitle="No work yet"
              emptyDescription="Entries appear here as pieces are given to and taken back from this karigar."
            />
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel title="Rate per piece">
            {stages.length === 0 ? (
              <p className="m-0 text-[14px] text-text-secondary">No stages are set up.</p>
            ) : (
              <DefinitionList items={stages.map((s) => { const r = current.get(s.id); return { term: s.label, value: r ? `${rupees(r.rateMinor)} on ${BASIS_LABEL[r.wageBasis]?.toLowerCase()}, from ${shortDate(r.effectiveFrom)}` : "No rate set" }; })} />
            )}
          </Panel>
          {canMoney && (
            <Panel title="Advances, deductions and payments" flush>
              <PaymentLedger workerId={ledger.worker.id} lines={ledger.payments} />
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, KarigarPage);
