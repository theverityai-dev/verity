"use client";

import Link from "next/link";
import Papa from "papaparse";
import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import { Icon, type IconName } from "@/components/ui/icons";
import { Avatar } from "@/components/ui/Avatar";
import { Modal, ModalCancel } from "@/components/ui/Modal";
import { OverflowMenu, OverflowMenuItem } from "@/components/ui/OverflowMenu";
import { FormModal, formOptional, formText, useCommand } from "@/components/ui/CommandForm";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { FieldDisplay, FieldEditor, Floating, OptionPill, ReasonSheet, RelationOptions, type ReasonRule } from "@/components/records/RecordView";
import { dayLabel, daysFromToday, moneyShort, relativeDay, relativeTime, type Described, type RecordField, type Ref, type Row } from "@/components/records/model";

/**
 * The CRM's own parts around the shared record views (Task 128): create sheets, import, pipeline settings, the
 * record timeline with its composer, editable record fields, the stage track and the follow-up queue. Every action
 * is a registered `verity.relationship.*` command; nothing here writes any other way.
 */

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");
const clean = (m: string) => m.replace(/^E_[A-Z_]+:\s*/, "").replace(/^./, (c) => c.toUpperCase());

/* ================================ pickers ================================ */

/** A field that picks a company or person by typing, inside a form. */
function RecordPicker({ described, relation, label, id, value, onChange }: { described: Described; relation: string; label: string; id: string; value: Ref | null; onChange: (v: Ref | null) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const field: RecordField = { key: id, label, type: "relation", relation };
  return (
    <>
      <button
        id={id}
        type="button"
        onClick={(e) => setAnchor(e.currentTarget)}
        className="flex min-h-11 w-full items-center gap-2 rounded-[10px] bg-[var(--color-control)] px-3.5 text-left text-[16px] text-text sm:text-[15px]"
      >
        {value ? <span className="truncate">{value.label}</span> : <span className="text-text-tertiary">Choose…</span>}
        <span className="flex-1" />
        <Icon name="chevronDown" size={16} className="text-text-tertiary" />
      </button>
      <Floating anchor={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)} label={label}>
        <PickerBody described={described} field={field} value={value} onPick={(v) => { onChange(v); setAnchor(null); }} />
      </Floating>
    </>
  );
}

function PickerBody({ described, field, value, onPick }: { described: Described; field: RecordField; value: Ref | null; onPick: (v: Ref | null) => void }) {
  return (
    <RelationOptions
      described={described}
      field={field}
      value={value?.id ?? ""}
      onPick={(id, label) => onPick(id ? { id, label: label ?? "Selected" } : null)}
    />
  );
}

