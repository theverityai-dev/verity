import { z } from "zod";
import { ValidationError, type CommandDefinition } from "@/server/platform/command";
import { assertMutable, transition } from "@/server/platform/state";
import { diffFields, recordActivity } from "@/server/platform/audit";
import type { TenantScopedClient } from "@/server/platform/tenancy";
import {
  COST_KINDS,
  ENTITY_PROJECT_COST_ENTRY,
  ENTITY_PROJECT_MILESTONE,
  ENTITY_PROJECT_TASK,
  ENTITY_PROJECT_TIME_ENTRY,
  loadWorkingJob,
} from "./shared";

/**
 * Tasks, milestones, time and cost. Time and cost are append-only facts: a wrong entry is
 * voided with a reason and entered again, never edited, so what was recorded on a given
 * day stays answerable.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");
const asDate = (d: string) => new Date(`${d}T00:00:00.000Z`);

/* ================================== tasks ================================== */

/** True when `target` is reachable from `from` by following "depends on" links: adding the link would close a loop. */
async function dependsTransitively(tx: TenantScopedClient, from: string, target: string): Promise<boolean> {
  const seen = new Set<string>();
  let frontier = [from];
  while (frontier.length > 0) {
    const links = await tx.projectTaskDependency.findMany({ where: { taskId: { in: frontier } } });
    frontier = [];
    for (const l of links) {
      if (l.dependsOnId === target) return true;
      if (!seen.has(l.dependsOnId)) {
        seen.add(l.dependsOnId);
        frontier.push(l.dependsOnId);
      }
    }
  }
  return false;
}

export const createTask: CommandDefinition<
  {
    jobId: string;
    title: string;
    parentId?: string;
    assigneeLabel?: string;
    dueDate?: string;
    expectedMinutes?: number;
    weight?: number;
    dependsOnIds?: string[];
  },
  { id: string }
> = {
  key: "verity.project.create_task",
  entity: ENTITY_PROJECT_TASK,
  verb: "Create",
  description: "Add a task to a job, optionally under another task or after others.",
  input: z.object({
    jobId: z.string().uuid(),
    title: z.string().trim().min(2).max(200),
    parentId: z.string().uuid().optional(),
    assigneeLabel: z.string().trim().max(100).optional(),
    dueDate: isoDate.optional(),
    expectedMinutes: z.number().int().positive().max(100_000).optional(),
    weight: z.number().int().min(1).max(100).optional(),
    dependsOnIds: z.array(z.string().uuid()).max(20).optional(),
  }),
  handler: async (ctx, input) => {
    await loadWorkingJob(ctx.tx, input.jobId, "adding a task");
    const related = [...(input.parentId ? [input.parentId] : []), ...(input.dependsOnIds ?? [])];
    if (related.length > 0) {
      const found = await ctx.tx.projectTask.findMany({ where: { id: { in: related }, jobId: input.jobId } });
      if (found.length !== new Set(related).size) throw new ValidationError("E_VALIDATION: the parent and prerequisite tasks must belong to this job");
    }
    const task = await ctx.tx.projectTask.create({
      data: {
        tenantId: ctx.actor.tenantId,
        jobId: input.jobId,
        parentId: input.parentId ?? null,
        title: input.title,
        assigneeLabel: input.assigneeLabel ?? null,
        dueDate: input.dueDate ? asDate(input.dueDate) : null,
        expectedMinutes: input.expectedMinutes ?? null,
        weight: input.weight ?? 1,
      },
    });
    for (const dependsOnId of new Set(input.dependsOnIds ?? [])) {
      await ctx.tx.projectTaskDependency.create({ data: { tenantId: ctx.actor.tenantId, taskId: task.id, dependsOnId } });
    }
    return { result: { id: task.id }, events: [{ name: "verity.project.task_created", entityId: task.id }] };
  },
};

export const editTask: CommandDefinition<
  {
    taskId: string;
    title?: string;
    assigneeLabel?: string | null;
    dueDate?: string | null;
    expectedMinutes?: number | null;
    weight?: number;
  },
  { id: string }
