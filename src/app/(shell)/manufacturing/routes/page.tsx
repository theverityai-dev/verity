import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_MANUFACTURING_ROUTE, MANUFACTURING_CAPABILITY } from "@/server/capabilities/manufacturing";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { PageHeader, PermissionDenied, Stat, StatRow } from "@/components/ui/primitives";
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
      chain: r.stages
        .map((s) => {
          const checks = Array.isArray(s.checkpoints) ? s.checkpoints.length : 0;
          return checks > 0 ? `${s.label} (${checks} checks)` : s.label;
        })
        .join("  →  "),
      stages: r.stages.length,
      state: r.active ? "active" : "archived",
      category: r.active ? "Active" : "Cancelled",
    }));
  });

  if (!rows) return <PermissionDenied what="reading production routes" />;

  return (
    <>
      <PageHeader
        title="Production routes"
        description="The ordered stages an order passes through. Each factory defines its own chain; an order can also use its own stages."
        actions={<CreateRouteForm />}
      />

      <StatRow cols={3} className="mb-6">
        <Stat label="Routes" value={rows.length} />
        <Stat label="Active" value={rows.filter((r) => r.state === "active").length} />
        <Stat label="Archived" value={rows.filter((r) => r.state === "archived").length} />
      </StatRow>

      <RoutesTable rows={rows} />
    </>
  );
}

export default withCapabilityPageAccess(MANUFACTURING_CAPABILITY, RoutesPage);
