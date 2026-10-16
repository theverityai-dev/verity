import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_MANUFACTURING_ROUTE, MANUFACTURING_CAPABILITY } from "@/server/capabilities/manufacturing";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { PageHeader, PermissionDenied, StatTile, StatTileRow } from "@/components/ui/primitives";
import { CreateRouteForm } from "./CreateRouteForm";
import { RoutesTable } from "./RoutesTable";

export const dynamic = "force-dynamic";

async function RoutesPage() {
  installCapabilities();
  const actor = await requireActor();

  const rows = await withTenant(actor.tenantId, async (tx) => {
    if (!(await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_MANUFACTURING_ROUTE))) return null;
    const routes = await tx.manufacturingRoute.findMany({
      include: { stages: { orderBy: { sequence: "asc" } } },
      orderBy: { code: "asc" },
    });
    return routes.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      stages: r.stages.map((s) => ({
        key: s.stageKey,
        label: s.label,
        checks: Array.isArray(s.checkpoints) ? s.checkpoints.length : 0,
      })),
      state: r.active ? "active" : "archived",
      category: r.active ? "Active" : "Cancelled",
    }));
  });

  if (!rows) return <PermissionDenied what="reading production routes" />;

  return (
    <>
      <PageHeader
        title="Routes"
        description="The ordered stages an order passes through. Each factory defines its own chain; an order can also use its own stages."
        actions={<CreateRouteForm />}
      />

      <StatTileRow cols={3} className="mb-6">
        <StatTile icon="route" hue="indigo" label="Routes" value={rows.length} />
        <StatTile state="active" icon="check" label="Active" value={rows.filter((r) => r.state === "active").length} />
        <StatTile state="cancelled" icon="close" label="Archived" value={rows.filter((r) => r.state === "archived").length} />
      </StatTileRow>

      <RoutesTable rows={rows} />
    </>
  );
}

export default withCapabilityPageAccess(MANUFACTURING_CAPABILITY, RoutesPage);
