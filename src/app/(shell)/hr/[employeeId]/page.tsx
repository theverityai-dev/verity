import Link from "next/link";
import { notFound } from "next/navigation";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { ENTITY_HR_COMPENSATION, HR_CAPABILITY, type EmployeeProfile } from "@/server/capabilities/hr";
import { requireActor } from "@/server/platform/auth";
import { hasPermission } from "@/server/platform/authorization";
import { withTenant } from "@/server/platform/tenancy";
import { runQuery } from "@/server/actions/platform";
import { DataTable } from "@/components/ui/DataTable";
import { ErrorState, PageHeader, Panel, Stat, StatRow } from "@/components/ui/primitives";
import { day } from "@/components/ui/business/format";
import { SalaryEditor } from "./SalaryEditor";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * One employee (staff.md): who they are, this year's leave balances, their
 * leave history, and their salary for people allowed to see pay.
 */
async function EmployeePage({ params }: { params: Promise<{ employeeId: string }> }) {
  const actor = await requireActor();
  const { employeeId } = await params;
  if (!UUID.test(employeeId)) notFound();

  const result = await runQuery<EmployeeProfile | null>("verity.hr.get_employee_profile", { employeeId });
  if (!result.ok) {
    return <ErrorState title="Could not load the employee" message={result.message} issues={result.issues} retryable={result.retryable} />;
  }
  const profile = result.data;
  if (!profile) notFound();
  const canEditSalary = await withTenant(actor.tenantId, (tx) => hasPermission(tx, actor.roleId, "Edit", ENTITY_HR_COMPENSATION));

  const remaining = profile.leaveBalances.reduce((sum, b) => sum + b.remaining, 0);
  return (
    <>
      <PageHeader
        title={profile.name}
        description={[profile.designation, profile.department, profile.dateOfJoining ? `joined ${day(profile.dateOfJoining)}` : null, profile.active ? null : "inactive"]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <Link href="/hr" className="text-[13px] text-text-secondary underline-offset-4 hover:underline">
            Back to people
          </Link>
        }
      />
      <StatRow cols={3} className="mb-6">
        <Stat label="Leave days left this year" value={remaining} />
        <Stat label="Leave applications" value={profile.leaves.length} />
        <Stat
          label="Monthly salary"
          value={!profile.canSeeSalary ? "Hidden" : profile.monthlySalaryMinor === null ? "Not set" : `₹${(profile.monthlySalaryMinor / 100).toLocaleString("en-IN")}`}
        />
      </StatRow>

      {canEditSalary && (
        <div className="mb-6">
          <SalaryEditor employeeId={profile.id} current={profile.monthlySalaryMinor} />
        </div>
      )}

      <Panel title="Leave balance" flush>
        <DataTable
          caption={`Leave balance for ${new Date().getUTCFullYear()}`}
          filterable={false}
          emptyTitle="No leave types set up"
          emptyDescription="Add leave types under People operations to track balances."
          columns={[
            { key: "leaveType", header: "Leave type" },
            { key: "allowed", header: "Allowed", numeric: true },
            { key: "taken", header: "Taken", numeric: true },
            { key: "remaining", header: "Left", numeric: true },
          ]}
          rows={profile.leaveBalances.map((b) => ({ ...b, id: b.leaveType }))}
        />
      </Panel>
      <div className="mt-6" />
      <Panel title="Leave history" flush>
        <DataTable
          caption="Leave applications, newest first"
          filterable={false}
          emptyTitle="No leave applied for"
          columns={[
            { key: "leaveType", header: "Type" },
            { key: "dates", header: "Dates" },
            { key: "days", header: "Days", numeric: true },
            { key: "status", header: "Status" },
          ]}
          rows={profile.leaves.map((l) => ({ id: l.id, leaveType: l.leaveType, dates: `${day(l.from)} – ${day(l.to)}`, days: l.days, status: l.status }))}
        />
      </Panel>
    </>
  );
}

export default withCapabilityPageAccess(HR_CAPABILITY, EmployeePage);
