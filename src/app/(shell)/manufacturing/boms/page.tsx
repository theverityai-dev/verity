import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_MANUFACTURING_BOM, MANUFACTURING_CAPABILITY } from "@/server/capabilities/manufacturing";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader, PermissionDenied, Stat, StatRow } from "@/components/ui/primitives";
import { CreateBomForm } from "./CreateBomForm";

export const dynamic = "force-dynamic";

async function BomsPage() {
  installCapabilities();
  const actor = await requireActor();

  const data = await withTenant(actor.tenantId, async (tx) => {
    if (!(await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_MANUFACTURING_BOM))) return null;

    const [boms, items, fields] = await Promise.all([
      tx.manufacturingBom.findMany({
        include: { outputItem: true, _count: { select: { lines: true } } },
        orderBy: { code: "asc" },
      }),
      tx.inventoryItem.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      // What varies between this tenant's products is the tenant's to declare
      // (PLA-EXT-001): the form renders whatever it has declared for BOMs.
      tx.customFieldSchema.findMany({ where: { entityKey: ENTITY_MANUFACTURING_BOM }, orderBy: { fieldName: "asc" } }),
    ]);

    return {
      items,
      fields: fields.map((f) => ({
        name: f.fieldName,
        type: f.fieldType,
        required: f.required,
        options: f.selectOptions,
      })),
      rows: boms.map((b) => ({
        id: b.id,
        code: b.code,
        name: b.name,
        output: b.outputItem.name,
        components: b._count.lines,
        state: b.active ? "active" : "archived",
        category: b.active ? "Active" : "Cancelled",
      })),
    };
  });

  if (!data) return <PermissionDenied what="reading bills of materials" />;
  const { rows } = data;

  return (
    <>
      <PageHeader
        title="Bills of materials"
        description="A reusable recipe for one unit of a finished item. An order made from it scales every line by the quantity."
        actions={<CreateBomForm items={data.items} fields={data.fields} />}
      />

      <StatRow cols={3} className="mb-6">
        <Stat label="Bills of materials" value={rows.length} />
        <Stat label="Active" value={rows.filter((r) => r.state === "active").length} />
        <Stat label="Archived" value={rows.filter((r) => r.state === "archived").length} />
      </StatRow>

      <DataTable
        caption="Bills of materials"
        rows={rows}
        columns={[
          { key: "code", header: "Code", variant: "link", href: "/manufacturing/boms/{id}", subKey: "name", sortable: true },
          { key: "output", header: "Produces" },
          { key: "components", header: "Components", numeric: true, sortable: true },
          { key: "state", header: "State", variant: "state", categoryKey: "category" },
        ]}
        emptyTitle="No bills of materials"
        emptyDescription="Create one to stop retyping the same component list on every order."
      />
    </>
  );
}

export default withCapabilityPageAccess(MANUFACTURING_CAPABILITY, BomsPage);