function MemberSelect({ id, name, members, defaultValue }: { id: string; name: string; members: Ref[]; defaultValue?: string }) {
  return (
    <Select id={id} name={name} defaultValue={defaultValue ?? ""}>
      <option value="">No one</option>
      {members.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
    </Select>
  );
}

/* ================================ create sheets ================================ */

function useDuplicateAware(revalidate: string) {
  const { run, pending, failure, clear } = useCommand(revalidate);
  const duplicate = failure?.message?.includes("already exists") || failure?.message?.includes("already has");
  return { run, pending, failure, clear, duplicate };
}

export function NewCompanyButton({ described, compact }: { described: Described; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { run, pending, failure, clear, duplicate } = useDuplicateAware("/crm/companies");
  const [last, setLast] = useState<FormData | null>(null);
  const submit = (form: FormData, allowDuplicate = false) => {
    setLast(form);
    run<{ id: string }>(
      "verity.relationship.create_company",
      {
        name: formText(form, "name"),
        domain: formOptional(form, "domain"),
        industry: formOptional(form, "industry"),
        phone: formOptional(form, "phone"),
        email: formOptional(form, "email"),
        city: formOptional(form, "city"),
        taxId: formOptional(form, "taxId"),
        owner: formText(form, "owner") || null,
        allowDuplicate,
      },
      (data) => { setOpen(false); clear(); router.push(`/crm/companies/${data.id}`); },
    );
  };
  return (
    <>
      <CommandButton commands="verity.relationship.create_company" variant={compact ? "secondary" : "primary"} onClick={() => setOpen(true)}>
        {compact ? "Add company" : "New company"}
      </CommandButton>
      <FormModal
        title="New company"
        description="A business you sell to or work with. People and opportunities attach to it."
        open={open}
        onClose={() => { setOpen(false); clear(); }}
        submitLabel="Create company"
        pending={pending}
        failure={failure}
        failureTitle="Could not create the company"
        onSubmit={(form) => submit(form)}
      >
        <Field label="Name" htmlFor="co-name" required><Input id="co-name" name="name" required maxLength={200} autoComplete="organization" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Website domain" htmlFor="co-domain" hint="acme.in — used to match people by email"><Input id="co-domain" name="domain" placeholder="acme.in" autoComplete="off" /></Field>
          <Field label="Industry" htmlFor="co-industry"><Input id="co-industry" name="industry" placeholder="Power generation" /></Field>
          <Field label="Phone" htmlFor="co-phone"><Input id="co-phone" name="phone" type="tel" /></Field>
          <Field label="Email" htmlFor="co-email"><Input id="co-email" name="email" type="email" /></Field>
          <Field label="City" htmlFor="co-city"><Input id="co-city" name="city" /></Field>
          <Field label="GSTIN / tax ID" htmlFor="co-tax"><Input id="co-tax" name="taxId" autoComplete="off" /></Field>
        </div>
        <Field label="Account owner" htmlFor="co-owner"><MemberSelect id="co-owner" name="owner" members={described.members} /></Field>
        {duplicate && last && (
          <Button type="button" variant="secondary" onClick={() => submit(last, true)}>Save anyway</Button>
        )}
      </FormModal>
    </>
  );
}

export function NewPersonButton({ described, company, compact }: { described: Described; company?: Ref; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Ref | null>(company ?? null);
  const { run, pending, failure, clear, duplicate } = useDuplicateAware("/crm/people");
  const [last, setLast] = useState<FormData | null>(null);
  const submit = (form: FormData, allowDuplicate = false) => {
    setLast(form);
    run<{ id: string }>(
      "verity.relationship.create_person",
      {
        givenName: formText(form, "givenName"),
        familyName: formOptional(form, "familyName") ?? null,
        jobTitle: formOptional(form, "jobTitle") ?? null,
        emails: formText(form, "emails"),
        phones: formText(form, "phones"),
        ...(picked ? { company: picked.id } : {}),
        owner: formText(form, "owner") || null,
        allowDuplicate,
      },
      (data) => { setOpen(false); clear(); if (company) router.refresh(); else router.push(`/crm/people/${data.id}`); },
    );
  };
  return (
    <>
      <CommandButton commands="verity.relationship.create_person" variant={compact ? "secondary" : "primary"} onClick={() => setOpen(true)}>
        {compact ? "Add person" : "New person"}
      </CommandButton>
      <FormModal
        title={company ? `New person at ${company.label}` : "New person"}
        description="A contact. Without a company chosen, a work email links them to the company with that domain."
        open={open}
        onClose={() => { setOpen(false); clear(); }}
        submitLabel="Add person"
        pending={pending}
        failure={failure}
        failureTitle="Could not add the person"
        onSubmit={(form) => submit(form)}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" htmlFor="pe-given" required><Input id="pe-given" name="givenName" required maxLength={100} autoComplete="given-name" /></Field>
          <Field label="Last name" htmlFor="pe-family"><Input id="pe-family" name="familyName" maxLength={100} autoComplete="family-name" /></Field>
        </div>
        <Field label="Job title" htmlFor="pe-title"><Input id="pe-title" name="jobTitle" placeholder="Purchase manager" /></Field>
        {!company && (
          <Field label="Company" htmlFor="pe-company">
            <RecordPicker described={described} relation="verity.relationship.company" label="Company" id="pe-company" value={picked} onChange={setPicked} />
          </Field>
        )}
        <Field label="Emails" htmlFor="pe-emails" hint="Separate several with commas; the first is the main one."><Input id="pe-emails" name="emails" autoComplete="off" inputMode="email" /></Field>
        <Field label="Phones" htmlFor="pe-phones" hint="Separate several with commas."><Input id="pe-phones" name="phones" type="tel" autoComplete="off" /></Field>
        <Field label="Owner" htmlFor="pe-owner"><MemberSelect id="pe-owner" name="owner" members={described.members} /></Field>
        {duplicate && last && <Button type="button" variant="secondary" onClick={() => submit(last, true)}>Save anyway</Button>}
      </FormModal>
    </>
  );
}

export function NewOpportunityButton({
  described,
  company,
  contact,
  compact,
}: {
  described: Described;
  company?: Ref;
  contact?: Ref;
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [co, setCo] = useState<Ref | null>(company ?? null);
  const [person, setPerson] = useState<Ref | null>(contact ?? null);
  const { run, pending, failure, clear } = useCommand("/crm/opportunities");
  const stages = described.fields.find((f) => f.key === "stage")?.options ?? [];
  const sources = described.fields.find((f) => f.key === "source")?.options ?? [];
  return (
    <>
      <CommandButton commands="verity.relationship.create_opportunity" variant={compact ? "secondary" : "primary"} onClick={() => setOpen(true)}>
        {compact ? "Add opportunity" : "New opportunity"}
      </CommandButton>
      <FormModal
        title="New opportunity"
        description="A deal in the pipeline. It starts in the first stage unless you choose another."
        open={open}
        onClose={() => { setOpen(false); clear(); }}
        submitLabel="Create opportunity"
        pending={pending}
        failure={failure}
        failureTitle="Could not create the opportunity"
        onSubmit={(form) =>
          run<{ id: string }>(
            "verity.relationship.create_opportunity",
            {
              name: formText(form, "name"),
              ...(co ? { company: co.id } : {}),
              ...(person ? { contact: person.id } : {}),
              amount: formText(form, "amount") || null,
              expectedCloseOn: formText(form, "close") || null,
              submissionDueOn: formText(form, "bid") || null,
              source: formText(form, "source") || null,
              ...(formText(form, "stage") ? { stage: formText(form, "stage") } : {}),
              owner: formText(form, "owner") || null,
            },
            (data) => { setOpen(false); clear(); if (company || contact) router.refresh(); else router.push(`/crm/opportunities/${data.id}`); },
          )
        }
      >
        <Field label="What is being sold" htmlFor="op-name" required><Input id="op-name" name="name" required maxLength={200} placeholder="2 MVA cast resin transformer" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {!company && (
            <Field label="Company" htmlFor="op-company">
              <RecordPicker described={described} relation="verity.relationship.company" label="Company" id="op-company" value={co} onChange={setCo} />
            </Field>
          )}
          {!contact && (
            <Field label="Point of contact" htmlFor="op-contact">
              <RecordPicker described={described} relation="verity.relationship.person" label="Point of contact" id="op-contact" value={person} onChange={setPerson} />
            </Field>
          )}
          <Field label="Amount (₹)" htmlFor="op-amount"><Input id="op-amount" name="amount" inputMode="decimal" placeholder="18,50,000" /></Field>
          <Field label="Source" htmlFor="op-source">
            <Select id="op-source" name="source" defaultValue="">
              <option value="">Not set</option>
              {sources.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
          </Field>
          <Field label="Expected close" htmlFor="op-close"><Input id="op-close" name="close" type="date" /></Field>
          <Field label="Bid due (tender or RFQ)" htmlFor="op-bid"><Input id="op-bid" name="bid" type="date" /></Field>
          {stages.length > 0 && (
            <Field label="Stage" htmlFor="op-stage">
              <Select id="op-stage" name="stage" defaultValue={stages.find((s) => s.tone === "info")?.value ?? ""}>
                {stages.filter((s) => s.tone === "info").map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Owner" htmlFor="op-owner"><MemberSelect id="op-owner" name="owner" members={described.members} /></Field>
        </div>
      </FormModal>
    </>
  );
}

/* ================================ import ================================ */

const IMPORT_TARGETS: Record<"company" | "person", Array<{ key: string; label: string; required?: boolean; guesses: string[] }>> = {
  company: [
    { key: "name", label: "Company name", required: true, guesses: ["name", "company", "company name", "organisation", "organization", "account"] },
    { key: "domain", label: "Website / domain", guesses: ["domain", "website", "web", "url"] },
    { key: "industry", label: "Industry", guesses: ["industry", "sector", "segment"] },
    { key: "phone", label: "Phone", guesses: ["phone", "telephone", "mobile", "contact number"] },
    { key: "email", label: "Email", guesses: ["email", "e-mail", "mail"] },
    { key: "city", label: "City", guesses: ["city", "town"] },
    { key: "region", label: "State / region", guesses: ["state", "region", "province"] },
    { key: "country", label: "Country", guesses: ["country"] },
    { key: "taxId", label: "GSTIN / tax ID", guesses: ["gstin", "gst", "gst no", "tax id", "vat"] },
  ],
  person: [
    { key: "givenName", label: "First name", required: true, guesses: ["first name", "firstname", "given name", "name", "contact name"] },
    { key: "familyName", label: "Last name", guesses: ["last name", "lastname", "surname", "family name"] },
    { key: "email", label: "Email", guesses: ["email", "e-mail", "mail", "email address"] },
    { key: "phone", label: "Phone", guesses: ["phone", "mobile", "telephone", "contact number"] },
    { key: "jobTitle", label: "Job title", guesses: ["title", "job title", "designation", "role", "position"] },
    { key: "company", label: "Company name", guesses: ["company", "organisation", "organization", "account", "company name"] },
    { key: "city", label: "City", guesses: ["city", "town"] },
  ],
};

type ImportResult = { row: number; status: "created" | "would_create" | "duplicate" | "error"; label: string; message?: string };

export function ImportButton({ object, label }: { object: "company" | "person"; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Array<Record<string, string>>>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [map, setMap] = useState<Record<string, string>>({});
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const targets = IMPORT_TARGETS[object];

  const reset = () => { setRows([]); setHeaders([]); setMap({}); setResults(null); setDone(null); setError(null); };
  const read = (file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (parsed) => {
        const hs = (parsed.meta.fields ?? []).filter(Boolean);
        if (!hs.length || !parsed.data.length) return setError("That file has no header row or no rows.");
        if (parsed.data.length > 2000) return setError("Import up to 2,000 rows at a time; split the file.");
        setError(null);
        setHeaders(hs);
        setRows(parsed.data);
        const guess: Record<string, string> = {};
        for (const t of targets) {
          const hit = hs.find((h) => t.guesses.includes(h.trim().toLowerCase()));
          if (hit && !Object.values(guess).includes(hit)) guess[t.key] = hit;
        }
        setMap(guess);
      },
      error: () => setError("That file could not be read as CSV."),
    });
  };
  const mapped = () => rows.map((r) => Object.fromEntries(targets.filter((t) => map[t.key]).map((t) => [t.key, String(r[map[t.key]!] ?? "")])));
  const ready = targets.filter((t) => t.required).every((t) => map[t.key]);
  const check = (dryRun: boolean) =>
    start(async () => {
      const result = await runCommand<{ results: ImportResult[]; created: number }>("verity.relationship.import_records", { object, rows: mapped(), dryRun });
      if (!result.ok) return setError(clean(result.message));
      setResults(result.data.results);
      if (!dryRun) { setDone(result.data.created); router.refresh(); }
    });
  const counts = results ? { create: results.filter((r) => r.status === "would_create" || r.status === "created").length, dup: results.filter((r) => r.status === "duplicate").length, bad: results.filter((r) => r.status === "error").length } : null;

  return (
    <>
      <CommandButton commands="verity.relationship.import_records" variant="secondary" onClick={() => { reset(); setOpen(true); }}>
        Import
      </CommandButton>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Import ${label}`}
        description="From a CSV file. Every row is checked first; nothing is saved until you confirm."
        width="lg"
        footer={
          done !== null ? (
            <Button variant="primary" onClick={() => setOpen(false)}>Done</Button>
          ) : (
            <>
              <ModalCancel onClose={() => setOpen(false)} />
              {results ? (
                <Button variant="primary" disabled={pending || !counts?.create} onClick={() => check(false)}>
                  {pending ? "Importing…" : `Import ${counts?.create ?? 0} ${label}`}
                </Button>
              ) : (
                <Button variant="primary" disabled={pending || !rows.length || !ready} onClick={() => check(true)}>{pending ? "Checking…" : "Check rows"}</Button>
              )}
            </>
          )
        }
      >
        {error && <p role="alert" className="mb-4 mt-0 rounded-[10px] bg-[var(--color-danger-subtle)] px-3.5 py-2.5 text-[15px] text-[var(--color-danger-ink)]">{error}</p>}
        {!rows.length ? (
          <label className="flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-2 rounded-[12px] bg-[var(--color-surface-sunken)] p-6 text-center hover:bg-[var(--color-control)]">
            <Icon name="catalogue" size={28} className="text-text-secondary" />
            <span className="text-[17px] font-semibold text-text">Choose a CSV file</span>
            <span className="max-w-[44ch] text-[15px] text-text-secondary">
              Export from Excel or another CRM as “CSV”. The first row must name the columns.
            </span>
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); }} />
          </label>
        ) : done !== null ? (
          <div className="py-6 text-center">
            <div className="mx-auto mb-3 grid size-14 place-items-center rounded-full bg-[var(--color-state-completed-fill)] text-[var(--color-state-completed-ink)]"><Icon name="check" size={28} /></div>
            <p className="m-0 text-[20px] font-bold text-text">{done} {label} imported</p>
            <p className="m-0 mt-1 text-[15px] text-text-secondary">{counts?.dup ? `${counts.dup} already existed and were skipped. ` : ""}{counts?.bad ? `${counts.bad} rows had problems and were not imported.` : ""}</p>
          </div>
        ) : !results ? (
          <div>
            <p className="mb-3 mt-0 text-[15px] text-text-secondary">{rows.length} rows found. Match each column to a field; unmatched columns are ignored.</p>
            <div className="glass-card overflow-hidden rounded-[12px]">
              {targets.map((t) => (
                <div key={t.key} className="flex min-h-12 items-center gap-3 border-b border-[var(--color-separator)] px-4 last:border-b-0">
                  <span className="flex-1 text-[15px] text-text">{t.label}{t.required && <span className="text-[var(--color-danger-ink)]"> *</span>}</span>
                  <select
                    aria-label={`Column for ${t.label}`}
                    value={map[t.key] ?? ""}
                    onChange={(e) => setMap((m) => ({ ...m, [t.key]: e.target.value }))}
                    className="h-10 w-56 max-w-[55%] rounded-[10px] border-0 bg-[var(--color-control)] px-3 text-[15px] text-text"
                  >
                    <option value="">Ignore</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                  <span className="hidden w-40 truncate text-[13px] text-text-tertiary sm:block">{map[t.key] ? String(rows[0]?.[map[t.key]!] ?? "") : ""}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <div className="mb-3 flex flex-wrap gap-2">
              <OptionPill option={{ value: "c", label: `${counts!.create} to import`, tone: "success" }} />
              {counts!.dup > 0 && <OptionPill option={{ value: "d", label: `${counts!.dup} already exist`, tone: "neutral" }} />}
              {counts!.bad > 0 && <OptionPill option={{ value: "b", label: `${counts!.bad} need fixing`, tone: "danger" }} />}
            </div>
            <ul className="glass-card m-0 max-h-[340px] list-none overflow-y-auto rounded-[12px] p-0">
              {results.map((r) => (
                <li key={r.row} className="flex min-h-11 items-center gap-3 border-b border-[var(--color-separator)] px-4 py-2 text-[15px] last:border-b-0">
                  <span className="tabular w-10 shrink-0 text-[13px] text-text-tertiary">{r.row}</span>
                  <span className="min-w-0 flex-1 truncate text-text">{r.label || "—"}</span>
                  <span className={cx("shrink-0 text-[13px]", r.status === "error" ? "text-[var(--color-danger-ink)]" : "text-text-secondary")}>
                    {r.status === "would_create" ? "Will import" : r.status === "created" ? "Imported" : r.message}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Modal>
    </>
  );
}

/** Creates the starting pipeline for a workspace that has none yet. */
export function SetupPipelineButton() {
  const { run, pending, failure } = useCommand("/crm/opportunities");
  return (
    <div className="flex flex-col items-center gap-2">
      <CommandButton commands="verity.relationship.setup_pipeline" variant="primary" disabled={pending} onClick={() => run("verity.relationship.setup_pipeline", {})}>
        {pending ? "Setting up…" : "Set up the pipeline"}
      </CommandButton>
      {failure && <p role="alert" className="m-0 text-[14px] text-[var(--color-danger-ink)]">{clean(failure.message)}</p>}
    </div>
  );
}

/* ================================ pipeline settings ================================ */

type StageRow = { id: string; label: string; category: string; probability: number; active: boolean };

export function PipelineSettingsButton({ stages }: { stages: StageRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(stages);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (key: string, input: unknown) =>
    start(async () => {
      const result = await runCommand(key, input);
      if (!result.ok) return setError(clean(result.message));
      setError(null);
      router.refresh();
    });
  const move = (i: number, d: -1 | 1) => {
    const next = [...list];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    setList(next);
    run("verity.relationship.reorder_stages", { ids: next.map((s) => s.id) });
  };
  const category: Record<string, string> = { Active: "Open", Completed: "Won", Cancelled: "Lost" };
  return (
    <>
      <CommandButton commands="verity.relationship.save_stage" variant="ghost" onClick={() => { setList(stages); setOpen(true); }}>
        Pipeline settings
      </CommandButton>
      <Modal open={open} onClose={() => setOpen(false)} title="Pipeline stages" description="Rename stages, set how likely a deal at each stage is to close, and put them in order." width="lg"
        footer={<Button variant="primary" onClick={() => setOpen(false)}>Done</Button>}>
        {error && <p role="alert" className="mb-3 mt-0 rounded-[10px] bg-[var(--color-danger-subtle)] px-3.5 py-2.5 text-[15px] text-[var(--color-danger-ink)]">{error}</p>}
        <ol className="glass-card m-0 list-none overflow-hidden rounded-[12px] p-0">
          {list.map((s, i) => (
            <li key={s.id} className={cx("flex flex-wrap items-center gap-2 border-b border-[var(--color-separator)] px-3 py-2.5 last:border-b-0", !s.active && "opacity-60")}>
              <span className="tabular w-6 text-center text-[13px] text-text-tertiary">{i + 1}</span>
              <input
                aria-label="Stage name"
                defaultValue={s.label}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.label) run("verity.relationship.save_stage", { id: s.id, label: v, category: s.category, probability: s.probability }); }}
                className="h-10 min-w-0 flex-1 rounded-[10px] border-0 bg-[var(--color-control)] px-3 text-[15px] text-text"
              />
              <OptionPill option={{ value: s.category, label: category[s.category] ?? s.category, tone: s.category === "Completed" ? "success" : s.category === "Cancelled" ? "danger" : "info" }} />
              <label className="flex items-center gap-1 text-[13px] text-text-secondary">
                <input
                  aria-label={`Win probability for ${s.label}`}
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={s.probability}
                  onBlur={(e) => { const v = Math.max(0, Math.min(100, Number(e.target.value) || 0)); if (v !== s.probability) run("verity.relationship.save_stage", { id: s.id, label: s.label, category: s.category, probability: v }); }}
                  className="tabular h-10 w-16 rounded-[10px] border-0 bg-[var(--color-control)] px-2 text-right text-[15px] text-text"
                />
                %
              </label>
              <button type="button" aria-label="Move up" disabled={i === 0 || pending} onClick={() => move(i, -1)} className="grid size-9 place-items-center rounded-[8px] text-text-secondary hover:bg-[var(--color-control)] disabled:opacity-30"><Icon name="chevronRight" size={14} className="-rotate-90" /></button>
              <button type="button" aria-label="Move down" disabled={i === list.length - 1 || pending} onClick={() => move(i, 1)} className="grid size-9 place-items-center rounded-[8px] text-text-secondary hover:bg-[var(--color-control)] disabled:opacity-30"><Icon name="chevronRight" size={14} className="rotate-90" /></button>
              <button type="button" onClick={() => run("verity.relationship.save_stage", { id: s.id, label: s.label, category: s.category, probability: s.probability, active: !s.active })} className="min-h-9 rounded-[8px] px-2 text-[13px] font-medium text-accent-ink hover:bg-accent-subtle">
                {s.active ? "Retire" : "Restore"}
              </button>
            </li>
          ))}
        </ol>
        <form
          className="mt-4 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const label = String(f.get("label") ?? "").trim();
            if (!label) return;
            run("verity.relationship.save_stage", { label, category: String(f.get("category")), probability: Number(f.get("probability") || 0) });
            e.currentTarget.reset();
          }}
        >
          <Field label="New stage" htmlFor="st-label"><Input id="st-label" name="label" placeholder="Site survey" maxLength={60} /></Field>
          <Field label="Means" htmlFor="st-cat">
            <Select id="st-cat" name="category" defaultValue="Active">
              <option value="Active">Still open</option>
              <option value="Completed">Won</option>
              <option value="Cancelled">Lost</option>
            </Select>
          </Field>
          <Field label="Probability %" htmlFor="st-prob"><Input id="st-prob" name="probability" type="number" min={0} max={100} defaultValue={30} className="w-24" /></Field>
          <Button type="submit" variant="secondary" disabled={pending}>Add stage</Button>
        </form>
      </Modal>
    </>
  );
}

/* ================================ record fields ================================ */

/** The editable facts of one record: tap a value to change it, through the same command the table uses. */
export function RecordFields({ described, row, fieldKeys }: { described: Described; row: Row; fieldKeys: string[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ field: RecordField; anchor: HTMLElement } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<Row>(row);
  const fields = fieldKeys.map((k) => described.fields.find((f) => f.key === k)).filter((f): f is RecordField => Boolean(f));
  const commit = async (field: RecordField, value: unknown) => {
    setEditing(null);
    if (!field.editCommand) return;
    const result = await runCommand<{ version: number }>(field.editCommand, { id: local.id, version: local.version, patch: { [field.key]: value } });
    if (!result.ok) return setError(clean(result.message));
    setError(null);
    setLocal((l) => ({ ...l, version: result.data.version }));
    router.refresh();
  };
  return (
    <div>
      {error && <p role="alert" className="mb-2 mt-0 rounded-[10px] bg-[var(--color-danger-subtle)] px-3 py-2 text-[14px] text-[var(--color-danger-ink)]">{error}</p>}
      <dl className="m-0">
        {fields.map((f) => {
          const can = described.canEdit && Boolean(f.editCommand);
          const value = row[f.key];
          return (
            <div key={f.key} className="flex min-h-11 items-center gap-3 border-b border-[var(--color-separator)] last:border-b-0">
              <dt className="w-[42%] shrink-0 truncate text-[15px] text-text-secondary">{f.label}</dt>
              <dd className="m-0 min-w-0 flex-1">
                {can ? (
                  <button type="button" onClick={(e) => setEditing({ field: f, anchor: e.currentTarget })} className="-mx-2 flex min-h-10 w-[calc(100%+16px)] min-w-0 items-center rounded-[8px] px-2 text-left text-[15px] text-text hover:bg-[var(--color-control)]" aria-label={`${f.label}: edit`}>
                    <span className="min-w-0 truncate"><FieldDisplay field={f} value={value} row={row} described={described} /></span>
                  </button>
                ) : (
                  <span className="block min-w-0 truncate text-[15px]"><FieldDisplay field={f} value={value} row={row} described={described} /></span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      {editing && (
        <Floating anchor={editing.anchor} open onClose={() => setEditing(null)} label={`Edit ${editing.field.label}`}>
          <FieldEditor field={editing.field} value={row[editing.field.key]} described={described} onCancel={() => setEditing(null)} onCommit={(v) => commit(editing.field, v)} />
        </Floating>
      )}
    </div>
  );
}

/* ================================ archive ================================ */

export function ArchiveButton({ kind, id, archived, label }: { kind: "companies" | "people" | "opportunities"; id: string; archived: boolean; label: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  const run = () =>
    start(async () => {
      const result = await runCommand(`verity.relationship.${archived ? "restore" : "archive"}_${kind}`, { ids: [id] });
      if (!result.ok) return setFailure(clean(result.message));
      setConfirm(false);
      router.refresh();
    });
  return (
    <>
      <CommandButton commands={`verity.relationship.${archived ? "restore" : "archive"}_${kind}`} variant={archived ? "secondary" : "danger"} onClick={() => (archived ? run() : setConfirm(true))} disabled={pending}>
        {archived ? "Restore" : "Archive"}
      </CommandButton>
      <Modal open={confirm} onClose={() => setConfirm(false)} title={`Archive ${label}?`} width="sm"
        description="It leaves lists and search, and keeps its whole history. You can restore it at any time."
        footer={<><ModalCancel onClose={() => setConfirm(false)} /><Button variant="danger" onClick={run} disabled={pending}>Archive</Button></>}>
        {failure ? <p role="alert" className="m-0 text-[15px] text-[var(--color-danger-ink)]">{failure}</p> : <span />}
      </Modal>
    </>
  );
}

/* ================================ stage track ================================ */

type StageOption = { id: string; label: string; category: string; probability: number };

/**
 * Where a deal is in the pipeline, drawn as the pipeline itself: every open stage in order, the current one filled,
 * the ones behind it done; Won and Lost as the two ways out. Tapping a stage moves the deal there.
 */
export function StageTrack({ described, opportunity, stages }: { described: Described; opportunity: Row; stages: StageOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [losing, setLosing] = useState<string | null>(null);
  const open = stages.filter((s) => s.category === "Active");
  const won = stages.find((s) => s.category === "Completed");
  const lost = stages.find((s) => s.category === "Cancelled");
  const current = String(opportunity.stage);
  const currentIndex = open.findIndex((s) => s.id === current);
  const category = String(opportunity.stageCategory);
  const rule: ReasonRule = { groups: lost ? [lost.id] : [], field: "lostReason", noteField: "lostNote", title: "Why was it lost?" };

  const moveTo = (stageId: string, extra: Record<string, unknown> = {}) => {
    if (stageId === current) return;
    if (lost && stageId === lost.id && !extra.lostReason) return setLosing(stageId);
    start(async () => {
      const result = await runCommand("verity.relationship.update_opportunity", { id: opportunity.id, version: opportunity.version, patch: { stage: stageId, ...extra } });
      if (!result.ok) return setError(clean(result.message));
      setError(null);
      router.refresh();
    });
  };

  return (
    <section aria-label="Stage" className="glass-card rounded-[12px] p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="m-0 text-[17px] font-semibold">
          {category === "Active" ? `Stage ${currentIndex + 1} of ${open.length}: ${String(opportunity.stageLabel)}` : category === "Completed" ? "Won" : "Lost"}
        </h2>
        {category === "Active" && <span className="text-[15px] text-text-secondary">{String(opportunity.probability)}% likely to close</span>}
        {category !== "Active" && typeof opportunity.closedAt === "string" && <span className="text-[15px] text-text-secondary">on {dayLabel(opportunity.closedAt)}</span>}
      </div>
      <ol className="m-0 flex list-none gap-1 p-0" aria-label="Pipeline stages">
        {open.map((s, i) => {
          const done = category !== "Active" ? category === "Completed" : i < currentIndex;
          const here = s.id === current;
          return (
            <li key={s.id} className="min-w-0 flex-1">
              <button
                type="button"
                disabled={!described.canEdit || pending}
                onClick={() => moveTo(s.id)}
                aria-current={here ? "step" : undefined}
                className="group flex w-full min-w-0 flex-col gap-1.5 text-left disabled:cursor-default"
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    "h-2 w-full rounded-full transition-colors",
                    here ? "bg-accent" : done ? "bg-[var(--color-state-completed)]" : "bg-[var(--color-track)] group-hover:bg-[var(--color-control-strong)]",
                  )}
                />
                <span className={cx("truncate text-[13px]", here ? "font-semibold text-text" : "text-text-secondary")}>{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {described.canEdit && (
        <div className="mt-4 flex flex-wrap gap-2">
          {category === "Active" && currentIndex < open.length - 1 && (
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => moveTo(open[currentIndex + 1]!.id)}>
              Move to {open[currentIndex + 1]!.label}
            </Button>
          )}
          {won && category !== "Completed" && <Button variant="primary" size="sm" disabled={pending} onClick={() => moveTo(won.id)}>Mark won</Button>}
          {lost && category !== "Cancelled" && <Button variant="danger" size="sm" disabled={pending} onClick={() => moveTo(lost.id)}>Mark lost</Button>}
          {category !== "Active" && open[0] && <Button variant="secondary" size="sm" disabled={pending} onClick={() => moveTo(open[Math.max(currentIndex, 0)]?.id ?? open[open.length - 1]!.id)}>Reopen</Button>}
        </div>
      )}
      {error && <p role="alert" className="mb-0 mt-3 text-[14px] text-[var(--color-danger-ink)]">{error}</p>}
      <ReasonSheet
        open={Boolean(losing)}
        rule={rule}
        described={described}
        onClose={() => setLosing(null)}
        onConfirm={(reason, note) => { const id = losing!; setLosing(null); moveTo(id, { lostReason: reason, ...(note ? { lostNote: note } : {}) }); }}
      />
    </section>
  );
}

/* ================================ timeline ================================ */

export type TimelineEntry = {
  id: string;
  kind: "note" | "interaction" | "follow_up" | "change" | "created";
  at: string;
  actor: Ref | null;
  title: string;
  body: string | null;
  meta: Record<string, unknown>;
  on: Array<{ kind: string; id: string; label: string; href: string }>;
};

const INTERACTION_ICON: Record<string, IconName> = { call: "bell", meeting: "people", visit: "locations", email: "mail", message: "remarks" };
const KIND_ICON: Record<TimelineEntry["kind"], IconName> = { note: "remarks", interaction: "bell", follow_up: "clock", change: "revision", created: "plus" };
const KIND_HUE: Record<TimelineEntry["kind"], string> = { note: "olive", interaction: "indigo", follow_up: "purple", change: "slate", created: "teal" };

function dayHeading(iso: string): string {
  const n = daysFromToday(iso);
  if (n === 0) return "Today";
  if (n === -1) return "Yesterday";
  return new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
}

type Target = { companyId?: string; personId?: string; opportunityId?: string };
type ComposerMode = "note" | "call" | "meeting" | "visit" | "follow_up";

function Composer({ target, members, onDone }: { target: Target; members: Ref[]; onDone: () => void }) {
  const [mode, setMode] = useState<ComposerMode>("note");
  const [pending, start] = useTransition();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const modes: Array<{ key: ComposerMode; label: string; icon: IconName }> = [
    { key: "note", label: "Note", icon: "remarks" },
    { key: "call", label: "Call", icon: "bell" },
    { key: "meeting", label: "Meeting", icon: "people" },
    { key: "visit", label: "Visit", icon: "locations" },
    { key: "follow_up", label: "Follow-up", icon: "clock" },
  ];
  const submit = (form: FormData) =>
    start(async () => {
      const text = (k: string) => String(form.get(k) ?? "").trim();
      const local = (k: string) => (text(k) ? new Date(text(k)).toISOString() : undefined);
      const result =
        mode === "note"
          ? await runCommand("verity.relationship.add_note", { ...target, body: text("body") })
          : mode === "follow_up"
            ? await runCommand("verity.relationship.add_follow_up", { ...target, title: text("title"), details: text("details") || undefined, dueAt: local("due"), assigneeId: text("assignee") || null })
            : await runCommand("verity.relationship.log_interaction", {
                ...target,
                kind: mode,
                subject: text("subject"),
                summary: text("summary") || undefined,
                outcome: text("outcome") || undefined,
                occurredAt: local("at"),
                durationMinutes: text("duration") ? Number(text("duration")) : undefined,
                ...(text("next") ? { nextStep: { title: text("next"), dueAt: local("nextDue") } } : {}),
              });
      if (!result.ok) return setFailure(result);
      setFailure(null);
      formRef.current?.reset();
      onDone();
    });

  return (
    <div className="glass-card rounded-[12px] p-3">
      <div role="tablist" aria-label="Add to the timeline" className="mb-3 flex gap-1 overflow-x-auto">
        {modes.map((m) => (
          <button
            key={m.key}
            role="tab"
            type="button"
            aria-selected={mode === m.key}
            onClick={() => { setMode(m.key); setFailure(null); }}
            className={cx(
              "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-pill px-3 text-[14px] font-medium max-sm:min-h-11",
              mode === m.key ? "bg-accent text-accent-on" : "bg-[var(--color-control)] text-text hover:bg-[var(--color-control-strong)]",
            )}
          >
            <Icon name={m.icon} size={15} /> {m.label}
          </button>
        ))}
      </div>
      <form ref={formRef} onSubmit={(e) => { e.preventDefault(); submit(new FormData(e.currentTarget)); }} className="flex flex-col gap-3">
        {mode === "note" && <Textarea name="body" required aria-label="Note" placeholder="What should the team know?" maxLength={20000} />}
        {(mode === "call" || mode === "meeting" || mode === "visit") && (
          <>
            <Input name="subject" required aria-label="What it was about" placeholder={mode === "call" ? "What was the call about?" : mode === "visit" ? "Purpose of the visit" : "Meeting topic"} maxLength={200} />
            <Textarea name="summary" aria-label="Summary" placeholder="What was said or agreed" className="min-h-20" />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="When" htmlFor="ix-at" hint="Leave empty for just now"><Input id="ix-at" name="at" type="datetime-local" /></Field>
              <Field label="Minutes" htmlFor="ix-dur"><Input id="ix-dur" name="duration" type="number" min={0} max={1440} inputMode="numeric" /></Field>
              <Field label="Outcome" htmlFor="ix-out"><Input id="ix-out" name="outcome" placeholder="Quote requested" maxLength={500} /></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
              <Field label="Next step (optional)" htmlFor="ix-next"><Input id="ix-next" name="next" placeholder="Send revised quote" maxLength={200} /></Field>
              <Field label="Due" htmlFor="ix-next-due"><Input id="ix-next-due" name="nextDue" type="datetime-local" /></Field>
            </div>
          </>
        )}
        {mode === "follow_up" && (
          <>
            <Input name="title" required aria-label="What has to be done" placeholder="Call back about the delivery date" maxLength={200} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Due" htmlFor="fu-due"><Input id="fu-due" name="due" type="datetime-local" /></Field>
              <Field label="For" htmlFor="fu-who"><MemberSelect id="fu-who" name="assignee" members={members} /></Field>
            </div>
            <Textarea name="details" aria-label="Details" placeholder="Details (optional)" className="min-h-16" />
          </>
        )}
        {failure && <p role="alert" className="m-0 text-[14px] text-[var(--color-danger-ink)]">{clean(failure.message)}</p>}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving…" : mode === "note" ? "Add note" : mode === "follow_up" ? "Add follow-up" : `Log ${mode}`}
          </Button>
        </div>
      </form>
    </div>
  );
}

function FollowUpCheck({ id, done, title }: { id: string; done: boolean; title: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [optimistic, setOptimistic] = useState(done);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={optimistic}
      aria-label={`${optimistic ? "Reopen" : "Complete"}: ${title}`}
      disabled={pending}
      onClick={() =>
        start(async () => {
          setOptimistic(!optimistic);
          const result = await runCommand(optimistic ? "verity.relationship.reopen_follow_up" : "verity.relationship.complete_follow_up", { id });
          if (!result.ok) setOptimistic(optimistic);
          router.refresh();
        })
      }
      className={cx(
        "grid size-6 shrink-0 place-items-center rounded-full border-2 transition-colors max-sm:size-7",
        optimistic ? "border-[var(--color-state-completed)] bg-[var(--color-state-completed)] text-white" : "border-[var(--color-line-strong)] hover:border-accent",
      )}
    >
      {optimistic && <Icon name="check" size={14} />}
    </button>
  );
}

export function Timeline({ entries, target, members, canWrite }: { entries: TimelineEntry[]; target: Target; members: Ref[]; canWrite: boolean }) {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | "talk" | "changes">("all");
  const shown = entries.filter((e) => (filter === "all" ? true : filter === "talk" ? e.kind === "note" || e.kind === "interaction" || e.kind === "follow_up" : e.kind === "change" || e.kind === "created"));
  const groups = useMemo(() => {
    const out: Array<{ day: string; items: TimelineEntry[] }> = [];
    for (const e of shown) {
      const day = dayHeading(e.at);
      const last = out[out.length - 1];
      if (last?.day === day) last.items.push(e);
      else out.push({ day, items: [e] });
    }
    return out;
  }, [shown]);

  return (
    <div className="flex flex-col gap-4">
      {canWrite && <Composer target={target} members={members} onDone={() => router.refresh()} />}
      <div className="flex items-center gap-1.5">
        {(["all", "talk", "changes"] as const).map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
            className={cx("min-h-8 rounded-pill px-3 text-[13px] font-semibold max-sm:min-h-10", filter === f ? "bg-[var(--color-control-strong)] text-text" : "text-text-secondary hover:bg-[var(--color-control)]")}>
            {f === "all" ? "Everything" : f === "talk" ? "Notes and calls" : "Changes"}
          </button>
        ))}
      </div>
      {groups.length === 0 ? (
        <p className="m-0 rounded-[12px] bg-[var(--color-surface-sunken)] px-5 py-8 text-center text-[15px] text-text-secondary">
          Nothing yet. Log a call, write a note or plan a follow-up, and it appears here with every change to this record.
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.day} aria-label={g.day}>
            <h3 className="m-0 mb-2 px-1 text-[13px] font-semibold uppercase tracking-[0.02em] text-text-secondary">{g.day}</h3>
            <ol className="glass-card m-0 list-none rounded-[12px] p-0">
              {g.items.map((e) => <TimelineItem key={e.id} entry={e} members={members} canWrite={canWrite} />)}
            </ol>
          </section>
        ))
      )}
    </div>
  );
}

/** Edit and remove for the things people write on a timeline. Field changes are history and have no menu. */
function ItemActions({ entry: e, members }: { entry: TimelineEntry; members: Ref[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (key: string, input: unknown, after?: () => void) =>
    start(async () => {
      const result = await runCommand(key, input);
      if (!result.ok) return setError(clean(result.message));
      setError(null);
      after?.();
      router.refresh();
    });
  if (e.kind !== "note" && e.kind !== "interaction" && e.kind !== "follow_up") return null;
  const id = String(e.meta.noteId ?? e.meta.interactionId ?? e.meta.followUpId);
  const archiveKey = e.kind === "note" ? "verity.relationship.archive_note" : e.kind === "interaction" ? "verity.relationship.archive_interaction" : "verity.relationship.archive_follow_up";
  const dueLocal = typeof e.meta.dueAt === "string" ? new Date(new Date(e.meta.dueAt).getTime() - new Date(e.meta.dueAt).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "";
  return (
    <>
      <OverflowMenu label={`Actions for ${e.title}`}>
        {e.kind !== "interaction" && <OverflowMenuItem onClick={() => setEditing(true)}>Edit</OverflowMenuItem>}
        <OverflowMenuItem danger onClick={() => run(archiveKey, { id })}>{e.kind === "follow_up" ? "Cancel follow-up" : "Remove from timeline"}</OverflowMenuItem>
      </OverflowMenu>
      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title={e.kind === "note" ? "Edit note" : "Edit follow-up"}
        width="md"
        footer={
          <>
            <ModalCancel onClose={() => setEditing(false)} />
            <Button type="submit" form={`edit-${e.id}`} variant="primary" disabled={pending}>Save</Button>
          </>
        }
      >
        <form
          id={`edit-${e.id}`}
          className="flex flex-col gap-4"
          onSubmit={(ev) => {
            ev.preventDefault();
            const f = new FormData(ev.currentTarget);
            const text = (k: string) => String(f.get(k) ?? "").trim();
            if (e.kind === "note") run("verity.relationship.edit_note", { id, body: text("body"), version: e.meta.version }, () => setEditing(false));
            else
              run(
                "verity.relationship.edit_follow_up",
                { id, version: e.meta.version, patch: { title: text("title"), details: text("details") || null, dueAt: text("due") ? new Date(text("due")).toISOString() : null, assigneeId: text("assignee") || null } },
                () => setEditing(false),
              );
          }}
        >
          {e.kind === "note" ? (
            <Field label="Note" htmlFor={`n-${e.id}`}><Textarea id={`n-${e.id}`} name="body" defaultValue={e.body ?? ""} required /></Field>
          ) : (
            <>
              <Field label="What has to be done" htmlFor={`t-${e.id}`} required><Input id={`t-${e.id}`} name="title" defaultValue={e.title} required maxLength={200} /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Due" htmlFor={`d-${e.id}`}><Input id={`d-${e.id}`} name="due" type="datetime-local" defaultValue={dueLocal} /></Field>
                <Field label="For" htmlFor={`a-${e.id}`}>
                  <MemberSelect id={`a-${e.id}`} name="assignee" members={members} defaultValue={isRefLike(e.meta.assignee) ? (e.meta.assignee as Ref).id : ""} />
                </Field>
              </div>
              <Field label="Details" htmlFor={`x-${e.id}`}><Textarea id={`x-${e.id}`} name="details" defaultValue={e.body ?? ""} /></Field>
            </>
          )}
          {error && <p role="alert" className="m-0 text-[14px] text-[var(--color-danger-ink)]">{error}</p>}
        </form>
      </Modal>
    </>
  );
}

function TimelineItem({ entry: e, members, canWrite }: { entry: TimelineEntry; members: Ref[]; canWrite: boolean }) {
  const icon = e.kind === "interaction" ? (INTERACTION_ICON[String(e.meta.interactionKind)] ?? "bell") : KIND_ICON[e.kind];
  const hue = KIND_HUE[e.kind];
  const changes = (e.meta.changes as Array<{ field: string; from: string | null; to: string | null }> | undefined) ?? [];
  const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(new Date(e.at));
  return (
    <li className="flex gap-3 border-b border-[var(--color-separator)] px-4 py-3 last:border-b-0">
      <span aria-hidden="true" className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-[9px]" style={{ backgroundColor: `var(--color-hue-${hue}-fill)`, color: `var(--color-hue-${hue}-ink)` }}>
        <Icon name={icon} size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          {e.kind === "follow_up" && <span className="mr-0.5 inline-flex translate-y-1"><FollowUpCheck id={String(e.meta.followUpId)} done={e.meta.status === "done"} title={e.title} /></span>}
          <span className={cx("text-[15px] font-semibold text-text", e.kind === "follow_up" && e.meta.status === "done" && "text-text-secondary line-through")}>
            {e.kind === "change" ? changes.length === 1 ? `${labelFor(changes[0]!.field)} changed` : e.title : e.title}
          </span>
          {e.on.map((o) => (
            <Link key={o.id} href={o.href} className="text-[13px] font-medium text-accent-ink no-underline hover:underline">{o.label}</Link>
          ))}
        </div>
        {e.kind === "change" && changes.length > 0 && (
          <ul className="m-0 mt-1 list-none p-0 text-[14px] text-text-secondary">
            {changes.map((c, i) => (
              <li key={i} className="truncate">
                {changes.length > 1 && <span className="text-text">{labelFor(c.field)}: </span>}
                <span className={c.from ? "line-through decoration-[var(--color-text-tertiary)]" : ""}>{c.from ?? "empty"}</span>
                <span aria-label="changed to"> → </span>
                <span className="font-medium text-text">{c.to ?? "empty"}</span>
              </li>
            ))}
          </ul>
        )}
        {e.body && <p className="m-0 mt-1 whitespace-pre-wrap break-words text-[15px] leading-[21px] text-text">{e.body}</p>}
        {e.kind === "interaction" && (Boolean(e.meta.outcome) || Boolean(e.meta.durationMinutes)) && (
          <p className="m-0 mt-1.5 flex flex-wrap gap-2 text-[13px]">
            {Boolean(e.meta.outcome) && <span className="rounded-full bg-[var(--color-state-completed-fill)] px-2 py-0.5 font-medium text-[var(--color-state-completed-ink)]">{String(e.meta.outcome)}</span>}
            {Boolean(e.meta.durationMinutes) && <span className="text-text-secondary">{String(e.meta.durationMinutes)} min</span>}
          </p>
        )}
        {e.kind === "follow_up" && (
          <p className="m-0 mt-1 flex flex-wrap items-center gap-2 text-[13px] text-text-secondary">
            {typeof e.meta.dueAt === "string" && (
              <span className={cx(e.meta.status !== "done" && daysFromToday(e.meta.dueAt) < 0 && "font-semibold text-[var(--color-danger-ink)]")}>
                Due {relativeDay(e.meta.dueAt)}
              </span>
            )}
            {isRefLike(e.meta.assignee) && <span className="inline-flex items-center gap-1"><Avatar name={e.meta.assignee.label} size={16} /> {e.meta.assignee.label}</span>}
          </p>
        )}
        <p className="m-0 mt-1 text-[13px] text-text-tertiary">
          {e.actor?.label ?? "Verity"} · {time}
        </p>
      </div>
      {canWrite && <div className="-mr-2 -mt-1 shrink-0"><ItemActions entry={e} members={members} /></div>}
    </li>
  );
}

const isRefLike = (v: unknown): v is Ref => typeof v === "object" && v !== null && "label" in v;
const FIELD_WORDS: Record<string, string> = {
  stage: "Stage", owner: "Owner", amount: "Amount", company: "Company", contact: "Point of contact", expectedCloseOn: "Expected close",
  submissionDueOn: "Bid due", source: "Source", name: "Name", lostReason: "Lost reason", lostNote: "Lost note", jobTitle: "Job title",
  emails: "Emails", phones: "Phones", givenName: "First name", familyName: "Last name", domain: "Domain", industry: "Industry",
  city: "City", sizeBand: "Employees", taxId: "GSTIN", record: "Record", note: "Note", region: "State", country: "Country", phone: "Phone", email: "Email",
};
const labelFor = (f: string) => FIELD_WORDS[f] ?? f.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

/* ================================ follow-up queue ================================ */

export type FollowUpRow = {
  id: string; title: string; details: string | null; status: string; dueAt: string | null; doneAt: string | null; overdue: boolean;
  assignee: Ref | null; on: Array<{ kind: string; id: string; label: string; href: string }>;
};

/** Follow-ups as a to-do list in the order they need doing: overdue, today, this week, later, undated. */
export function FollowUpQueue({ rows, done }: { rows: FollowUpRow[]; done: boolean }) {
  const buckets = useMemo(() => {
    if (done) return [{ key: "done", label: "Done", tone: "neutral" as const, items: rows }];
    const b = { overdue: [] as FollowUpRow[], today: [] as FollowUpRow[], week: [] as FollowUpRow[], later: [] as FollowUpRow[], none: [] as FollowUpRow[] };
    for (const r of rows) {
      if (!r.dueAt) b.none.push(r);
      else if (r.overdue) b.overdue.push(r);
      else {
        const n = daysFromToday(r.dueAt);
        if (n <= 0) b.today.push(r);
        else if (n <= 7) b.week.push(r);
        else b.later.push(r);
      }
    }
    return [
      { key: "overdue", label: "Overdue", tone: "danger" as const, items: b.overdue },
      { key: "today", label: "Today", tone: "warning" as const, items: b.today },
      { key: "week", label: "Next 7 days", tone: "info" as const, items: b.week },
      { key: "later", label: "Later", tone: "neutral" as const, items: b.later },
      { key: "none", label: "No date", tone: "neutral" as const, items: b.none },
    ].filter((x) => x.items.length);
  }, [rows, done]);

  if (!rows.length) {
    return (
      <div className="glass-card rounded-[12px] px-6 py-12 text-center">
        <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-[var(--color-state-completed-fill)] text-[var(--color-state-completed-ink)]"><Icon name="check" size={24} /></div>
        <p className="m-0 text-[17px] font-semibold text-text">{done ? "Nothing completed yet" : "All caught up"}</p>
        <p className="m-0 mx-auto mt-1 max-w-[46ch] text-[15px] text-text-secondary">{done ? "Completed follow-ups appear here." : "Plan a follow-up from any company, person or opportunity and it lands here on its due day."}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {buckets.map((bucket) => (
        <section key={bucket.key} aria-label={bucket.label}>
          <h2 className="m-0 mb-2 flex items-center gap-2 px-1 text-[13px] font-semibold uppercase tracking-[0.02em] text-text-secondary">
            <OptionPill option={{ value: bucket.key, label: `${bucket.label} · ${bucket.items.length}`, tone: bucket.tone }} />
          </h2>
          <ul className="glass-card m-0 list-none rounded-[12px] p-0">
            {bucket.items.map((f) => (
              <li key={f.id} className="flex items-start gap-3 border-b border-[var(--color-separator)] px-4 py-3 last:border-b-0">
                <span className="mt-0.5"><FollowUpCheck id={f.id} done={f.status === "done"} title={f.title} /></span>
                <div className="min-w-0 flex-1">
                  <p className={cx("m-0 text-[16px] font-medium text-text", f.status === "done" && "text-text-secondary line-through")}>{f.title}</p>
                  {f.details && <p className="m-0 mt-0.5 line-clamp-2 text-[14px] text-text-secondary">{f.details}</p>}
                  <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-text-secondary">
                    {f.on.map((o) => <Link key={o.id} href={o.href} className="font-medium text-accent-ink no-underline hover:underline">{o.label}</Link>)}
                    {f.assignee && <span className="inline-flex items-center gap-1"><Avatar name={f.assignee.label} size={16} />{f.assignee.label}</span>}
                  </p>
                </div>
                <span className={cx("tabular shrink-0 text-[14px]", f.overdue ? "font-semibold text-[var(--color-danger-ink)]" : "text-text-secondary")}>
                  {done ? (f.doneAt ? relativeTime(f.doneAt) : "") : f.dueAt ? relativeDay(f.dueAt) : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/* ================================ small summary pieces ================================ */

/** "₹18.5L open · 2 deals" facts row under a record title. */
export function FactRow({ items }: { items: Array<{ label: string; value: ReactNode; tone?: "danger" | "success" }> }) {
  return (
    <dl className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-[12px] bg-[var(--color-separator)] sm:grid-cols-4">
      {items.map((i) => (
        <div key={i.label} className="bg-[var(--color-surface)] px-4 py-3">
          <dt className="text-[13px] text-text-secondary">{i.label}</dt>
          <dd className={cx("tabular m-0 mt-0.5 text-[22px] font-bold leading-[28px]", i.tone === "danger" ? "text-[var(--color-danger-ink)]" : i.tone === "success" ? "text-[var(--color-state-completed-ink)]" : "text-text")}>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export { moneyShort };
