import Link from "next/link";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_LOT, ENTITY_PIECEWORK_PAYMENT, PIECEWORK_CAPABILITY, dashboard } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader, Panel, PermissionDenied, StatTile, StatTileRow } from "@/components/ui/primitives";
import { ProgressBar, StackedBar } from "@/components/ui/viz";
import { STATUS_LABEL, rupees } from "../format";

export const dynamic = "force-dynamic";

async function OwnerDashboardPage() {
  installCapabilities();
  const actor = await requireActor();

  const { allowed, canWage } = await withTenant(actor.tenantId, async (tx) => ({
    allowed: await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_LOT),
    canWage: await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_PAYMENT),
  }));
  if (!allowed) return <PermissionDenied what="the owner dashboard" />;

  const d = await executeQuery(actor, dashboard, {});
  const totalPending = d.byStage.reduce((sum, s) => sum + s.pending, 0);
  const longest = Math.max(1, ...d.stuck.map((s) => s.days ?? 0));

  return (
    <>
      <PageHeader title="Owner dashboard" description={`The state of the work on ${d.today}. Every figure is worked out from the entries recorded; good, rejected, rework and short are never mixed.`} />

      <StatTileRow cols={4} className="mb-6">
        <StatTile icon="batch" hue="teal" label="Open lots" value={d.activeLots.length} />
        <StatTile state="pending" icon="clock" label="Pieces out with karigars" value={totalPending} />
        <StatTile state="completed" icon="check" label="Good pieces ready" value={d.ready.pieces} />
        {canWage ? <StatTile icon="wallet" hue="purple" label="Owed to karigars" value={rupees(d.dues.totalMinor)} /> : <StatTile state="blocked" icon="flag" label="Overdue lots" value={d.overdue.lots} />}
      </StatTileRow>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Panel title="Good, rejected, rework and short">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {([["Good", d.quality.good], ["Rejected", d.quality.rejected], ["Rework waiting", d.quality.reworkOpen], ["Short", d.quality.short]] as const).map(([label, value]) => (
              <div key={label} className="flex flex-col">
                <span className="tabular text-[26px] font-bold leading-[1.1] text-text">{value}</span>
                <span className="text-[13px] text-text-secondary">{label}</span>
              </div>
            ))}
          </div>
          <p className="m-0 mt-3 text-[13px] text-text-tertiary">Rework is not output until it is accepted. Short means pieces that did not come back and cannot be found.</p>
        </Panel>

        <Panel title="Bundles and pending pieces at every stage">
          {totalPending === 0 && d.byStage.every((s) => s.bundles === 0) ? (
            <p className="m-0 text-[14px] text-text-secondary">No bundle is in work.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <StackedBar label="Pending pieces by stage" segments={d.byStage.map((s) => ({ label: s.label, value: s.pending }))} />
              <p className="m-0 text-[13px] text-text-secondary">{d.byStage.filter((s) => s.bundles > 0).map((s) => `${s.label}: ${s.bundles} bundle${s.bundles === 1 ? "" : "s"}`).join(" · ") || "No bundle is waiting at a stage."}</p>
            </div>
          )}
        </Panel>

        <Panel title="Material with karigars" flush>
          <DataTable
            caption="Pieces each karigar is holding"
            rows={d.withWorkers.map((w) => ({ id: w.workerId, name: w.name, pieces: w.pieces }))}
            columns={[{ key: "name", header: "Karigar", variant: "link", href: "/karigars/{id}" }, { key: "pieces", header: "Pieces held", numeric: true, sortable: true }]}
            emptyTitle="Nothing is out"
            emptyDescription="No karigar is holding any pieces."
          />
        </Panel>

        <Panel title="Open lots" flush>
          <DataTable
            caption="Lots not yet completed"
            rows={d.activeLots.map((l) => ({ id: l.id, number: l.number, title: l.name ?? l.design, stage: l.stageLabel ?? "—", location: l.location, cut: `${l.bundledPieces} of ${l.plannedPieces}`, status: `${STATUS_LABEL[l.status]}${l.overdue ? " · overdue" : ""}` }))}
            columns={[
              { key: "number", header: "Lot", variant: "link", href: "/lots/{id}", subKey: "title" },
              { key: "stage", header: "Stage" },
              { key: "location", header: "Location" },
              { key: "cut", header: "Cut of planned", numeric: true },
              { key: "status", header: "Status" },
            ]}
            emptyTitle="No open lots"
            emptyDescription="Every lot is completed, or none has been created."
          />
        </Panel>

        <Panel title="Days since each lot last moved">
          {d.stuck.length === 0 ? (
            <p className="m-0 text-[14px] text-text-secondary">No open lots.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {d.stuck.map((s) => (
                <div key={s.lotId} className="grid grid-cols-[5.5rem_1fr] items-center gap-3">
                  <Link href={`/lots/${s.lotId}`} className="text-[14px] font-medium text-accent-ink no-underline hover:underline">{s.number}</Link>
                  <ProgressBar label={`${s.number}, days since it last moved`} value={s.days ?? 0} total={longest} tone={s.days !== null && s.days >= 7 ? "pending" : "active"} figures={s.days === null ? "Not started" : `${s.days} day${s.days === 1 ? "" : "s"}`} />
                </div>
              ))}
              <p className="m-0 text-[13px] text-text-tertiary">{d.overdue.issues} issue{d.overdue.issues === 1 ? " is" : "s are"} past the expected return date. How many days counts as stuck is still to be agreed.</p>
            </div>
          )}
        </Panel>

        <Panel title="Ready stock">
          <p className="m-0 text-[15px] text-text">{d.ready.pieces} good pieces · {d.ready.bundles} bundle{d.ready.bundles === 1 ? "" : "s"} · {d.ready.lots} lot{d.ready.lots === 1 ? "" : "s"}</p>
          <p className="m-0 mt-2 text-[13px] text-text-tertiary">Good pieces that have reached the last stage. Packing and dispatch are not recorded yet, so this does not fall when garments leave.</p>
        </Panel>

        {canWage && (
          <Panel title="Lot-wise costing" flush>
            <DataTable
              caption="Wages earned on each lot"
              rows={d.lotWages.map((l) => ({ id: l.lotId, number: l.number, wages: rupees(l.wagesMinor) }))}
              columns={[{ key: "number", header: "Lot", variant: "link", href: "/lots/{id}" }, { key: "wages", header: "Wages so far", numeric: true }]}
              emptyTitle="No wages yet"
              emptyDescription="Wages appear as work is returned."
            />
            <p className="m-0 px-5 pb-4 text-[13px] text-text-tertiary">Wages only. The other cost categories are recorded in a later stage, and cost per good piece is shown in the costing report.</p>
          </Panel>
        )}

        {canWage && (
          <Panel title="Karigars' dues" flush>
            <DataTable
              caption="Balance due to each karigar"
              rows={d.dues.workers.map((w) => ({ id: w.workerId, name: w.name, balance: rupees(w.balanceMinor) }))}
              columns={[{ key: "name", header: "Karigar", variant: "link", href: "/karigars/{id}" }, { key: "balance", header: "Balance due", numeric: true }]}
              emptyTitle="Nothing is owed"
              emptyDescription="Every karigar's account is square."
            />
            <p className="m-0 px-5 pb-4 text-[13px] text-text-tertiary">Advances not yet recovered from wages: {rupees(d.dues.advanceOutstandingMinor)}.</p>
          </Panel>
        )}
      </div>
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, OwnerDashboardPage);
