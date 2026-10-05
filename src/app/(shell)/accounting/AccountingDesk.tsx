"use client";

import { useState } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { Tabs } from "@/components/ui/Tabs";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { CommandFailure, FormModal, formOptional, formText, useCommand } from "@/components/ui/CommandForm";

export type AccountRow = {
  id: string;
  code: string;
  name: string;
  type: string;
  debit: string;
  credit: string;
  balance: string;
  active: boolean;
  status: string;
};
export type EntryRow = {
  id: string;
  date: string;
  memo: string;
  accounts: string;
  amount: string;
  postedBy: string;
  status: "Posted" | "Reversed" | "Reversal";
  canReverse: boolean;
};

const ROUTE = "/accounting";

/* --------------------------------- accounts -------------------------------- */

function AccountsTab({ accounts, accountTypes }: { accounts: AccountRow[]; accountTypes: string[] }) {
  const [open, setOpen] = useState(false);
  const add = useCommand(ROUTE);
  const toggle = useCommand(ROUTE);

  return (
    <>
      <DataTable
        caption="Chart of accounts"
        emptyTitle="No accounts yet"
        emptyDescription="Add the accounts you post to: cash, bank, sales, purchases, expenses."
        emptyAction={<Button variant="primary" onClick={() => setOpen(true)}>Add account</Button>}
        columns={[
          { key: "code", header: "Code", sortable: true },
          { key: "name", header: "Account", sortable: true, variant: "link", href: "/accounting/{id}" },
          { key: "type", header: "Type", sortable: true },
          { key: "debit", header: "Debits", numeric: true },
          { key: "credit", header: "Credits", numeric: true },
          { key: "balance", header: "Balance", numeric: true },
          { key: "status", header: "Status", sortable: true },
        ]}
        rows={accounts}
        toolbar={<Button variant="primary" onClick={() => setOpen(true)}>Add account</Button>}
        rowActions={(row) => {
          const account = row as unknown as AccountRow;
          return (
            <Button
              size="sm"
              variant="secondary"
              disabled={toggle.pending}
              onClick={() => toggle.run("verity.accounting.set_account_active", { accountId: account.id, active: !account.active })}
            >
              {account.active ? "Deactivate" : "Reactivate"}
            </Button>
          );
        }}
      />
      <CommandFailure failure={toggle.failure} title="Could not update the account" />
      <FormModal
        title="Add account"
        description="Codes are unique, for example 1000 Cash or 4000 Sales."
        open={open}
        onClose={() => {
          setOpen(false);
          add.clear();
        }}
        submitLabel="Add account"
        pending={add.pending}
        failure={add.failure}
        failureTitle="Could not add the account"
        onSubmit={(form) =>
          add.run(
            "verity.accounting.create_account",
            { code: formText(form, "code"), name: formText(form, "name"), type: formText(form, "type") },
            () => setOpen(false),
          )
        }
      >
        <div className="grid grid-cols-[120px_1fr] gap-4">
          <Field label="Code" htmlFor="acc-code" required>
            <Input id="acc-code" name="code" required maxLength={20} autoFocus />
          </Field>
          <Field label="Name" htmlFor="acc-name" required>
            <Input id="acc-name" name="name" required maxLength={200} />
          </Field>
        </div>
        <Field label="Type" htmlFor="acc-type" required>
          <Select id="acc-type" name="type" required defaultValue="">
            <option value="" disabled>Choose a type</option>
            {accountTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </Field>
      </FormModal>
    </>
  );
}

/* ---------------------------------- journal -------------------------------- */

type DraftLine = { key: number; accountId: string; debit: string; credit: string };

const toPaise = (value: string) => (value.trim() === "" ? 0 : Math.round(Number(value) * 100));
const show = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function NewEntryModal({ open, onClose, accounts }: { open: boolean; onClose: () => void; accounts: AccountRow[] }) {
  const post = useCommand(ROUTE);
  const blank = (key: number): DraftLine => ({ key, accountId: "", debit: "", credit: "" });
  const [lines, setLines] = useState<DraftLine[]>([blank(1), blank(2)]);
  const debits = lines.reduce((sum, l) => sum + toPaise(l.debit), 0);
  const credits = lines.reduce((sum, l) => sum + toPaise(l.credit), 0);
  const balanced = debits > 0 && debits === credits;
  const active = accounts.filter((a) => a.active);

  const update = (key: number, patch: Partial<DraftLine>) =>
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const close = () => {
    post.clear();
    setLines([blank(1), blank(2)]);
    onClose();
  };

  return (
    <FormModal
      title="New journal entry"
      description="Each line is a debit or a credit. The entry posts only when debits equal credits."
      open={open}
      onClose={close}
      width="lg"
      submitLabel="Post entry"
      pending={post.pending}
      failure={post.failure}
      failureTitle="Could not post the entry"
      onSubmit={(form) =>
        post.run(
          "verity.accounting.post_journal_entry",
          {
            memo: formOptional(form, "memo"),
            lines: lines
              .filter((l) => l.accountId)
              .map((l) => ({ accountId: l.accountId, debitMinor: toPaise(l.debit), creditMinor: toPaise(l.credit) })),
          },
          close,
        )
      }
    >
      <Field label="Memo" htmlFor="je-memo">
        <Input id="je-memo" name="memo" maxLength={500} placeholder="What this entry records" />
      </Field>
      <div className="flex flex-col gap-2">
        {lines.map((line, index) => (
          <div key={line.key} className="grid grid-cols-[1fr_110px_110px_auto] items-end gap-2">
            <Field label={index === 0 ? "Account" : ""} htmlFor={`je-acc-${line.key}`}>
              <Select
                id={`je-acc-${line.key}`}
                aria-label={`Account, line ${index + 1}`}
                value={line.accountId}
                onChange={(e) => update(line.key, { accountId: e.target.value })}
              >
                <option value="">Choose an account</option>
                {active.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} {a.name}</option>
                ))}
              </Select>
            </Field>
            <Field label={index === 0 ? "Debit (₹)" : ""} htmlFor={`je-dr-${line.key}`}>
              <Input
                id={`je-dr-${line.key}`}
                aria-label={`Debit, line ${index + 1}`}
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={line.debit}
                onChange={(e) => update(line.key, { debit: e.target.value, credit: e.target.value ? "" : line.credit })}
              />
            </Field>
            <Field label={index === 0 ? "Credit (₹)" : ""} htmlFor={`je-cr-${line.key}`}>
              <Input
                id={`je-cr-${line.key}`}
                aria-label={`Credit, line ${index + 1}`}
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={line.credit}
                onChange={(e) => update(line.key, { credit: e.target.value, debit: e.target.value ? "" : line.debit })}
              />
            </Field>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={lines.length <= 2}
              onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
              aria-label={`Remove line ${index + 1}`}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => setLines((current) => [...current, blank(Math.max(...current.map((l) => l.key)) + 1)])}
        >
          Add line
        </Button>
        <p className={"m-0 text-[14px] tabular " + (balanced ? "text-success" : "text-text-secondary")} role="status">
          Debits {show(debits)} · Credits {show(credits)}
          {balanced ? " · Balanced" : debits !== credits ? ` · Off by ${show(Math.abs(debits - credits))}` : ""}
        </p>
      </div>
    </FormModal>
  );
}

