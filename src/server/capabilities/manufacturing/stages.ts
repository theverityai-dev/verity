import { z } from "zod";
import { registerCommand, ValidationError, type CommandContext, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { transition } from "@/server/platform/state";
import { diffFields, recordActivity } from "@/server/platform/audit";
import { ENTITY_MANUFACTURING_OPERATION, ENTITY_MANUFACTURING_ROUTE, OPEN_OPERATION_STATES } from "./shared";

/**
 * Stage-wise production (Task 118, from Carxen's factory floor).
 *
 * A ROUTE is an ordered list of stages, entirely tenant data: CAD, Cutting,
 * Stitching, QC, Packing is Carxen's chain, not the platform's (CLAUDE.md
 * forbids a hard-coded department list). An order gets one OPERATION per stage.
 * Each operation moves pending -> in_progress <-> on_hold -> completed, through
 * the platform state runtime, so its behaviour reads `StateCategory` (ADR-009)
 * and INV-002 makes a completed one read-only.
 *
 * Sequencing: an operation may start only when every lower-sequence operation of
 * the order is completed or cancelled, and only once the ORDER is in progress
 * (its materials consumed). A QC send-back never edits history: it cancels the
 * open operations and appends fresh ones from the stage being redone, with
 * `reworkOfId` pointing at what is being redone (correct by new fact).
 *
 * Per-order routing: an order may be planned from a route OR from its own stage
 * list, so an order that skips or reorders a stage needs no special case.
 */

const stageKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "lowercase letters, digits and underscores");
const stageInput = z.object({ stageKey: stageKeySchema, label: z.string().trim().min(1).max(80) });

function assertUniqueStages(stages: Array<{ stageKey: string }>): void {
  if (new Set(stages.map((s) => s.stageKey)).size !== stages.length) {
    throw new ValidationError("E_VALIDATION: a stage appears more than once");
  }
}

type Op = { id: string; orderId: string; state: string; note: string | null; sequence: number; label: string };

/** One state change, through the state runtime, with its audit line. */
async function move(
  ctx: CommandContext,
  op: Op,
  toKey: string,
  commandKey: string,
  data: Record<string, unknown> = {},
  note?: string,
) {
  const moved = await transition(ctx, {
    entityKey: ENTITY_MANUFACTURING_OPERATION,
    entityId: op.id,
    fromKey: op.state,
    toKey,
  });
  await ctx.tx.manufacturingOperation.update({
    where: { id: op.id },
    data: { state: toKey, version: { increment: 1 }, ...(note !== undefined ? { note } : {}), ...data },
  });
  await recordActivity(ctx, {
    entityKey: ENTITY_MANUFACTURING_OPERATION,
    entityId: op.id,
    commandKey,
    changes: diffFields(
      { state: op.state, ...(note !== undefined ? { note: op.note ?? "" } : {}) },
      { state: toKey, ...(note !== undefined ? { note } : {}) },
    ),
  });
  return moved.event;
}

/** The order must be running (materials consumed) and every earlier operation done or cancelled. */
async function assertActionable(ctx: CommandContext, op: { orderId: string; sequence: number }): Promise<void> {
  const order = await ctx.tx.manufacturingOrder.findUniqueOrThrow({ where: { id: op.orderId } });
  if (order.state !== "in_progress") {
    throw new ValidationError("E_VALIDATION: start the order first, so its materials are consumed");
  }
  const blocking = await ctx.tx.manufacturingOperation.findFirst({
    where: { orderId: op.orderId, sequence: { lt: op.sequence }, state: { in: OPEN_OPERATION_STATES } },
    orderBy: { sequence: "asc" },
  });
  if (blocking) throw new ValidationError(`E_VALIDATION: ${blocking.label} must be completed first`);
}

