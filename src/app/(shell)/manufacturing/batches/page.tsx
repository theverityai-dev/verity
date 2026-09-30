import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_MANUFACTURING_BATCH, ENTITY_MANUFACTURING_ORDER, MANUFACTURING_CAPABILITY } from "@/server/capabilities/manufacturing";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader, PermissionDenied, Stat, StatRow } from "@/components/ui/primitives";
import { executeQuery } from "@/server/platform/query";
import { listBatches } from "@/server/capabilities/manufacturing/batch";
import { CreateBatchForm } from "./BatchControls";

export const dynamic = "force-dynamic";

/**
 * Batches: draft orders produced together. A batch has no state of its own; it
 * only groups orders so their components are matched against stock as one.
 */
async function BatchesPage() {
  installCapabilities();
  const actor = await requireActor();

  const access = await withTenant(actor.tenantId, async (tx) => {
    if (!(await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_MANUFACTURING_BATCH))) return null;
    const canOrders = await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_MANUFACTURING_ORDER);
    // Only draft orders not already batched can join a new one.
    const free = canOrders
      ? await tx.manufacturingOrder.findMany({
          where: { state: "draft", batchId: null },
          include: { outputItem: true, location: true },
          orderBy: { createdAt: "desc" },
          take: 200,
        })
      : [];
    return {
      free: free.map((o) => ({
        id: o.id,
        label: o.reference ?? `MO ${o.id.slice(0, 8)}`,
        location: o.location.name,
        detail: `${o.outputQty} × ${o.outputItem.name}`,
      })),
    };
  });
  if (!access) return <PermissionDenied what="reading batches" />;

  const batches = await executeQuery(actor, listBatches, {});

  return (
    <>
      <PageHeader
        title="Batches"
        description="Draft orders produced together, so their components are matched against stock as one."
        actions={<CreateBatchForm orders={access.free} />}
      />

      <StatRow cols={2} className="mb-6">
        <Stat label="Batches" value={batches.length} />
        <Stat label="Orders in batches" value={batches.reduce((n, b) => n + b.orders, 0)} />
      </StatRow>

      <DataTable
        caption="Batches"
        rows={batches.map((b) => ({ id: b.id, reference: b.reference ?? `Batch ${b.id.slice(0, 8)}`, location: b.location, orders: b.orders }))}
        columns={[
          { key: "reference", header: "Batch", variant: "link", href: "/manufacturing/batches/{id}", sortable: true },
          { key: "location", header: "Location" },
          { key: "orders", header: "Orders", numeric: true, sortable: true },
        ]}
        emptyTitle="No batches"
        emptyDescription="Group two or more draft orders to produce them in one run."
      />
    </>
  );
}

export default withCapabilityPageAccess(MANUFACTURING_CAPABILITY, BatchesPage);