> = {
  key: "verity.project.edit_task",
  entity: ENTITY_PROJECT_TASK,
  verb: "Edit",
  description: "Change a task's title, who it is assigned to, due date, expected hours or weight.",
  input: z.object({
    taskId: z.string().uuid(),
    title: z.string().trim().min(2).max(200).optional(),
    assigneeLabel: z.string().trim().max(100).nullable().optional(),
    dueDate: isoDate.nullable().optional(),
    expectedMinutes: z.number().int().positive().max(100_000).nullable().optional(),
    weight: z.number().int().min(1).max(100).optional(),
  }),
  handler: async (ctx, input) => {
    const before = await ctx.tx.projectTask.findUniqueOrThrow({ where: { id: input.taskId } });
    await loadWorkingJob(ctx.tx, before.jobId, "editing a task");
    // A done or cancelled task is a finished fact (INV-002 posture); it is not edited, a new task is added instead.
    await assertMutable(ctx.tx, ENTITY_PROJECT_TASK, before.state);
    const after = await ctx.tx.projectTask.update({
      where: { id: before.id },
      data: {
        title: input.title,
        assigneeLabel: input.assigneeLabel,
        dueDate: input.dueDate === undefined ? undefined : input.dueDate === null ? null : asDate(input.dueDate),
        expectedMinutes: input.expectedMinutes,
        weight: input.weight,
        version: { increment: 1 },
      },
    });
    const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
    await recordActivity(ctx, {
      entityKey: ENTITY_PROJECT_TASK,
      entityId: after.id,
      commandKey: "verity.project.edit_task",
      changes: diffFields(
        { title: before.title, assignedTo: before.assigneeLabel, due: day(before.dueDate), weight: before.weight },
        { title: after.title, assignedTo: after.assigneeLabel, due: day(after.dueDate), weight: after.weight },
      ),
    });
    return { result: { id: after.id }, events: [{ name: "verity.project.task_edited", entityId: after.id }] };
  },
};

export const addTaskDependency: CommandDefinition<{ taskId: string; dependsOnId: string }, { id: string }> = {
  key: "verity.project.add_task_dependency",
  entity: ENTITY_PROJECT_TASK,
  verb: "Edit",
  description: "Make one task wait for another to finish.",
  input: z.object({ taskId: z.string().uuid(), dependsOnId: z.string().uuid() }),
  handler: async (ctx, input) => {
    if (input.taskId === input.dependsOnId) throw new ValidationError("E_VALIDATION: a task cannot wait for itself");
    const [task, other] = await Promise.all([
      ctx.tx.projectTask.findUnique({ where: { id: input.taskId } }),
      ctx.tx.projectTask.findUnique({ where: { id: input.dependsOnId } }),
    ]);
    if (!task || !other || task.jobId !== other.jobId) throw new ValidationError("E_VALIDATION: both tasks must belong to the same job");
    if (await dependsTransitively(ctx.tx, input.dependsOnId, input.taskId)) {
      throw new ValidationError("E_VALIDATION: that would make the tasks wait for each other in a loop");
    }
    await ctx.tx.projectTaskDependency.upsert({
      where: { taskId_dependsOnId: { taskId: input.taskId, dependsOnId: input.dependsOnId } },
      create: { tenantId: ctx.actor.tenantId, taskId: input.taskId, dependsOnId: input.dependsOnId },
      update: {},
    });
    return { result: { id: input.taskId }, events: [{ name: "verity.project.task_dependency_added", entityId: input.taskId }] };
  },
};

export const setTaskState: CommandDefinition<{ taskId: string; toState: string }, { id: string; state: string }> = {
  key: "verity.project.set_task_state",
  entity: ENTITY_PROJECT_TASK,
  verb: "ActionExecute",
  description: "Move a task between to do, in progress, blocked, done and cancelled.",
  input: z.object({ taskId: z.string().uuid(), toState: z.enum(["todo", "in_progress", "blocked", "done", "cancelled"]) }),
  handler: async (ctx, input) => {
    const task = await ctx.tx.projectTask.findUniqueOrThrow({ where: { id: input.taskId } });
    await loadWorkingJob(ctx.tx, task.jobId, "changing a task");
    if (input.toState === "in_progress" || input.toState === "done") {
      const waiting = await ctx.tx.projectTaskDependency.findMany({
        where: { taskId: task.id, dependsOn: { state: { notIn: ["done", "cancelled"] } } },
        include: { dependsOn: true },
      });
      if (waiting.length > 0) {
        throw new ValidationError(`E_VALIDATION: this task waits for ${waiting.map((w) => `"${w.dependsOn.title}"`).join(", ")}`);
      }
    }
    const moved = await transition(ctx, { entityKey: ENTITY_PROJECT_TASK, entityId: task.id, fromKey: task.state, toKey: input.toState });
    await ctx.tx.projectTask.update({
      where: { id: task.id },
      data: { state: input.toState, completedAt: input.toState === "done" ? new Date() : null, version: { increment: 1 } },
    });
    return { result: { id: task.id, state: input.toState }, events: [moved.event] };
  },
};