/** Cancels every open operation of an order. Used by cancel-order and by send-back. */
export async function cancelOpenOperations(
  ctx: CommandContext,
  orderId: string,
  commandKey: string,
  notes: { current?: { id: string; note: string }; others: string },
) {
  const open = await ctx.tx.manufacturingOperation.findMany({
    where: { orderId, state: { in: OPEN_OPERATION_STATES } },
    orderBy: { sequence: "asc" },
  });
  const events = [];
  for (const op of open) {
    const note = notes.current?.id === op.id ? notes.current.note : notes.others;
    events.push(await move(ctx, op, "cancelled", commandKey, {}, note));
  }
  return events;
}

/* -------------------------------- routes -------------------------------- */

export const createRoute: CommandDefinition<
  { code: string; name: string; stages: Array<z.infer<typeof stageInput>> },
  { id: string }
> = {
  key: "verity.manufacturing.create_route",
  entity: ENTITY_MANUFACTURING_ROUTE,
  verb: "Create",
  input: z.object({
    code: z.string().trim().min(1).max(60),
    name: z.string().trim().min(1).max(200),
    stages: z.array(stageInput).min(1).max(30),
  }),
  preconditions: async (ctx, input) => {
    assertUniqueStages(input.stages);
    if (await ctx.tx.manufacturingRoute.findUnique({ where: { tenantId_code: { tenantId: ctx.actor.tenantId, code: input.code } } })) {
      throw new ValidationError(`E_VALIDATION: a route with code ${input.code} already exists`);
    }
  },
  handler: async (ctx, input) => {
    const route = await ctx.tx.manufacturingRoute.create({
      data: { tenantId: ctx.actor.tenantId, code: input.code, name: input.name },
    });
    await ctx.tx.manufacturingRouteStage.createMany({
      data: input.stages.map((s, i) => ({
        tenantId: ctx.actor.tenantId,
        routeId: route.id,
        sequence: i + 1,
        stageKey: s.stageKey,
        label: s.label,
      })),
    });
    return { result: { id: route.id }, events: [{ name: "verity.manufacturing.route_created", entityId: route.id }] };
  },
};

/** Archive or restore. Operations already made keep their own snapshot, so nothing else moves. */
export const setRouteActive: CommandDefinition<{ routeId: string; active: boolean }, { id: string }> = {
  key: "verity.manufacturing.set_route_active",
  entity: ENTITY_MANUFACTURING_ROUTE,
  verb: "Edit",
  input: z.object({ routeId: z.string().uuid(), active: z.boolean() }),
  handler: async (ctx, input) => {
    const before = await ctx.tx.manufacturingRoute.findUniqueOrThrow({ where: { id: input.routeId } });
    if (before.active !== input.active) {
      await ctx.tx.manufacturingRoute.update({
        where: { id: before.id },
        data: { active: input.active, version: { increment: 1 } },
      });
      await recordActivity(ctx, {
        entityKey: ENTITY_MANUFACTURING_ROUTE,
        entityId: before.id,
        commandKey: "verity.manufacturing.set_route_active",
        changes: diffFields({ active: before.active }, { active: input.active }),
      });
    }
    return { result: { id: before.id }, events: [{ name: "verity.manufacturing.route_state_changed", entityId: before.id }] };
  },
};

/* ----------------------------- plan operations ----------------------------- */

export const planOperations: CommandDefinition<
  { orderId: string; routeId?: string; stages?: Array<z.infer<typeof stageInput>> },
  { count: number }
