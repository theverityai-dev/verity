import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_MANUFACTURING_ORDER, MANUFACTURING_CAPABILITY } from "@/server/capabilities/manufacturing";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader, PermissionDenied, Stat, StatRow } from "@/components/ui/primitives";
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
      })),
    };
  });

  if (!data) return <PermissionDenied what="reading manufacturing orders" />;
  const { rows } = data;

  return (
    <>
      <PageHeader
        title="Manufacturing"
        description="Turn components into finished goods. Starting an order consumes stock; completing it receives the output."
        actions={<CreateOrderForm locations={data.locations} items={data.items} />}
      />

      {/* Counted by canonical StateCategory (ADR-009), not state key, so a
          tenant that renames its own labels still gets correct figures. */}
      <StatRow cols={4} className="mb-6">
        <Stat label="Orders" value={rows.length} />
        <Stat label="Draft" value={rows.filter((r) => r.category === "Draft").length} />
        <Stat label="In progress" value={rows.filter((r) => r.category === "Active").length} />
        <Stat label="Completed" value={rows.filter((r) => r.category === "Completed").length} />
      </StatRow>

      <DataTable
        caption="Manufacturing orders"
        rows={rows}
        columns={[
          { key: "reference", header: "Order", variant: "link", href: "/manufacturing/{id}" },
          { key: "output", header: "Produces" },
          { key: "qty", header: "Quantity", numeric: true, sortable: true },
          { key: "location", header: "Location" },
          { key: "state", header: "State", variant: "state", categoryKey: "category" },
        ]}
        emptyTitle="No manufacturing orders"
        emptyDescription="An order lists the components it consumes and the item it produces. Create one to begin."
      />
    </>
  );
}

export default withCapabilityPageAccess(MANUFACTURING_CAPABILITY, ManufacturingPage);
