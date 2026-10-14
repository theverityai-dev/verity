"use client";

import { useState, type ReactNode } from "react";
import { CommandButton } from "@/components/ui/CommandAccess";
import { CommandFailure, FormModal, formOptional, formText, useCommand } from "@/components/ui/CommandForm";
import { FormDateField } from "@/components/ui/DateTimePicker";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";

/**
 * Every job action is a registered command run through `runCommand`: validation,
 * authorization, preconditions, mutation, event and audit all happen on the server. These
 * components only collect input and show what the command refused. A button the actor may
 * not use is not rendered (`CommandButton`), and the server checks again regardless.
 */

const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

/** Rupees as typed ("1,25,000.50") to integer paise. NaN-safe: a bad value becomes 0 and the server rejects it. */
function rupeesToMinor(raw: string): number {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function ActionDialog({
  command,
  label,
  title,
  description,
  submitLabel,
  variant = "secondary",
  size,
  destructive = false,
  build,
  children,
}: {
  command: string;
  label: string;
  title: string;
  description: string;
  submitLabel: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  destructive?: boolean;
  build: (form: FormData) => unknown;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { run, pending, failure, clear } = useCommand("/jobs");
  return (
    <>
      <CommandButton
        commands={command}
        variant={variant}
        size={size}
        onClick={() => {
          clear();
          setOpen(true);
        }}
      >
        {label}
      </CommandButton>
      <FormModal
        title={title}
        description={description}
        open={open}
        onClose={() => setOpen(false)}
        submitLabel={submitLabel}
        pending={pending}
        failure={failure}
        failureTitle={`Could not ${label.toLowerCase()}`}
        destructive={destructive}
        onSubmit={(form) => run(command, build(form), () => setOpen(false))}
      >
        {children}
      </FormModal>
    </>
  );
}

/** A one-click command with no input, showing the server's refusal in place. */
function QuickAction({
  command,
  input,
  label,
  variant = "secondary",
  size,
}: {
  command: string;
  input: unknown;
  label: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
}) {
  const { run, pending, failure } = useCommand("/jobs");
  return (
    <span className="inline-flex flex-col gap-2">
      <CommandButton commands={command} variant={variant} size={size} disabled={pending} onClick={() => run(command, input)}>
        {pending ? "Working…" : label}
      </CommandButton>
      <CommandFailure failure={failure} title={`Could not ${label.toLowerCase()}`} />
    </span>
  );
}

/* ================================== jobs ================================== */

export function NewJobButton({ customers }: { customers: Array<{ id: string; name: string }> }) {
  return (
    <ActionDialog
      command="verity.project.create_job"
      label="New job"
      title="New job"
      description="Open a job from a customer enquiry. Add the quote next."
      submitLabel="Open job"
      variant="primary"
      build={(f) => ({
        title: formText(f, "title"),
        customerId: formText(f, "customerId"),
        customerContact: formOptional(f, "customerContact"),
        description: formOptional(f, "description"),
        priority: formText(f, "priority") || "normal",
        dueDate: formOptional(f, "dueDate"),
      })}
    >
      <Field label="What is being made" htmlFor="job-title" required hint="For example: 500 kVA cast resin transformer, 11 kV / 433 V">
        <Input id="job-title" name="title" required minLength={3} maxLength={200} />
      </Field>
      <Field label="Customer" htmlFor="job-customer" required hint="Not listed? Close this and use New customer.">
        <Select id="job-customer" name="customerId" required defaultValue="">
          <option value="" disabled>{customers.length === 0 ? "Add a customer first" : "Choose a customer"}</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Contact person and phone" htmlFor="job-contact">
        <Input id="job-contact" name="customerContact" maxLength={200} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Priority" htmlFor="job-priority">
          <Select id="job-priority" name="priority" defaultValue="normal">
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Promised by" htmlFor="job-due">
          <FormDateField name="dueDate" id="job-due" />
        </Field>
      </div>
      <Field label="Requirement notes" htmlFor="job-desc">
        <Textarea id="job-desc" name="description" maxLength={4000} />
      </Field>
    </ActionDialog>
  );
}

export function EditJobButton({ job }: { job: { id: string; title: string; customerContact: string | null; description: string | null; priority: string; dueDate: string | null } }) {
  return (
    <ActionDialog
      command="verity.project.edit_job"
      label="Edit"
      title="Edit job"
      description="Change the title, contact, priority, promised date or notes."
      submitLabel="Save"
      build={(f) => ({
        jobId: job.id,
        title: formText(f, "title"),
        customerContact: formOptional(f, "customerContact") ?? null,
        description: formOptional(f, "description") ?? null,
        priority: formText(f, "priority"),
        dueDate: formOptional(f, "dueDate") ?? null,
      })}
    >
      <Field label="Title" htmlFor="edit-title" required>
        <Input id="edit-title" name="title" defaultValue={job.title} required minLength={3} maxLength={200} />
      </Field>
      <Field label="Contact person and phone" htmlFor="edit-contact">
        <Input id="edit-contact" name="customerContact" defaultValue={job.customerContact ?? ""} maxLength={200} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Priority" htmlFor="edit-priority">
          <Select id="edit-priority" name="priority" defaultValue={job.priority}>
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Promised by" htmlFor="edit-due">
          <FormDateField name="dueDate" id="edit-due" defaultValue={job.dueDate ?? ""} />
        </Field>
      </div>
      <Field label="Requirement notes" htmlFor="edit-desc">
        <Textarea id="edit-desc" name="description" defaultValue={job.description ?? ""} maxLength={4000} />
      </Field>
    </ActionDialog>
  );
}

/** The moves a job may make from where it is. The server refuses the rest. */
export function JobActions({
  jobId,
  state,
  openQuoteId,
  lostReasons,
}: {
  jobId: string;
  state: string;
  openQuoteId: string | null;
  lostReasons: Array<{ id: string; label: string }>;
}) {
  const live = !["completed", "lost", "cancelled"].includes(state);
  return (
    <>
      {state === "quoted" && openQuoteId && (
        <QuickAction command="verity.project.approve_quote" input={{ quoteId: openQuoteId }} label="Customer approved the quote" variant="primary" />
      )}
      {state === "approved" && <QuickAction command="verity.project.start_job" input={{ jobId }} label="Start work" variant="primary" />}
      {state === "in_progress" && <QuickAction command="verity.project.complete_job" input={{ jobId }} label="Finish job" variant="primary" />}
      {state === "in_progress" && <QuickAction command="verity.project.hold_job" input={{ jobId }} label="Put on hold" />}
      {state === "on_hold" && <QuickAction command="verity.project.resume_job" input={{ jobId }} label="Resume" variant="primary" />}
      {(state === "enquiry" || state === "quoted") && (
        <ActionDialog
          command="verity.project.mark_job_lost"
          label="Mark as lost"
          title="Mark job as lost"
          description="Record why the customer did not go ahead. The enquiry and its quotes stay on file."
          submitLabel="Mark as lost"
          destructive
          build={(f) => ({ jobId, reasonId: formText(f, "reasonId"), note: formOptional(f, "note") })}
        >
          <Field label="Reason" htmlFor="lost-reason" required>
            <Select id="lost-reason" name="reasonId" required defaultValue="">
              <option value="" disabled>Choose a reason</option>
              {lostReasons.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Note" htmlFor="lost-note">
            <Textarea id="lost-note" name="note" maxLength={1000} />
          </Field>
        </ActionDialog>
      )}
      {live && (
        <ActionDialog
          command="verity.project.cancel_job"
          label="Cancel job"
          title="Cancel job"
          description="The job and its history stay on record but become read-only. This cannot be undone."
          submitLabel="Cancel job"
          variant="danger"
          destructive
          build={(f) => ({ jobId, reason: formText(f, "reason") })}
        >
          <Field label="Reason" htmlFor="cancel-reason" required>
            <Textarea id="cancel-reason" name="reason" required minLength={3} maxLength={500} />
          </Field>
        </ActionDialog>
      )}
    </>
  );
}

/* ================================== quote ================================== */

export function QuoteButton({ jobId, hasQuote }: { jobId: string; hasQuote: boolean }) {
  const [rows, setRows] = useState(1);
  return (
    <ActionDialog
      command="verity.project.add_quote_revision"
      label={hasQuote ? "Revise quote" : "Add quote"}
      title={hasQuote ? "Revise quote" : "Technical quote"}
      description={hasQuote ? "A new revision replaces the open one. The earlier revision stays on file." : "List what is being offered. The total is worked out from the lines."}
      submitLabel="Save quote"
      variant="primary"
      build={(f) => ({
        jobId,
        validUntil: formOptional(f, "validUntil"),
        scopeNote: formOptional(f, "scopeNote"),
        lines: Array.from({ length: rows }, (_, i) => ({
          description: formText(f, `desc_${i}`),
          qty: Number(formText(f, `qty_${i}`) || 1),
          unitPriceMinor: rupeesToMinor(formText(f, `price_${i}`)),
        })),
      })}
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="grid grid-cols-[1fr_4.5rem_7.5rem] items-end gap-2">
          <Field label={i === 0 ? "Item" : `Item ${i + 1}`} htmlFor={`q-desc-${i}`} required>
            <Input id={`q-desc-${i}`} name={`desc_${i}`} required minLength={2} maxLength={300} />
          </Field>
          <Field label="Qty" htmlFor={`q-qty-${i}`} required>
            <Input id={`q-qty-${i}`} name={`qty_${i}`} type="number" min={1} step={1} defaultValue={1} required />
          </Field>
          <Field label="Unit price ₹" htmlFor={`q-price-${i}`} required>
            <Input id={`q-price-${i}`} name={`price_${i}`} inputMode="decimal" required />
          </Field>
        </div>
      ))}
      <div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setRows((r) => Math.min(r + 1, 20))}>
          Add another item
        </Button>
      </div>
      <Field label="Valid until" htmlFor="q-valid">
        <FormDateField name="validUntil" id="q-valid" />
      </Field>
      <Field label="Scope and terms" htmlFor="q-scope" hint="Delivery, warranty, payment terms.">
        <Textarea id="q-scope" name="scopeNote" maxLength={4000} />
      </Field>
    </ActionDialog>
  );
}

