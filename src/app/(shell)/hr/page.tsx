import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { HR_CAPABILITY } from "@/server/capabilities/hr";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { runQuery } from "@/server/actions/platform";
import { PageHeader, Stat, StatRow, ErrorState } from "@/components/ui/primitives";
import { HrDesk, type DepartmentRow, type EmployeeRow, type LeaveRow, type LeaveTypeRow, type PartyOption } from "./HrDesk";

export const dynamic = "force-dynamic";

type LeaveStatusRow = {
  applicationId: string;
  employeeId: string;
  leaveTypeId: string;
  fromDate: string;
  toDate: string;
  status: LeaveRow["status"];
};

/** People operations: who works here, which department, and who is off. */
async function HrPage() {
  const actor = await requireActor();

  const [leaveResult, employees, departments, leaveTypes, parties] = await Promise.all([
    runQuery<LeaveStatusRow[]>("verity.hr.leave_application_status", {}),
    withTenant(actor.tenantId, (tx) =>
      tx.hrEmployee.findMany({
        include: { party: true, department: true },
        orderBy: { party: { displayName: "asc" } },
      }),
    ),
    withTenant(actor.tenantId, (tx) => tx.hrDepartment.findMany({ orderBy: { name: "asc" } })),
    withTenant(actor.tenantId, (tx) => tx.hrLeaveType.findMany({ orderBy: { name: "asc" } })),
    withTenant(actor.tenantId, (tx) =>
      tx.party.findMany({
        where: { hrEmployees: { none: {} } },
        select: { id: true, displayName: true },
        orderBy: { displayName: "asc" },
      }),
    ),
  ]);

  if (!leaveResult.ok) {
    return <ErrorState title="Could not load people operations" message={leaveResult.message} issues={leaveResult.issues} retryable={leaveResult.retryable} />;
  }

  const nameById = new Map(employees.map((e) => [e.id, e.party.displayName]));
  const typeById = new Map(leaveTypes.map((t) => [t.id, t.name]));

  const employeeRows: EmployeeRow[] = employees.map((e) => ({
    id: e.id,
    name: e.party.displayName,
    departmentId: e.departmentId,
    department: e.department?.name ?? "No department",
    designation: e.designation ?? "",
    joined: e.dateOfJoining ? e.dateOfJoining.toISOString().slice(0, 10) : "",
    active: e.active,
  }));
  const departmentRows: DepartmentRow[] = departments.map((d) => ({
    id: d.id,
    name: d.name,
    headcount: employees.filter((e) => e.departmentId === d.id && e.active).length,
  }));
  const leaveTypeRows: LeaveTypeRow[] = leaveTypes.map((t) => ({ id: t.id, name: t.name, daysPerYear: t.daysPerYear }));
  const leaveRows: LeaveRow[] = leaveResult.data.map((a) => ({
    id: a.applicationId,
    employee: nameById.get(a.employeeId) ?? "Unknown",
    leaveType: typeById.get(a.leaveTypeId) ?? "Unknown",
    fromDate: String(a.fromDate).slice(0, 10),
    toDate: String(a.toDate).slice(0, 10),
    status: a.status,
  }));

  const active = employees.filter((e) => e.active).length;
  const pending = leaveRows.filter((l) => l.status === "Pending").length;
  const todayIso = new Date().toISOString().slice(0, 10);
  const away = leaveRows.filter((l) => l.status === "Approved" && l.fromDate <= todayIso && l.toDate >= todayIso).length;

  return (
    <>
      <PageHeader title="People operations" description="Employees, departments and leave in one place." />
      <StatRow cols={4} className="mb-6">
        <Stat label="Active employees" value={active} />
        <Stat label="Departments" value={departments.length} />
        <Stat label="Leave awaiting a decision" value={pending} />
        <Stat label="Away today" value={away} />
      </StatRow>
      <HrDesk
        employees={employeeRows}
        departments={departmentRows}
        leaveTypes={leaveTypeRows}
        leave={leaveRows}
        parties={parties as PartyOption[]}
        today={todayIso}
      />
    </>
  );
}

export default withCapabilityPageAccess(HR_CAPABILITY, HrPage);
