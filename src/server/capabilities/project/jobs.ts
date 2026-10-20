import { z } from "zod";
import { ValidationError, type CommandContext, type CommandDefinition } from "@/server/platform/command";
import { assertMutable, transition } from "@/server/platform/state";
import { diffFields, recordActivity } from "@/server/platform/audit";
import {
  ENTITY_PROJECT_JOB,
  ENTITY_PROJECT_LOST_REASON,
  ENTITY_PROJECT_QUOTE,
  JOB_PRIORITIES,
  loadWorkingJob,
  nextJobNumber,
} from "./shared";

/**
 * Job lifecycle: enquiry -> quoted -> approved -> in progress (-> on hold) -> completed,
 * with lost and cancelled as the two unhappy ends. Every move goes through the platform's
 * transition runtime, so an undeclared move is refused by absence (ADR-009), and a finished
 * job is read-only (INV-002).
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");
const asDate = (d: string) => new Date(`${d}T00:00:00.000Z`);

/** Writes a state move to the job's history, so the page can show who moved it, when, and from where. */
async function logState(ctx: CommandContext, jobId: string, from: string, to: string, commandKey: string): Promise<void> {
  await recordActivity(ctx, { entityKey: ENTITY_PROJECT_JOB, entityId: jobId, commandKey, changes: diffFields({ status: from.replace(/_/g, " ") }, { status: to.replace(/_/g, " ") }) });
}

export const createJob: CommandDefinition<
  {
    title: string;
    customerId: string;
    customerContact?: string;
    description?: string;
    priority?: (typeof JOB_PRIORITIES)[number];
    dueDate?: string;
  },
  { id: string; number: number }
> = {
  key: "verity.project.create_job",
  entity: ENTITY_PROJECT_JOB,
  verb: "Create",
  description: "Open a new job from a customer enquiry.",
  input: z.object({
    title: z.string().trim().min(3).max(200),
    customerId: z.string().uuid(),
    customerContact: z.string().trim().max(200).optional(),
    description: z.string().trim().max(4000).optional(),
    priority: z.enum(JOB_PRIORITIES).optional(),
    dueDate: isoDate.optional(),
  }),
  preconditions: async (ctx, input) => {
    const customer = await ctx.tx.tradingCustomer.findUnique({ where: { id: input.customerId } });
    if (!customer) throw new ValidationError("E_VALIDATION: customer not found in this tenant");
    if (!customer.active) throw new ValidationError("E_VALIDATION: this customer is inactive; restore it or choose another");
  },
  handler: async (ctx, input) => {
    const customer = await ctx.tx.tradingCustomer.findUniqueOrThrow({ where: { id: input.customerId } });
    const number = await nextJobNumber(ctx.tx, ctx.actor.tenantId);
    const job = await ctx.tx.projectJob.create({
      data: {
        tenantId: ctx.actor.tenantId,
        number,
        title: input.title,
        customerId: customer.id,
        // Snapshot: what this job was quoted to, whatever the customer is later renamed.
        customerName: customer.displayName,
        customerContact: input.customerContact ?? null,
        description: input.description ?? null,
        priority: input.priority ?? "normal",
        dueDate: input.dueDate ? asDate(input.dueDate) : null,
        createdById: ctx.actor.userId,
      },
    });
    return {
      result: { id: job.id, number },
      events: [{ name: "verity.project.job_created", entityId: job.id }],
    };
  },
};

export const editJob: CommandDefinition<
  {
    jobId: string;
    title?: string;
    customerContact?: string | null;
    description?: string | null;
    priority?: (typeof JOB_PRIORITIES)[number];
    dueDate?: string | null;
  },
  { id: string }