/* ================================== tasks ================================== */

export function AddTaskButton({ jobId, tasks }: { jobId: string; tasks: Array<{ id: string; title: string }> }) {
  return (
    <ActionDialog
      command="verity.project.create_task"
      label="Add task"
      title="Add task"
      description="A task can wait for another one to finish before it can start."
      submitLabel="Add task"
      build={(f) => ({
        jobId,
        title: formText(f, "title"),
        assigneeLabel: formOptional(f, "assignee"),
        dueDate: formOptional(f, "dueDate"),
        expectedMinutes: formText(f, "hours") ? Math.round(Number(formText(f, "hours")) * 60) : undefined,
        weight: Number(formText(f, "weight") || 1),
        dependsOnIds: formOptional(f, "after") ? [formText(f, "after")] : undefined,
      })}
    >
      <Field label="Task" htmlFor="task-title" required>
        <Input id="task-title" name="title" required minLength={2} maxLength={200} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Assigned to" htmlFor="task-assignee">
          <Input id="task-assignee" name="assignee" maxLength={100} />
        </Field>
        <Field label="Due" htmlFor="task-due">
          <FormDateField name="dueDate" id="task-due" />
        </Field>
        <Field label="Expected hours" htmlFor="task-hours">
          <Input id="task-hours" name="hours" type="number" min={0.5} step={0.5} />
        </Field>
        <Field label="Weight" htmlFor="task-weight" hint="Bigger tasks count more toward progress.">
          <Input id="task-weight" name="weight" type="number" min={1} max={100} step={1} defaultValue={1} />
        </Field>
      </div>
      {tasks.length > 0 && (
        <Field label="Starts after" htmlFor="task-after">
          <Select id="task-after" name="after" defaultValue="">
            <option value="">Nothing, can start any time</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
          </Select>
        </Field>
      )}
    </ActionDialog>
  );
}

