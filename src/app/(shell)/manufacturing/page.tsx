import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_MANUFACTURING_ORDER, MANUFACTURING_CAPABILITY } from "@/server/capabilities/manufacturing";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader, PermissionDenied, StatTile, StatTileRow } from "@/components/ui/primitives";
import { equipmentKindFor } from "@/components/ui/business/domains";
import { CreateOrderForm } from "./CreateOrderForm";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown> & {
  id: string;
  reference: string;
  output: string;
  qty: number;
  location: string;
  state: string;
  category: string;
  kind: string;
  progress: string;
};

async function ManufacturingPage() {
  installCapabilities();
  const actor = await requireActor();

  const data = await withTenant(actor.tenantId, async (tx) => {
    if (!(await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_MANUFACTURING_ORDER))) return null;

    const [orders, states, locations, items] = await Promise.all([
      tx.manufacturingOrder.findMany({
        include: { outputItem: true, location: true },
        orderBy: { createdAt: "desc" },
      }),
      tx.stateDefinition.findMany({ where: { entityKey: ENTITY_MANUFACTURING_ORDER } }),
      tx.location.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      tx.inventoryItem.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);
    const category = new Map(states.map((s) => [s.key, s.category]));
    // Stage progress per order: live stages only (a send-back cancels and appends, so cancelled rows are history).
    const ops = await tx.manufacturingOperation.findMany({
      where: { orderId: { in: orders.map((o) => o.id) }, state: { not: "cancelled" } },
      select: { orderId: true, state: true },
    });
    const progress = new Map<string, { done: number; total: number }>();
    for (const op of ops) {
      const p = progress.get(op.orderId) ?? { done: 0, total: 0 };
      p.total++;
      if (op.state === "completed") p.done++;
      progress.set(op.orderId, p);
    }

    return {
      locations,
      items,
      rows: orders.map<Row>((o) => ({
        id: o.id,
        reference: o.reference ?? `MO ${o.id.slice(0, 8)}`,
        output: o.outputItem.name,
        qty: o.outputQty,
        location: o.location.name,
        state: o.state.replace(/_/g, " "),
        category: category.get(o.state) ?? "Draft",
        kind: equipmentKindFor(o.outputItem.name),
        progress: (() => {
          const p = progress.get(o.id);
          return p ? `${p.done} of ${p.total} stages done` : "No stages planned";
        })(),
      })),
    };
  });

  if (!data) return <PermissionDenied what="reading manufacturing orders" />;
  const { rows } = data;

  return (
    <>
      <PageHeader
        title="Manufacturing orders"
        description="Turn components into finished goods. Starting an order consumes stock; completing it receives the output."
        actions={<CreateOrderForm locations={data.locations} items={data.items} />}
      />

      {/* Counted by canonical StateCategory (ADR-009), not state key, so a
          tenant that renames its own labels still gets correct figures. */}
      <StatTileRow className="mb-6">
        <StatTile kind="job" label="Orders" value={rows.length} />
        <StatTile state="draft" icon="quote" label="Draft" value={rows.filter((r) => r.category === "Draft").length} />
        <StatTile state="active" icon="stage" label="In progress" value={rows.filter((r) => r.category === "Active").length} />
        <StatTile state="completed" icon="check" label="Completed" value={rows.filter((r) => r.category === "Completed").length} />
      </StatTileRow>

      <DataTable
        caption="Manufacturing orders"
        rows={rows}
        columns={[
          { key: "reference", header: "Order", variant: "link", href: "/manufacturing/{id}" },
          { key: "output", header: "Produces", kindKey: "kind" },
          { key: "qty", header: "Quantity", numeric: true, sortable: true },
          { key: "location", header: "Location" },
          { key: "state", header: "State", variant: "state", categoryKey: "category", subKey: "progress" },
        ]}
        emptyTitle="No manufacturing orders"
        emptyDescription="An order lists the components it consumes and the item it produces. Create one to begin."
      />
    </>
  );
}

export default withCapabilityPageAccess(MANUFACTURING_CAPABILITY, ManufacturingPage);
