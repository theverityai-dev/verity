import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PROJECT_JOB, PROJECT_CAPABILITY, jobDetail } from "@/server/capabilities/project";
import { entityHistory } from "@/server/platform/audit";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { DataTable } from "@/components/ui/DataTable";
import { Tabs } from "@/components/ui/Tabs";
import { DefinitionList, EmptyState, PageHeader, Panel, PermissionDenied, Stat, StatRow, StateBadge } from "@/components/ui/primitives";
import { AuditTrail } from "@/components/shell/AuditTrail";
import {
  AddCostButton,
  AddMilestoneButton,
  AddTaskButton,
  EditJobButton,
  JobActions,
  LinkOrderButton,
  LogTimeButton,
  QuoteButton,
} from "../JobForms";
import { ActionTable } from "../JobTables";
import { PRIORITY_LABEL, dateText, hoursText, inr } from "../format";

export const dynamic = "force-dynamic";

const COST_KIND_LABEL: Record<string, string> = { outsourced: "Outsourced work", testing: "External testing", freight: "Freight", other: "Other" };
const TASK_LABEL: Record<string, string> = { todo: "To do", in_progress: "In progress", blocked: "Blocked", done: "Done", cancelled: "Cancelled" };
const QUOTE_LABEL: Record<string, string> = { open: "Open", approved: "Approved", superseded: "Replaced", lost: "Lost" };