> = {
  key: "verity.manufacturing.plan_operations",
  entity: ENTITY_MANUFACTURING_OPERATION,
  verb: "Create",
  input: z
    .object({
      orderId: z.string().uuid(),
      routeId: z.string().uuid().optional(),
      stages: z.array(stageInput).min(1).max(30).optional(),
    })
    .refine((v) => (v.routeId === undefined) !== (v.stages === undefined), {
      message: "give either a route or the order's own stages, not both and not neither",
    }),
  preconditions: async (ctx, input) => {
    const order = await ctx.tx.manufacturingOrder.findUnique({ where: { id: input.orderId } });
    if (!order) throw new ValidationError("E_VALIDATION: order not found in this tenant");
    if (order.state !== "draft" && order.state !== "in_progress") {
      throw new ValidationError("E_VALIDATION: only a draft or running order can be planned");
    }
    if ((await ctx.tx.manufacturingOperation.count({ where: { orderId: input.orderId } })) > 0) {
      throw new ValidationError("E_VALIDATION: this order already has operations; send it back to redo a stage");
    }
    if (input.stages) assertUniqueStages(input.stages);
  },
  handler: async (ctx, input) => {
    let stages: Array<{ stageKey: string; label: string }>;
    if (input.routeId) {
      const route = await ctx.tx.manufacturingRoute.findUnique({
        where: { id: input.routeId },
        include: { stages: { orderBy: { sequence: "asc" } } },
      });
      if (!route) throw new ValidationError("E_VALIDATION: route not found in this tenant");
      if (!route.active) throw new ValidationError("E_VALIDATION: this route is archived");
      stages = route.stages;
    } else {
      stages = input.stages!;
    }
    await ctx.tx.manufacturingOperation.createMany({
      data: stages.map((s, i) => ({
        tenantId: ctx.actor.tenantId,
        orderId: input.orderId,
        sequence: i + 1,
        stageKey: s.stageKey,
        label: s.label,
      })),
    });
    return {
      result: { count: stages.length },
      events: [{ name: "verity.manufacturing.operations_planned", entityId: input.orderId }],
    };
  },
};

/* --------------------------- operation lifecycle --------------------------- */

const opInput = z.object({ operationId: z.string().uuid() });

export const startOperation: CommandDefinition<{ operationId: string }, { id: string }> = {
  key: "verity.manufacturing.start_operation",
  entity: ENTITY_MANUFACTURING_OPERATION,
  verb: "ActionExecute",
  input: opInput,
  handler: async (ctx, input) => {
    const op = await ctx.tx.manufacturingOperation.findUniqueOrThrow({ where: { id: input.operationId } });
    await assertActionable(ctx, op);
    const event = await move(ctx, op, "in_progress", "verity.manufacturing.start_operation", {
      startedAt: new Date(),
      startedById: ctx.actor.userId,
    });
    return { result: { id: op.id }, events: [event] };
  },
};

export const holdOperation: CommandDefinition<{ operationId: string; reason: string }, { id: string }> = {
  key: "verity.manufacturing.hold_operation",
  entity: ENTITY_MANUFACTURING_OPERATION,
  verb: "ActionExecute",
  input: z.object({ operationId: z.string().uuid(), reason: z.string().trim().min(3).max(400) }),
  handler: async (ctx, input) => {
    const op = await ctx.tx.manufacturingOperation.findUniqueOrThrow({ where: { id: input.operationId } });
    const event = await move(ctx, op, "on_hold", "verity.manufacturing.hold_operation", {}, input.reason);
    return { result: { id: op.id }, events: [event] };
  },
};

export const resumeOperation: CommandDefinition<{ operationId: string }, { id: string }> = {
  key: "verity.manufacturing.resume_operation",
  entity: ENTITY_MANUFACTURING_OPERATION,
  verb: "ActionExecute",
  input: opInput,
  handler: async (ctx, input) => {
    const op = await ctx.tx.manufacturingOperation.findUniqueOrThrow({ where: { id: input.operationId } });
    await assertActionable(ctx, op);
    const event = await move(ctx, op, "in_progress", "verity.manufacturing.resume_operation");
    return { result: { id: op.id }, events: [event] };
  },
};

export const completeOperation: CommandDefinition<{ operationId: string }, { id: string }> = {
  key: "verity.manufacturing.complete_operation",
  entity: ENTITY_MANUFACTURING_OPERATION,
  verb: "ActionExecute",
  input: opInput,
  handler: async (ctx, input) => {
    const op = await ctx.tx.manufacturingOperation.findUniqueOrThrow({ where: { id: input.operationId } });
    const event = await move(ctx, op, "completed", "verity.manufacturing.complete_operation", {
      completedAt: new Date(),
      completedById: ctx.actor.userId,
    });
    return { result: { id: op.id }, events: [event] };
  },
};

/**
 * A QC reject: send the order back to an earlier stage (or redo this one).
 * History is untouched. Every open operation is cancelled and the route from
 * `toStageKey` onward is appended again, the first of them marked as the rework
 * of the stage it redoes.
 */
