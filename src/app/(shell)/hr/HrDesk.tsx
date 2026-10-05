"use client";

import { CommandFailure, FormModal, formOptional, formText, useCommand } from "@/components/ui/CommandForm";
import { useState } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { Tabs } from "@/components/ui/Tabs";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";

export type EmployeeRow = {
  id: string;
  name: string;
  departmentId: string | null;
  department: string;
  designation: string;
  joined: string;
  active: boolean;
};
export type DepartmentRow = { id: string; name: string; headcount: number };
export type LeaveTypeRow = { id: string; name: string; daysPerYear: number };
export type LeaveRow = {
  id: string;
  employee: string;
  leaveType: string;
  fromDate: string;
  toDate: string;
  status: "Pending" | "Approved" | "Rejected" | "Revoked";
};
export type PartyOption = { id: string; displayName: string };

const startOfDay = (date: string) => `${date}T00:00:00.000Z`;

/* -------------------------------- employees -------------------------------- */

function EmployeesTab({ employees, departments, parties }: { employees: EmployeeRow[]; departments: DepartmentRow[]; parties: PartyOption[] }) {
  const [open, setOpen] = useState(false);
  const add = useCommand("/hr");
  const toggle = useCommand("/hr");

  const rows = employees.map((e) => ({ ...e, status: e.active ? "Active" : "Inactive" }));

  return (
    <>
      <DataTable
        caption="Employees"
        emptyTitle="No employees yet"
        emptyDescription="Add the first person from your existing contacts."
        emptyAction={parties.length > 0 ? <Button variant="primary" onClick={() => setOpen(true)}>Add employee</Button> : undefined}
        columns={[
          { key: "name", header: "Name", sortable: true, subKey: "designation" },
          { key: "department", header: "Department", sortable: true },
          { key: "joined", header: "Joined", sortable: true },
          { key: "status", header: "Status", sortable: true },
        ]}
        rows={rows}
        toolbar={
          <Button variant="primary" onClick={() => setOpen(true)} disabled={parties.length === 0}>
            Add employee
          </Button>
        }
        rowActions={(row) => {
          const employee = row as unknown as EmployeeRow;
          return (
            <Button
              size="sm"
              variant="secondary"
              disabled={toggle.pending}
              onClick={() => toggle.run("verity.hr.set_employee_active", { employeeId: employee.id, active: !employee.active })}
            >
              {employee.active ? "Deactivate" : "Reactivate"}
            </Button>
          );
        }}
      />
      <CommandFailure failure={toggle.failure} title="Could not update employee" />
      {parties.length === 0 && (
        <p className="mt-3 text-[13px] text-text-tertiary">
          Everyone in your contacts is already an employee. Add the person under People first, then return here.
        </p>
      )}
      <FormModal
        title="Add employee"
        description="Pick a person from your contacts and place them in a department."
        open={open}
        onClose={() => {
          setOpen(false);
          add.clear();
        }}
        submitLabel="Add employee"
        pending={add.pending}
        failure={add.failure}
        failureTitle="Could not add employee"
        onSubmit={(form) => {
          const joined = formOptional(form, "dateOfJoining");
          add.run(
            "verity.hr.create_employee",
            {
              partyId: formText(form, "partyId"),
              departmentId: formOptional(form, "departmentId"),
              designation: formOptional(form, "designation"),
              dateOfJoining: joined ? startOfDay(joined) : undefined,
            },
            () => setOpen(false),
          );
        }}
      >
        <Field label="Person" htmlFor="hr-party" required>
          <Select id="hr-party" name="partyId" required defaultValue="">
            <option value="" disabled>Choose a person</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>{p.displayName}</option>
            ))}
          </Select>
        </Field>
        <Field label="Department" htmlFor="hr-department">
          <Select id="hr-department" name="departmentId" defaultValue="">
            <option value="">No department</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Designation" htmlFor="hr-designation">
          <Input id="hr-designation" name="designation" maxLength={120} placeholder="Site supervisor" />
        </Field>
        <Field label="Date of joining" htmlFor="hr-joining">
          <Input id="hr-joining" name="dateOfJoining" type="date" />
        </Field>
      </FormModal>
    </>
  );
}

