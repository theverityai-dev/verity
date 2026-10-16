import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PROJECT_JOB, PROJECT_CAPABILITY, listJobs } from "@/server/capabilities/project";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader, PermissionDenied, StatTile, StatTileRow } from "@/components/ui/primitives";
import { equipmentKindFor } from "@/components/ui/business/domains";
import Link from "next/link";
import { NewCustomerButton, NewJobButton } from "./JobForms";
import { JobFilters } from "./JobFilters";
import { JOB_FILTERS, type JobFilterKey } from "./filters";
import { PRIORITY_LABEL, dateText, inr } from "./format";

export const dynamic = "force-dynamic";

async function JobsPage({ searchParams }: { searchParams: Promise<{ customer?: string; status?: string }> }) {
  const { customer: customerFilter, status } = await searchParams;
  const active: JobFilterKey = JOB_FILTERS.some(([k]) => k === status) ? (status as JobFilterKey) : "all";
  const onlyCustomer = customerFilter && /^[0-9a-f-]{36}$/i.test(customerFilter) ? customerFilter : undefined;
  installCapabilities();
  const actor = await requireActor();

  const data = await withTenant(actor.tenantId, async (tx) => {
    if (!(await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PROJECT_JOB))) return null;
    const [rows, customers] = await Promise.all([
      listJobs(tx, { customerId: onlyCustomer }),
      tx.tradingCustomer.findMany({ where: { active: true }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true } }),
    ]);
    return { rows, customers: customers.map((c) => ({ id: c.id, name: c.displayName })) };
  });
  if (!data) return <PermissionDenied what="reading jobs" />;
  const { rows, customers } = data;

  const inGroup: Record<JobFilterKey, (r: (typeof rows)[number]) => boolean> = {
    all: () => true,
    open: (r) => r.category !== "Completed" && r.category !== "Cancelled",
    enquiries: (r) => r.state === "enquiry" || r.state === "quoted",
    working: (r) => ["approved", "in progress", "on hold"].includes(r.state),
    finished: (r) => r.state === "completed",
    lost: (r) => r.state === "lost" || r.state === "cancelled",
  };
  const counts = Object.fromEntries(JOB_FILTERS.map(([k]) => [k, rows.filter(inGroup[k]).length])) as Record<JobFilterKey, number>;
  const shown = rows.filter(inGroup[active]);

  const open = rows.filter((r) => r.category !== "Completed" && r.category !== "Cancelled");
  const table = shown.map((r) => ({
    id: r.id,
    // A non-breaking hyphen keeps J-0005 on one line however narrow the column gets.
    reference: r.reference.replace("-", "‑"),
    title: r.title,
    kind: equipmentKindFor(r.title),
    customer: r.customerName,
    state: r.state,
    category: r.category,
    priority: PRIORITY_LABEL[r.priority] ?? r.priority,
    due: r.overdue ? `${dateText(r.dueDate)} (late)` : dateText(r.dueDate),
    value: inr(r.quotedValueMinor ?? r.openQuoteMinor),
    progress: r.progress === null ? "—" : `${r.progress}%`,
  }));

  return (
    <>
      <PageHeader
        title="Jobs"
        description={onlyCustomer ? `Jobs for ${customers.find((c) => c.id === onlyCustomer)?.name ?? "this customer"}. Open Jobs from the menu to see all.` : "Every customer order from enquiry to delivery: quote, production, test, cost and margin in one place."}
        actions={
          <>
            <Link href="/jobs/lost-reasons" className="text-[15px] text-accent-ink">Lost reasons</Link>
            <NewCustomerButton />
            <NewJobButton customers={customers} />
          </>
        }
      />

      <StatTileRow className="mb-6">
        <StatTile kind="job" label="Open jobs" value={open.length} href="/jobs?status=open" />
        <StatTile kind="enquiry" label="Enquiries and quotes" value={counts.enquiries} href="/jobs?status=enquiries" />
        <StatTile state="active" icon="stage" label="In work" value={counts.working} href="/jobs?status=working" />
        {/* Late is a count of one condition, so it takes the blocked state's colours, never a kind hue. */}
        <StatTile
          state={rows.some((r) => r.overdue) ? "blocked" : "draft"}
          icon="milestone"
          label="Late deliveries"
          value={rows.filter((r) => r.overdue).length}
        />
      </StatTileRow>

      <JobFilters active={active} counts={counts} customer={onlyCustomer} />

      <DataTable
        caption="Jobs"
        rows={table}
        columns={[
          { key: "reference", header: "Job", variant: "link", href: "/jobs/{id}" },
          { key: "title", header: "What", kindKey: "kind" },
          { key: "customer", header: "Customer" },
          { key: "state", header: "Status", variant: "state", categoryKey: "category" },
          { key: "priority", header: "Priority" },
          { key: "due", header: "Delivery promised" },
          { key: "value", header: "Order value", numeric: true },
          { key: "progress", header: "Progress", numeric: true },
        ]}
        emptyTitle={active === "all" ? "No jobs yet" : "No jobs in this view"}
        emptyDescription={active === "all" ? "A job starts as a customer enquiry. Use New job to open the first one." : "Choose All to see every job."}
      />
    </>
  );
}

export default withCapabilityPageAccess(PROJECT_CAPABILITY, JobsPage);
