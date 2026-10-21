import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_PAYMENT, ENTITY_PIECEWORK_WORKER, PIECEWORK_CAPABILITY, listStages, listWorkers } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader, PermissionDenied, StatTile, StatTileRow } from "@/components/ui/primitives";
import { NewKarigarForm } from "./KarigarForms";
import { rupees } from "../lots/format";

export const dynamic = "force-dynamic";

async function KarigarsPage() {
  installCapabilities();
  const actor = await requireActor();

  const { allowed, canMoney } = await withTenant(actor.tenantId, async (tx) => ({
    allowed: await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_WORKER),
    canMoney: await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_PAYMENT),
  }));
  if (!allowed) return <PermissionDenied what="reading karigars" />;

  const [workers, stages] = await Promise.all([executeQuery(actor, listWorkers, { includeInactive: true }), executeQuery(actor, listStages, {})]);
  const live = workers.filter((w) => w.active);

  return (
    <>
      <PageHeader
        title="Karigars"
        description="Each karigar's rate per piece, the pieces they hold, and what they are owed. Wages are worked out from the pieces they return."
        actions={<NewKarigarForm stages={stages.map((s) => ({ id: s.id, label: s.label }))} />}
      />

      <StatTileRow cols={3} className="mb-6">
        <StatTile icon="user" hue="teal" label="Active karigars" value={live.length} />
        <StatTile state="pending" icon="clock" label="Pieces with karigars" value={live.reduce((s, w) => s + w.piecesHeld, 0)} />
        {canMoney ? (
          <StatTile icon="wallet" hue="purple" label="Owed to karigars" value={rupees(live.reduce((s, w) => s + w.balanceMinor, 0))} />
        ) : (
          <StatTile icon="check" hue="indigo" label="With a rate set" value={live.filter((w) => w.workTypes.length > 0).length} />
        )}
      </StatTileRow>

      <DataTable
        caption="Karigars"
        rows={workers.map((w) => ({
          id: w.id,
          name: w.name,
          mobile: w.mobile ?? "—",
          work: w.workTypes.length === 0 ? "No rate set" : w.workTypes.map((t) => `${t.label} ${rupees(t.rateMinor)}`).join(" · "),
          held: w.piecesHeld,
          wages: canMoney ? rupees(w.wagesMinor) : "—",
          balance: canMoney ? rupees(w.balanceMinor) : "—",
          state: w.active ? "active" : "retired",
          category: w.active ? "Active" : "Cancelled",
        }))}
        columns={[
          { key: "name", header: "Karigar", variant: "link", href: "/karigars/{id}", subKey: "mobile", sortable: true },
          { key: "work", header: "Work and rate per piece" },
          { key: "held", header: "Pieces held", numeric: true, sortable: true },
          ...(canMoney
            ? [
                { key: "wages", header: "Wages earned", numeric: true },
                { key: "balance", header: "Balance due", numeric: true },
              ]
            : []),
          { key: "state", header: "State", variant: "state" as const, categoryKey: "category" },
        ]}
        emptyTitle="No karigars yet"
        emptyDescription="Add a karigar with a name, a mobile number and a rate per piece for the work they do."
      />
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, KarigarsPage);