/* ------------------------------- departments ------------------------------- */

function DepartmentsTab({ departments }: { departments: DepartmentRow[] }) {
  const [open, setOpen] = useState(false);
  const add = useCommand("/hr");

  return (
    <>
      <DataTable
        caption="Departments"
        emptyTitle="No departments yet"
        emptyDescription="Departments group employees for rosters and reports."
        emptyAction={<Button variant="primary" onClick={() => setOpen(true)}>Add department</Button>}
        columns={[
          { key: "name", header: "Department", sortable: true },
          { key: "headcount", header: "Active employees", numeric: true, sortable: true },
        ]}
        rows={departments}
        toolbar={<Button variant="primary" onClick={() => setOpen(true)}>Add department</Button>}
      />
      <FormModal
        title="Add department"
        description="Names are unique within your organization."
        open={open}
        onClose={() => {
          setOpen(false);
          add.clear();
        }}
        submitLabel="Add department"
        pending={add.pending}
        failure={add.failure}
        failureTitle="Could not add department"
        onSubmit={(form) => add.run("verity.hr.create_department", { name: formText(form, "name") }, () => setOpen(false))}
      >
        <Field label="Name" htmlFor="hr-dept-name" required>
          <Input id="hr-dept-name" name="name" required maxLength={120} autoFocus />
        </Field>
      </FormModal>
    </>
  );
}

/* ---------------------------------- leave ---------------------------------- */

