import Link from "next/link";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PROJECT_JOB, PROJECT_CAPABILITY, summaryData } from "@/server/capabilities/project";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState, PageHeader, Panel, PermissionDenied, Stat, StatRow } from "@/components/ui/primitives";
import { dateText, inr } from "../jobs/format";

export const dynamic = "force-dynamic";

/**
 * The business at a glance: the order book, what is on the shop floor, what is late, what
 * is running short. Every figure is a count or a sum over real records; nothing is
 * estimated or invented, and a figure with nothing behind it shows as zero.
 */
async function SummaryPage() {
  installCapabilities();
  const actor = await requireActor();

  const data = await withTenant(actor.tenantId, async (tx) => {
    if (!(await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PROJECT_JOB))) return null;
    return summaryData(tx);
  });
  if (!data) return <PermissionDenied what="the summary" />;

  const { counts } = data;

  const wording = (a: (typeof data.attention)[number]): { problem: string; action: string } => {
    const d = dateText(a.date);
    switch (a.kind) {
      case "job_late": return { problem: `${a.subject} was promised for ${d} and is still ${a.extra}`, action: "Call the customer, or agree a new delivery date and update the job." };
      case "milestone_late": return { problem: `Milestone "${a.subject}" was due ${d}`, action: "Mark it reached if it is done, otherwise find out what is holding it." };
      case "task_blocked": return { problem: `Task "${a.subject}" is blocked`, action: `Find what is blocking it${a.extra ? ` and ask ${a.extra}` : ""}, then resume or reassign it.` };
      case "task_late": return { problem: `Task "${a.subject}" was due ${d}`, action: `Check progress with ${a.extra ?? "the team"}.` };
      case "quote_expired": return { problem: `Quote ${a.subject} expired on ${d}, no reply`, action: "Follow up with the customer, or send a revised quote." };
      default: return { problem: `${a.subject}: ${a.extra}`, action: "Raise a purchase order before it stops production." };
    }
  };

  return (
    <>
      <PageHeader title="Summary" description="Where every job stands today, what is on the shop floor, and what needs attention." />

      <StatRow cols={4} className="mb-6">
        <Stat label="Confirmed orders" value={inr(data.orderBookMinor, { compact: true })} hint={`Accepted quotes, ${counts.working} job${counts.working === 1 ? "" : "s"} in work`} href="/jobs" />
        <Stat label="Quotes awaiting reply" value={inr(data.pipelineMinor, { compact: true })} hint={`${counts.quoted} sent, not yet accepted`} href="/jobs" />
        <Stat label="New enquiries" value={counts.enquiries} hint="Not quoted yet" href="/jobs" />
        <Stat tone={counts.overdue > 0 ? "danger" : "default"} label="Late deliveries" value={counts.overdue} hint={counts.overdue === 0 ? "None past the promised date" : "Past the promised date"} href="/jobs" />
      </StatRow>

      <div className="mb-6">
        <Panel title={data.attention.length > 0 ? `Needs attention (${data.attention.length})` : "Needs attention"}>
          {data.attention.length === 0 ? (
            <EmptyState title="Nothing needs attention" description="Late deliveries, overdue milestones and tasks, blocked work, expired quotes and low stock show here, most urgent first." />
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {data.attention.map((a, i) => {
                const w = wording(a);
                return (
                  <li key={`${a.kind}-${i}`} className="flex gap-3 border-b border-line py-3.5 last:border-b-0">
                    {/* Severity by semantic colour: red is wrong now, orange is slipping. The words say it too, so colour is never the only signal. */}
                    <span aria-hidden="true" className={`mt-[7px] size-2.5 shrink-0 rounded-full ${a.kind === "task_late" || a.kind === "stock_low" ? "bg-warning" : "bg-danger"}`} />
                    <div className="min-w-0">
                      <p className="m-0 text-[15px] font-medium">
                        {a.jobId && a.jobReference ? <Link href={`/jobs/${a.jobId}`} className="text-accent-ink">{a.jobReference}</Link> : null}
                        {a.jobId ? " · " : ""}
                        {w.problem}
                      </p>
                      <p className="m-0 mt-0.5 text-[13px] text-text-secondary">{w.action}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <Panel title="Jobs in work" flush>
            <DataTable
              caption="Jobs in work"
              rows={data.working.map((r) => ({
                id: r.id,
                // A non-breaking hyphen keeps J-0005 on one line however narrow the column gets.
    reference: r.reference.replace("-", "‑"),
                title: r.title,
                customer: r.customerName,
                state: r.state,
                category: r.category,
                due: r.overdue ? `${dateText(r.dueDate)} (late)` : dateText(r.dueDate),
                value: inr(r.quotedValueMinor),
                progress: r.progress === null ? "—" : `${r.progress}%`,
              }))}
              columns={[
                { key: "reference", header: "Job", variant: "link", href: "/jobs/{id}" },
                { key: "title", header: "What" },
                { key: "customer", header: "Customer" },
                { key: "state", header: "Status", variant: "state", categoryKey: "category" },
                { key: "due", header: "Delivery promised" },
                { key: "value", header: "Order value", numeric: true },
                { key: "progress", header: "Progress", numeric: true },
              ]}
              emptyTitle="Nothing in work"
              emptyDescription="Approve a quote and start the job to see it here."
            />
          </Panel>
        </div>

        <Panel title="On the shop floor now">
          {data.shop.length === 0 ? (
            <EmptyState title="Nothing in production" description="Production orders that are running show here, with the stage each one is at." />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {data.shop.map((s) => (
                <li key={s.orderId} className="flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-b-0">
                  <span className="min-w-0">
                    <a href={`/manufacturing/${s.orderId}`}>{s.jobReference ?? s.order}</a>
                    <span className="text-text-secondary"> · {s.stage}{s.stageState === "in_progress" ? "" : " (next)"}</span>
                  </span>
                  <span className="tabular text-text-secondary">{s.done} of {s.total}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mb-0 mt-3 text-[13px] text-text-tertiary">
            {counts.productionOrders} production order{counts.productionOrders === 1 ? "" : "s"} running · <Link href="/manufacturing/floor">Open production floor</Link>
          </p>
        </Panel>

        <Panel title="Coming up">
          {data.milestones.length === 0 ? (
            <EmptyState title="No dated milestones" description="Add milestones to a job and the next ones fall due here." />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {data.milestones.map((m) => (
                <li key={m.id} className="flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-b-0">
                  <span>
                    {m.name} · <a href={`/jobs/${m.jobId}`}>{m.jobReference}</a>
                  </span>
                  <span className={m.dueDate < new Date().toISOString().slice(0, 10) ? "text-danger" : "text-text-secondary"}>
                    {dateText(m.dueDate)}{m.dueDate < new Date().toISOString().slice(0, 10) ? " (late)" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="lg:col-span-2">
          <Panel title="Running short" flush>
            <DataTable
              caption="Stock at or below its reorder level"
              rows={data.low.map((i) => ({ id: i.id, sku: i.sku, name: i.name, onHand: `${i.onHand} ${i.unitLabel}`, reorder: `${i.reorderLevel} ${i.unitLabel}` }))}
              columns={[
                { key: "sku", header: "Code" },
                { key: "name", header: "Item" },
                { key: "onHand", header: "On hand", numeric: true },
                { key: "reorder", header: "Reorder at", numeric: true },
              ]}
              emptyTitle="Nothing running short"
              emptyDescription="Items with a reorder level show here once their stock falls to it."
            />
          </Panel>
        </div>
      </div>
    </>
  );
}

export default withCapabilityPageAccess(PROJECT_CAPABILITY, SummaryPage);