> = {
  key: "verity.project.edit_job",
  entity: ENTITY_PROJECT_JOB,
  verb: "Edit",
  description: "Change a job's title, contact, description, priority or due date.",
  input: z.object({
    jobId: z.string().uuid(),
    title: z.string().trim().min(3).max(200).optional(),
    customerContact: z.string().trim().max(200).nullable().optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    priority: z.enum(JOB_PRIORITIES).optional(),
    dueDate: isoDate.nullable().optional(),
  }),
  handler: async (ctx, input) => {
    const before = await ctx.tx.projectJob.findUniqueOrThrow({ where: { id: input.jobId } });
    await assertMutable(ctx.tx, ENTITY_PROJECT_JOB, before.state);
    const after = await ctx.tx.projectJob.update({
      where: { id: before.id },
      data: {
        title: input.title,
        customerContact: input.customerContact,
        description: input.description,
        priority: input.priority,
        dueDate: input.dueDate === undefined ? undefined : input.dueDate === null ? null : asDate(input.dueDate),
        version: { increment: 1 },
      },
    });
    await recordActivity(ctx, {
      entityKey: ENTITY_PROJECT_JOB,
      entityId: after.id,
      commandKey: "verity.project.edit_job",
      changes: diffFields(
        { title: before.title, priority: before.priority, dueDate: before.dueDate?.toISOString().slice(0, 10) ?? null },
        { title: after.title, priority: after.priority, dueDate: after.dueDate?.toISOString().slice(0, 10) ?? null },
      ),
    });
    return { result: { id: after.id }, events: [{ name: "verity.project.job_edited", entityId: after.id }] };
  },
};

/* ================================== quotes ================================== */

const quoteLine = z.object({
  description: z.string().trim().min(2).max(300),
  qty: z.number().int().positive().max(100_000),
  unitPriceMinor: z.number().int().min(0).max(2_000_000_000),
});

/**
 * A new quote revision. The previous open revision is superseded, never edited, so the
 * history of what was offered when stays intact. The first quote moves the job from
 * enquiry to quoted.
 */
export const addQuoteRevision: CommandDefinition<
  { jobId: string; lines: Array<z.infer<typeof quoteLine>>; validUntil?: string; scopeNote?: string },
  { id: string; revision: number; amountMinor: number }
> = {
  key: "verity.project.add_quote_revision",
  entity: ENTITY_PROJECT_QUOTE,
  verb: "Create",
  description: "Record a technical quote, or a revised quote, for a job.",
  input: z.object({
    jobId: z.string().uuid(),
    lines: z.array(quoteLine).min(1).max(100),
    validUntil: isoDate.optional(),
    scopeNote: z.string().trim().max(4000).optional(),
  }),
  handler: async (ctx, input) => {
    const job = await ctx.tx.projectJob.findUniqueOrThrow({ where: { id: input.jobId } });
    if (job.state !== "enquiry" && job.state !== "quoted") {
      throw new ValidationError(`E_VALIDATION: a quote can only be added while the job is an enquiry or quoted; this job is ${job.state.replace(/_/g, " ")}`);
    }
    const amountMinor = input.lines.reduce((sum, l) => sum + l.qty * l.unitPriceMinor, 0);
    if (amountMinor > 2_000_000_000) throw new ValidationError("E_VALIDATION: quote total is too large");

    const last = await ctx.tx.projectQuote.aggregate({ where: { jobId: job.id }, _max: { revision: true } });
    const revision = (last._max.revision ?? 0) + 1;
    await ctx.tx.projectQuote.updateMany({ where: { jobId: job.id, status: "open" }, data: { status: "superseded" } });

    const quote = await ctx.tx.projectQuote.create({
      data: {
        tenantId: ctx.actor.tenantId,
        jobId: job.id,
        revision,
        amountMinor,
        validUntil: input.validUntil ? asDate(input.validUntil) : null,
        scopeNote: input.scopeNote ?? null,
        createdById: ctx.actor.userId,
        lines: {
          create: input.lines.map((l, i) => ({
            tenantId: ctx.actor.tenantId,
            sequence: i + 1,
            description: l.description,
            qty: l.qty,
            unitPriceMinor: l.unitPriceMinor,
          })),
        },
      },
    });

    const events: Array<{ name: string; entityId: string; payload?: Record<string, unknown> }> = [
      { name: "verity.project.quote_added", entityId: quote.id, payload: { revision, amountMinor } },
    ];
    if (job.state === "enquiry") {
      const moved = await transition(ctx, { entityKey: ENTITY_PROJECT_JOB, entityId: job.id, fromKey: "enquiry", toKey: "quoted" });
      await logState(ctx, job.id, "enquiry", "quoted", "verity.project.add_quote_revision");
      await ctx.tx.projectJob.update({ where: { id: job.id }, data: { state: "quoted", version: { increment: 1 } } });
      events.push(moved.event);
    }
    return { result: { id: quote.id, revision, amountMinor }, events };
  },
};

