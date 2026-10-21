import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_LOT, PIECEWORK_CAPABILITY, listLots, listStages } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { CommandAccess } from "@/components/ui/CommandAccess";
import { DataTable } from "@/components/ui/DataTable";
import { ButtonLink, EmptyState, PageHeader, PermissionDenied, StatTile, StatTileRow } from "@/components/ui/primitives";
import { DefineStageForm, NewLotForm } from "./LotForms";
import { PHASE_CATEGORY, PHASE_LABEL } from "./format";

export const dynamic = "force-dynamic";

async function LotsPage() {
  installCapabilities();
  const actor = await requireActor();

  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_LOT));
  if (!allowed) return <PermissionDenied what="reading lots" />;

  const [lots, stages] = await Promise.all([executeQuery(actor, listLots, {}), executeQuery(actor, listStages, {})]);

  if (stages.length === 0) {
    return (
      <>
        <PageHeader title="Lots" description="One batch of cloth cut and made into garments together, tracked under one number." />
        <EmptyState
          title="Set up the stages first"
          description="A lot moves through stages such as Cutting, Stitching, Button / Kaj, Finishing and Press. Add them once, in order."
          action={<DefineStageForm next={1} />}
        />
      </>
    );
  }

  const live = lots.filter((l) => l.phase !== "cancelled");
  return (
    <>
      <PageHeader
        title="Lots"
        description={`${stages.map((s) => s.label).join(" › ")} › Ready. Every lot has its own number and a count of pieces issued, received and pending at each stage.`}
        actions={
          <>
            <CommandAccess commands="verity.piecework.record_entry">
              <ButtonLink href="/lots/entry" variant="secondary">Daily entry</ButtonLink>
            </CommandAccess>
            <NewLotForm />
          </>
        }
      />

      <StatTileRow cols={4} className="mb-6">
        <StatTile icon="batch" hue="teal" label="Active lots" value={live.filter((l) => l.phase !== "ready").length} />
        <StatTile state="pending" icon="clock" label="Pieces pending" value={live.reduce((s, l) => s + l.pendingPieces, 0)} />
        <StatTile state="completed" icon="check" label="Ready pieces" value={live.reduce((s, l) => s + l.readyPieces, 0)} />
        <StatTile icon="stock" hue="indigo" label="Ready bundles" value={live.reduce((s, l) => s + l.readyBundles, 0)} />
      </StatTileRow>

      <DataTable
        caption="Lots"
        rows={lots.map((l) => ({
          id: l.id,
          number: l.number,
          design: l.design,
          stage: l.stageLabel ?? "—",
          location: l.location,
          total: l.totalPieces,
          pending: l.pendingPieces,
          days: l.daysHere,
          progress: l.phase === "cancelled" ? null : { value: l.readyPieces, total: l.totalPieces, tone: l.phase === "ready" ? ("completed" as const) : ("active" as const), figures: `${l.readyPieces} of ${l.totalPieces}` },
          state: PHASE_LABEL[l.phase],
          category: PHASE_CATEGORY[l.phase],
        }))}
        columns={[
          { key: "number", header: "Lot", variant: "link", href: "/lots/{id}", subKey: "design", sortable: true },
          { key: "stage", header: "Stage" },
          { key: "location", header: "Location" },
          { key: "total", header: "Total pieces", numeric: true, sortable: true },
          { key: "pending", header: "Pending", numeric: true, sortable: true },
          { key: "days", header: "Days here", numeric: true, sortable: true },
          { key: "progress", header: "Ready", variant: "meter" },
          { key: "state", header: "State", variant: "state", categoryKey: "category" },
        ]}
        emptyTitle="No lots yet"
        emptyDescription="Create a lot to start tracking its pieces through the stages."
      />
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, LotsPage);