/* =============================== milestones =============================== */

export const addMilestone: CommandDefinition<{ jobId: string; name: string; dueDate?: string; customerVisible?: boolean }, { id: string }> = {
  key: "verity.project.add_milestone",
  entity: ENTITY_PROJECT_MILESTONE,
  verb: "Create",
  description: "Add a dated checkpoint the customer can follow.",
  input: z.object({
    jobId: z.string().uuid(),
    name: z.string().trim().min(2).max(120),
    dueDate: isoDate.optional(),
    customerVisible: z.boolean().optional(),
  }),
  handler: async (ctx, input) => {
    await loadWorkingJob(ctx.tx, input.jobId, "adding a milestone");
    const row = await ctx.tx.projectMilestone.create({
      data: {
        tenantId: ctx.actor.tenantId,
        jobId: input.jobId,
        name: input.name,
        dueDate: input.dueDate ? asDate(input.dueDate) : null,
        customerVisible: input.customerVisible ?? true,
      },
    });
    return { result: { id: row.id }, events: [{ name: "verity.project.milestone_added", entityId: row.id }] };
  },
};

export const editMilestone: CommandDefinition<
  { milestoneId: string; name?: string; dueDate?: string | null; customerVisible?: boolean },
  { id: string }
> = {
  key: "verity.project.edit_milestone",
  entity: ENTITY_PROJECT_MILESTONE,
  verb: "Edit",
  description: "Change a milestone's name, due date, or whether the customer sees it.",
  input: z.object({
    milestoneId: z.string().uuid(),
    name: z.string().trim().min(2).max(120).optional(),
    dueDate: isoDate.nullable().optional(),
    customerVisible: z.boolean().optional(),
  }),
  handler: async (ctx, input) => {
    const row = await ctx.tx.projectMilestone.findUniqueOrThrow({ where: { id: input.milestoneId } });
    await loadWorkingJob(ctx.tx, row.jobId, "editing a milestone");
    if (row.reachedAt) throw new ValidationError("E_VALIDATION: a milestone that was reached is a fact and cannot be changed");
    await ctx.tx.projectMilestone.update({
      where: { id: row.id },
      data: {
        name: input.name,
        dueDate: input.dueDate === undefined ? undefined : input.dueDate === null ? null : asDate(input.dueDate),
        customerVisible: input.customerVisible,
      },
    });
    return { result: { id: row.id }, events: [{ name: "verity.project.milestone_edited", entityId: row.id }] };
  },
};

