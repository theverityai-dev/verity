import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import {
  ENTITY_MANUFACTURING_DISPATCH,
  ENTITY_MANUFACTURING_OPERATION,
  ENTITY_MANUFACTURING_ORDER,
  ENTITY_MANUFACTURING_PASSPORT,
  ENTITY_MANUFACTURING_RESERVATION,
  MANUFACTURING_CAPABILITY,
} from "@/server/capabilities/manufacturing";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { entityHistory } from "@/server/platform/audit";
import { DataTable } from "@/components/ui/DataTable";
import { Panel, PermissionDenied, StatTile, StatTileRow } from "@/components/ui/primitives";
import { EntityHeader } from "@/components/ui/EntityHeader";
import { JourneyMap, type JourneyStatus, type JourneyStep } from "@/components/ui/JourneyMap";
import { ProgressRing } from "@/components/ui/viz";
import { STAGE_KIND_LABEL, equipmentKindFor, kindPresentation, stageKindFor } from "@/components/ui/business/domains";
import { AuditTrail } from "@/components/shell/AuditTrail";
import { executeQuery } from "@/server/platform/query";
import { listRoutes, orderOperations } from "@/server/capabilities/manufacturing/stages";
import { orderPassport } from "@/server/capabilities/manufacturing/passport";
import { orderDispatch } from "@/server/capabilities/manufacturing/logistics";
import { orderReservations } from "@/server/capabilities/manufacturing/batch";
import { PassportPanel } from "./PassportPanel";
import { DispatchPanel, StockHoldPanel } from "./LogisticsPanels";
import { OrderActions } from "./OrderActions";
import { StagesPanel, type StageRow } from "./StagesPanel";

export const dynamic = "force-dynamic";

/**
 * Manufacturing order detail: the state (which decides what can still be done,
 * and INV-002 read-only once terminal), what it produces, what it consumes, and
 * the history of every change.
 */
