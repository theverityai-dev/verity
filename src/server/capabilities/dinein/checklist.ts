import { z } from "zod";
import { registerCommand, ValidationError, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { recordActivity } from "@/server/platform/audit";
import { ENTITY_TABLE } from "./keys";
import { serviceDayRange } from "./day";
import { assertOutletInScope, scopedLocationIds } from "./scope";
import { dayStartMinuteFor } from "./gst";

/**
 * Opening and closing checklists (Task 126 item 1.8; URY's POS checklists).
 *
 * Each outlet keeps one list of steps for opening and one for closing. Ticking a
 * step records who and when for that service day. It is deliberately NOT a gate on
 * selling: URY blocks the POS until the list is done, which stops a till that is
 * needed more than the list. An unfinished closing list is shown on the outlet's
 * day view instead (see `outletToday`), where a manager will see it.
 *
 * Setting the list is a floor-setup act (Create on the table entity, as the floor
 * plan is); ticking is whatever a shift does (ActionExecute on the table entity).
 */

export const CHECKLIST_KINDS = ["opening", "closing"] as const;
export type ChecklistKind = (typeof CHECKLIST_KINDS)[number];

export const setChecklistSteps: CommandDefinition<
  { locationId: string; kind: ChecklistKind; steps: string[] },
  { kept: number; added: number; retired: number }
> = {
  key: "verity.dinein.set_checklist_steps",
  entity: ENTITY_TABLE,
  verb: "Create",
  input: z.object({
    locationId: z.string().uuid(),
    kind: z.enum(CHECKLIST_KINDS),
    steps: z.array(z.string().trim().min(1).max(200)).max(40),
  }),
  preconditions: async (ctx, input) => {
    await assertOutletInScope(ctx.tx, ctx.actor, ENTITY_TABLE, "Create", input.locationId);
    if (new Set(input.steps.map((s) => s.toLowerCase())).size !== input.steps.length) {
      throw new ValidationError("E_VALIDATION: two steps have the same wording");
    }
  },
  handler: async (ctx, input) => {
    const existing = await ctx.tx.outletChecklistStep.findMany({
      where: { locationId: input.locationId, kind: input.kind },
    });
    const byLabel = new Map(existing.map((s) => [s.label.toLowerCase(), s]));
    let kept = 0;
    let added = 0;
    for (const [index, label] of input.steps.entries()) {
      const found = byLabel.get(label.toLowerCase());
      if (found) {
        await ctx.tx.outletChecklistStep.update({
          where: { id: found.id },
          data: { label, sortOrder: index, active: true, version: { increment: 1 } },
        });
        byLabel.delete(label.toLowerCase());
        kept += 1;
      } else {
        await ctx.tx.outletChecklistStep.create({
          data: { tenantId: ctx.actor.tenantId, locationId: input.locationId, kind: input.kind, label, sortOrder: index },
        });
        added += 1;
      }
    }
    // Whatever is left was taken off the list: retired, so earlier days keep what they were asked.
    let retired = 0;
    for (const step of byLabel.values()) {
      if (!step.active) continue;
      await ctx.tx.outletChecklistStep.update({ where: { id: step.id }, data: { active: false, version: { increment: 1 } } });
      retired += 1;
    }
    return {
      result: { kept, added, retired },
      events: [{ name: "verity.dinein.checklist_steps_set", entityId: input.locationId }],
    };
  },
};

export const tickChecklistStep: CommandDefinition<
  { stepId: string; done: boolean; note?: string },
  { complete: boolean; ticked: number; total: number }
> = {
  key: "verity.dinein.tick_checklist_step",
  entity: ENTITY_TABLE,
  verb: "ActionExecute",
  input: z.object({ stepId: z.string().uuid(), done: z.boolean(), note: z.string().trim().max(300).optional() }),
  preconditions: async (ctx, input) => {
    const step = await ctx.tx.outletChecklistStep.findUnique({ where: { id: input.stepId } });
    if (!step) throw new ValidationError("E_VALIDATION: step not found");
    if (!step.active) throw new ValidationError("E_VALIDATION: that step is no longer on the list");
    await assertOutletInScope(ctx.tx, ctx.actor, ENTITY_TABLE, "ActionExecute", step.locationId);
  },
  handler: async (ctx, input) => {
    const step = await ctx.tx.outletChecklistStep.findUniqueOrThrow({ where: { id: input.stepId } });
    const day = (await serviceDayRange(ctx.tx, ctx.actor.organizationId, undefined, await dayStartMinuteFor(ctx.tx, [step.locationId]))).day;
    const serviceDay = new Date(`${day}T00:00:00Z`);

    const run = await ctx.tx.outletChecklistRun.upsert({
      where: {
        outlet_checklist_run_day: { tenantId: ctx.actor.tenantId, locationId: step.locationId, kind: step.kind, serviceDay },
      },
      create: { tenantId: ctx.actor.tenantId, locationId: step.locationId, kind: step.kind, serviceDay },
      update: {},
    });

    const existing = await ctx.tx.outletChecklistTick.findUnique({
      where: { outlet_checklist_tick_once: { runId: run.id, stepId: step.id } },
    });
    if (input.done && !existing) {
      await ctx.tx.outletChecklistTick.create({
        data: {
          tenantId: ctx.actor.tenantId,
          runId: run.id,
          stepId: step.id,
          label: step.label,
          doneByUserId: ctx.actor.userId,
          note: input.note ?? null,
        },
      });
    } else if (!input.done && existing) {
      await ctx.tx.outletChecklistTick.delete({ where: { id: existing.id } });
    }

    const total = await ctx.tx.outletChecklistStep.count({
      where: { locationId: step.locationId, kind: step.kind, active: true },
    });
    const ticked = await ctx.tx.outletChecklistTick.count({
      where: { runId: run.id, step: { is: { active: true } } },
    });
    const complete = total > 0 && ticked >= total;
    await ctx.tx.outletChecklistRun.update({
      where: { id: run.id },
      data: { completedAt: complete ? (run.completedAt ?? new Date()) : null },
    });

    await recordActivity(ctx, {
      entityKey: ENTITY_TABLE,
      entityId: step.locationId,
      commandKey: "verity.dinein.tick_checklist_step",
      changes: [{ field: `${step.kind}: ${step.label}`, oldValue: existing ? "done" : "not done", newValue: input.done ? "done" : "not done" }],
    });

    return {
      result: { complete, ticked, total },
      events: [{ name: "verity.dinein.checklist_step_ticked", entityId: run.id }],
    };
  },
};

export type ChecklistToday = Array<{
  locationId: string;
  locationName: string;
  day: string;
  lists: Array<{
    kind: ChecklistKind;
    complete: boolean;
    steps: Array<{ id: string; label: string; done: boolean; doneBy: string | null; doneAt: Date | null; note: string | null }>;
  }>;
}>;

export const checklistToday: QueryDefinition<{ locationId?: string }, ChecklistToday> = {
  key: "verity.dinein.checklist_today",
  entity: ENTITY_TABLE,
  input: z.object({ locationId: z.string().uuid().optional() }),
  handler: async (ctx, input) => {
    const locationIds = await scopedLocationIds(ctx.tx, ctx.actor, ENTITY_TABLE, input.locationId);
    const day = (await serviceDayRange(ctx.tx, ctx.actor.organizationId, undefined, await dayStartMinuteFor(ctx.tx, locationIds))).day;
    const locations = await ctx.tx.location.findMany({
      where: { id: { in: locationIds }, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    const steps = await ctx.tx.outletChecklistStep.findMany({
      where: { locationId: { in: locationIds }, active: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    });
    const runs = await ctx.tx.outletChecklistRun.findMany({
      where: { locationId: { in: locationIds }, serviceDay: new Date(`${day}T00:00:00Z`) },
      include: { ticks: true },
    });
    const userIds = [...new Set(runs.flatMap((r) => r.ticks.map((t) => t.doneByUserId)))];
    const users = userIds.length
      ? await ctx.tx.user.findMany({ where: { id: { in: userIds } }, include: { party: { select: { displayName: true } } } })
      : [];
    const names = new Map(users.map((u) => [u.id, u.party.displayName]));

    return locations.map((location) => ({
      locationId: location.id,
      locationName: location.name,
      day,
      lists: CHECKLIST_KINDS.map((kind) => {
        const run = runs.find((r) => r.locationId === location.id && r.kind === kind);
        const ticks = new Map((run?.ticks ?? []).map((t) => [t.stepId, t]));
        const listSteps = steps.filter((s) => s.locationId === location.id && s.kind === kind);
        return {
          kind,
          complete: listSteps.length > 0 && listSteps.every((s) => ticks.has(s.id)),
          steps: listSteps.map((s) => {
            const tick = ticks.get(s.id);
            return {
              id: s.id,
              label: s.label,
              done: Boolean(tick),
              doneBy: tick ? (names.get(tick.doneByUserId) ?? null) : null,
              doneAt: tick?.doneAt ?? null,
              note: tick?.note ?? null,
            };
          }),
        };
      }),
    }));
  },
};

export function registerDineinChecklist(): void {
  registerCommand(setChecklistSteps);
  registerCommand(tickChecklistStep);
  registerQuery(checklistToday);
}