const TASK_MOVES: Record<string, Array<{ to: string; label: string; variant?: "primary" | "ghost" }>> = {
  todo: [{ to: "in_progress", label: "Start", variant: "primary" }, { to: "blocked", label: "Block", variant: "ghost" }],
  in_progress: [{ to: "done", label: "Done", variant: "primary" }, { to: "blocked", label: "Block", variant: "ghost" }],
  blocked: [{ to: "in_progress", label: "Resume", variant: "primary" }, { to: "todo", label: "Back to list", variant: "ghost" }],
};

export function TaskMoves({ taskId, state }: { taskId: string; state: string }) {
  const moves = TASK_MOVES[state] ?? [];
  return (
    <span className="flex flex-wrap items-start justify-end gap-2">
      {moves.map((m) => (
        <QuickAction key={m.to} command="verity.project.set_task_state" input={{ taskId, toState: m.to }} label={m.label} variant={m.variant ?? "secondary"} size="sm" />
      ))}
    </span>
  );
}

/* =============================== milestones =============================== */

export function AddMilestoneButton({ jobId }: { jobId: string }) {
  return (
    <ActionDialog
      command="verity.project.add_milestone"
      label="Add milestone"
      title="Add milestone"
      description="A dated checkpoint, such as core ready, coils cast or test report issued."
      submitLabel="Add milestone"
      build={(f) => ({ jobId, name: formText(f, "name"), dueDate: formOptional(f, "dueDate") })}
    >
      <Field label="Milestone" htmlFor="ms-name" required>
        <Input id="ms-name" name="name" required minLength={2} maxLength={120} />
      </Field>
      <Field label="Due" htmlFor="ms-due">
        <FormDateField name="dueDate" id="ms-due" />
      </Field>
    </ActionDialog>
  );
}

