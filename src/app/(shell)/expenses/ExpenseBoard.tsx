"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, ErrorState, Field, Input, Panel, RowList, Row, Select } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

const CATEGORIES = ["Rent", "Electricity", "Gas", "Water", "Maintenance", "Cleaning", "Packaging", "Transport", "Marketing", "Repairs", "Salaries", "Miscellaneous"] as const;
const PAYMENT_METHODS = ["Cash", "UPI", "Card", "Wallet", "BankTransfer", "DeliveryPlatform", "Other"] as const;

type ExpenseRow = { id: string; category: string; amountMinor: number; status: string; expenseDate: string };

function formatRupees(minor: number): string {
  return (minor / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
}

function RecordExpenseForm({ locations }: { locations: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return <div className="mb-6"><Button size="sm" onClick={() => setOpen(true)}>+ Record expense</Button></div>;
  }

  return (
    <Panel title="Record expense" className="mb-6">
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          setFailure(null);
          startTransition(async () => {
            const result = await runCommand(
              "verity.finance.record_expense",
              {
                locationId: String(form.get("locationId") ?? ""),
                category: String(form.get("category") ?? ""),
                amountMinor: Number(form.get("amount")) * 100,
                paymentMethod: String(form.get("paymentMethod") ?? ""),
                expenseDate: String(form.get("expenseDate") ?? ""),
                vendor: String(form.get("vendor") ?? "") || undefined,
                periodFrom: String(form.get("periodFrom") ?? "") || undefined,
                periodTo: String(form.get("periodTo") ?? "") || undefined,
              },
              "/expenses",
            );
            if (result.ok) { setOpen(false); router.refresh(); } else setFailure(result);
          });
        }}
      >
        <Field label="Outlet" htmlFor="locationId" required>
          <Select id="locationId" name="locationId" required defaultValue={locations[0]?.id}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </Field>
        <Field label="Category" htmlFor="category" required>
          <Select id="category" name="category" required defaultValue="Miscellaneous">
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Amount (₹)" htmlFor="amount" required>
          <Input id="amount" name="amount" type="number" min={1} required />
        </Field>
        <Field label="Payment method" htmlFor="paymentMethod">
          <Select id="paymentMethod" name="paymentMethod" defaultValue="Cash">
            {PAYMENT_METHODS.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </Field>
        <Field label="Date" htmlFor="expenseDate" required>
          <Input id="expenseDate" name="expenseDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
        </Field>
        <Field label="Vendor" htmlFor="vendor" hint="Optional">
          <Input id="vendor" name="vendor" />
        </Field>
        <Field label="Covers from" htmlFor="periodFrom" hint="Only for a bill that pays for many days, such as electricity. Leave both dates empty otherwise.">
          <Input id="periodFrom" name="periodFrom" type="date" />
        </Field>
        <Field label="Covers to" htmlFor="periodTo">
          <Input id="periodTo" name="periodTo" type="date" />
        </Field>
        {failure && <div className="sm:col-span-2"><ErrorState title="Could not record expense" message={failure.message} issues={failure.issues} retryable={failure.retryable} /></div>}
        <div className="flex items-center gap-2 sm:col-span-2">
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Record"}</Button>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </form>
    </Panel>
  );
}

function ExpenseRowActions({ expense }: { expense: ExpenseRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<ActionFailure | null>(null);

  if (expense.status !== "Pending") return <Badge tone={expense.status === "Approved" ? "neutral" : "accent"}>{expense.status}</Badge>;

  function decide(approve: boolean) {
    setFailure(null);
    startTransition(async () => {
      const result = await runCommand("verity.finance.decide_expense", { expenseId: expense.id, approve }, "/expenses");
      if (result.ok) router.refresh(); else setFailure(result);
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={() => decide(true)}>Approve</Button>
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => decide(false)}>Reject</Button>
      </div>
      {failure && <ErrorState title="Could not decide" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
    </div>
  );
}

export function ExpenseBoard({ expenses, locations }: { expenses: ExpenseRow[]; locations: Array<{ id: string; name: string }> }) {
  return (
    <>
      <RecordExpenseForm locations={locations} />
      {expenses.length === 0 ? (
        <Panel title="Expenses"><p className="m-0 text-[13px] text-text-tertiary">No expenses recorded yet.</p></Panel>
      ) : (
        <Panel title="Expenses" flush>
          <RowList>
            {expenses.map((e) => (
              <Row key={e.id} className="items-center justify-between">
                <div className="flex flex-col gap-1">
                  <span className="text-text">{e.category}</span>
                  <span className="text-text-tertiary text-[13px]">{new Date(e.expenseDate).toLocaleDateString("en-IN")} · {formatRupees(e.amountMinor)}</span>
                </div>
                <ExpenseRowActions expense={e} />
              </Row>
            ))}
          </RowList>
        </Panel>
      )}
    </>
  );
}
