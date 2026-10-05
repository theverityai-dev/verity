import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { installCapabilities } from "@/server/capabilities/registry";
import { ASSET_CAPABILITY, ENTITY_ASSET } from "@/server/capabilities/asset";
import { runQuery } from "@/server/actions/platform";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { DataTable } from "@/components/ui/DataTable";
import { ErrorState, PageHeader, Stat, StatRow } from "@/components/ui/primitives";
import { RegisterAsset } from "./RegisterAsset";

export const dynamic = "force-dynamic";

type AssetRecord = { id: string; name: string; reference: string | null; locationId: string | null; state: string };
type Row = Record<string, unknown> & {
  id: string; name: string; reference: string; location: string; state: string; category: string;
};

async function AssetsPage() {
  installCapabilities();
  const actor = await requireActor();

  // The capability's own query carries the read permission.
  const result = await runQuery<AssetRecord[]>("verity.asset.list", {});
  if (!result.ok) {
    return <ErrorState title="Could not load assets" message={result.message} issues={result.issues} retryable={result.retryable} />;
  }

  const [states, locations] = await withTenant(actor.tenantId, (tx) =>
    Promise.all([
      tx.stateDefinition.findMany({ where: { entityKey: ENTITY_ASSET } }),
      tx.location.findMany({ select: { id: true, name: true, active: true }, orderBy: { name: "asc" } }),
    ]),
  );
  const category = new Map(states.map((s) => [s.key, s.category]));
  const locationName = new Map(locations.map((l) => [l.id, l.name]));

  const data = result.data.map<Row>((a) => ({
    id: a.id,
    name: a.name,
    reference: a.reference ?? "",
    location: (a.locationId && locationName.get(a.locationId)) ?? "Unassigned",
    state: a.state.replace(/_/g, " "),
    category: category.get(a.state) ?? "Draft",
  }));

  return (
    <>
      <PageHeader
        title="Assets"
        description="Physical equipment. Equipment-specific attributes live in custom fields."
        actions={<RegisterAsset locations={locations.filter((l) => l.active).map((l) => ({ id: l.id, name: l.name }))} />}
      />

      {/* Counted by the canonical StateCategory (ADR-009) rather than by state
          key, so the figures stay correct when a tenant renames its labels. */}
      <StatRow cols={4} className="mb-6">
        <Stat label="Assets in scope" value={data.length} />
        <Stat label="Active" value={data.filter((r) => r.category === "Active").length} />
        <Stat label="Blocked" value={data.filter((r) => r.category === "Blocked").length} />
        <Stat label="Unassigned" value={data.filter((r) => r.location === "Unassigned").length} />
      </StatRow>

      <DataTable
        caption="Assets"
        rows={data}
        columns={[
          { key: "name", header: "Asset", variant: "link", href: "/assets/{id}", subKey: "reference" },
          { key: "location", header: "Location", sortable: true },
          { key: "state", header: "State", variant: "state", categoryKey: "category" },
        ]}
        emptyTitle="No assets registered"
        emptyDescription="Register the equipment you want to track, schedule and service."
      />
    </>
  );
}

export default withCapabilityPageAccess(ASSET_CAPABILITY, AssetsPage);