export function ReachMilestoneButton({ milestoneId }: { milestoneId: string }) {
  return <QuickAction command="verity.project.reach_milestone" input={{ milestoneId }} label="Mark reached" variant="primary" size="sm" />;
}

/* ============================== time and cost ============================== */

export function LogTimeButton({ jobId, tasks }: { jobId: string; tasks: Array<{ id: string; title: string }> }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <ActionDialog
      command="verity.project.log_time"
      label="Log time"
      title="Log time"
      description="Hours worked on this job. The rate is kept on the entry, so later rate changes do not rewrite it."
      submitLabel="Log time"
      build={(f) => ({
        jobId,
        taskId: formOptional(f, "taskId"),
        workerLabel: formText(f, "worker"),
        workDate: formText(f, "workDate") || today,
        minutes: Math.round(Number(formText(f, "hours")) * 60),
        hourlyRateMinor: rupeesToMinor(formText(f, "rate")),
        note: formOptional(f, "note"),
      })}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Worked by" htmlFor="time-worker" required>
          <Input id="time-worker" name="worker" required minLength={2} maxLength={100} />
        </Field>
        <Field label="Date" htmlFor="time-date" required>
          <FormDateField name="workDate" id="time-date" defaultValue={today} />
        </Field>
        <Field label="Hours" htmlFor="time-hours" required>
          <Input id="time-hours" name="hours" type="number" min={0.25} max={24} step={0.25} required />
        </Field>
        <Field label="Rate per hour ₹" htmlFor="time-rate" required>
          <Input id="time-rate" name="rate" inputMode="decimal" required />
        </Field>
      </div>
      {tasks.length > 0 && (
        <Field label="Task" htmlFor="time-task">
          <Select id="time-task" name="taskId" defaultValue="">
            <option value="">Not tied to a task</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Note" htmlFor="time-note">
        <Input id="time-note" name="note" maxLength={400} />
      </Field>
    </ActionDialog>
  );
}

export function AddCostButton({ jobId }: { jobId: string }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <ActionDialog
      command="verity.project.add_cost"
      label="Add cost"
      title="Add cost"
      description="Money spent on this job that is not stock or labour: outsourced work, external testing, freight."
      submitLabel="Add cost"
      build={(f) => ({
        jobId,
        kind: formText(f, "kind"),
        description: formText(f, "description"),
        supplierName: formOptional(f, "supplier"),
        amountMinor: rupeesToMinor(formText(f, "amount")),
        incurredOn: formText(f, "incurredOn") || today,
      })}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kind" htmlFor="cost-kind" required>
          <Select id="cost-kind" name="kind" defaultValue="outsourced">
            <option value="outsourced">Outsourced work</option>
            <option value="testing">External testing</option>
            <option value="freight">Freight</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Date" htmlFor="cost-date" required>
          <FormDateField name="incurredOn" id="cost-date" defaultValue={today} />
        </Field>
      </div>
      <Field label="What for" htmlFor="cost-desc" required>
        <Input id="cost-desc" name="description" required minLength={2} maxLength={300} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Supplier" htmlFor="cost-supplier">
          <Input id="cost-supplier" name="supplier" maxLength={200} />
        </Field>
        <Field label="Amount ₹" htmlFor="cost-amount" required>
          <Input id="cost-amount" name="amount" inputMode="decimal" required />
        </Field>
      </div>
    </ActionDialog>
  );
}

