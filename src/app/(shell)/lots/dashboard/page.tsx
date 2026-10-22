import Link from "next/link";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_LOT, ENTITY_PIECEWORK_PAYMENT, PIECEWORK_CAPABILITY, dashboard } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { Icon } from "@/components/ui/icons";
import { BarList, FloorBoard, PieceBar, PieceRing } from "@/components/ui/PieceFlow";
import { PageHeader, Panel, PermissionDenied, StateBadge, Surface } from "@/components/ui/primitives";
import { STATUS_CATEGORY, STATUS_LABEL, rupees, shortDate } from "../format";
import { floorLanes } from "../floor";

export const dynamic = "force-dynamic";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

async function OwnerDashboardPage() {
  installCapabilities();
  const actor = await requireActor();

  const { allowed, canWage } = await withTenant(actor.tenantId, async (tx) => ({
    allowed: await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_LOT),
    canWage: await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_PAYMENT),
  }));
  if (!allowed) return <PermissionDenied what="the owner dashboard" />;

  const d = await executeQuery(actor, dashboard, {});
  const out = d.byStage.reduce((sum, s) => sum + s.pending, 0);
  const inWork = d.floor.reduce((s, b) => s + b.netPieces, 0);
  const onFloor = {
    ready: d.floor.reduce((s, b) => s + b.readyPieces, 0), out: d.floor.reduce((s, b) => s + b.pendingPieces, 0), rework: d.floor.reduce((s, b) => s + b.reworkPieces, 0),
    rejected: d.floor.reduce((s, b) => s + b.rejectedPieces, 0), short: d.floor.reduce((s, b) => s + b.shortPieces, 0),
  };
  const lanes = floorLanes(d.byStage.map((s) => ({ id: s.stageId, label: s.label })), d.placements, true);

  // Per-lot pieces for the lots-in-work list, from the same floor rows the board draws.
  const byLot = d.activeLots.map((l) => {
    const rows = d.floor.filter((b) => b.lotNumber === l.number);
    const sum = (f: (b: (typeof rows)[number]) => number) => rows.reduce((s, b) => s + f(b), 0);
    return { lot: l, total: sum((b) => b.netPieces), counts: { ready: sum((b) => b.readyPieces), out: sum((b) => b.pendingPieces), rework: sum((b) => b.reworkPieces), rejected: sum((b) => b.rejectedPieces), short: sum((b) => b.shortPieces) }, bundles: rows.length };
  });
  const idle = d.stuck.filter((s) => s.days !== null && s.days > 0).slice(0, 3);

  return (
    <>
      <PageHeader
        title="Factory today"
        description={`${shortDate(d.today)}. ${plural(d.activeLots.length, "lot")} in work, ${plural(d.floor.length, "bundle")} on the floor, ${plural(out, "piece")} out with karigars.`}
      />

      <div className="mb-6 grid items-stretch gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Surface className="flex flex-wrap items-center justify-between gap-x-8 gap-y-6 p-7">
          <div className="min-w-0 flex-1 basis-[15rem]">
            <p className="micro m-0">Good pieces ready</p>
            <p className="figure m-0 mt-3 text-[clamp(84px,9vw,140px)] text-text">{onFloor.ready}</p>
            <p className="m-0 mt-3 max-w-[34ch] text-[14px] leading-[22px] text-text-secondary">
              of {inWork} pieces on the floor. {out} {out === 1 ? "is" : "are"} with karigars right now.
            </p>
          </div>
          {inWork > 0 && (
            <PieceRing label="Every piece on the floor" total={inWork} counts={onFloor} size={216}>
              <div>
                <p className="figure m-0 text-[34px] text-text">{Math.round((onFloor.ready / inWork) * 100)}%</p>
                <p className="micro m-0">of the floor</p>
              </div>
            </PieceRing>
          )}
          <dl className="m-0 grid w-full grid-cols-2 gap-x-6 gap-y-4 border-t border-[var(--color-line)] pt-5 sm:grid-cols-5">
            {(
              [
                ["Ready", onFloor.ready, "var(--color-state-completed)"],
                ["With karigars", onFloor.out, "var(--color-state-active)"],
                ["Rework", onFloor.rework, "var(--color-state-pending)"],
                ["Rejected", onFloor.rejected, "var(--color-state-blocked)"],
                ["Short", onFloor.short, "var(--color-state-draft)"],
              ] as const
            ).map(([name, value, color]) => (
              <div key={name}>
                <dt className="micro flex items-center gap-2">
                  <span aria-hidden="true" className="size-[7px] rounded-full" style={{ backgroundColor: color }} />
                  {name}
                </dt>
                <dd className="figure m-0 mt-1 text-[30px] text-text">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="m-0 w-full max-w-[64ch] text-[13px] leading-[18px] text-text-tertiary">
            Rework is not output until it is accepted. Short means pieces that did not come back and cannot be found. They are never mixed with good.
          </p>
        </Surface>

        <Surface className="flex flex-col p-6">
          <h2 className="m-0 mb-3 text-[17px] font-medium leading-[22px] tracking-[-0.02em]">Needs attention</h2>
          {d.lateIssues.length === 0 && idle.length === 0 ? (
            <p className="m-0 flex items-center gap-2 text-[15px] text-text-secondary">
              <span aria-hidden="true" style={{ color: "var(--color-state-completed)" }}><Icon name="check" size={18} /></span>
              Nothing is late. Every issue is inside its return date.
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {d.lateIssues.slice(0, 4).map((l) => (
                <li key={`${l.bundleId}-${l.workerId}-${l.stageLabel}`} className="list-none">
                  <Link href={`/lots/bundles/${l.bundleId}`} className="glass-inset block rounded-[14px] px-3.5 py-3 no-underline transition-[transform] duration-150 hover:-translate-y-px">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-[15px] font-semibold text-text">{l.bundleNumber} · {l.workerName}</span>
                      <span className="shrink-0 text-[13px] font-semibold" style={{ color: "var(--color-state-blocked)" }}>{plural(l.daysLate, "day")} late</span>
                    </span>
                    <span className="block text-[13px] leading-[18px] text-text-secondary">{l.open} pieces still out at {l.stageLabel}, due {shortDate(l.dueDate)}</span>
                  </Link>
                </li>
              ))}
              {idle.map((s) => (
                <li key={s.lotId} className="list-none">
                  <Link href={`/lots/${s.lotId}`} className="glass-inset block rounded-[14px] px-3.5 py-3 no-underline transition-[transform] duration-150 hover:-translate-y-px">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-[15px] font-semibold text-text">{s.number}</span>
                      <span className="shrink-0 text-[13px] text-text-secondary">{plural(s.days ?? 0, "day")} since it moved</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {canWage && (
            <Link href="/karigars" className="glass-inset mt-auto block rounded-[16px] px-4 py-3.5 no-underline transition-[transform] duration-150 hover:-translate-y-px">
              <p className="micro m-0">Owed to karigars</p>
              <p className="figure m-0 mt-1 text-[40px] text-text">{rupees(d.dues.totalMinor)}</p>
              <p className="m-0 mt-1 text-[13px] leading-[18px] text-text-secondary">
                {plural(d.dues.workers.length, "karigar")} to pay{d.dues.advanceOutstandingMinor > 0 ? `, ${rupees(d.dues.advanceOutstandingMinor)} of advance not yet recovered` : ""}
              </p>
            </Link>
          )}
        </Surface>
      </div>

      <section aria-labelledby="floor-heading" className="mb-6">
        <h2 id="floor-heading" className="m-0 mb-3 px-1 text-[17px] font-semibold leading-[22px] tracking-[-0.02em]">The floor, stage by stage</h2>
        <FloorBoard lanes={lanes} label="Every bundle by stage" empty={<Surface className="p-5"><p className="m-0 text-[15px] text-text-secondary">No bundle is in work. Start a lot and cut its bundles.</p></Surface>} />
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Panel title="Lots in work">
          {byLot.length === 0 ? (
            <p className="m-0 text-[15px] text-text-secondary">Every lot is completed, or none has been created.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-5 p-0">
              {byLot.map(({ lot, total, counts, bundles }) => (
                <li key={lot.id} className="list-none">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <Link href={`/lots/${lot.id}`} className="min-w-0 truncate text-[15px] font-semibold text-accent-ink no-underline hover:underline">
                      {lot.number} <span className="font-normal text-text-secondary">· {lot.name ?? lot.design}</span>
                    </Link>
                    <StateBadge category={STATUS_CATEGORY[lot.status]!} label={`${STATUS_LABEL[lot.status]}${lot.overdue ? " · overdue" : ""}`} />
                  </div>
                  {total > 0 ? <PieceBar counts={counts} total={total} label={`${lot.number} pieces`} size="sm" legend={false} /> : <p className="m-0 text-[13px] text-text-secondary">Nothing cut yet</p>}
                  <p className="m-0 mt-1.5 text-[13px] leading-[18px] text-text-secondary">
                    {bundles > 0 ? `${plural(bundles, "bundle")} · ${lot.stageLabel ?? "—"} · ${lot.location}` : `${lot.bundledPieces} of ${lot.plannedPieces} cut`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Material with karigars">
          {d.withWorkers.length === 0 ? (
            <p className="m-0 text-[15px] text-text-secondary">No karigar is holding any pieces.</p>
          ) : (
            <BarList
              label="Pieces each karigar is holding"
              items={d.withWorkers.map((w) => ({ id: w.workerId, label: w.name, href: `/karigars/${w.workerId}`, value: w.pieces, display: `${w.pieces} pcs` }))}
            />
          )}
        </Panel>

        {canWage && (
          <Panel title="Owed to karigars">
            {d.dues.workers.length === 0 ? (
              <p className="m-0 text-[15px] text-text-secondary">Every karigar&apos;s account is square.</p>
            ) : (
              <>
                <p className="tabular m-0 mb-4 text-[28px] font-extralight leading-[1.1] tracking-[-0.045em] text-text">{rupees(d.dues.totalMinor)}</p>
                <BarList
                  tone="pending"
                  label="Balance due to each karigar"
                  items={d.dues.workers.map((w) => ({ id: w.workerId, label: w.name, href: `/karigars/${w.workerId}`, value: w.balanceMinor, display: rupees(w.balanceMinor) }))}
                />
              </>
            )}
            <p className="m-0 mt-4 text-[13px] leading-[18px] text-text-tertiary">Advances not yet recovered from wages: {rupees(d.dues.advanceOutstandingMinor)}.</p>
          </Panel>
        )}

        {canWage && (
          <Panel title="Wages by lot">
            {d.lotWages.length === 0 ? (
              <p className="m-0 text-[15px] text-text-secondary">Wages appear as work is returned.</p>
            ) : (
              <BarList tone="completed" label="Wages earned on each lot" items={d.lotWages.map((l) => ({ id: l.lotId, label: l.number, href: `/lots/${l.lotId}`, value: l.wagesMinor, display: rupees(l.wagesMinor) }))} />
            )}
            <p className="m-0 mt-4 text-[13px] leading-[18px] text-text-tertiary">Wages only. The other cost categories come in a later stage; cost per good piece is in the costing report.</p>
          </Panel>
        )}
      </div>

      <p className="m-0 mt-6 px-1 text-[13px] leading-[18px] text-text-tertiary">
        Across every lot, including finished ones, {d.ready.pieces} good pieces are ready in {plural(d.ready.bundles, "bundle")}. Packing and dispatch are not recorded yet, so this does not fall when garments leave.
      </p>
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, OwnerDashboardPage);