async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  installCapabilities();
  const { id } = await params;
  const actor = await requireActor();

  const data = await withTenant(actor.tenantId, async (tx) => {
    if (!(await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PROJECT_JOB))) return { denied: true as const };
    const detail = await jobDetail(tx, id);
    if (!detail) return null;
    return { denied: false as const, detail, history: await entityHistory(tx, ENTITY_PROJECT_JOB, id) };
  });
  if (data === null) notFound();
  if (data.denied) return <PermissionDenied what="reading this job" />;

  const { detail, history } = data;
  const { job, costing } = detail;
  const working = ["approved", "in_progress", "on_hold"].includes(job.state);
  const openQuote = job.quotes.find((q) => q.status === "open") ?? null;
  const taskOptions = job.tasks.filter((t) => t.state !== "cancelled").map((t) => ({ id: t.id, title: t.title }));
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const today = new Date().toISOString().slice(0, 10);

  /* ------------------------------- tabs ------------------------------- */

  const overview = (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Job">
        <DefinitionList
          items={[
            { term: "Customer", value: job.customerId ? <a href={`/customers/${job.customerId}`}>{job.customerName}</a> : job.customerName },
            ...(job.customerId ? [{ term: "Other jobs", value: <a href={`/jobs?customer=${job.customerId}`}>All jobs for this customer</a> }] : []),
            { term: "Contact", value: job.customerContact ?? "—" },
            { term: "Priority", value: PRIORITY_LABEL[job.priority] ?? job.priority },
            { term: "Delivery promised", value: dateText(job.dueDate) },
            { term: "Started", value: dateText(job.startedAt) },
            { term: "Finished", value: dateText(job.finishedAt) },
            ...(job.lostReason ? [{ term: "Lost because", value: job.lostReason.label }] : []),
            ...(job.lostNote ? [{ term: "Note", value: job.lostNote }] : []),
          ]}
        />
        {job.description && <p className="mb-0 mt-4 whitespace-pre-wrap text-[15px] text-text-secondary">{job.description}</p>}
      </Panel>
      <Panel title="History" flush>
        <AuditTrail
          entries={history.map((h) => ({
            id: h.id,
            field: h.fieldChanged,
            from: h.oldValue,
            to: h.newValue,
            at: h.occurredAt.toISOString(),
            // Command keys are implementation detail, never product copy.
            command: null,
          }))}
        />
      </Panel>
    </div>
  );

  const quoteTab = (
    <div className="flex flex-col gap-4">
      {job.quotes.length === 0 ? (
        <EmptyState title="No quote yet" description="List what is being offered and the price. The customer's approval opens the job for work." />
      ) : (
        job.quotes.map((q) => (
          <Panel
            key={q.id}
            title={`Revision ${q.revision}`}
            action={
              <span className="flex items-center gap-3">
                <a href={`/jobs/${job.id}/quote/${q.id}`}>Print quote</a>
                <StateBadge category={q.status === "approved" ? "Completed" : q.status === "open" ? "Pending" : "Cancelled"} label={QUOTE_LABEL[q.status] ?? q.status} />
              </span>
            }
            flush
          >
            <DataTable
              caption={`Quote revision ${q.revision}`}
              rows={q.lines.map((l) => ({ id: l.id, item: l.description, qty: l.qty, unit: inr(l.unitPriceMinor), total: inr(l.qty * l.unitPriceMinor) }))}
              columns={[
                { key: "item", header: "Item" },
                { key: "qty", header: "Qty", numeric: true },
                { key: "unit", header: "Unit price", numeric: true },
                { key: "total", header: "Amount", numeric: true },
              ]}
              emptyTitle="No lines"
              emptyDescription=""
            />
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-[15px]">
              <span className="text-text-secondary">
                {q.validUntil ? `Valid until ${dateText(q.validUntil)}` : "No expiry set"}
                {q.scopeNote ? ` · ${q.scopeNote}` : ""}
              </span>
              <strong>Total {inr(q.amountMinor)}</strong>
            </div>
          </Panel>
        ))
      )}
    </div>
  );

  const taskTab = (
    <div className="flex flex-col gap-4">
      {job.tasks.length === 0 ? (
        <EmptyState title="No tasks yet" description="Break the job into steps. A task can wait for another to finish." />
      ) : (
        <ActionTable
          kind="task"
          working={working}
          caption="Tasks"
          rows={job.tasks.map((t) => ({
            id: t.id,
            task: t.title,
            who: t.assigneeLabel ?? "—",
            due: dateText(t.dueDate),
            after: t.dependsOn.length === 0 ? "—" : t.dependsOn.map((d) => d.dependsOn.title).join(", "),
            state: TASK_LABEL[t.state] ?? t.state,
            category: detail.taskCategories.get(t.state) ?? "Pending",
            rawState: t.state,
          }))}
          columns={[
            { key: "task", header: "Task" },
            { key: "who", header: "Assigned to" },
            { key: "due", header: "Due" },
            { key: "after", header: "Waits for" },
            { key: "state", header: "Status", variant: "state", categoryKey: "category" },
          ]}
          emptyTitle="No tasks"
        />
      )}
    </div>
  );

  const milestoneTab =
    job.milestones.length === 0 ? (
      <EmptyState title="No milestones yet" description="Dated checkpoints the customer can follow, such as coils cast or test report issued." />
    ) : (
      <ActionTable
        kind="milestone"
        working={working}
        caption="Milestones"
        rows={job.milestones.map((m) => {
          const due = iso(m.dueDate);
          return {
            id: m.id,
            name: m.name,
            due: dateText(m.dueDate),
            state: m.reachedAt ? `Reached ${dateText(m.reachedAt)}` : due && due < today ? "Late" : "Pending",
            category: m.reachedAt ? "Completed" : due && due < today ? "Blocked" : "Pending",
            reached: m.reachedAt ? "yes" : "no",
          };
        })}
        columns={[
          { key: "name", header: "Milestone" },
          { key: "due", header: "Due" },
          { key: "state", header: "Status", variant: "state", categoryKey: "category" },
        ]}
        emptyTitle="No milestones"
      />
    );

  const timeTab =
    job.timeEntries.length === 0 ? (
      <EmptyState title="No time logged" description="Log hours against the job to see labour cost." />
    ) : (
      <ActionTable
        kind="time"
        working={working}
        caption="Time entries"
        rows={job.timeEntries.map((t) => ({
          id: t.id,
          date: dateText(t.workDate),
          who: t.workerLabel,
          task: job.tasks.find((x) => x.id === t.taskId)?.title ?? "—",
          hours: hoursText(t.minutes),
          cost: t.voidedAt ? `Void: ${t.voidReason}` : inr(Math.round((t.minutes * t.hourlyRateMinor) / 60)),
          void: t.voidedAt ? "yes" : "no",
        }))}
        columns={[
          { key: "date", header: "Date" },
          { key: "who", header: "Worked by" },
          { key: "task", header: "Task" },
          { key: "hours", header: "Hours", numeric: true },
          { key: "cost", header: "Cost", numeric: true },
        ]}
        emptyTitle="No time"
      />
    );

  const costTab = (
    <div className="flex flex-col gap-4">
      <Panel title="Where the cost comes from">
        <DefinitionList
          items={[
            { term: "Material used by production orders", value: inr(costing.materialMinor) },
            { term: "Labour from logged time", value: inr(costing.labourMinor) },
            { term: "Outsourced, testing and other costs", value: inr(costing.otherMinor) },
            { term: "Total cost", value: <strong>{inr(costing.totalMinor)}</strong> },
          ]}
        />
        <p className="mb-0 mt-3 text-[13px] text-text-tertiary">
          Material is worked out from what the linked production orders consumed, at each item&apos;s current average cost, so it is an estimate until stock costs are final.
        </p>
      </Panel>
      {job.costEntries.length === 0 ? (
        <EmptyState title="No other costs" description="Record outsourced work, external testing or freight." />
      ) : (
        <ActionTable
          kind="cost"
          working={working}
          caption="Other costs"
          rows={job.costEntries.map((c) => ({
            id: c.id,
            date: dateText(c.incurredOn),
            kind: COST_KIND_LABEL[c.kind] ?? c.kind,
            what: c.description,
            supplier: c.supplierName ?? "—",
            amount: c.voidedAt ? `Void: ${c.voidReason}` : inr(c.amountMinor),
            void: c.voidedAt ? "yes" : "no",
          }))}
          columns={[
            { key: "date", header: "Date" },
            { key: "kind", header: "Kind" },
            { key: "what", header: "What for" },
            { key: "supplier", header: "Supplier" },
            { key: "amount", header: "Amount", numeric: true },
          ]}
          emptyTitle="No costs"
        />
      )}
    </div>
  );

  const productionTab =
    job.orders.length === 0 ? (
      <EmptyState title="No production order linked" description="Link the production order that builds this job. Its material cost then counts here." />
    ) : (
      <div className="flex flex-col gap-4">
        {job.orders.map((l) => {
          const ops = l.order.operations.filter((o) => o.state !== "cancelled");
          const done = ops.filter((o) => o.state === "completed").length;
          return (
            <Panel
              key={l.id}
              title={l.order.reference ?? `Order ${l.order.id.slice(0, 8)}`}
              action={<a href={`/manufacturing/${l.order.id}`}>Open production order</a>}
            >
              <p className="m-0 mb-3 text-[15px] text-text-secondary">
                {l.order.outputQty} × {l.order.outputItem.name} · {l.order.state.replace(/_/g, " ")} · {done} of {ops.length} stages done
              </p>
              <ol className="m-0 flex list-none flex-wrap gap-2 p-0">
                {ops.map((o) => (
                  <li key={o.id}>
                    <StateBadge category={o.state === "completed" ? "Completed" : o.state === "in_progress" ? "Active" : o.state === "on_hold" ? "Blocked" : "Pending"} label={o.label} />
                  </li>
                ))}
              </ol>
            </Panel>
          );
        })}
      </div>
    );

  const toolbar = (buttons: React.ReactNode) => <div className="mb-4 flex flex-wrap items-center gap-2">{buttons}</div>;

  return (
    <>
      <PageHeader
        wrapTitle
        title={`${detail.reference} · ${job.title}`}
        description={`${job.customerName}${job.dueDate ? ` · promised by ${dateText(job.dueDate)}` : ""}`}
        actions={
          <>
            <StateBadge category={detail.category} label={job.state.replace(/_/g, " ")} />
            <JobActions jobId={job.id} state={job.state} openQuoteId={openQuote?.id ?? null} lostReasons={detail.lostReasons} />
            {!["completed", "lost", "cancelled"].includes(job.state) && (
              <EditJobButton job={{ id: job.id, title: job.title, customerContact: job.customerContact, description: job.description, priority: job.priority, dueDate: iso(job.dueDate) }} />
            )}
          </>
        }
      />

      <StatRow cols={4} className="mb-6">
        <Stat label="Order value" value={inr(costing.quotedValueMinor ?? openQuote?.amountMinor ?? job.quotes[0]?.amountMinor ?? null)} hint={costing.quotedValueMinor !== null ? "From the approved quote" : openQuote ? "From the open quote" : job.quotes[0] ? "Last quote, not accepted" : "No quote yet"} />
        <Stat label="Actual cost to date" value={inr(costing.totalMinor)} hint={`Material, labour and other costs; ${hoursText(costing.loggedMinutes)} logged`} />
        <Stat label="Margin so far" value={costing.marginMinor === null ? "—" : inr(costing.marginMinor)} hint={costing.marginPercent === null ? "Needs an approved quote" : `${costing.marginPercent}% of the order value, before costs still to come`} />
        <Stat label={job.tasks.length > 0 ? "Tasks done" : "Stages done"} value={detail.progress === null ? "—" : `${detail.progress}%`} hint={job.tasks.length > 0 ? "Bigger tasks count more" : "Production stages finished"} />
      </StatRow>

      <Tabs
        scroll
        tabs={[
          { id: "overview", label: "Overview", content: overview },
          {
            id: "quote",
            label: "Quote",
            count: job.quotes.length,
            content: (
              <>
                {(job.state === "enquiry" || job.state === "quoted") && toolbar(<QuoteButton jobId={job.id} hasQuote={job.quotes.length > 0} />)}
                {quoteTab}
              </>
            ),
          },
          {
            id: "production",
            label: "Production",
            count: job.orders.length,
            content: (
              <>
                {working && detail.freeOrders.length > 0 && toolbar(<LinkOrderButton jobId={job.id} orders={detail.freeOrders} />)}
                {productionTab}
              </>
            ),
          },
          {
            id: "tasks",
            label: "Tasks",
            count: job.tasks.length,
            content: (
              <>
                {working && toolbar(<AddTaskButton jobId={job.id} tasks={taskOptions} />)}
                {taskTab}
              </>
            ),
          },
          {
            id: "milestones",
            label: "Milestones",
            count: job.milestones.length,
            content: (
              <>
                {working && toolbar(<AddMilestoneButton jobId={job.id} />)}
                {milestoneTab}
              </>
            ),
          },
          {
            id: "time",
            label: "Time",
            count: job.timeEntries.length,
            content: (
              <>
                {working && toolbar(<LogTimeButton jobId={job.id} tasks={taskOptions} />)}
                {timeTab}
              </>
            ),
          },
          {
            id: "costs",
            label: "Costs",
            content: (
              <>
                {working && toolbar(<AddCostButton jobId={job.id} />)}
                {costTab}
              </>
            ),
          },
        ]}
      />
    </>
  );
}

export default withCapabilityPageAccess(PROJECT_CAPABILITY, JobDetailPage);
