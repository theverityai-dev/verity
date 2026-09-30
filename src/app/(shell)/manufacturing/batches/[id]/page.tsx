import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_MANUFACTURING_BATCH, MANUFACTURING_CAPABILITY } from "@/server/capabilities/manufacturing";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader, Panel, PermissionDenied, Stat, StatRow } from "@/components/ui/primitives";
import { executeQuery } from "@/server/platform/query";
import { batchDetail } from "@/server/capabilities/manufacturing/batch";
import { BatchActions } from "../BatchControls";

export const dynamic = "force-dynamic";

/**
 * One batch: its orders, and what the whole run consumes set against stock. The
 * stock-match is what the batch is for: each order alone may fit while the
 * batch does not, and that shortfall is the thing to see before cutting.
 */
async function BatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  installCapabilities();
  const { id } = await params;
  const actor = await requireActor();

  const state = await withTenant(actor.tenantId, async (tx) => {
    if (!(await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_MANUFACTURING_BATCH))) return "denied" as const;
    return (await tx.manufacturingBatch.findUnique({ where: { id }, select: { id: true } })) ? ("ok" as const) : ("missing" as const);
  });
  if (state === "denied") return <PermissionDenied what="viewing this batch" />;
  if (state === "missing") notFound();

  const batch = await executeQuery(actor, batchDetail, { batchId: id });
  const short = batch.requirements.filter((r) => r.shortfall > 0);
  const held = batch.orders.filter((o) => o.reserved).length;

  return (
    <>
      <PageHeader
        title={batch.reference ?? `Batch ${batch.id.slice(0, 8)}`}
        description={`Produced together at ${batch.location}.`}
        actions={<BatchActions batchId={batch.id} />}
      />

      <StatRow cols={3} className="mb-6">
        <Stat label="Orders" value={batch.orders.length} />
        <Stat label="Holding stock" value={`${held} of ${batch.orders.length}`} />
        <Stat label="Components short" value={short.length} hint={short.length ? "Stock does not cover the whole batch" : "Stock covers the batch"} />
      </StatRow>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Panel title="Orders" flush>
          <DataTable
            caption="Orders in this batch"
            rows={batch.orders.map((o) => ({
              id: o.id,
              order: o.reference ?? `MO ${o.id.slice(0, 8)}`,
              produces: `${o.outputQty} × ${o.outputName}`,
              state: o.state.replace(/_/g, " "),
              stock: o.reserved ? "Held" : "Not held",
            }))}
            columns={[
              { key: "order", header: "Order", variant: "link", href: "/manufacturing/{id}" },
              { key: "produces", header: "Produces" },
              { key: "state", header: "State" },
              { key: "stock", header: "Stock" },
            ]}
            emptyTitle="No orders"
            emptyDescription="This batch has no orders."
          />
        </Panel>

        <Panel title="Stock match" flush>
          <DataTable
            caption="Components the whole batch consumes"
            rows={batch.requirements.map((r) => ({
              id: r.itemId,
              item: r.name,
              required: r.required,
              onHand: r.onHand,
              heldElsewhere: r.heldElsewhere,
              shortfall: r.shortfall,
            }))}
            columns={[
              { key: "item", header: "Component" },
              { key: "required", header: "Needed", numeric: true },
              { key: "onHand", header: "On hand", numeric: true },
              { key: "heldElsewhere", header: "Held by others", numeric: true },
              { key: "shortfall", header: "Short by", numeric: true },
            ]}
            emptyTitle="No components"
            emptyDescription="These orders consume nothing."
          />
        </Panel>
      </div>
    </>
  );
}

export default withCapabilityPageAccess(MANUFACTURING_CAPABILITY, BatchDetailPage);