async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  installCapabilities();
  const { id } = await params;
  const actor = await requireActor();

  const data = await withTenant(actor.tenantId, async (tx) => {
    if (!(await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_MANUFACTURING_ORDER))) {
      return { denied: true as const };
    }
    const order = await tx.manufacturingOrder.findUnique({
      where: { id },
      include: { outputItem: true, location: true, bom: true, lines: { include: { componentItem: true } } },
    });
    if (!order) return { notFound: true as const };

    const [states, history] = await Promise.all([
      tx.stateDefinition.findMany({ where: { entityKey: ENTITY_MANUFACTURING_ORDER } }),
      entityHistory(tx, ENTITY_MANUFACTURING_ORDER, order.id),
    ]);
    const current = states.find((s) => s.key === order.state);
    return { order, category: current?.category ?? "Draft", isTerminal: current?.isTerminal ?? false, history };
  });

  if ("denied" in data) return <PermissionDenied what="viewing this manufacturing order" />;
  if ("notFound" in data) notFound();

  const { order } = data;
  const title = order.reference ?? `MO ${order.id.slice(0, 8)}`;

  // Stages are a separate entity with their own Read grant; without it the
  // panel simply is not shown, and the rest of the order is unaffected.
  const canSeeStages = await withTenant(actor.tenantId, (tx) =>
    hasTenantPermission(tx, actor.roleId, "Read", ENTITY_MANUFACTURING_OPERATION),
  );
  const stages: StageRow[] = canSeeStages
    ? (await executeQuery(actor, orderOperations, { orderId: order.id })).map((o) => ({
        id: o.id,
        sequence: o.sequence,
        stageKey: o.stageKey,
        label: o.label,
        state: o.state,
        category: o.category,
        note: o.note,
        rework: o.reworkOfId !== null,
        startedAt: o.startedAt?.toISOString() ?? null,
        completedAt: o.completedAt?.toISOString() ?? null,
        actionable: o.actionable,
        checklist: o.checklist,
      }))
    : [];
  const routes = canSeeStages && stages.length === 0 ? await executeQuery(actor, listRoutes, {}) : [];

  // The passport is its own entity with its own grant: publishing is a disclosure
  // decision, so the panel is shown only to someone who may read passports.
  const canSeePassport = await withTenant(actor.tenantId, (tx) =>
    hasTenantPermission(tx, actor.roleId, "Read", ENTITY_MANUFACTURING_PASSPORT),
  );
  const passport = canSeePassport ? await executeQuery(actor, orderPassport, { orderId: order.id }) : null;

  // Dispatch and stock holds are likewise their own entities with their own grants.
  const [canSeeDispatch, canSeeHold] = await withTenant(actor.tenantId, async (tx) => [
    await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_MANUFACTURING_DISPATCH),
    await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_MANUFACTURING_RESERVATION),
  ]);
  const dispatch = canSeeDispatch ? await executeQuery(actor, orderDispatch, { orderId: order.id }) : null;
  const hold = canSeeHold && order.state === "draft" ? await executeQuery(actor, orderReservations, { orderId: order.id }) : null;

  // The live journey (Task 127 Phase 3): the latest attempt of each stage, coloured by its state.
  // A send-back cancels open stages and appends fresh ones, so cancelled rows are history, not the path.
  const live = stages.filter((s) => s.state !== "cancelled");
  const STATUS: Record<string, JourneyStatus> = {
    completed: "done",
    in_progress: "active",
    on_hold: "held",
    pending: "pending",
  };
  const steps: JourneyStep[] = live.map((s) => {
    const kind = stageKindFor(s.stageKey, s.label);
    const open = s.state === "pending" || s.state === "in_progress" || s.state === "on_hold";
    return {
      key: s.id,
      label: s.label + (s.rework ? " (rework)" : ""),
      kind,
      status: STATUS[s.state] ?? "pending",
      description: s.note ?? undefined,
      chip:
        s.checklist.total > 0
          ? { icon: "stage-testing", label: `${s.checklist.passed} of ${s.checklist.total} checks passed` }
          : { icon: kindPresentation(kind).icon, label: STAGE_KIND_LABEL[kind] ?? "Production stage" },
      // An open stage opens in the floor's pane, where its outcomes live.
      href: open && order.state === "in_progress" ? `/manufacturing/floor?op=${s.id}` : undefined,
    };
  });
  const done = live.filter((s) => s.state === "completed").length;
  const checksTotal = live.reduce((n, s) => n + s.checklist.total, 0);
  const checksPassed = live.reduce((n, s) => n + s.checklist.passed, 0);
  const current = live.find((s) => s.state === "in_progress" || s.state === "on_hold") ?? live.find((s) => s.state === "pending");

  return (
    <>
      <EntityHeader
        crumbs={[{ label: "Manufacturing orders", href: "/manufacturing" }, { label: title }]}
        title={title}
        state={{ category: data.category, label: order.state.replace(/_/g, " ") }}
        meta={[
          `${order.outputQty} × ${order.outputItem.name}`,
          order.location.name,
          ...(order.bom ? [`BOM ${order.bom.code}`] : []),
        ]}
        description={data.isTerminal ? "This order is closed and permanently read-only." : undefined}
        actions={<OrderActions orderId={order.id} state={order.state} />}
      />

      <StatTileRow className="mb-6">
        <StatTile kind={equipmentKindFor(order.outputItem.name)} label="Produces" value={order.outputQty} hint={order.outputItem.name} />
        <StatTile
          state={done === live.length && live.length > 0 ? "completed" : "active"}
          icon="stage"
          label="Stages done"
          value={live.length > 0 ? `${done} of ${live.length}` : "—"}
          hint={current ? `Now: ${current.label}` : undefined}
          viz={live.length > 0 ? <ProgressRing value={done} total={live.length} label="Stages done" showValue={false} /> : undefined}
        />
        <StatTile
          kind="certificate"
          label="Quality checks passed"
          value={checksTotal > 0 ? `${checksPassed} of ${checksTotal}` : "—"}
          viz={checksTotal > 0 ? <ProgressRing value={checksPassed} total={checksTotal} label="Quality checks passed" showValue={false} /> : undefined}
        />
        <StatTile kind="stock" label="Components" value={order.lines.length} />
      </StatTileRow>

      {canSeeStages && steps.length > 0 && (
        <Panel title="Production journey" className="mb-6">
          <p className="m-0 mb-4 text-[15px] text-text-secondary">
            Green is done, blue is in progress, amber is on hold, grey has not started. Open a running stage to work it on the floor.
          </p>
          <JourneyMap steps={steps} selectedKey={current?.id} label={`${title} stages`} />
        </Panel>
      )}

      {hold && (
        <div className="mb-6">
          <Panel title="Stock" flush>
            <StockHoldPanel orderId={order.id} held={hold.held} lines={hold.lines} />
          </Panel>
        </div>
      )}

      {canSeeStages && (
        <div className="mb-6">
          <Panel title={stages.length > 0 ? "Stage actions" : "Stages"} flush>
            <StagesPanel
              orderId={order.id}
              orderState={order.state}
              stages={stages}
              routes={routes.map((r) => ({ id: r.id, code: r.code, name: r.name, stages: r.stages.map((s) => s.label).join(" → ") }))}
            />
          </Panel>
        </div>
      )}

      {passport && (order.state === "completed" || passport.active) && (
        <div className="mb-6">
          <Panel title="Verification passport" flush>
            <PassportPanel
              orderId={order.id}
              orderState={order.state}
              active={passport.active ? { id: passport.active.id, issuedAt: passport.active.issuedAt.toISOString(), reference: passport.active.reference } : null}
            />
          </Panel>
        </div>
      )}

      {dispatch && (order.state === "completed" || dispatch.status) && (
        <div className="mb-6">
          <Panel title="Dispatch" flush>
            <DispatchPanel
              orderId={order.id}
              orderState={order.state}
              status={dispatch.status}
              events={dispatch.events.map((e) => ({ ...e, recordedAt: e.recordedAt.toISOString() }))}
            />
          </Panel>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[1.35fr_1fr]">
        <Panel title="Components consumed" flush>
          <DataTable
            caption="Components consumed"
            rows={order.lines.map((l) => ({
              id: l.id,
              item: l.componentItem.name,
              qty: l.qtyRequired,
            }))}
            columns={[
              { key: "item", header: "Component" },
              { key: "qty", header: "Quantity", numeric: true },
            ]}
            emptyTitle="No components"
            emptyDescription="This order consumes nothing."
          />
        </Panel>

        <Panel title="History" flush>
          <AuditTrail
            entries={data.history.map((h) => ({
              id: h.id,
              field: h.fieldChanged,
              from: h.oldValue,
              to: h.newValue,
              at: h.occurredAt.toISOString(),
              command: h.commandKey,
            }))}
          />
        </Panel>
      </div>
    </>
  );
}

export default withCapabilityPageAccess(MANUFACTURING_CAPABILITY, OrderDetailPage);
