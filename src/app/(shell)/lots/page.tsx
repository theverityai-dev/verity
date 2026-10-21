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
import { STATUS_CATEGORY, STATUS_LABEL, shortDate } from "./format";

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
        <PageHeader title="Lots" description="A lot is cut into numbered bundles, and each bundle moves through the stages." />
        <EmptyState
          title="Set up the stages first"
          description="Add the stages a bundle goes through, in order, for example Pasting, Collar & Cuff, Stitching, Button / Kaj, Finishing."
          action={<DefineStageForm next={1} />}
        />
      </>
    );
  }

  const live = lots.filter((l) => l.status !== "cancelled");
  return (
    <>
      <PageHeader
        title="Lots"
        description={`${stages.map((s) => s.label).join(" › ")} › Ready. Every lot has a number; every bundle cut from it has its own slip and its own record.`}
        actions={
          <>
            <CommandAccess commands="verity.piecework.record_issue">
              <ButtonLink href="/lots/entry" variant="secondary">Daily entry</ButtonLink>
            </CommandAccess>
            <NewLotForm />
          </>
        }
      />

      <StatTileRow cols={4} className="mb-6">
        <StatTile icon="batch" hue="teal" label="Open lots" value={live.filter((l) => ["draft", "active", "hold"].includes(l.status)).length} />
        <StatTile state="pending" icon="clock" label="Pieces pending" value={live.reduce((s, l) => s + l.pendingPieces, 0)} />
        <StatTile state="completed" icon="check" label="Good pieces ready" value={live.reduce((s, l) => s + l.readyPieces, 0)} />
        <StatTile state="blocked" icon="flag" label="Overdue lots" value={live.filter((l) => l.overdue).length} />
      </StatTileRow>

      <DataTable
        caption="Lots"
        rows={lots.map((l) => ({
          id: l.id,
          number: l.number,
          title: l.name ? `${l.name} · ${l.design}` : l.design,
          stage: l.stageLabel ?? "—",
          location: l.location,
          bundles: l.bundles,
          cut: `${l.bundledPieces} of ${l.plannedPieces}`,
          pending: l.pendingPieces,
          due: l.dueDate ? `${shortDate(l.dueDate)}${l.overdue ? " (overdue)" : ""}` : "—",
          progress: l.status === "cancelled" || l.bundledPieces === 0 ? null : { value: l.readyPieces, total: l.bundledPieces, tone: l.status === "completed" || l.status === "closed" ? ("completed" as const) : ("active" as const), figures: `${l.readyPieces} of ${l.bundledPieces}` },
          losses: l.rejectedPieces + l.shortPieces + l.reworkPieces === 0 ? "—" : `${l.rejectedPieces} rej · ${l.reworkPieces} rework · ${l.shortPieces} short`,
          state: STATUS_LABEL[l.status],
          category: STATUS_CATEGORY[l.status],
        }))}
        columns={[
          { key: "number", header: "Lot", variant: "link", href: "/lots/{id}", subKey: "title", sortable: true },
          { key: "stage", header: "Stage" },
          { key: "location", header: "Location" },
          { key: "bundles", header: "Bundles", numeric: true, sortable: true },
          { key: "cut", header: "Cut of planned", numeric: true },
          { key: "pending", header: "Pending", numeric: true, sortable: true },
          { key: "progress", header: "Good ready", variant: "meter" },
          { key: "losses", header: "Reject · rework · short" },
          { key: "due", header: "Due", sortable: true },
          { key: "state", header: "Status", variant: "state", categoryKey: "category" },
        ]}
        emptyTitle="No lots yet"
        emptyDescription="Create a lot, start it, then cut its bundles."
      />
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, LotsPage);
