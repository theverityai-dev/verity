import { z } from "zod";
import { registerCommand, ValidationError, type CommandContext, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { diffFields, recordActivity } from "@/server/platform/audit";
import type { TenantScopedClient } from "@/server/platform/tenancy";
import { allocateSequence } from "@/server/runtime/document-number";
import { ENTITY_MENU_ITEM, ENTITY_ORDER_LINE, ENTITY_TABLE, ORDER_CHANNEL_LABEL, type OrderChannel } from "./keys";
import { serviceDayRange } from "./day";
import { dayStartMinuteFor } from "./gst";
import { assertOutletInScope, scopedLocationIds } from "./scope";

/**
 * Kitchen stations, courses and tickets (ADR-041; Task 126 Wave 3).
 *
 * A STATION is a view over an outlet's kitchen, not a security boundary: a line is
 * routed to one when it is added (the station is copied onto the line, so changing
 * what a station cooks never moves a dish already cooking). A COURSE orders the pass.
 * A TICKET is a stored fact of what the kitchen was told and when: one per station
 * per change to an order, numbered per outlet per service day, never edited.
 */

/* ============================== routing ============================== */

/** The station that cooks a category at an outlet: the one mapped to it, else the outlet's default, else none. */
export async function routeToStation(tx: TenantScopedClient, locationId: string, categoryId: string): Promise<string | null> {
  const mapped = await tx.kitchenStationCategory.findFirst({
    where: { locationId, categoryId, station: { is: { active: true } } },
    select: { stationId: true },
  });
  if (mapped) return mapped.stationId;
  const fallback = await tx.kitchenStation.findFirst({ where: { locationId, isDefault: true, active: true }, select: { id: true } });
  return fallback?.id ?? null;
}

export type TicketKind = "new" | "addition" | "void";

/**
 * Writes the ticket(s) for a change to an order: one per station among the lines given,
 * numbered from the outlet's running count for the service day. Returns the ticket ids.
 */
export async function writeTickets(
  ctx: CommandContext,
  order: { id: string; locationId: string },
  kind: TicketKind,
  lineIds: string[],
): Promise<string[]> {
  if (lineIds.length === 0) return [];
  const lines = await ctx.tx.orderLine.findMany({ where: { id: { in: lineIds } }, select: { id: true, stationId: true } });
  const byStation = new Map<string | null, string[]>();
  for (const line of lines) byStation.set(line.stationId, [...(byStation.get(line.stationId) ?? []), line.id]);

  const day = (await serviceDayRange(ctx.tx, ctx.actor.organizationId, undefined, await dayStartMinuteFor(ctx.tx, [order.locationId]))).day;
  const ids: string[] = [];
  for (const [stationId, group] of byStation) {
    const { sequenceNumber } = await allocateSequence(ctx.tx, ctx.actor.tenantId, `KOT-${order.locationId}`, day);
    const ticket = await ctx.tx.kitchenTicket.create({
      data: {
        tenantId: ctx.actor.tenantId,
        locationId: order.locationId,
        stationId,
        orderId: order.id,
        number: `K${String(sequenceNumber).padStart(3, "0")}`,
        sequenceNumber,
        serviceDay: new Date(`${day}T00:00:00Z`),
        kind,
        createdByUserId: ctx.actor.userId,
      },
    });
    await ctx.tx.kitchenTicketLine.createMany({
      data: group.map((orderLineId) => ({ tenantId: ctx.actor.tenantId, ticketId: ticket.id, orderLineId })),
    });
    ids.push(ticket.id);
  }
  return ids;
}

/**
 * What the kitchen must be told when a line is voided after it was sent: a void
 * ticket for the paper, and, if the dish was already being cooked or on the pass, a
 * flag that stays on the station's screen until someone there confirms it.
 */
export async function noteVoidedAfterSend(
  ctx: CommandContext,
  order: { id: string; locationId: string },
  lines: Array<{ id: string; stateBefore: string }>,
): Promise<void> {
  const fired = lines.filter((l) => l.stateBefore === "preparing" || l.stateBefore === "ready").map((l) => l.id);
  if (fired.length > 0) {
    await ctx.tx.orderLine.updateMany({ where: { id: { in: fired } }, data: { needsKitchenAck: true, kitchenAckAt: null } });
  }
  await writeTickets(ctx, order, "void", lines.map((l) => l.id));
}

/* ============================== setup commands ============================== */

export const saveKitchenStation: CommandDefinition<
  { stationId?: string; locationId: string; name: string; isDefault: boolean; active: boolean },
  { id: string }
> = {
  key: "verity.dinein.save_kitchen_station",
  entity: ENTITY_TABLE,
  verb: "Create",
  input: z.object({
    stationId: z.string().uuid().optional(),
    locationId: z.string().uuid(),
    name: z.string().trim().min(1).max(60),
    isDefault: z.boolean(),
    active: z.boolean(),
  }),
  preconditions: async (ctx, input) => {
    await assertOutletInScope(ctx.tx, ctx.actor, ENTITY_TABLE, "Create", input.locationId);
    if (input.isDefault && !input.active) throw new ValidationError("E_VALIDATION: the default station must be active");
    const clash = await ctx.tx.kitchenStation.findFirst({
      where: { locationId: input.locationId, name: input.name, ...(input.stationId ? { NOT: { id: input.stationId } } : {}) },
    });
    if (clash) throw new ValidationError("E_VALIDATION: this outlet already has a station with that name");
    if (input.stationId) {
      const existing = await ctx.tx.kitchenStation.findUnique({ where: { id: input.stationId } });
      if (!existing || existing.locationId !== input.locationId) throw new ValidationError("E_VALIDATION: station not found at this outlet");
    }
  },
  handler: async (ctx, input) => {
    if (input.isDefault) {
      await ctx.tx.kitchenStation.updateMany({ where: { locationId: input.locationId, isDefault: true }, data: { isDefault: false } });
    }
    const data = { name: input.name, isDefault: input.isDefault, active: input.active };
    const saved = input.stationId
      ? await ctx.tx.kitchenStation.update({ where: { id: input.stationId }, data: { ...data, version: { increment: 1 } } })
      : await ctx.tx.kitchenStation.create({ data: { tenantId: ctx.actor.tenantId, locationId: input.locationId, ...data } });
    return { result: { id: saved.id }, events: [{ name: "verity.dinein.kitchen_station_saved", entityId: saved.id }] };
  },
};

export const setStationCategories: CommandDefinition<{ stationId: string; categoryIds: string[] }, { mapped: number }> = {
  key: "verity.dinein.set_station_categories",
  entity: ENTITY_TABLE,
  verb: "Create",
  input: z.object({ stationId: z.string().uuid(), categoryIds: z.array(z.string().uuid()).max(100) }),
  preconditions: async (ctx, input) => {
    const station = await ctx.tx.kitchenStation.findUnique({ where: { id: input.stationId } });
    if (!station) throw new ValidationError("E_VALIDATION: station not found");
    await assertOutletInScope(ctx.tx, ctx.actor, ENTITY_TABLE, "Create", station.locationId);
    const found = await ctx.tx.menuCategory.count({ where: { id: { in: input.categoryIds } } });
    if (found !== new Set(input.categoryIds).size) throw new ValidationError("E_VALIDATION: a category was not found");
  },
  handler: async (ctx, input) => {
    const station = await ctx.tx.kitchenStation.findUniqueOrThrow({ where: { id: input.stationId } });
    const wanted = [...new Set(input.categoryIds)];
    // A category belongs to one station at an outlet: claiming it takes it from wherever it was.
    await ctx.tx.kitchenStationCategory.deleteMany({
      where: { locationId: station.locationId, OR: [{ stationId: station.id }, { categoryId: { in: wanted } }] },
    });
    if (wanted.length > 0) {
      await ctx.tx.kitchenStationCategory.createMany({
        data: wanted.map((categoryId) => ({ tenantId: ctx.actor.tenantId, locationId: station.locationId, stationId: station.id, categoryId })),
      });
    }
    await recordActivity(ctx, {
      entityKey: ENTITY_TABLE,
      entityId: station.id,
      commandKey: "verity.dinein.set_station_categories",
      changes: diffFields({}, { categories: wanted.length }),
    });
    return { result: { mapped: wanted.length }, events: [{ name: "verity.dinein.station_categories_set", entityId: station.id }] };
  },
};

export const saveMenuCourse: CommandDefinition<
  { courseId?: string; name: string; priority: number; active: boolean },
  { id: string }
> = {
  key: "verity.dinein.save_menu_course",
  entity: ENTITY_MENU_ITEM,
  verb: "Create",
  input: z.object({
    courseId: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(60),
    priority: z.number().int().min(0).max(99),
    active: z.boolean(),
  }),
  preconditions: async (ctx, input) => {
    const clash = await ctx.tx.menuCourse.findFirst({ where: { name: input.name, ...(input.courseId ? { NOT: { id: input.courseId } } : {}) } });
    if (clash) throw new ValidationError("E_VALIDATION: a course with that name already exists");
  },
  handler: async (ctx, input) => {
    const data = { name: input.name, priority: input.priority, active: input.active };
    const saved = input.courseId
      ? await ctx.tx.menuCourse.update({ where: { id: input.courseId }, data: { ...data, version: { increment: 1 } } })
      : await ctx.tx.menuCourse.create({ data: { tenantId: ctx.actor.tenantId, ...data } });
    return { result: { id: saved.id }, events: [{ name: "verity.dinein.menu_course_saved", entityId: saved.id }] };
  },
};

/* ============================== kitchen commands ============================== */

export const acknowledgeCancelledLine: CommandDefinition<{ lineId: string }, { lineId: string }> = {
  key: "verity.dinein.acknowledge_cancelled_line",
  entity: ENTITY_ORDER_LINE,
  verb: "ActionExecute",
  input: z.object({ lineId: z.string().uuid() }),
  preconditions: async (ctx, input) => {
    const line = await ctx.tx.orderLine.findUnique({ where: { id: input.lineId }, include: { order: { select: { locationId: true } } } });
    if (!line) throw new ValidationError("E_VALIDATION: line not found");
    await assertOutletInScope(ctx.tx, ctx.actor, ENTITY_ORDER_LINE, "ActionExecute", line.order.locationId);
    if (!line.needsKitchenAck) throw new ValidationError("E_VALIDATION: that dish is not waiting for the kitchen to confirm");
  },
  handler: async (ctx, input) => {
    await ctx.tx.orderLine.update({
      where: { id: input.lineId },
      data: { needsKitchenAck: false, kitchenAckAt: new Date(), version: { increment: 1 } },
    });
    return { result: { lineId: input.lineId }, events: [{ name: "verity.dinein.cancelled_line_acknowledged", entityId: input.lineId }] };
  },
};

/**
 * Records that a ticket was printed. The first time is the print; any later time is
 * a reprint, and the paper says so. The ticket itself never changes.
 */
export const recordTicketPrint: CommandDefinition<{ ticketId: string }, { reprint: boolean; prints: number }> = {
  key: "verity.dinein.record_ticket_print",
  entity: ENTITY_ORDER_LINE,
  verb: "ActionExecute",
  input: z.object({ ticketId: z.string().uuid() }),
  preconditions: async (ctx, input) => {
    const ticket = await ctx.tx.kitchenTicket.findUnique({ where: { id: input.ticketId } });
    if (!ticket) throw new ValidationError("E_VALIDATION: ticket not found");
    await assertOutletInScope(ctx.tx, ctx.actor, ENTITY_ORDER_LINE, "ActionExecute", ticket.locationId);
  },
  handler: async (ctx, input) => {
    const prior = await ctx.tx.kitchenTicketPrint.count({ where: { ticketId: input.ticketId } });
    await ctx.tx.kitchenTicketPrint.create({
      data: { tenantId: ctx.actor.tenantId, ticketId: input.ticketId, printedByUserId: ctx.actor.userId, reprint: prior > 0 },
    });
    return { result: { reprint: prior > 0, prints: prior + 1 }, events: [{ name: "verity.dinein.ticket_printed", entityId: input.ticketId }] };
  },
};

/* ============================== queries ============================== */

export type KitchenSetup = {
  categories: Array<{ id: string; name: string }>;
  courses: Array<{ id: string; name: string; priority: number; active: boolean }>;
  outlets: Array<{
    locationId: string;
    locationName: string;
    stations: Array<{ id: string; name: string; isDefault: boolean; active: boolean; categoryIds: string[] }>;
  }>;
};

export const listKitchenSetup: QueryDefinition<{ locationId?: string }, KitchenSetup> = {
  key: "verity.dinein.list_kitchen_setup",
  entity: ENTITY_TABLE,
  input: z.object({ locationId: z.string().uuid().optional() }),
  handler: async (ctx, input) => {
    const ids = await scopedLocationIds(ctx.tx, ctx.actor, ENTITY_TABLE, input.locationId);
    const [categories, courses, locations, stations] = await Promise.all([
      ctx.tx.menuCategory.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
      ctx.tx.menuCourse.findMany({ orderBy: [{ priority: "asc" }, { name: "asc" }] }),
      ctx.tx.location.findMany({ where: { id: { in: ids }, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      ctx.tx.kitchenStation.findMany({ where: { locationId: { in: ids } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { categories: { select: { categoryId: true } } } }),
    ]);
    return {
      categories,
      courses: courses.map((c) => ({ id: c.id, name: c.name, priority: c.priority, active: c.active })),
      outlets: locations.map((l) => ({
        locationId: l.id,
        locationName: l.name,
        stations: stations
          .filter((s) => s.locationId === l.id)
          .map((s) => ({ id: s.id, name: s.name, isDefault: s.isDefault, active: s.active, categoryIds: s.categories.map((c) => c.categoryId) })),
      })),
    };
  },
};

export type TicketView = {
  id: string;
  number: string;
  kind: TicketKind;
  serviceDay: string;
  createdAt: Date;
  stationName: string | null;
  label: string;
  channel: string;
  covers: number;
  takenBy: string | null;
  prints: number;
  lines: Array<{
    qty: number;
    itemName: string;
    variantName: string | null;
    modifiers: string[];
    lineNote: string | null;
    courseName: string | null;
    coursePriority: number | null;
  }>;
};

export const getKitchenTicket: QueryDefinition<{ ticketId: string }, TicketView | null> = {
  key: "verity.dinein.get_kitchen_ticket",
  entity: ENTITY_ORDER_LINE,
  input: z.object({ ticketId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const ticket = await ctx.tx.kitchenTicket.findUnique({
      where: { id: input.ticketId },
      include: {
        station: { select: { name: true } },
        prints: { select: { id: true } },
        order: { include: { table: { select: { label: true } } } },
        lines: { include: { line: { include: { addOns: true } } } },
      },
    });
    if (!ticket) return null;
    await assertOutletInScope(ctx.tx, ctx.actor, ENTITY_ORDER_LINE, "Read", ticket.locationId);
    const taker = await ctx.tx.user.findUnique({ where: { id: ticket.order.takenByUserId }, include: { party: { select: { displayName: true } } } });
    const order = ticket.order;
    const label = order.table
      ? `Table ${order.table.label}`
      : order.channel === "delivery_platform"
        ? `${order.platform ?? "Delivery platform"}${order.platformOrderRef ? ` #${order.platformOrderRef}` : ""}`
        : `${ORDER_CHANNEL_LABEL[order.channel as OrderChannel] ?? order.channel}${order.customerName ? ` · ${order.customerName}` : ""}`;
    return {
      id: ticket.id,
      number: ticket.number,
      kind: ticket.kind as TicketKind,
      serviceDay: ticket.serviceDay.toISOString().slice(0, 10),
      createdAt: ticket.createdAt,
      stationName: ticket.station?.name ?? null,
      label,
      channel: order.channel,
      covers: order.covers,
      takenBy: taker?.party.displayName ?? null,
      prints: ticket.prints.length,
      lines: ticket.lines
        .map((tl) => ({
          qty: tl.line.qty,
          itemName: tl.line.itemNameSnapshot,
          variantName: tl.line.variantNameSnapshot,
          modifiers: [...tl.line.addOns].map((m) => m.name).sort(),
          lineNote: tl.line.lineNote,
          courseName: tl.line.courseName,
          coursePriority: tl.line.coursePriority,
        }))
        .sort((a, b) => (a.coursePriority ?? 999) - (b.coursePriority ?? 999) || a.itemName.localeCompare(b.itemName)),
    };
  },
};

export type UnprintedTicket = {
  id: string;
  number: string;
  kind: TicketKind;
  stationName: string | null;
  createdAt: Date;
  /** How many times it has been printed; zero for a ticket nobody has printed. */
  prints: number;
};

/**
 * Tickets from the last hours. By default only those nobody has printed (what a station
 * screen in auto-print mode needs); with `includePrinted`, the recent ones for a reprint.
 */
export const listUnprintedTickets: QueryDefinition<
  { locationId?: string; stationId?: string; includePrinted?: boolean },
  UnprintedTicket[]
> = {
  key: "verity.dinein.list_unprinted_tickets",
  entity: ENTITY_ORDER_LINE,
  input: z.object({
    locationId: z.string().uuid().optional(),
    stationId: z.string().uuid().optional(),
    includePrinted: z.boolean().optional(),
  }),
  handler: async (ctx, input) => {
    const ids = await scopedLocationIds(ctx.tx, ctx.actor, ENTITY_ORDER_LINE, input.locationId);
    const tickets = await ctx.tx.kitchenTicket.findMany({
      where: {
        locationId: { in: ids },
        ...(input.stationId ? { stationId: input.stationId } : {}),
        ...(input.includePrinted ? {} : { prints: { none: {} } }),
        createdAt: { gte: new Date(Date.now() - (input.includePrinted ? 12 : 6) * 3_600_000) },
      },
      orderBy: { createdAt: input.includePrinted ? "desc" : "asc" },
      take: input.includePrinted ? 20 : 30,
      include: { station: { select: { name: true } }, _count: { select: { prints: true } } },
    });
    return tickets.map((t) => ({
      id: t.id,
      number: t.number,
      kind: t.kind as TicketKind,
      stationName: t.station?.name ?? null,
      createdAt: t.createdAt,
      prints: t._count.prints,
    }));
  },
};

export type CancelledDish = {
  lineId: string;
  itemName: string;
  qty: number;
  label: string;
  stationId: string | null;
  stationName: string | null;
};

export const kitchenCancelled: QueryDefinition<{ locationId?: string; stationId?: string }, CancelledDish[]> = {
  key: "verity.dinein.kitchen_cancelled",
  entity: ENTITY_ORDER_LINE,
  input: z.object({ locationId: z.string().uuid().optional(), stationId: z.string().uuid().optional() }),
  handler: async (ctx, input) => {
    const ids = await scopedLocationIds(ctx.tx, ctx.actor, ENTITY_ORDER_LINE, input.locationId);
    const lines = await ctx.tx.orderLine.findMany({
      where: {
        needsKitchenAck: true,
        ...(input.stationId ? { stationId: input.stationId } : {}),
        order: { is: { locationId: { in: ids } } },
      },
      orderBy: { updatedAt: "asc" },
      include: { station: { select: { name: true } }, order: { include: { table: { select: { label: true } } } } },
    });
    return lines.map((l) => ({
      lineId: l.id,
      itemName: l.itemNameSnapshot,
      qty: l.qty,
      label: l.order.table
        ? `Table ${l.order.table.label}`
        : l.order.channel === "delivery_platform"
          ? `${l.order.platform ?? "Delivery platform"}${l.order.platformOrderRef ? ` #${l.order.platformOrderRef}` : ""}`
          : (ORDER_CHANNEL_LABEL[l.order.channel as OrderChannel] ?? l.order.channel),
      stationId: l.stationId,
      stationName: l.station?.name ?? null,
    }));
  },
};

export function registerDineinKitchen(): void {
  registerCommand(saveKitchenStation);
  registerCommand(setStationCategories);
  registerCommand(saveMenuCourse);
  registerCommand(acknowledgeCancelledLine);
  registerCommand(recordTicketPrint);
  registerQuery(listKitchenSetup);
  registerQuery(getKitchenTicket);
  registerQuery(listUnprintedTickets);
  registerQuery(kitchenCancelled);
}
