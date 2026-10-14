import type { TenantScopedClient } from "@/server/platform/tenancy";
import { ENTITY_PROJECT_JOB, ENTITY_PROJECT_TASK, jobReference, labourCostMinor } from "./shared";

/**
 * Read models for jobs. Everything numeric here is DERIVED from facts every time, never
 * stored: cost comes from consumed material, logged time and recorded costs; margin is the
 * approved quote minus that cost; progress comes from tasks, else from production stages.
 */

export type JobCosting = {
  quotedValueMinor: number | null;
  materialMinor: number;
  labourMinor: number;
  otherMinor: number;
  totalMinor: number;
  marginMinor: number | null;
  marginPercent: number | null;
  loggedMinutes: number;
};

/**
 * Material is what linked orders have consumed (started or finished), at each item's
 * current moving-average cost. Issue movements do not snapshot a unit cost, so this is an
 * estimate at today's average, and the screen says so.
 */
export async function jobCosting(tx: TenantScopedClient, jobId: string): Promise<JobCosting> {
  const [job, links, time, costs] = await Promise.all([
    tx.projectJob.findUniqueOrThrow({ where: { id: jobId } }),
    tx.projectJobOrder.findMany({
      where: { jobId, order: { state: { in: ["in_progress", "completed"] } } },
      include: { order: { include: { lines: { include: { componentItem: true } } } } },
    }),
    tx.projectTimeEntry.findMany({ where: { jobId, voidedAt: null } }),
    tx.projectCostEntry.findMany({ where: { jobId, voidedAt: null } }),
  ]);
  const materialMinor = links.reduce(
    (sum, l) => sum + l.order.lines.reduce((s, line) => s + line.qtyRequired * (line.componentItem.avgUnitCostPaise ?? 0), 0),
    0,
  );
  const labourMinor = time.reduce((s, t) => s + labourCostMinor(t.minutes, t.hourlyRateMinor), 0);
  const otherMinor = costs.reduce((s, c) => s + c.amountMinor, 0);
  const totalMinor = materialMinor + labourMinor + otherMinor;
  const quoted = job.quotedValueMinor;
  return {
    quotedValueMinor: quoted,
    materialMinor,
    labourMinor,
    otherMinor,
    totalMinor,
    marginMinor: quoted === null ? null : quoted - totalMinor,
    marginPercent: quoted === null || quoted === 0 ? null : Math.round(((quoted - totalMinor) / quoted) * 1000) / 10,
    loggedMinutes: time.reduce((s, t) => s + t.minutes, 0),
  };
}

type TaskLite = { state: string; weight: number };

/** Weighted share of tasks done, ignoring cancelled ones. Null when there are no tasks to measure. */
export function taskProgress(tasks: TaskLite[]): number | null {
  const live = tasks.filter((t) => t.state !== "cancelled");
  const total = live.reduce((s, t) => s + t.weight, 0);
  if (total === 0) return null;
  const done = live.filter((t) => t.state === "done").reduce((s, t) => s + t.weight, 0);
  return Math.round((done / total) * 100);
}

async function categoryMap(tx: TenantScopedClient, entityKey: string): Promise<Map<string, string>> {
  const states = await tx.stateDefinition.findMany({ where: { entityKey } });
  return new Map(states.map((s) => [s.key, s.category]));
}

/** Production progress for a job: finished stages over all stages of its linked orders. */
async function stageProgress(tx: TenantScopedClient, jobIds: string[]): Promise<Map<string, number | null>> {
  const links = await tx.projectJobOrder.findMany({
    where: { jobId: { in: jobIds } },
    include: { order: { include: { operations: { select: { state: true } } } } },
  });
  const byJob = new Map<string, { done: number; total: number }>();
  for (const l of links) {
    const acc = byJob.get(l.jobId) ?? { done: 0, total: 0 };
    for (const op of l.order.operations) {
      if (op.state === "cancelled") continue;
      acc.total += 1;
      if (op.state === "completed") acc.done += 1;
    }
    byJob.set(l.jobId, acc);
  }
  return new Map(jobIds.map((id) => {
    const a = byJob.get(id);
    return [id, a && a.total > 0 ? Math.round((a.done / a.total) * 100) : null];
  }));
}

export type JobRow = {
  id: string;
  reference: string;
  title: string;
  customerName: string;
  state: string;
  category: string;
  priority: string;
  dueDate: string | null;
  overdue: boolean;
  quotedValueMinor: number | null;
  openQuoteMinor: number | null;
  progress: number | null;
};

