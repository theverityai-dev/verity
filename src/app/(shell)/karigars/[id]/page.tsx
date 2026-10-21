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
import { rupees, shortDate } from "../../lots/format";

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
  for (const r of ledger.rates) {
    if (r.effectiveFrom <= today && (!current.has(r.stageId) || r.effectiveFrom > current.get(r.stageId)!.effectiveFrom)) current.set(r.stageId, r);
  }
  const { money } = ledger;

  return (
    <>
      <PageHeader
        title={ledger.worker.name}
        description={ledger.worker.mobile ? `Mobile ${ledger.worker.mobile}` : "No mobile number recorded"}
        actions={
          <>
            <ChangeRate workerId={ledger.worker.id} name={ledger.worker.name} stages={stages.map((s) => ({ id: s.id, label: s.label }))} />
            {canMoney && <RecordMoney workerId={ledger.worker.id} name={ledger.worker.name} balanceMinor={money.balanceMinor} />}
            <ActiveToggle workerId={ledger.worker.id} active={ledger.worker.active} />
          </>
        }
      />

      <StatRow cols={canMoney ? 4 : 2} className="mb-6">
        <Stat label="Pieces given" value={ledger.piecesGiven} />
        <Stat label="Pieces returned" value={ledger.piecesReturned} hint={`${ledger.piecesGiven - ledger.piecesReturned} still pending`} />
        {canMoney && <Stat label="Total wages" value={rupees(money.wagesMinor)} hint={`Advance ${rupees(money.advanceMinor)} · Paid ${rupees(money.paidMinor)}`} />}
        {canMoney && <Stat label="Balance due" value={rupees(money.balanceMinor)} hint="Wages minus advance minus paid" />}
      </StatRow>

      <div className="grid items-start gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Account of work" flush>
          <DataTable
            caption="Pieces given and returned, and wages earned"
            rows={ledger.work.map((w) => ({
              id: w.id,
              date: shortDate(w.entryDate),
              lot: w.lotNumber,
              work: w.stageLabel,
              type: `${w.isReversal ? "Reversal: " : ""}${w.kind === "issue" ? "Given" : "Returned"}${w.reversed ? " (reversed)" : ""}`,
              pieces: w.pieces,
              wages: canMoney && w.kind === "receive" ? rupees(w.wageMinor) : "—",
            }))}
            columns={[
              { key: "date", header: "Date" },
              { key: "lot", header: "Lot" },
              { key: "work", header: "Work" },
              { key: "type", header: "Entry" },
              { key: "pieces", header: "Pieces", numeric: true },
              ...(canMoney ? [{ key: "wages", header: "Wages", numeric: true }] : []),
            ]}
            emptyTitle="No work yet"
            emptyDescription="Entries appear here as pieces are given to and returned by this karigar."
          />
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel title="Rate per piece">
            {stages.length === 0 ? (
              <p className="m-0 text-[14px] text-text-secondary">No stages are set up.</p>
            ) : (
              <DefinitionList
                items={stages.map((s) => {
                  const r = current.get(s.id);
                  return { term: s.label, value: r ? `${rupees(r.rateMinor)} from ${shortDate(r.effectiveFrom)}` : "No rate set" };
                })}
              />
            )}
          </Panel>
          {canMoney && (
            <Panel title="Advances and payments" flush>
              <PaymentLedger workerId={ledger.worker.id} lines={ledger.payments} />
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, KarigarPage);
