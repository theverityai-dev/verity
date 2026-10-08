"use client";

import { DataTable } from "@/components/ui/DataTable";
import { Panel } from "@/components/ui/primitives";

export type PayrollSummaryRow = {
  employeeId: string;
  name: string;
  daysWorked: number;
  hoursWorked: number;
  overtimeHours: number;
  lateCount: number;
  absentCount: number;
  leaveCount: number;
  monthlySalaryMinor: number | null;
};

function csvCell(value: string | number): string {
  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * The month's attendance for every active employee, ready to hand to whoever
 * runs payroll (staff.md, payroll-input export). The CSV is built in the
 * browser from exactly the rows shown, so the file and the screen cannot differ.
 * Salary appears only for people allowed to see pay.
 */
export function PayrollSummary({
  month,
  rows,
  canSeeSalary,
}: {
  month: string;
  rows: PayrollSummaryRow[];
  canSeeSalary: boolean;
}) {
  function download() {
    const header = ["Employee", "Days worked", "Hours worked", "Overtime hours", "Late", "Absent", "On leave", ...(canSeeSalary ? ["Monthly salary (Rs)"] : [])];
    const lines = rows.map((r) =>
      [
        r.name,
        r.daysWorked,
        r.hoursWorked,
        r.overtimeHours,
        r.lateCount,
        r.absentCount,
        r.leaveCount,
        ...(canSeeSalary ? [r.monthlySalaryMinor === null ? "" : (r.monthlySalaryMinor / 100).toFixed(2)] : []),
      ]
        .map(csvCell)
        .join(","),
    );
    const blob = new Blob([[header.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-inputs-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Panel title={`Payroll inputs · ${month}`} flush>
      <form method="get" className="flex flex-wrap items-end gap-3 px-4 pt-4">
        <label className="flex flex-col gap-1 text-[13px] text-text-secondary">
          Month
          <input type="month" name="month" defaultValue={month} className="min-h-11 rounded-[10px] bg-control px-3 text-[15px] text-text" />
        </label>
        <button type="submit" className="min-h-11 cursor-pointer rounded-[10px] border-0 bg-control px-4 text-[15px] font-semibold text-accent-ink hover:bg-control-strong">
          Show
        </button>
        <button
          type="button"
          onClick={download}
          disabled={rows.length === 0}
          className="min-h-11 cursor-pointer rounded-[10px] border-0 bg-control px-4 text-[15px] font-semibold text-accent-ink hover:bg-control-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          Download CSV
        </button>
      </form>
      <DataTable
        caption={`Attendance totals for ${month}`}
        emptyTitle="No active employees"
        columns={[
          { key: "name", header: "Employee", sortable: true, variant: "link", href: "/hr/{employeeId}" },
          { key: "daysWorked", header: "Days", numeric: true, sortable: true },
          { key: "hoursWorked", header: "Hours", numeric: true },
          { key: "overtimeHours", header: "Overtime", numeric: true, sortable: true },
          { key: "lateCount", header: "Late", numeric: true, sortable: true },
          { key: "absentCount", header: "Absent", numeric: true },
          { key: "leaveCount", header: "Leave", numeric: true },
          ...(canSeeSalary ? [{ key: "salary", header: "Salary", numeric: true }] : []),
        ]}
        rows={rows.map((r) => ({
          ...r,
          id: r.employeeId,
          salary: r.monthlySalaryMinor === null ? "Not set" : `₹${(r.monthlySalaryMinor / 100).toLocaleString("en-IN")}`,
        }))}
      />
    </Panel>
  );
}
