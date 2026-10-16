import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import { executeQuery } from "@/server/platform/query";
import { ENTITY_MANUFACTURING_OPERATION, MANUFACTURING_CAPABILITY } from "@/server/capabilities/manufacturing";
import { operationQueue, orderOperations } from "@/server/capabilities/manufacturing/stages";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { DefinitionList, FilterChipRow, PageHeader, PermissionDenied, StateBadge, StatTile, StatTileRow } from "@/components/ui/primitives";
import { DetailPane, MasterDetail, PaneFact } from "@/components/ui/DetailPane";
import { IconTile } from "@/components/ui/IconTile";
import { Tabs } from "@/components/ui/Tabs";
import { kindPresentation, stageKindFor } from "@/components/ui/business/domains";
import { ChecklistPanel } from "../ChecklistPanel";
import { OperationActions } from "../OperationActions";
import { FloorQueue, type FloorRow } from "./FloorQueue";

export const dynamic = "force-dynamic";

const when = (d: Date | null) =>
  d ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(d) : "—";

/**
 * The operator's view of the factory: the open stages of RUNNING orders (Task 127 Phase 2, the
 * shop-floor mockup). A stage shows Start only when everything before it is done, so an operator is
 * never offered work that would be refused. Selecting a row opens its checklist, details and stages in
 * a pane with the stage's outcomes always in view.
 */