export async function listJobs(tx: TenantScopedClient, filter: { customerId?: string } = {}): Promise<JobRow[]> {
  const [jobs, categories] = await Promise.all([
    tx.projectJob.findMany({
      where: filter.customerId ? { customerId: filter.customerId } : undefined,
      orderBy: { number: "desc" },
      include: { tasks: { select: { state: true, weight: true } }, quotes: { where: { status: "open" }, select: { amountMinor: true } } },
    }),
    categoryMap(tx, ENTITY_PROJECT_JOB),
  ]);
  const stages = await stageProgress(tx, jobs.map((j) => j.id));
  const today = new Date().toISOString().slice(0, 10);
  return jobs.map((j) => {
    const due = j.dueDate ? j.dueDate.toISOString().slice(0, 10) : null;
    const category = categories.get(j.state) ?? "Draft";
    return {
      id: j.id,
      reference: jobReference(j.number),
      title: j.title,
      customerName: j.customerName,
      state: j.state.replace(/_/g, " "),
      category,
      priority: j.priority,
      dueDate: due,
      overdue: due !== null && due < today && category !== "Completed" && category !== "Cancelled",
      quotedValueMinor: j.quotedValueMinor,
      openQuoteMinor: j.quotes[0]?.amountMinor ?? null,
      progress: taskProgress(j.tasks) ?? stages.get(j.id) ?? null,
    };
  });
}

export async function jobDetail(tx: TenantScopedClient, jobId: string) {
  const job = await tx.projectJob.findUnique({
    where: { id: jobId },
    include: {
      lostReason: true,
      quotes: { orderBy: { revision: "desc" }, include: { lines: { orderBy: { sequence: "asc" } } } },
      milestones: { orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }] },
      tasks: { orderBy: { createdAt: "asc" }, include: { dependsOn: { include: { dependsOn: { select: { id: true, title: true, state: true } } } } } },
      timeEntries: { orderBy: [{ workDate: "desc" }, { createdAt: "desc" }] },
      costEntries: { orderBy: [{ incurredOn: "desc" }, { createdAt: "desc" }] },
      orders: {
        include: {
          order: {
            include: {
              outputItem: { select: { name: true } },
              operations: { orderBy: { sequence: "asc" }, select: { id: true, label: true, state: true } },
            },
          },
        },
      },
    },
  });
  if (!job) return null;
  const [costing, jobCategories, taskCategories, lostReasons, freeOrders] = await Promise.all([
    jobCosting(tx, jobId),
    categoryMap(tx, ENTITY_PROJECT_JOB),
    categoryMap(tx, ENTITY_PROJECT_TASK),
    tx.projectLostReason.findMany({ where: { active: true }, orderBy: { label: "asc" }, select: { id: true, label: true } }),
    tx.manufacturingOrder.findMany({
      where: { projectLink: null, state: { not: "cancelled" } },
      orderBy: { createdAt: "desc" },
      select: { id: true, reference: true },
    }),
  ]);
  return {
    job,
    reference: jobReference(job.number),
    category: jobCategories.get(job.state) ?? "Draft",
    taskCategories,
    costing,
    lostReasons,
    freeOrders,
    progress: taskProgress(job.tasks) ?? (await stageProgress(tx, [job.id])).get(job.id) ?? null,
  };
}