export const reachMilestone: CommandDefinition<{ milestoneId: string }, { id: string }> = {
  key: "verity.project.reach_milestone",
  entity: ENTITY_PROJECT_MILESTONE,
  verb: "ActionExecute",
  description: "Mark a milestone as reached.",
  input: z.object({ milestoneId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const row = await ctx.tx.projectMilestone.findUniqueOrThrow({ where: { id: input.milestoneId } });
    await loadWorkingJob(ctx.tx, row.jobId, "reaching a milestone");
    if (row.reachedAt) throw new ValidationError("E_VALIDATION: this milestone was already reached");
    await ctx.tx.projectMilestone.update({ where: { id: row.id }, data: { reachedAt: new Date() } });
    return { result: { id: row.id }, events: [{ name: "verity.project.milestone_reached", entityId: row.id }] };
  },
};

/* ============================== time and cost ============================== */

export const logTime: CommandDefinition<
  { jobId: string; taskId?: string; workerLabel: string; workDate: string; minutes: number; hourlyRateMinor: number; note?: string },
  { id: string }
> = {
  key: "verity.project.log_time",
  entity: ENTITY_PROJECT_TIME_ENTRY,
  verb: "Create",
  description: "Record hours someone worked on a job.",
  input: z.object({
    jobId: z.string().uuid(),
    taskId: z.string().uuid().optional(),
    workerLabel: z.string().trim().min(2).max(100),
    workDate: isoDate,
    minutes: z.number().int().min(1).max(1440),
    hourlyRateMinor: z.number().int().min(0).max(10_000_000),
    note: z.string().trim().max(400).optional(),
  }),
  handler: async (ctx, input) => {
    await loadWorkingJob(ctx.tx, input.jobId, "logging time");
    if (input.taskId) {
      const task = await ctx.tx.projectTask.findUnique({ where: { id: input.taskId } });
      if (!task || task.jobId !== input.jobId) throw new ValidationError("E_VALIDATION: that task does not belong to this job");
    }
    if (asDate(input.workDate).getTime() > Date.now() + 24 * 3600 * 1000) {
      throw new ValidationError("E_VALIDATION: time cannot be logged for a future date");
    }
    const row = await ctx.tx.projectTimeEntry.create({
      data: {
        tenantId: ctx.actor.tenantId,
        jobId: input.jobId,
        taskId: input.taskId ?? null,
        workerLabel: input.workerLabel,
        workDate: asDate(input.workDate),
        minutes: input.minutes,
        hourlyRateMinor: input.hourlyRateMinor,
        note: input.note ?? null,
        createdById: ctx.actor.userId,
      },
    });
    return { result: { id: row.id }, events: [{ name: "verity.project.time_logged", entityId: row.id }] };
  },
};

export const voidTimeEntry: CommandDefinition<{ entryId: string; reason: string }, { id: string }> = {
  key: "verity.project.void_time_entry",
  entity: ENTITY_PROJECT_TIME_ENTRY,
  verb: "Edit",
  impact: "destructive",
  description: "Cancel a time entry that was recorded wrongly; it stays on record, marked void.",
  input: z.object({ entryId: z.string().uuid(), reason: z.string().trim().min(3).max(300) }),
  handler: async (ctx, input) => {
    const row = await ctx.tx.projectTimeEntry.findUniqueOrThrow({ where: { id: input.entryId } });
    if (row.voidedAt) throw new ValidationError("E_VALIDATION: this entry is already void");
    await loadWorkingJob(ctx.tx, row.jobId, "voiding time");
    await ctx.tx.projectTimeEntry.update({ where: { id: row.id }, data: { voidedAt: new Date(), voidReason: input.reason } });
    return { result: { id: row.id }, events: [{ name: "verity.project.time_voided", entityId: row.id }] };
  },
};

export const addCost: CommandDefinition<
  { jobId: string; kind: (typeof COST_KINDS)[number]; description: string; supplierName?: string; amountMinor: number; incurredOn: string },
  { id: string }
> = {
  key: "verity.project.add_cost",
  entity: ENTITY_PROJECT_COST_ENTRY,
  verb: "Create",
  description: "Record a cost on a job that is not stock or labour, such as outsourced work, external testing or freight.",
  input: z.object({
    jobId: z.string().uuid(),
    kind: z.enum(COST_KINDS),
    description: z.string().trim().min(2).max(300),
    supplierName: z.string().trim().max(200).optional(),
    amountMinor: z.number().int().positive().max(2_000_000_000),
    incurredOn: isoDate,
  }),
  handler: async (ctx, input) => {
    await loadWorkingJob(ctx.tx, input.jobId, "recording a cost");
    const row = await ctx.tx.projectCostEntry.create({
      data: {
        tenantId: ctx.actor.tenantId,
        jobId: input.jobId,
        kind: input.kind,
        description: input.description,
        supplierName: input.supplierName ?? null,
        amountMinor: input.amountMinor,
        incurredOn: asDate(input.incurredOn),
        createdById: ctx.actor.userId,
      },
    });
    return { result: { id: row.id }, events: [{ name: "verity.project.cost_added", entityId: row.id }] };
  },
};

export const voidCostEntry: CommandDefinition<{ entryId: string; reason: string }, { id: string }> = {
  key: "verity.project.void_cost_entry",
  entity: ENTITY_PROJECT_COST_ENTRY,
  verb: "Edit",
  impact: "destructive",
  description: "Cancel a cost entry that was recorded wrongly; it stays on record, marked void.",
  input: z.object({ entryId: z.string().uuid(), reason: z.string().trim().min(3).max(300) }),
  handler: async (ctx, input) => {
    const row = await ctx.tx.projectCostEntry.findUniqueOrThrow({ where: { id: input.entryId } });
    if (row.voidedAt) throw new ValidationError("E_VALIDATION: this entry is already void");
    await loadWorkingJob(ctx.tx, row.jobId, "voiding a cost");
    await ctx.tx.projectCostEntry.update({ where: { id: row.id }, data: { voidedAt: new Date(), voidReason: input.reason } });
    return { result: { id: row.id }, events: [{ name: "verity.project.cost_voided", entityId: row.id }] };
  },
};
