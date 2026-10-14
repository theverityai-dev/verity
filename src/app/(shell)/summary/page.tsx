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

  return (
    <>
      <PageHeader title="Summary" description="Where every job stands today, what is on the shop floor, and what needs attention." />

      <StatRow cols={4} className="mb-6">
        <Stat label="Order book" value={inr(data.orderBookMinor, { compact: true })} hint={`${counts.working} job${counts.working === 1 ? "" : "s"} in work`} href="/jobs" />
        <Stat label="Quotes out" value={inr(data.pipelineMinor, { compact: true })} hint={`${counts.quoted} awaiting the customer`} href="/jobs" />
        <Stat label="New enquiries" value={counts.enquiries} hint="Not quoted yet" href="/jobs" />
        <Stat label="Past promised date" value={counts.overdue} hint={counts.overdue === 0 ? "Nothing late" : "Needs a call"} href="/jobs" />
      </StatRow>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <Panel title="Jobs in work" flush>
            <DataTable
              caption="Jobs in work"
              rows={data.working.map((r) => ({
                id: r.id,
                reference: r.reference,
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
                { key: "due", header: "Promised by" },
                { key: "value", header: "Value", numeric: true },
                { key: "progress", header: "Done", numeric: true },
              ]}
              emptyTitle="Nothing in work"
              emptyDescription="Approve a quote and start the job to see it here."
            />
          </Panel>
        </div>

        <Panel title="On the shop floor now">
          {data.shop.length === 0 ? (
            <EmptyState title="No stage running" description="Stages that are in progress show here, with how many orders are in each." />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {data.shop.map((s) => (
                <li key={s.label} className="flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-b-0">
                  <span>{s.label}</span>
                  <strong className="tabular">{s.count}</strong>
                </li>
              ))}
            </ul>
          )}
          <p className="mb-0 mt-3 text-[13px] text-text-tertiary">
            {counts.productionOrders} production order{counts.productionOrders === 1 ? "" : "s"} running · <a href="/manufacturing/floor">Open production floor</a>
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
                  <span className="text-text-secondary">{dateText(m.dueDate)}</span>
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