export const sendBack: CommandDefinition<
  { operationId: string; toStageKey: string; reason: string },
  { count: number }
> = {
  key: "verity.manufacturing.send_back",
  entity: ENTITY_MANUFACTURING_OPERATION,
  verb: "ActionExecute",
  input: z.object({
    operationId: z.string().uuid(),
    toStageKey: stageKeySchema,
    reason: z.string().trim().min(3).max(400),
  }),
  handler: async (ctx, input) => {
    const op = await ctx.tx.manufacturingOperation.findUniqueOrThrow({ where: { id: input.operationId } });
    if (!OPEN_OPERATION_STATES.includes(op.state)) {
      throw new ValidationError("E_VALIDATION: only an open operation can be sent back");
    }
    const order = await ctx.tx.manufacturingOrder.findUniqueOrThrow({ where: { id: op.orderId } });
    if (order.state !== "in_progress") throw new ValidationError("E_VALIDATION: only a running order can be sent back");

    const all = await ctx.tx.manufacturingOperation.findMany({ where: { orderId: op.orderId }, orderBy: { sequence: "asc" } });
    const stageOrder: string[] = [];
    for (const o of all) if (!stageOrder.includes(o.stageKey)) stageOrder.push(o.stageKey);

    const target = stageOrder.indexOf(input.toStageKey);
    if (target === -1) throw new ValidationError("E_VALIDATION: that stage is not part of this order's route");
    if (target > stageOrder.indexOf(op.stageKey)) {
      throw new ValidationError("E_VALIDATION: an order can only be sent back to an earlier stage or redone in place");
    }

    // The latest instance of each stage supplies its label; the latest instance of
    // the target is what this rework points back at.
    const latest = new Map(all.map((o) => [o.stageKey, o]));
    const events = await cancelOpenOperations(ctx, op.orderId, "verity.manufacturing.send_back", {
      current: { id: op.id, note: `Sent back to ${latest.get(input.toStageKey)!.label}: ${input.reason}` },
      others: "Superseded by a send-back",
    });

    const redo = stageOrder.slice(target);
    const base = all[all.length - 1]!.sequence;
    await ctx.tx.manufacturingOperation.createMany({
      data: redo.map((key, i) => ({
        tenantId: ctx.actor.tenantId,
        orderId: op.orderId,
        sequence: base + 1 + i,
        stageKey: key,
        label: latest.get(key)!.label,
        reworkOfId: i === 0 ? latest.get(input.toStageKey)!.id : null,
      })),
    });
    return {
      result: { count: redo.length },
      events: [...events, { name: "verity.manufacturing.order_sent_back", entityId: op.orderId }],
    };
  },
};

/* --------------------------------- queries --------------------------------- */

export type OperationRow = {
  id: string;
  sequence: number;
  stageKey: string;
  label: string;
  state: string;
  category: string;
  note: string | null;
  reworkOfId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  /** Pending, its order is running, and everything before it is done or cancelled. */
  actionable: boolean;
};

export const listRoutes: QueryDefinition<
  { includeInactive?: boolean },
  Array<{ id: string; code: string; name: string; active: boolean; stages: Array<{ stageKey: string; label: string }> }>
> = {
  key: "verity.manufacturing.list_routes",
  entity: ENTITY_MANUFACTURING_ROUTE,
  input: z.object({ includeInactive: z.boolean().optional() }),
  handler: async (ctx, input) => {
    const routes = await ctx.tx.manufacturingRoute.findMany({
      where: input.includeInactive ? {} : { active: true },
      include: { stages: { orderBy: { sequence: "asc" } } },
      orderBy: { code: "asc" },
    });
    return routes.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      active: r.active,
      stages: r.stages.map((s) => ({ stageKey: s.stageKey, label: s.label })),
    }));
  },
};