function JournalTab({ entries, accounts }: { entries: EntryRow[]; accounts: AccountRow[] }) {
  const [creating, setCreating] = useState(false);
  const [reversing, setReversing] = useState<EntryRow | null>(null);
  const reverse = useCommand(ROUTE);
  const activeCount = accounts.filter((a) => a.active).length;

  return (
    <>
      <DataTable
        caption="Journal entries, newest first"
        emptyTitle="No journal entries yet"
        emptyDescription={activeCount < 2 ? "Add at least two accounts first." : "Post the first entry."}
        emptyAction={activeCount >= 2 ? <Button variant="primary" onClick={() => setCreating(true)}>New entry</Button> : undefined}
        columns={[
          { key: "date", header: "Date", sortable: true },
          { key: "memo", header: "Memo", subKey: "accounts" },
          { key: "amount", header: "Amount", numeric: true },
          { key: "postedBy", header: "Posted by", sortable: true },
          { key: "status", header: "Status", sortable: true },
        ]}
        rows={entries}
        toolbar={
          <Button variant="primary" onClick={() => setCreating(true)} disabled={activeCount < 2}>
            New entry
          </Button>
        }
        rowActions={(row) => {
          const entry = row as unknown as EntryRow;
          if (!entry.canReverse) return null;
          return (
            <Button size="sm" variant="danger" onClick={() => setReversing(entry)}>
              Reverse
            </Button>
          );
        }}
      />
      <NewEntryModal open={creating} onClose={() => setCreating(false)} accounts={accounts} />
      <FormModal
        title="Reverse this entry"
        description={
          reversing
            ? `Posts a new entry with every debit and credit swapped. The original (${reversing.date}, ${reversing.amount}) stays on record.`
            : ""
        }
        open={reversing !== null}
        onClose={() => {
          setReversing(null);
          reverse.clear();
        }}
        destructive
        submitLabel="Post reversal"
        pending={reverse.pending}
        failure={reverse.failure}
        failureTitle="Could not reverse the entry"
        onSubmit={(form) => {
          if (!reversing) return;
          reverse.run(
            "verity.accounting.reverse_journal_entry",
            { journalEntryId: reversing.id, memo: formText(form, "reason") },
            () => setReversing(null),
          );
        }}
      >
        <Field label="Reason" htmlFor="je-reverse-reason" required>
          <Input id="je-reverse-reason" name="reason" required maxLength={500} autoFocus placeholder="Posted to the wrong account" />
        </Field>
      </FormModal>
    </>
  );
}

/* ----------------------------------- desk ---------------------------------- */

export function AccountingDesk({
  accounts,
  entries,
  accountTypes,
}: {
  accounts: AccountRow[];
  entries: EntryRow[];
  accountTypes: string[];
}) {
  return (
    <Tabs
      tabs={[
        { id: "accounts", label: "Chart of accounts", count: accounts.length, content: <AccountsTab accounts={accounts} accountTypes={accountTypes} /> },
        { id: "journal", label: "Journal", count: entries.length, content: <JournalTab entries={entries} accounts={accounts} /> },
      ]}
    />
  );
}
