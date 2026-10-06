import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { ATTENDANCE_CAPABILITY } from "@/server/capabilities/attendance";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { runQuery } from "@/server/actions/platform";
import { PageHeader, Stat, StatRow, ErrorState } from "@/components/ui/primitives";
import { AttendanceBoard } from "./AttendanceBoard";
import { PayrollAndShifts } from "./PayrollAndShifts";
import { PayrollSummary, type PayrollSummaryRow } from "./PayrollSummary";

export const dynamic = "force-dynamic";

type Dashboard = { present: number; absent: number; late: number; onLeave: number };
type ShiftRow = { id: string; employeeId: string; date: string; label: string; startTime: string; endTime: string };

/** §39-40, 42 — today's check-ins, who to mark, payroll inputs, and shifts. */
async function AttendancePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const actor = await requireActor();
  const today = new Date().toISOString().slice(0, 10);
  const { month: requested } = await searchParams;
  const month = requested && /^\d{4}-\d{2}$/.test(requested) ? requested : today.slice(0, 7);
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year!, monthNumber!, 0)).toISOString().slice(0, 10);
  const payroll = await runQuery<{ rows: PayrollSummaryRow[]; canSeeSalary: boolean }>("verity.attendance.payroll_summary", {
    fromDate: `${month}-01`,
    toDate: lastDay,
  });

  const [dashboardResult, shiftsResult, employees, locations] = await Promise.all([
    runQuery<Dashboard>("verity.attendance.get_dashboard", { date: today }),
    runQuery<ShiftRow[]>("verity.attendance.list_shifts", {}),
    withTenant(actor.tenantId, (tx) =>
      tx.hrEmployee.findMany({ where: { active: true }, include: { party: true } }),
    ),
    withTenant(actor.tenantId, (tx) => tx.location.findMany({ select: { id: true, name: true } })),
  ]);

  if (!dashboardResult.ok) return <ErrorState title="Could not load attendance" message={dashboardResult.message} issues={dashboardResult.issues} retryable={dashboardResult.retryable} />;
  const dashboard = dashboardResult.data;

  return (
    <>
      <PageHeader title="Attendance" description={`Today, ${new Date(today).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}.`} />
      <StatRow cols={4} className="mb-6">
        <Stat label="Present" value={dashboard.present} />
        <Stat label="Late" value={dashboard.late} />
        <Stat label="Absent" value={dashboard.absent} />
        <Stat label="On leave" value={dashboard.onLeave} />
      </StatRow>
      <AttendanceBoard
        today={today}
        employees={employees.map((e) => ({ id: e.id, name: e.party.displayName }))}
      />
      {payroll.ok && (
        <div className="mt-6">
          <PayrollSummary month={month} rows={payroll.data.rows} canSeeSalary={payroll.data.canSeeSalary} />
        </div>
      )}
      <div className="mt-6">
        <PayrollAndShifts
          employees={employees.map((e) => ({ id: e.id, name: e.party.displayName }))}
          locations={locations}
          shifts={shiftsResult.ok ? shiftsResult.data : []}
        />
      </div>
    </>
  );
}

export default withCapabilityPageAccess(ATTENDANCE_CAPABILITY, AttendancePage);
