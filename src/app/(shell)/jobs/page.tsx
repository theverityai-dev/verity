import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PROJECT_JOB, PROJECT_CAPABILITY, listJobs } from "@/server/capabilities/project";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader, PermissionDenied, Stat, StatRow } from "@/components/ui/primitives";
import { NewCustomerButton, NewJobButton } from "./JobForms";
import { PRIORITY_LABEL, dateText, inr } from "./format";

export const dynamic = "force-dynamic";

async function JobsPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const { customer: customerFilter } = await searchParams;
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

  const open = rows.filter((r) => r.category !== "Completed" && r.category !== "Cancelled");
  const table = rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    title: r.title,
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
            <NewCustomerButton />
            <NewJobButton customers={customers} />
          </>
        }
      />

      <StatRow cols={4} className="mb-6">
        <Stat label="Open jobs" value={open.length} />
        <Stat label="Enquiries and quotes" value={rows.filter((r) => r.state === "enquiry" || r.state === "quoted").length} />
        <Stat label="In work" value={rows.filter((r) => ["approved", "in progress", "on hold"].includes(r.state)).length} />
        <Stat label="Past promised date" value={rows.filter((r) => r.overdue).length} />
      </StatRow>

      <DataTable
        caption="Jobs"
        rows={table}
        columns={[
          { key: "reference", header: "Job", variant: "link", href: "/jobs/{id}" },
          { key: "title", header: "What" },
          { key: "customer", header: "Customer" },
          { key: "state", header: "Status", variant: "state", categoryKey: "category" },
          { key: "priority", header: "Priority" },
          { key: "due", header: "Promised by" },
          { key: "value", header: "Value", numeric: true },
          { key: "progress", header: "Done", numeric: true },
        ]}
        emptyTitle="No jobs yet"
        emptyDescription="A job starts as a customer enquiry. Use New job to open the first one."
      />
    </>
  );
}

export default withCapabilityPageAccess(PROJECT_CAPABILITY, JobsPage);