export const orderOperations: QueryDefinition<{ orderId: string }, OperationRow[]> = {
  key: "verity.manufacturing.order_operations",
  entity: ENTITY_MANUFACTURING_OPERATION,
  input: z.object({ orderId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const [order, ops, states] = await Promise.all([
      ctx.tx.manufacturingOrder.findUniqueOrThrow({ where: { id: input.orderId } }),
      ctx.tx.manufacturingOperation.findMany({ where: { orderId: input.orderId }, orderBy: { sequence: "asc" } }),
      ctx.tx.stateDefinition.findMany({ where: { entityKey: ENTITY_MANUFACTURING_OPERATION } }),
    ]);
    const category = new Map(states.map((s) => [s.key, s.category]));
    return ops.map((o, i) => ({
      id: o.id,
      sequence: o.sequence,
      stageKey: o.stageKey,
      label: o.label,
      state: o.state,
      category: category.get(o.state) ?? "Pending",
      note: o.note,
      reworkOfId: o.reworkOfId,
      startedAt: o.startedAt,
      completedAt: o.completedAt,
      actionable:
        order.state === "in_progress" &&
        o.state === "pending" &&
        !ops.slice(0, i).some((p) => OPEN_OPERATION_STATES.includes(p.state)),
    }));
  },
};

export type QueueRow = OperationRow & {
  orderId: string;
  orderReference: string;
  outputItemName: string;
  outputQty: number;
  /** Stages this one may be sent back to: earlier stages of the order's route, and itself. */
  sendBackTo: Array<{ stageKey: string; label: string }>;
};

/** The floor's work list: open operations of RUNNING orders, optionally for one stage. */
export const operationQueue: QueryDefinition<{ stageKey?: string }, QueueRow[]> = {
  key: "verity.manufacturing.operation_queue",
  entity: ENTITY_MANUFACTURING_OPERATION,
  input: z.object({ stageKey: stageKeySchema.optional() }),
  handler: async (ctx, input) => {
    const orders = await ctx.tx.manufacturingOrder.findMany({
      where: { state: "in_progress", operations: { some: { state: { in: OPEN_OPERATION_STATES } } } },
      include: { outputItem: true, operations: { orderBy: { sequence: "asc" } } },
      orderBy: { createdAt: "asc" },
    });
    const states = await ctx.tx.stateDefinition.findMany({ where: { entityKey: ENTITY_MANUFACTURING_OPERATION } });
    const category = new Map(states.map((s) => [s.key, s.category]));

    const rows: QueueRow[] = [];
    for (const order of orders) {
      const stageOrder: Array<{ stageKey: string; label: string }> = [];
      for (const s of order.operations) {
        if (!stageOrder.some((x) => x.stageKey === s.stageKey)) stageOrder.push({ stageKey: s.stageKey, label: s.label });
      }
      order.operations.forEach((o, i) => {
        if (!OPEN_OPERATION_STATES.includes(o.state)) return;
        if (input.stageKey && o.stageKey !== input.stageKey) return;
        rows.push({
          id: o.id,
          sequence: o.sequence,
          stageKey: o.stageKey,
          label: o.label,
          state: o.state,
          category: category.get(o.state) ?? "Pending",
          note: o.note,
          reworkOfId: o.reworkOfId,
          startedAt: o.startedAt,
          completedAt: o.completedAt,
          actionable: o.state === "pending" && !order.operations.slice(0, i).some((p) => OPEN_OPERATION_STATES.includes(p.state)),
          orderId: order.id,
          orderReference: order.reference ?? `MO ${order.id.slice(0, 8)}`,
          outputItemName: order.outputItem.name,
          outputQty: order.outputQty,
          sendBackTo: stageOrder.slice(0, stageOrder.findIndex((x) => x.stageKey === o.stageKey) + 1),
        });
      });
    }
    return rows;
  },
};

export function registerManufacturingStages(): void {
  registerCommand(createRoute);
  registerCommand(setRouteActive);
  registerCommand(planOperations);
  registerCommand(startOperation);
  registerCommand(holdOperation);
  registerCommand(resumeOperation);
  registerCommand(completeOperation);
  registerCommand(sendBack);
  registerQuery(listRoutes);
  registerQuery(orderOperations);
  registerQuery(operationQueue);
}
