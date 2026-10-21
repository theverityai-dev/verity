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
import { rupees } from "../format";

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
  const totalPending = d.pendingByStage.reduce((sum, s) => sum + s.pending, 0);
  const longest = Math.max(1, ...d.stuck.map((s) => s.days ?? 0));

  return (
    <>
      <PageHeader title="Owner dashboard" description={`The state of the work on ${d.today}. Every figure is worked out from the entries the munshi has recorded.`} />

      <StatTileRow cols={4} className="mb-6">
        <StatTile icon="batch" hue="teal" label="Active lots" value={d.activeLots.length} />
        <StatTile state="pending" icon="clock" label="Pieces pending" value={totalPending} />
        <StatTile state="completed" icon="check" label="Ready bundles" value={d.ready.bundles} />
        {canWage ? (
          <StatTile icon="wallet" hue="purple" label="Owed to karigars" value={rupees(d.dues.totalMinor)} />
        ) : (
          <StatTile icon="user" hue="indigo" label="Karigars with work" value={d.withWorkers.length} />
        )}
      </StatTileRow>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Panel title="Pending pieces at every stage">
          {totalPending === 0 ? (
            <p className="m-0 text-[14px] text-text-secondary">No pieces are waiting at any stage.</p>
          ) : (
            <StackedBar label="Pending pieces by stage" segments={d.pendingByStage.map((s) => ({ label: s.label, value: s.pending }))} />
          )}
        </Panel>

        <Panel title="Material with karigars" flush>
          <DataTable
            caption="Pieces each karigar is holding"
            rows={d.withWorkers.map((w) => ({ id: w.workerId, name: w.name, pieces: w.pieces }))}
            columns={[
              { key: "name", header: "Karigar", variant: "link", href: "/karigars/{id}" },
              { key: "pieces", header: "Pieces held", numeric: true, sortable: true },
            ]}
            emptyTitle="Nothing is out"
            emptyDescription="No karigar is holding any pieces."
          />
        </Panel>

        <Panel title="Active lots" flush>
          <DataTable
            caption="Lots not yet fully ready"
            rows={d.activeLots.map((l) => ({ id: l.id, number: l.number, design: l.design, stage: l.stageLabel ?? "—", location: l.location, total: l.totalPieces }))}
            columns={[
              { key: "number", header: "Lot", variant: "link", href: "/lots/{id}", subKey: "design" },
              { key: "stage", header: "Stage" },
              { key: "location", header: "Location" },
              { key: "total", header: "Pieces", numeric: true },
            ]}
            emptyTitle="No active lots"
            emptyDescription="Every lot is ready, or none has been created."
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
              <p className="m-0 text-[13px] text-text-tertiary">Days since the last issue or receive entry. How many days counts as stuck is still to be agreed.</p>
            </div>
          )}
        </Panel>

        <Panel title="Ready stock">
          <p className="m-0 text-[15px] text-text">
            {d.ready.pieces} pieces · {d.ready.bundles} bundles · {d.ready.lots} lot{d.ready.lots === 1 ? "" : "s"}
          </p>
          <p className="m-0 mt-2 text-[13px] text-text-tertiary">
            Pieces that have reached ready. Dispatch is not part of this software, so this figure does not fall when garments leave.
          </p>
        </Panel>

        {canWage && (
          <Panel title="Lot-wise costing" flush>
            <DataTable
              caption="Wages earned on each lot"
              rows={d.lotWages.map((l) => ({ id: l.lotId, number: l.number, wages: rupees(l.wagesMinor) }))}
              columns={[
                { key: "number", header: "Lot", variant: "link", href: "/lots/{id}" },
                { key: "wages", header: "Wages", numeric: true },
              ]}
              emptyTitle="No wages yet"
              emptyDescription="Wages appear as karigars return finished pieces."
            />
            <p className="m-0 px-5 pb-4 text-[13px] text-text-tertiary">Wages only. Cloth and other costs are to be confirmed before a full lot cost can be shown.</p>
          </Panel>
        )}

        {canWage && (
          <Panel title="Karigars' dues" flush>
            <DataTable
              caption="Balance due to each karigar"
              rows={d.dues.workers.map((w) => ({ id: w.workerId, name: w.name, balance: rupees(w.balanceMinor) }))}
              columns={[
                { key: "name", header: "Karigar", variant: "link", href: "/karigars/{id}" },
                { key: "balance", header: "Balance due", numeric: true },
              ]}
              emptyTitle="Nothing is owed"
              emptyDescription="Every karigar's account is square."
            />
          </Panel>
        )}
      </div>
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, OwnerDashboardPage);