function LeaveTab({ leave, leaveTypes, employees }: { leave: LeaveRow[]; leaveTypes: LeaveTypeRow[]; employees: EmployeeRow[] }) {
  const [applying, setApplying] = useState(false);
  const [addingType, setAddingType] = useState(false);
  const apply = useCommand("/hr");
  const addType = useCommand("/hr");
  const decide = useCommand("/hr");

  const activeEmployees = employees.filter((e) => e.active);

  function decideOn(id: string, decision: "Approved" | "Rejected" | "Revoked") {
    decide.run("verity.hr.decide_leave_application", { leaveApplicationId: id, decision });
  }

  return (
    <>
      <DataTable
        caption="Leave"
        emptyTitle="No leave requests"
        emptyDescription={leaveTypes.length === 0 ? "Create a leave type first, then record a request." : "Requests appear here for a decision."}
        emptyAction={
          leaveTypes.length === 0 ? (
            <Button variant="primary" onClick={() => setAddingType(true)}>Add leave type</Button>
          ) : undefined
        }
        columns={[
          { key: "employee", header: "Employee", sortable: true },
          { key: "leaveType", header: "Type", sortable: true },
          { key: "fromDate", header: "From", sortable: true },
          { key: "toDate", header: "To", sortable: true },
          { key: "status", header: "Status", sortable: true },
        ]}
        rows={leave}
        toolbar={
          <>
            <Button variant="secondary" onClick={() => setAddingType(true)}>Add leave type</Button>
            <Button variant="primary" onClick={() => setApplying(true)} disabled={leaveTypes.length === 0 || activeEmployees.length === 0}>
              Record leave
            </Button>
          </>
        }
        rowActions={(row) => {
          const item = row as unknown as LeaveRow;
          if (item.status === "Pending") {
            return (
              <div className="flex gap-2">
                <Button size="sm" variant="primary" disabled={decide.pending} onClick={() => decideOn(item.id, "Approved")}>Approve</Button>
                <Button size="sm" variant="secondary" disabled={decide.pending} onClick={() => decideOn(item.id, "Rejected")}>Reject</Button>
              </div>
            );
          }
          if (item.status === "Approved") {
            return (
              <Button size="sm" variant="secondary" disabled={decide.pending} onClick={() => decideOn(item.id, "Revoked")}>Revoke</Button>
            );
          }
          return null;
        }}
      />
      <CommandFailure failure={decide.failure} title="Could not record the decision" />

      <FormModal
        title="Record leave"
        description="The request waits for a decision under Leave."
        open={applying}
        onClose={() => {
          setApplying(false);
          apply.clear();
        }}
        submitLabel="Record leave"
        pending={apply.pending}
        failure={apply.failure}
        failureTitle="Could not record leave"
        onSubmit={(form) =>
          apply.run(
            "verity.hr.apply_for_leave",
            {
              employeeId: formText(form, "employeeId"),
              leaveTypeId: formText(form, "leaveTypeId"),
              fromDate: startOfDay(formText(form, "fromDate")),
              toDate: startOfDay(formText(form, "toDate")),
              reason: formOptional(form, "reason"),
            },
            () => setApplying(false),
          )
        }
      >
        <Field label="Employee" htmlFor="hr-leave-employee" required>
          <Select id="hr-leave-employee" name="employeeId" required defaultValue="">
            <option value="" disabled>Choose an employee</option>
            {activeEmployees.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Leave type" htmlFor="hr-leave-type" required>
          <Select id="hr-leave-type" name="leaveTypeId" required defaultValue="">
            <option value="" disabled>Choose a type</option>
            {leaveTypes.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="From" htmlFor="hr-leave-from" required>
            <Input id="hr-leave-from" name="fromDate" type="date" required />
          </Field>
          <Field label="To" htmlFor="hr-leave-to" required>
            <Input id="hr-leave-to" name="toDate" type="date" required />
          </Field>
        </div>
        <Field label="Reason" htmlFor="hr-leave-reason">
          <Textarea id="hr-leave-reason" name="reason" rows={2} maxLength={500} />
        </Field>
      </FormModal>

      <FormModal
        title="Add leave type"
        description="For example Casual leave, 12 days a year."
        open={addingType}
        onClose={() => {
          setAddingType(false);
          addType.clear();
        }}
        submitLabel="Add leave type"
        pending={addType.pending}
        failure={addType.failure}
        failureTitle="Could not add leave type"
        onSubmit={(form) =>
          addType.run(
            "verity.hr.create_leave_type",
            { name: formText(form, "name"), daysPerYear: Number(formText(form, "daysPerYear")) },
            () => setAddingType(false),
          )
        }
      >
        <Field label="Name" htmlFor="hr-type-name" required>
          <Input id="hr-type-name" name="name" required maxLength={80} />
        </Field>
        <Field label="Days per year" htmlFor="hr-type-days" required>
          <Input id="hr-type-days" name="daysPerYear" type="number" min={0} max={365} step={1} required defaultValue={12} />
        </Field>
        {leaveTypes.length > 0 && (
          <p className="m-0 text-[13px] text-text-tertiary">
            Existing: {leaveTypes.map((t) => `${t.name} (${t.daysPerYear})`).join(", ")}.
          </p>
        )}
      </FormModal>
    </>
  );
}

/* ----------------------------------- desk ---------------------------------- */

export function HrDesk({
  employees,
  departments,
  leaveTypes,
  leave,
  parties,
}: {
  employees: EmployeeRow[];
  departments: DepartmentRow[];
  leaveTypes: LeaveTypeRow[];
  leave: LeaveRow[];
  parties: PartyOption[];
}) {
  const pending = leave.filter((l) => l.status === "Pending").length;
  return (
    <Tabs
      tabs={[
        { id: "employees", label: "Employees", count: employees.length, content: <EmployeesTab employees={employees} departments={departments} parties={parties} /> },
        { id: "departments", label: "Departments", count: departments.length, content: <DepartmentsTab departments={departments} /> },
        { id: "leave", label: "Leave", count: pending, content: <LeaveTab leave={leave} leaveTypes={leaveTypes} employees={employees} /> },
      ]}
    />
  );
}
