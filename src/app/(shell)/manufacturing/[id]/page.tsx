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
import { PageHeader, Panel, PermissionDenied, Stat, StatRow, StateBadge } from "@/components/ui/primitives";
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

  return (
    <>
      <PageHeader
        title={title}
        description={
          `Produces ${order.outputItem.name} at ${order.location.name}.` +
          (order.bom ? ` Made from BOM ${order.bom.code}.` : "") +
          (data.isTerminal ? " This order is closed and permanently read-only." : "")
        }
        actions={<OrderActions orderId={order.id} state={order.state} />}
      />

      <StatRow cols={4} className="mb-6">
        <div className="flex flex-col px-5 py-4">
          <span className="flex h-[26px] items-center text-[15px]">
            <StateBadge category={data.category} label={order.state.replace(/_/g, " ")} />
          </span>
          <span className="mt-2 text-[12px] leading-[1.3] text-text-tertiary">State</span>
        </div>
        <Stat label="Produces" value={order.outputQty} hint={order.outputItem.name} />
        <Stat label="Components" value={order.lines.length} />
        <Stat label="Version" value={order.version} hint="Optimistic concurrency" />
      </StatRow>

      {hold && (
        <div className="mb-6">
          <Panel title="Stock" flush>
            <StockHoldPanel orderId={order.id} held={hold.held} lines={hold.lines} />
          </Panel>
        </div>
      )}

      {canSeeStages && (
        <div className="mb-6">
          <Panel title="Stages" flush>
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
