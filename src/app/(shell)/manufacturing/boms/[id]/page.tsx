import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_MANUFACTURING_BOM, MANUFACTURING_CAPABILITY } from "@/server/capabilities/manufacturing";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { DataTable } from "@/components/ui/DataTable";
import { DefinitionList, PageHeader, Panel, PermissionDenied, Stat, StatRow, StateBadge } from "@/components/ui/primitives";
import { BomActions } from "./BomActions";

export const dynamic = "force-dynamic";

async function BomDetailPage({ params }: { params: Promise<{ id: string }> }) {
  installCapabilities();
  const { id } = await params;
  const actor = await requireActor();

  const data = await withTenant(actor.tenantId, async (tx) => {
    if (!(await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_MANUFACTURING_BOM))) return { denied: true as const };

    const bom = await tx.manufacturingBom.findUnique({
      where: { id },
      include: { outputItem: true, lines: { include: { componentItem: true } }, _count: { select: { orders: true } } },
    });
    if (!bom) return { notFound: true as const };

    const locations = await tx.location.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
    return { bom, locations };
  });

  if ("denied" in data) return <PermissionDenied what="viewing this bill of materials" />;
  if ("notFound" in data) notFound();

  const { bom } = data;
  const custom = Object.entries((bom.customFields ?? {}) as Record<string, unknown>);

  return (
    <>
      <PageHeader
        title={`${bom.code} · ${bom.name}`}
        description={`One unit produces ${bom.outputItem.name}. An order scales every line by its quantity.`}
        actions={<BomActions bomId={bom.id} active={bom.active} locations={data.locations} />}
      />

      <StatRow cols={4} className="mb-6">
        <div className="flex flex-col px-5 py-4">
          <span className="flex h-[26px] items-center text-[15px]">
            <StateBadge category={bom.active ? "Active" : "Cancelled"} label={bom.active ? "active" : "archived"} />
          </span>
          <span className="mt-2 text-[12px] leading-[1.3] text-text-tertiary">State</span>
        </div>
        <Stat label="Components" value={bom.lines.length} />
        <Stat label="Orders made" value={bom._count.orders} />
        <Stat label="Version" value={bom.version} hint="Optimistic concurrency" />
      </StatRow>

      <div className="grid items-start gap-6 lg:grid-cols-[1.35fr_1fr]">
        <Panel title="Per unit" flush>
          <DataTable
            caption="Components for one unit"
            rows={bom.lines.map((l) => ({ id: l.id, item: l.componentItem.name, qty: l.qtyPerUnit }))}
            columns={[
              { key: "item", header: "Component" },
              { key: "qty", header: "Qty per unit", numeric: true },
            ]}
            emptyTitle="No components"
            emptyDescription="This BOM consumes nothing."
          />
        </Panel>

        <Panel title="Details">
          {custom.length === 0 ? (
            <p className="m-0 text-[13px] text-text-tertiary">No details recorded.</p>
          ) : (
            <DefinitionList
              items={custom.map(([term, value]) => ({ term: term.replace(/_/g, " "), value: String(value) }))}
            />
          )}
        </Panel>
      </div>
    </>
  );
}

export default withCapabilityPageAccess(MANUFACTURING_CAPABILITY, BomDetailPage);
