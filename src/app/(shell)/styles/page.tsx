import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_INVENTORY_TEMPLATE, INVENTORY_CAPABILITY, listAttributes, listTemplates } from "@/server/capabilities/inventory";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { DataTable } from "@/components/ui/DataTable";
import { ButtonLink, PageHeader, PermissionDenied, StatTile, StatTileRow } from "@/components/ui/primitives";
import { hasTenantPermission } from "@/server/platform/authorization";
import { gstLabel } from "./gst";
import { CreateStyleForm } from "./CreateStyleForm";

export const dynamic = "force-dynamic";

async function StylesPage() {
  installCapabilities();
  const actor = await requireActor();

  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Read", ENTITY_INVENTORY_TEMPLATE));
  if (!allowed) return <PermissionDenied what="reading styles" />;

  const [styles, lists, groups] = await Promise.all([
    executeQuery(actor, listTemplates, { includeInactive: true }),
    executeQuery(actor, listAttributes, {}),
    withTenant(actor.tenantId, (tx) => tx.inventoryItemGroup.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } })),
  ]);

  const live = styles.filter((s) => s.active);
  const toGenerate = live.reduce((sum, s) => sum + s.missing, 0);

  return (
    <>
      <PageHeader
        title="Styles"
        description="A style is one product in many colours and sizes. Pick the colours and sizes it comes in, then generate its stock-keeping variants once."
        actions={
          <>
            <ButtonLink href="/styles/lists" variant="ghost">Colours and sizes</ButtonLink>
            <CreateStyleForm lists={lists} groups={groups} />
          </>
        }
      />

      <StatTileRow cols={4} className="mb-6">
        <StatTile icon="tag" hue="teal" label="Styles" value={live.length} />
        <StatTile icon="stock" hue="indigo" label="Variants" value={styles.reduce((sum, s) => sum + s.variants, 0)} />
        <StatTile state="pending" icon="clock" label="Variants to generate" value={toGenerate} />
        <StatTile icon="catalogue" hue="purple" label="Colour and size lists" value={lists.length} />
      </StatTileRow>

      <DataTable
        caption="Styles"
        rows={styles.map((s) => ({
          id: s.id,
          code: s.code,
          name: s.name,
          offered: s.axes.map((a) => `${a.offered} ${a.label.toLowerCase()}`).join(" · "),
          season: s.season ?? "—",
          coverage:
            s.combinations === 0
              ? null
              : {
                  value: Math.min(s.variants, s.combinations),
                  total: s.combinations,
                  tone: s.missing > 0 ? ("pending" as const) : ("active" as const),
                  figures: `${s.combinations - s.missing} of ${s.combinations}`,
                },
          gst: gstLabel(s.taxRateBp),
          hsn: s.hsnCode ?? "Not set",
          state: s.active ? "active" : "archived",
          category: s.active ? "Active" : "Cancelled",
        }))}
        columns={[
          { key: "code", header: "Style", variant: "link", href: "/styles/{id}", subKey: "name", sortable: true },
          { key: "offered", header: "Offered in" },
          { key: "season", header: "Season", sortable: true },
          { key: "coverage", header: "Variants generated", variant: "meter" },
          { key: "hsn", header: "HSN" },
          { key: "gst", header: "GST" },
          { key: "state", header: "State", variant: "state", categoryKey: "category" },
        ]}
        emptyTitle="No styles yet"
        emptyDescription="Create a style, choose the colours and sizes it comes in, and generate its variants. Define the colours and sizes first under Colours and sizes."
      />
    </>
  );
}

export default withCapabilityPageAccess(INVENTORY_CAPABILITY, StylesPage);