/**
 * Approving the open quote is the moment the commercial terms freeze: its total is
 * snapshotted onto the job, and later revisions are refused because the job is no longer
 * quoted.
 */
export const approveQuote: CommandDefinition<{ quoteId: string }, { id: string; quotedValueMinor: number }> = {
  key: "verity.project.approve_quote",
  entity: ENTITY_PROJECT_QUOTE,
  verb: "ActionExecute",
  description: "Record that the customer accepted this quote, and open the job for work.",
  input: z.object({ quoteId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const quote = await ctx.tx.projectQuote.findUniqueOrThrow({ where: { id: input.quoteId } });
    if (quote.status !== "open") {
      throw new ValidationError("E_VALIDATION: only the current open quote can be approved; this one has been superseded or closed");
    }
    const job = await ctx.tx.projectJob.findUniqueOrThrow({ where: { id: quote.jobId } });
    const moved = await transition(ctx, { entityKey: ENTITY_PROJECT_JOB, entityId: job.id, fromKey: job.state, toKey: "approved" });
    await logState(ctx, job.id, job.state, "approved", "verity.project.approve_quote");
    await ctx.tx.projectQuote.update({ where: { id: quote.id }, data: { status: "approved" } });
    await ctx.tx.projectJob.update({
      where: { id: job.id },
      data: { state: "approved", quotedValueMinor: quote.amountMinor, approvedQuoteId: quote.id, version: { increment: 1 } },
    });
    return {
      result: { id: job.id, quotedValueMinor: quote.amountMinor },
      events: [moved.event, { name: "verity.project.quote_approved", entityId: quote.id }],
    };
  },
};

/** Lost is a structured outcome: a reason from the tenant's own registry, never free text alone. */
export const markJobLost: CommandDefinition<{ jobId: string; reasonId: string; note?: string }, { id: string }> = {
  key: "verity.project.mark_job_lost",
  entity: ENTITY_PROJECT_JOB,
  verb: "ActionExecute",
  impact: "destructive",
  description: "Close an enquiry or quoted job as lost, with the reason.",
  input: z.object({ jobId: z.string().uuid(), reasonId: z.string().uuid(), note: z.string().trim().max(1000).optional() }),
  preconditions: async (ctx, input) => {
    const reason = await ctx.tx.projectLostReason.findUnique({ where: { id: input.reasonId } });
    if (!reason || !reason.active) throw new ValidationError("E_VALIDATION: choose an active lost reason");
  },
  handler: async (ctx, input) => {
    const job = await ctx.tx.projectJob.findUniqueOrThrow({ where: { id: input.jobId } });
    const moved = await transition(ctx, { entityKey: ENTITY_PROJECT_JOB, entityId: job.id, fromKey: job.state, toKey: "lost" });
    await logState(ctx, job.id, job.state, "lost", "verity.project.mark_job_lost");
    await ctx.tx.projectQuote.updateMany({ where: { jobId: job.id, status: "open" }, data: { status: "lost" } });
    await ctx.tx.projectJob.update({
      where: { id: job.id },
      data: { state: "lost", lostReasonId: input.reasonId, lostNote: input.note ?? null, finishedAt: new Date(), version: { increment: 1 } },
    });
    return { result: { id: job.id }, events: [moved.event] };
  },
};

/* ============================= lifecycle moves ============================= */

function move(
  key: string,
  toKey: string,
  fromKeys: string[],
  description: string,
  extra?: () => Record<string, unknown>,
): CommandDefinition<{ jobId: string }, { id: string }> {
  // Bound to a typed const, not returned as a bare literal: write-confinement recognises a
  // command by its declared CommandDefinition type, and a returned literal reads as a helper.
  const command: CommandDefinition<{ jobId: string }, { id: string }> = {
    key,
    entity: ENTITY_PROJECT_JOB,
    verb: "ActionExecute",
    description,
    input: z.object({ jobId: z.string().uuid() }),
    handler: async (ctx, input) => {
      const job = await ctx.tx.projectJob.findUniqueOrThrow({ where: { id: input.jobId } });
      if (!fromKeys.includes(job.state)) {
        throw new ValidationError(`E_VALIDATION: a job that is ${job.state.replace(/_/g, " ")} cannot be moved to ${toKey.replace(/_/g, " ")}`);
      }
      const moved = await transition(ctx, { entityKey: ENTITY_PROJECT_JOB, entityId: job.id, fromKey: job.state, toKey });
      await logState(ctx, job.id, job.state, toKey, key);
      await ctx.tx.projectJob.update({
        where: { id: job.id },
        data: { state: toKey, version: { increment: 1 }, ...(extra?.() ?? {}) },
      });
      return { result: { id: job.id }, events: [moved.event] };
    },
  };
  return command;
}

export const startJob = move("verity.project.start_job", "in_progress", ["approved"], "Start work on an approved job.", () => ({
  startedAt: new Date(),
}));
export const holdJob = move("verity.project.hold_job", "on_hold", ["in_progress"], "Put a job on hold.");
export const resumeJob = move("verity.project.resume_job", "in_progress", ["on_hold"], "Resume a job that was on hold.");

/**
 * Completing refuses while work is visibly unfinished: a linked production order still
 * open, or a task still to do. The reason names what is open, so the fix is obvious.
 */
export const completeJob: CommandDefinition<{ jobId: string }, { id: string }> = {
  key: "verity.project.complete_job",
  entity: ENTITY_PROJECT_JOB,
  verb: "ActionExecute",
  description: "Finish a job once its production orders and tasks are done.",
  input: z.object({ jobId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const job = await ctx.tx.projectJob.findUniqueOrThrow({ where: { id: input.jobId } });
    const links = await ctx.tx.projectJobOrder.findMany({ where: { jobId: job.id }, include: { order: true } });
    const openOrders = links.filter((l) => l.order.state !== "completed" && l.order.state !== "cancelled");
    if (openOrders.length > 0) {
      throw new ValidationError(`E_VALIDATION: ${openOrders.length} production order(s) are still open: ${openOrders.map((l) => l.order.reference ?? l.order.id.slice(0, 8)).join(", ")}`);
    }
    const openTasks = await ctx.tx.projectTask.count({ where: { jobId: job.id, state: { notIn: ["done", "cancelled"] } } });
    if (openTasks > 0) throw new ValidationError(`E_VALIDATION: ${openTasks} task(s) are not done yet`);

    const moved = await transition(ctx, { entityKey: ENTITY_PROJECT_JOB, entityId: job.id, fromKey: job.state, toKey: "completed" });
    await logState(ctx, job.id, job.state, "completed", "verity.project.complete_job");
    await ctx.tx.projectJob.update({
      where: { id: job.id },
      data: { state: "completed", finishedAt: new Date(), version: { increment: 1 } },
    });
    return { result: { id: job.id }, events: [moved.event] };
  },
};

export const cancelJob: CommandDefinition<{ jobId: string; reason: string }, { id: string }> = {
  key: "verity.project.cancel_job",
  entity: ENTITY_PROJECT_JOB,
  verb: "ActionExecute",
  impact: "destructive",
  description: "Cancel a job. The record and its history stay; the job becomes read-only.",
  input: z.object({ jobId: z.string().uuid(), reason: z.string().trim().min(3).max(500) }),
  handler: async (ctx, input) => {
    const job = await ctx.tx.projectJob.findUniqueOrThrow({ where: { id: input.jobId } });
    const moved = await transition(ctx, { entityKey: ENTITY_PROJECT_JOB, entityId: job.id, fromKey: job.state, toKey: "cancelled" });
    await logState(ctx, job.id, job.state, "cancelled", "verity.project.cancel_job");
    await ctx.tx.projectQuote.updateMany({ where: { jobId: job.id, status: "open" }, data: { status: "lost" } });
    await ctx.tx.projectJob.update({
      where: { id: job.id },
      data: { state: "cancelled", lostNote: input.reason, finishedAt: new Date(), version: { increment: 1 } },
    });
    return { result: { id: job.id }, events: [moved.event] };
  },
};

/* ============================ production link ============================ */

export const linkOrder: CommandDefinition<{ jobId: string; orderId: string }, { id: string }> = {
  key: "verity.project.link_order",
  entity: ENTITY_PROJECT_JOB,
  verb: "Edit",
  description: "Attach a production order to this job so its material cost counts toward the job.",
  input: z.object({ jobId: z.string().uuid(), orderId: z.string().uuid() }),
  handler: async (ctx, input) => {
    await loadWorkingJob(ctx.tx, input.jobId, "linking a production order");
    const order = await ctx.tx.manufacturingOrder.findUnique({ where: { id: input.orderId } });
    if (!order) throw new ValidationError("E_VALIDATION: production order not found in this tenant");
    if (order.state === "cancelled") throw new ValidationError("E_VALIDATION: a cancelled order cannot be linked");
    const taken = await ctx.tx.projectJobOrder.findUnique({ where: { orderId: order.id } });
    if (taken) throw new ValidationError("E_VALIDATION: this order already belongs to a job");
    const link = await ctx.tx.projectJobOrder.create({
      data: { tenantId: ctx.actor.tenantId, jobId: input.jobId, orderId: order.id },
    });
    return { result: { id: link.id }, events: [{ name: "verity.project.order_linked", entityId: input.jobId, payload: { orderId: order.id } }] };
  },
};

/* ============================== lost reasons ============================== */

export const defineLostReason: CommandDefinition<{ key: string; label: string }, { id: string }> = {
  key: "verity.project.define_lost_reason",
  entity: ENTITY_PROJECT_LOST_REASON,
  verb: "Create",
  description: "Add a reason jobs can be lost for.",
  input: z.object({
    key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/, "lowercase letters, digits and underscores"),
    label: z.string().trim().min(2).max(100),
  }),
  preconditions: async (ctx, input) => {
    if (await ctx.tx.projectLostReason.findFirst({ where: { key: input.key } })) {
      throw new ValidationError("E_VALIDATION: a lost reason with that key already exists");
    }
  },
  handler: async (ctx, input) => {
    const row = await ctx.tx.projectLostReason.create({ data: { tenantId: ctx.actor.tenantId, key: input.key, label: input.label } });
    return { result: { id: row.id }, events: [{ name: "verity.project.lost_reason_defined", entityId: row.id }] };
  },
};

/** Retired, never deleted: jobs already lost for this reason keep pointing at it. */
export const setLostReasonActive: CommandDefinition<{ reasonId: string; active: boolean }, { id: string }> = {
  key: "verity.project.set_lost_reason_active",
  entity: ENTITY_PROJECT_LOST_REASON,
  verb: "Edit",
  description: "Retire or restore a lost reason.",
  input: z.object({ reasonId: z.string().uuid(), active: z.boolean() }),
  handler: async (ctx, input) => {
    const row = await ctx.tx.projectLostReason.update({ where: { id: input.reasonId }, data: { active: input.active } });
    return { result: { id: row.id }, events: [{ name: "verity.project.lost_reason_changed", entityId: row.id }] };
  },
};