/** Everything the Summary home shows, in one read. */
export async function summaryData(tx: TenantScopedClient) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const today = new Date(`${todayIso}T00:00:00.000Z`);
  const workingJob = { state: { in: ["approved", "in_progress", "on_hold"] } };
  const [rows, orders, balances, items, milestones, openOps, lateMilestones, lateTasks, blockedTasks, expiredQuotes] = await Promise.all([
    listJobs(tx),
    tx.manufacturingOrder.count({ where: { state: "in_progress" } }),
    tx.inventoryStockBalance.groupBy({ by: ["itemId"], _sum: { qty: true } }),
    tx.inventoryItem.findMany({ where: { active: true, reorderLevel: { gt: 0 } }, select: { id: true, name: true, sku: true, unitLabel: true, reorderLevel: true } }),
    tx.projectMilestone.findMany({
      where: { reachedAt: null, dueDate: { not: null }, job: { state: { in: ["approved", "in_progress", "on_hold"] } } },
      orderBy: { dueDate: "asc" },
      take: 6,
      include: { job: { select: { id: true, number: true, title: true } } },
    }),
    tx.manufacturingOrder.findMany({
      where: { state: "in_progress" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        reference: true,
        operations: { orderBy: { sequence: "asc" }, select: { label: true, state: true } },
        projectLink: { select: { job: { select: { id: true, number: true } } } },
      },
    }),
    tx.projectMilestone.findMany({
      where: { reachedAt: null, dueDate: { lt: today }, job: workingJob },
      orderBy: { dueDate: "asc" },
      take: 5,
      include: { job: { select: { id: true, number: true } } },
    }),
    tx.projectTask.findMany({
      where: { dueDate: { lt: today }, state: { in: ["todo", "in_progress"] }, job: workingJob },
      orderBy: { dueDate: "asc" },
      take: 5,
      include: { job: { select: { id: true, number: true } } },
    }),
    tx.projectTask.findMany({
      where: { state: "blocked", job: workingJob },
      orderBy: { updatedAt: "asc" },
      take: 5,
      include: { job: { select: { id: true, number: true } } },
    }),
    tx.projectQuote.findMany({
      where: { status: "open", validUntil: { lt: today }, job: { state: "quoted" } },
      orderBy: { validUntil: "asc" },
      take: 5,
      include: { job: { select: { id: true, number: true } } },
    }),
  ]);
  const onHand = new Map(balances.map((b) => [b.itemId, b._sum.qty ?? 0]));
  const low = items
    .map((i) => ({ ...i, onHand: onHand.get(i.id) ?? 0 }))
    .filter((i) => i.onHand <= i.reorderLevel)
    .sort((a, b) => a.onHand / a.reorderLevel - b.onHand / b.reorderLevel);

  const working = rows.filter((r) => ["approved", "in progress", "on hold"].includes(r.state));

  // Most damaging first. Each item names the job (when it has one), what is wrong, and the date it concerns;
  // the page words the next action. Everything here is a fact over stored records, nothing is predicted.
  type Attention = { kind: "job_late" | "milestone_late" | "task_blocked" | "task_late" | "quote_expired" | "stock_low"; jobId: string | null; jobReference: string | null; subject: string; date: string | null; extra: string | null };
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const attention: Attention[] = [
    ...rows.filter((r) => r.overdue).map((r): Attention => ({ kind: "job_late", jobId: r.id, jobReference: r.reference, subject: r.title, date: r.dueDate, extra: r.state })),
    ...lateMilestones.map((m): Attention => ({ kind: "milestone_late", jobId: m.job.id, jobReference: jobReference(m.job.number), subject: m.name, date: iso(m.dueDate), extra: null })),
    ...blockedTasks.map((t): Attention => ({ kind: "task_blocked", jobId: t.job.id, jobReference: jobReference(t.job.number), subject: t.title, date: null, extra: t.assigneeLabel })),
    ...lateTasks.map((t): Attention => ({ kind: "task_late", jobId: t.job.id, jobReference: jobReference(t.job.number), subject: t.title, date: iso(t.dueDate), extra: t.assigneeLabel })),
    ...expiredQuotes.map((q): Attention => ({ kind: "quote_expired", jobId: q.job.id, jobReference: jobReference(q.job.number), subject: `revision ${q.revision}`, date: iso(q.validUntil), extra: null })),
    ...low.slice(0, 3).map((i): Attention => ({ kind: "stock_low", jobId: null, jobReference: null, subject: i.name, date: null, extra: `${i.onHand} ${i.unitLabel} left, reorder at ${i.reorderLevel}` })),
  ].slice(0, 8);

  return {
    attention,
    counts: {
      enquiries: rows.filter((r) => r.state === "enquiry").length,
      quoted: rows.filter((r) => r.state === "quoted").length,
      working: working.length,
      overdue: rows.filter((r) => r.overdue).length,
      completed: rows.filter((r) => r.category === "Completed").length,
      productionOrders: orders,
    },
    pipelineMinor: rows.filter((r) => r.state === "quoted").reduce((s, r) => s + (r.openQuoteMinor ?? 0), 0),
    orderBookMinor: working.reduce((s, r) => s + (r.quotedValueMinor ?? 0), 0),
    working,
    low,
    // Where each running order is now: its first stage that is not finished. An order sitting
    // between stages (the last one done, the next not started) still shows its next stage.
    shop: openOps.flatMap((o) => {
      const stages = o.operations.filter((op) => op.state !== "cancelled");
      const current = stages.find((op) => op.state !== "completed");
      if (!current) return [];
      return [{
        orderId: o.id,
        order: o.reference ?? `Order ${o.id.slice(0, 8)}`,
        jobId: o.projectLink?.job.id ?? null,
        jobReference: o.projectLink ? jobReference(o.projectLink.job.number) : null,
        stage: current.label,
        stageState: current.state,
        done: stages.filter((op) => op.state === "completed").length,
        total: stages.length,
      }];
    }),
    milestones: milestones.map((m) => ({
      id: m.id,
      name: m.name,
      dueDate: m.dueDate!.toISOString().slice(0, 10),
      jobId: m.job.id,
      jobReference: jobReference(m.job.number),
      jobTitle: m.job.title,
    })),
  };
}
