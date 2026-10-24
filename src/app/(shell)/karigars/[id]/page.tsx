import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_PAYMENT, ENTITY_PIECEWORK_WORKER, PIECEWORK_CAPABILITY, listStages, supervisorChoices, workerLedger } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { DataTable } from "@/components/ui/DataTable";
import { MoneyBar } from "@/components/ui/PieceFlow";
import { PageHeader, Panel, PermissionDenied, Surface } from "@/components/ui/primitives";
import { ProgressBar } from "@/components/ui/viz";
import { ActiveToggle, ChangeRate, EditProfile, PaymentLedger, RecordMoney } from "./KarigarActions";
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

  const [ledger, stages, supervisors] = await Promise.all([executeQuery(actor, workerLedger, { workerId: id }), executeQuery(actor, listStages, {}), executeQuery(actor, supervisorChoices, {})]);
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
        back={{ href: "/karigars", label: "Karigars" }}
        title={ledger.worker.name}
        description={[ledger.worker.kind === "outside" ? "Outside unit" : "In the factory", ledger.worker.mobile ? `Mobile ${ledger.worker.mobile}` : null, ledger.worker.address].filter(Boolean).join(" · ")}
        actions={
          <>
            <EditProfile worker={ledger.worker} supervisors={supervisors} />
            <ChangeRate workerId={ledger.worker.id} name={ledger.worker.name} stages={stages.map((s) => ({ id: s.id, label: s.label }))} />
            {canMoney && <RecordMoney workerId={ledger.worker.id} name={ledger.worker.name} balanceMinor={money.balanceMinor} advanceOutstandingMinor={money.advanceOutstandingMinor} />}
            <ActiveToggle workerId={ledger.worker.id} active={ledger.worker.active} />
          </>
        }
      />

      <Surface className="mb-6 p-5">
        <div className="mb-5 flex items-center gap-3.5">
          <Avatar name={ledger.worker.name} size={48} />
          <div className="min-w-0">
            <p className="m-0 text-[13px] leading-[18px] text-text-secondary">{ledger.worker.active ? (out > 0 ? `Holding ${out} pieces now` : "Holding nothing now") : "Retired"}</p>
            {canMoney && (
              <p className="tabular m-0 figure text-[28px] text-text">
                {rupees(money.balanceMinor)} <span className="text-[15px] font-normal text-text-secondary">owed</span>
              </p>
            )}
          </div>
        </div>
        <div className={`grid gap-6 ${canMoney ? "lg:grid-cols-2 lg:gap-10" : ""}`}>
          <div className="min-w-0">
            <h2 className="m-0 mb-3 text-[15px] font-semibold leading-[20px] text-text">Pieces</h2>
            <ProgressBar
              label="Pieces accounted for"
              value={ledger.piecesReturned}
              total={Math.max(ledger.piecesGiven, 1)}
              tone={out === 0 ? "completed" : "active"}
              figures={`${ledger.piecesReturned} of ${ledger.piecesGiven} accounted for`}
            />
            <p className="m-0 mt-2 text-[13px] leading-[18px] text-text-secondary">{out} still out.</p>
          </div>
          {canMoney && (
            <div className="min-w-0">
              <h2 className="m-0 mb-3 text-[15px] font-semibold leading-[20px] text-text">Wages {rupees(money.wagesMinor)}, where they went</h2>
              <MoneyBar label="Wages split" format={rupees} parts={money} />
              {money.advanceOutstandingMinor > 0 && (
                <p className="m-0 mt-2 text-[13px] leading-[18px] text-text-secondary">Advance not yet recovered {rupees(money.advanceOutstandingMinor)}.</p>
              )}
            </div>
          )}
        </div>
      </Surface>

      <div className="grid items-start gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="flex flex-col gap-6">
          <Panel title="Work in hand">
            {ledger.workInHand.length === 0 ? (
              <p className="m-0 text-[15px] text-text-secondary">Nothing out. This karigar holds no pieces.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                {ledger.workInHand.map((w) => (
                  <li key={w.issueId} className="list-none">
                    <Link href={`/lots/bundles/${w.bundleId}`} className="block rounded-[10px] bg-[var(--color-surface-sunken)] px-3.5 py-3 no-underline transition-colors hover:bg-[var(--color-control)]">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="text-[16px] font-semibold text-text">
                          {w.bundleNumber} <span className="font-normal text-text-secondary">· {w.lotNumber}</span>
                          {w.isRework && <span className="ml-2 rounded-full bg-[var(--color-control)] px-2 py-0.5 text-[12px] font-semibold text-text-secondary">Rework</span>}
                        </span>
                        <span className="tabular shrink-0 text-[15px] font-semibold text-text">{w.open} out</span>
                      </span>
                      <span className="mt-1 flex items-baseline justify-between gap-3 text-[13px] leading-[18px] text-text-secondary">
                        <span>{w.stageLabel} · {w.issued} given {shortDate(w.entryDate)}</span>
                        {w.dueDate && (
                          <span style={w.overdue ? { color: "var(--color-state-blocked)", fontWeight: 600 } : undefined}>
                            {w.overdue ? "Late, was due " : "Due "}{shortDate(w.dueDate)}
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
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
          <Panel title="Profile">
            <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-1">
              {([
                ["Looked after by", ledger.worker.supervisorName ?? "Any supervisor"],
                ["Joined", ledger.worker.joinedOn ? new Date(`${ledger.worker.joinedOn}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "Not recorded"],
                ["ID note", ledger.worker.idNote ?? "Not recorded"],
                ["Emergency contact", ledger.worker.emergencyContact ?? "Not recorded"],
              ] as const).map(([k, v]) => (
                <div key={k}><dt className="text-[12px] leading-[16px] text-text-tertiary">{k}</dt><dd className="m-0 text-[15px] leading-[20px] text-text">{v}</dd></div>
              ))}
            </dl>
          </Panel>
          <Panel title="Rate per piece">
            {stages.length === 0 ? (
              <p className="m-0 text-[14px] text-text-secondary">No stages are set up.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col p-0">
                {stages.map((s) => {
                  const r = current.get(s.id);
                  return (
                    <li key={s.id} className="flex list-none items-center justify-between gap-3 border-t border-[var(--color-line)] py-2.5 first:border-t-0 first:pt-0 last:pb-0">
                      <span className="text-[15px] text-text">{s.label}</span>
                      {r ? (
                        <span className="text-right">
                          <span className="tabular block text-[15px] font-semibold text-text">{rupees(r.rateMinor)} <span className="text-[13px] font-normal text-text-secondary">per piece</span></span>
                          <span className="block text-[12px] leading-[16px] text-text-tertiary">on {BASIS_LABEL[r.wageBasis]?.toLowerCase()}, from {shortDate(r.effectiveFrom)}</span>
                        </span>
                      ) : (
                        <span className="text-[13px] text-text-tertiary">No rate set</span>
                      )}
                    </li>
                  );
                })}
              </ul>
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
