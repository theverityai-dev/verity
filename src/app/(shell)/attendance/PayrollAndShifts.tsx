"use client";

import { useState, useTransition } from "react";
import { trailingDaysRange } from "@/lib/date-range";
import { Button, DefinitionList, ErrorState, Field, Input, Panel, RowList, Row, Select } from "@/components/ui/primitives";
import { runCommand, runQuery } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

type PayrollInputs = { daysWorked: number; hoursWorked: number; lateCount: number; absentCount: number; leaveCount: number };
type Shift = { id: string; employeeId: string; date: string; label: string; startTime: string; endTime: string };

function PayrollInputsPanel({ employees }: { employees: Array<{ id: string; name: string }> }) {
  const [range] = useState(() => trailingDaysRange(30));
  const [result, setResult] = useState<PayrollInputs | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(form: FormData) {
    setFailure(null);
    startTransition(async () => {
      const outcome = await runQuery<PayrollInputs>("verity.attendance.get_payroll_inputs", {
        employeeId: String(form.get("employeeId") ?? ""),
        fromDate: String(form.get("fromDate") ?? ""),
        toDate: String(form.get("toDate") ?? ""),
      });
      if (outcome.ok) setResult(outcome.data); else setFailure(outcome);
    });
  }

  if (employees.length === 0) return null;

  return (
    <Panel title="Payroll inputs" className="mb-6">
      <form
        className="grid gap-4 sm:grid-cols-3"
        onSubmit={(e) => { e.preventDefault(); submit(new FormData(e.currentTarget)); }}
      >
        <Field label="Employee" htmlFor="employeeId" required>
          <Select id="employeeId" name="employeeId" required defaultValue={employees[0]?.id}>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </Select>
        </Field>
        <Field label="From" htmlFor="fromDate" required>
          <Input id="fromDate" name="fromDate" type="date" required defaultValue={range.fromDate} />
        </Field>
        <Field label="To" htmlFor="toDate" required>
          <Input id="toDate" name="toDate" type="date" required defaultValue={range.toDate} />
        </Field>
        <div className="sm:col-span-3">
          <Button type="submit" size="sm" disabled={pending}>{pending ? "Loading…" : "Compute"}</Button>
        </div>
      </form>
      {failure && <div className="mt-3"><ErrorState title="Could not compute payroll inputs" message={failure.message} issues={failure.issues} retryable={failure.retryable} /></div>}
      {result && (
        <div className="mt-4 border-t border-line pt-4">
          <DefinitionList
            items={[
              { term: "Days worked", value: result.daysWorked },
              { term: "Hours worked", value: result.hoursWorked },
              { term: "Late", value: result.lateCount },
              { term: "Absent", value: result.absentCount },
              { term: "On leave", value: result.leaveCount },
            ]}
          />
        </div>
      )}
    </Panel>
  );
}

function DefineShiftForm({ employees, locations }: { employees: Array<{ id: string; name: string }>; locations: Array<{ id: string; name: string }> }) {
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  if (employees.length === 0 || locations.length === 0) return null;

  if (!open) return <div className="mb-4"><Button size="sm" onClick={() => setOpen(true)}>+ Define shift</Button></div>;

  return (
    <form
      className="mb-4 grid gap-3 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setFailure(null);
        startTransition(async () => {
          const result = await runCommand(
            "verity.attendance.define_shift",
            {
              locationId: String(form.get("locationId") ?? ""),
              employeeId: String(form.get("employeeId") ?? ""),
              date: String(form.get("date") ?? ""),
              label: String(form.get("label") ?? ""),
              startTime: String(form.get("startTime") ?? ""),
              endTime: String(form.get("endTime") ?? ""),
            },
            "/attendance",
          );
          if (result.ok) { setOpen(false); window.location.reload(); } else setFailure(result);
        });
      }}
    >
      <Field label="Outlet" htmlFor="shift-locationId" required>
        <Select id="shift-locationId" name="locationId" required defaultValue={locations[0]?.id}>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
      </Field>
      <Field label="Employee" htmlFor="shift-employeeId" required>
        <Select id="shift-employeeId" name="employeeId" required defaultValue={employees[0]?.id}>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </Select>
      </Field>
      <Field label="Date" htmlFor="shift-date" required>
        <Input id="shift-date" name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
      </Field>
      <Field label="Label" htmlFor="shift-label" required>
        <Input id="shift-label" name="label" required placeholder="e.g. Morning" />
      </Field>
      <Field label="Start" htmlFor="shift-startTime" required>
        <Input id="shift-startTime" name="startTime" type="time" required />
      </Field>
      <Field label="End" htmlFor="shift-endTime" required>
        <Input id="shift-endTime" name="endTime" type="time" required />
      </Field>
      {failure && <div className="sm:col-span-3"><ErrorState title="Could not define shift" message={failure.message} issues={failure.issues} retryable={failure.retryable} /></div>}
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : "Save shift"}</Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}

export function PayrollAndShifts({
  employees,
  locations,
  shifts,
}: {
  employees: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  shifts: Shift[];
}) {
  const employeeName = (id: string) => employees.find((e) => e.id === id)?.name ?? "Unknown";
  return (
    <>
      <PayrollInputsPanel employees={employees} />
      <Panel title="Shifts" flush>
        <div className="p-4 pb-0">
          <DefineShiftForm employees={employees} locations={locations} />
        </div>
        {shifts.length === 0 ? (
          <p className="m-0 p-4 pt-0 text-[13px] text-text-tertiary">No shifts defined.</p>
        ) : (
          <RowList>
            {shifts.map((s) => (
              <Row key={s.id} className="justify-between">
                <span className="text-text">{employeeName(s.employeeId)} — {s.label}</span>
                <span className="text-text-tertiary text-[13px]">{new Date(s.date).toLocaleDateString("en-IN")}, {s.startTime}–{s.endTime}</span>
              </Row>
            ))}
          </RowList>
        )}
      </Panel>
    </>
  );
}