/** Void a time or cost entry: kept on record, marked, and dropped from the totals. */
export function VoidEntryButton({ kind, entryId }: { kind: "time" | "cost"; entryId: string }) {
  return (
    <ActionDialog
      command={kind === "time" ? "verity.project.void_time_entry" : "verity.project.void_cost_entry"}
      label="Void"
      title="Void entry"
      description="The entry stays on record, marked void, and no longer counts toward the job's cost."
      submitLabel="Void entry"
      variant="ghost"
      size="sm"
      destructive
      build={(f) => ({ entryId, reason: formText(f, "reason") })}
    >
      <Field label="Why is it wrong" htmlFor={`void-${entryId}`} required>
        <Input id={`void-${entryId}`} name="reason" required minLength={3} maxLength={300} />
      </Field>
    </ActionDialog>
  );
}

/* =============================== production =============================== */

export function LinkOrderButton({ jobId, orders }: { jobId: string; orders: Array<{ id: string; reference: string | null }> }) {
  return (
    <ActionDialog
      command="verity.project.link_order"
      label="Link production order"
      title="Link production order"
      description="Material consumed by the order counts toward this job's cost. An order can belong to one job."
      submitLabel="Link order"
      build={(f) => ({ jobId, orderId: formText(f, "orderId") })}
    >
      <Field label="Production order" htmlFor="link-order" required>
        <Select id="link-order" name="orderId" required defaultValue="">
          <option value="" disabled>Choose an order</option>
          {orders.map((o) => (
            <option key={o.id} value={o.id}>{o.reference ?? o.id.slice(0, 8)}</option>
          ))}
        </Select>
      </Field>
    </ActionDialog>
  );
}

/** A company the business sells to. Trading owns the customer; Jobs only points at it. */
export function NewCustomerButton() {
  return (
    <ActionDialog
      command="verity.trading.create_customer"
      label="New customer"
      title="New customer"
      description="A company or person you quote to. Jobs, invoices and payments all attach to this one record."
      submitLabel="Add customer"
      build={(f) => ({
        displayName: formText(f, "name"),
        gstin: formOptional(f, "gstin")?.toUpperCase(),
        phone: formOptional(f, "phone"),
        email: formOptional(f, "email"),
      })}
    >
      <Field label="Name" htmlFor="cust-name" required>
        <Input id="cust-name" name="name" required maxLength={200} />
      </Field>
      <Field label="GSTIN" htmlFor="cust-gstin" hint="Optional now; needed before a GST invoice.">
        <Input id="cust-gstin" name="gstin" maxLength={15} autoCapitalize="characters" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone" htmlFor="cust-phone">
          <Input id="cust-phone" name="phone" inputMode="tel" maxLength={40} />
        </Field>
        <Field label="Email" htmlFor="cust-email">
          <Input id="cust-email" name="email" type="email" maxLength={200} />
        </Field>
      </div>
    </ActionDialog>
  );
}