async function FloorPage({ searchParams }: { searchParams: Promise<{ stage?: string; op?: string; all?: string }> }) {
  installCapabilities();
  const { stage, op, all: showAllParam } = await searchParams;
  const actor = await requireActor();

  const allowed = await withTenant(actor.tenantId, (tx) =>
    hasTenantPermission(tx, actor.roleId, "Read", ENTITY_MANUFACTURING_OPERATION),
  );
  if (!allowed) return <PermissionDenied what="reading the production floor" />;

  const everything = await executeQuery(actor, operationQueue, {});

  // A worker can be given a focus: the kinds of stage they work (winding, testing, ...), kept on their
  // membership. It narrows what the list opens with; it is a view, not a permission, so "Show all stages"
  // is always one tap away and the commands are still authorized as before.
  const focusKinds = await withTenant(actor.tenantId, async (tx) => {
    const m = await tx.tenantMembership.findFirst({ where: { id: actor.membershipId, tenantId: actor.tenantId }, select: { customFields: true } });
    const raw = (m?.customFields as { stageKinds?: unknown } | null)?.stageKinds;
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string") : [];
  });
  const showAll = showAllParam === "1";
  const focused = focusKinds.length > 0 && !showAll;
  const all = focused ? everything.filter((r) => focusKinds.includes(stageKindFor(r.stageKey, r.label))) : everything;
  const keep = showAll && focusKinds.length > 0 ? "all=1" : "";

  // Stage chips come from the work that exists, in the order it first appears.
  const stages: Array<{ stageKey: string; label: string; count: number }> = [];
  for (const r of all) {
    const s = stages.find((x) => x.stageKey === r.stageKey);
    if (s) s.count++;
    else stages.push({ stageKey: r.stageKey, label: r.label, count: 1 });
  }

  const shown = stage ? all.filter((r) => r.stageKey === stage) : all;
  const rows: FloorRow[] = shown.map((r) => ({
    id: r.id,
    orderId: r.orderId,
    order: r.orderReference,
    item: r.outputItemName,
    qty: r.outputQty,
    stage: r.label + (r.reworkOfId ? " (rework)" : ""),
    kind: stageKindFor(r.stageKey, r.label),
    position: `Stage ${r.stageIndex} of ${r.stageCount}`,
    state: r.state.replace(/_/g, " "),
    rawState: r.state,
    category: r.category,
    actionable: r.actionable,
    sendBackTo: r.sendBackTo,
    checklist: r.checklist,
  }));

  const baseQuery = [stage ? `stage=${encodeURIComponent(stage)}` : "", keep].filter(Boolean).join("&");
  const listHref = `/manufacturing/floor${baseQuery ? `?${baseQuery}` : ""}`;
  const selected = op ? everything.find((r) => r.id === op) : undefined;
  const orderStages = selected ? await executeQuery(actor, orderOperations, { orderId: selected.orderId }) : [];

  const onHold = all.filter((r) => r.state === "on_hold").length;
  const rework = all.filter((r) => r.reworkOfId).length;

  const pane = selected ? (
    <DetailPane
      label="Selected stage"
      title={selected.orderReference}
      subtitle={selected.outputItemName}
      openHref={`/manufacturing/${selected.orderId}`}
      closeHref={listHref}
      summary={
        <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.8fr)] items-center gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <IconTile kind={stageKindFor(selected.stageKey, selected.label)} />
            <PaneFact label="Current stage" value={selected.label} />
          </div>
          <PaneFact label="Stage order" value={`${selected.stageIndex} of ${selected.stageCount}`} />
          <PaneFact label="Quantity" value={selected.outputQty} />
        </div>
      }
      footer={
        <OperationActions
          layout="bar"
          operationId={selected.id}
          state={selected.state}
          actionable={selected.actionable}
          sendBackTo={selected.sendBackTo}
          checklist={selected.checklist}
          revalidate="/manufacturing/floor"
        />
      }
    >
      <Tabs
        tabs={[
          {
            id: "checklist",
            label: `Checklist (${selected.checklist.passed}/${selected.checklist.total})`,
            content:
              selected.checklist.total > 0 ? (
                <ChecklistPanel key={selected.id} operationId={selected.id} revalidate="/manufacturing/floor" layout="pane" />
              ) : (
                <p className="m-0 py-2 text-[15px] text-text-secondary">This stage has no checklist.</p>
              ),
          },
          {
            id: "details",
            label: "Details",
            content: (
              <DefinitionList
                items={[
                  { term: "State", value: <StateBadge category={selected.category} label={selected.state.replace(/_/g, " ")} /> },
                  { term: "Started", value: when(selected.startedAt) },
                  { term: "Note", value: selected.note ?? "—" },
                  { term: "Rework", value: selected.reworkOfId ? "Yes, redoing an earlier attempt" : "No" },
                ]}
              />
            ),
          },
          {
            id: "stages",
            label: "Stages",
            count: orderStages.length,
            content: (
              <ol className="m-0 flex list-none flex-col gap-2 p-0">
                {orderStages
                  .filter((s) => s.state !== "cancelled")
                  .map((s, i) => (
                    <li key={s.id} className={"flex items-center gap-3 rounded-[12px] px-3 py-2.5 " + (s.id === selected.id ? "bg-accent-subtle" : "bg-[var(--color-surface-sunken)]")}>
                      <span className="tabular w-5 text-[13px] font-semibold text-text-tertiary">{i + 1}</span>
                      <IconTile kind={stageKindFor(s.stageKey, s.label)} size="sm" />
                      <span className="min-w-0 flex-1 text-[15px] text-text">{s.label}</span>
                      <StateBadge category={s.category} label={s.state.replace(/_/g, " ")} />
                    </li>
                  ))}
              </ol>
            ),
          },
        ]}
      />
    </DetailPane>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Shop floor"
        description="Open stages of running orders. Work can only start when everything before it is done."
      />

      {focusKinds.length > 0 && (
        <p className="mb-4 mt-0 flex flex-wrap items-center gap-x-2 text-[15px] text-text-secondary">
          {focused ? "Showing the stages you work." : "Showing every stage."}
          <a href={focused ? "/manufacturing/floor?all=1" : "/manufacturing/floor"} className="font-medium text-accent-ink">
            {focused ? "Show all stages" : "Back to my stages"}
          </a>
        </p>
      )}

      <StatTileRow className="mb-5">
        <StatTile state="active" icon="stage" label="Open stages" value={all.length} />
        <StatTile state="completed" icon="check" label="Ready to start" value={all.filter((r) => r.actionable).length} />
        <StatTile state="pending" icon="hold" label="On hold" value={onHold} />
        <StatTile state="blocked" icon="rework" label="Rework" value={rework} />
      </StatTileRow>

      <nav aria-label="Filter by stage" className="mb-4">
        <FilterChipRow
          chips={[
            { label: focused ? "My stages" : "All stages", count: all.length, active: !stage, href: `/manufacturing/floor${keep ? `?${keep}` : ""}` },
            ...stages.map((s) => ({
              label: s.label,
              count: s.count,
              icon: kindPresentation(stageKindFor(s.stageKey, s.label)).icon,
              active: stage === s.stageKey,
              href: `/manufacturing/floor?stage=${encodeURIComponent(s.stageKey)}${keep ? `&${keep}` : ""}`,
            })),
          ]}
        />
      </nav>

      <MasterDetail list={<FloorQueue rows={rows} selectedId={selected?.id} baseQuery={baseQuery} />} pane={pane} />
    </>
  );
}

export default withCapabilityPageAccess(MANUFACTURING_CAPABILITY, FloorPage);
