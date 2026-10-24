"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { DateField } from "@/components/ui/DateTimePicker";
import { FormModal } from "@/components/ui/CommandForm";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import { BASIS_LABEL, toPaise } from "../lots/format";
import { parseKarigarList } from "./import-list";

const DEFINE = "verity.piecework.define_worker";
const IMPORT = "verity.piecework.import_workers";

export type SupervisorChoice = { userId: string; name: string; roleName: string | null };
export type ProfileValues = { joinedOn: string | null; idNote: string | null; emergencyContact: string | null; supervisorUserId: string | null };

/**
 * The profile fields shared by the new-karigar sheet and the edit sheet: who looks after them, when they joined, an ID note
 * and an emergency contact. Read from the form by name; the date rides in a hidden input because the calendar is a controlled field.
 */
export function ProfileFields({ supervisors, initial, idPrefix }: { supervisors: SupervisorChoice[]; initial?: Partial<ProfileValues>; idPrefix: string }) {
  const [joined, setJoined] = useState(initial?.joinedOn ?? "");
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Looked after by" htmlFor={`${idPrefix}-supervisor`} hint="Their give-out list shows this karigar. Leave open for any supervisor.">
        <Select id={`${idPrefix}-supervisor`} name="supervisor" defaultValue={initial?.supervisorUserId ?? ""}>
          <option value="">Any supervisor</option>
          {supervisors.map((s) => <option key={s.userId} value={s.userId}>{s.name}{s.roleName ? ` (${s.roleName})` : ""}</option>)}
        </Select>
      </Field>
      <Field label="Joined on" htmlFor={`${idPrefix}-joined`}>
        <DateField id={`${idPrefix}-joined`} value={joined} onChange={setJoined} placeholder="Pick a date" />
        <input type="hidden" name="joinedOn" value={joined} />
      </Field>
      <Field label="ID note" htmlFor={`${idPrefix}-idnote`} hint="Aadhaar last four, PAN, or whatever the factory keeps"><Input id={`${idPrefix}-idnote`} name="idNote" maxLength={300} defaultValue={initial?.idNote ?? ""} /></Field>
      <Field label="Emergency contact" htmlFor={`${idPrefix}-emergency`} hint="Name and number"><Input id={`${idPrefix}-emergency`} name="emergencyContact" maxLength={300} defaultValue={initial?.emergencyContact ?? ""} /></Field>
    </div>
  );
}

export function NewKarigarForm({ stages, supervisors }: { stages: Array<{ id: string; label: string }>; supervisors: SupervisorChoice[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <CommandButton commands={DEFINE} variant="primary" onClick={() => setOpen(true)}>New karigar or unit</CommandButton>
      <FormModal
        open={open} onClose={() => setOpen(false)} title="New karigar or outside unit" description="Name, contact, and for each kind of work the rate per piece and what it is paid on. A rate of 0 means the work is unpaid." width="lg"
        submitLabel="Add karigar" pendingLabel="Adding…"
        pending={pending} failure={failure} failureTitle="Could not add the karigar"
        onSubmit={(formData) => {
            setFailure(null);
            const text = (name: string) => String(formData.get(name) ?? "").trim();
            const rates = stages.flatMap((s) => {
              const paise = toPaise(text(`rate:${s.id}`));
              return paise === null ? [] : [{ stageId: s.id, rateMinor: paise, wageBasis: text(`basis:${s.id}`) || "good" }];
            });
            startTransition(async () => {
              const result = await runCommand<{ id: string }>(DEFINE, { name: text("name"), mobile: text("mobile") || undefined, kind: text("kind") || "in_house", address: text("address") || undefined, rates, joinedOn: text("joinedOn") || undefined, idNote: text("idNote") || undefined, emergencyContact: text("emergencyContact") || undefined, supervisorUserId: text("supervisor") || undefined }, "/karigars");
              if (result.ok) {
                setOpen(false);
                router.push(`/karigars/${result.data!.id}`);
              } else setFailure(result);
            });
          }}
      >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="karigar-name" required><Input id="karigar-name" name="name" required maxLength={120} autoFocus /></Field>
            <Field label="Mobile number" htmlFor="karigar-mobile"><Input id="karigar-mobile" name="mobile" type="tel" inputMode="tel" maxLength={20} /></Field>
            <Field label="Works" htmlFor="karigar-kind">
              <Select id="karigar-kind" name="kind" defaultValue="in_house">
                <option value="in_house">In the factory</option>
                <option value="outside">Outside unit</option>
              </Select>
            </Field>
            <Field label="Address" htmlFor="karigar-address"><Input id="karigar-address" name="address" maxLength={300} /></Field>
          </div>
          <ProfileFields supervisors={supervisors} idPrefix="karigar" />
          <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
            <legend className="mb-1 text-[13px] font-medium text-text">Rate per piece, in rupees, for the work this karigar does (leave blank for work they do not do)</legend>
            {stages.map((s) => (
              <div key={s.id} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_9rem_1fr]">
                <span className="self-center text-[14px] text-text">{s.label}</span>
                <Field label="Rate" htmlFor={`rate-${s.id}`}><Input id={`rate-${s.id}`} name={`rate:${s.id}`} type="number" inputMode="decimal" min={0} step="0.01" placeholder="e.g. 12" /></Field>
                <Field label="Paid on" htmlFor={`basis-${s.id}`}>
                  <Select id={`basis-${s.id}`} name={`basis:${s.id}`} defaultValue="good">
                    {Object.entries(BASIS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </Field>
              </div>
            ))}
          </fieldset>
      </FormModal>
    </>
  );
}

/**
 * Launch day: paste the whole karigar list from Excel (name, mobile, in the factory or outside, address) and add them in one go.
 * Names already in the system are skipped and listed. Rates are set afterwards on each karigar's page.
 */
export function ImportKarigars() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [done, setDone] = useState<{ created: number; skipped: string[] } | null>(null);
  const [pending, startTransition] = useTransition();
  const parsed = parseKarigarList(text);
  const close = () => { setOpen(false); setText(""); setFailure(null); setDone(null); };

  return (
    <>
      <CommandButton commands={IMPORT} onClick={() => setOpen(true)}>Import a list</CommandButton>
      <FormModal
        open={open} onClose={close} width="lg" title="Import karigars from a list"
        description="Paste rows from Excel: name, mobile, in the factory or outside, address. Only the name is needed. Rates are set afterwards on each karigar's page."
        submitLabel={done ? "Done" : `Add ${parsed.rows.length} karigar${parsed.rows.length === 1 ? "" : "s"}`} pendingLabel="Adding…"
        submitDisabled={done === null && parsed.rows.length === 0}
        pending={pending} failure={failure} failureTitle="The list was not added"
        onSubmit={() => {
          if (done) { close(); return; }
          setFailure(null);
          startTransition(async () => {
            const result = await runCommand<{ created: number; skipped: string[] }>(IMPORT, { rows: parsed.rows }, "/karigars");
            if (result.ok) { setDone(result.data!); router.refresh(); } else setFailure(result);
          });
        }}
      >
        {done ? (
          <div role="status" className="flex flex-col gap-2 rounded-[12px] bg-[var(--color-control)] px-4 py-3 text-[15px] text-text">
            <p className="m-0 font-medium">{done.created} added{done.skipped.length > 0 ? `, ${done.skipped.length} already here` : ""}.</p>
            {done.skipped.length > 0 && <p className="m-0 text-[13px] text-text-secondary">Skipped: {done.skipped.join(", ")}</p>}
          </div>
        ) : (
          <>
            <Field label="The list" htmlFor="import-list" hint="One person per line. Tabs or commas between the columns.">
              <Textarea id="import-list" value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder={"Ravi Kumar\t98765 43210\tIn\tModel Town\nSharma Works\t98140 11002\tOutside\tFocal Point"} spellCheck={false} />
            </Field>
            {text.trim() !== "" && (
              <div role="status" className="flex flex-col gap-1.5 rounded-[12px] bg-[var(--color-control)] px-4 py-3 text-[14px] text-text">
                <p className="m-0 font-medium">{parsed.rows.length} ready to add{parsed.problems.length > 0 ? `, ${parsed.problems.length} to fix` : ""}</p>
                {parsed.problems.slice(0, 6).map((p) => <p key={p} className="m-0 text-[13px]" style={{ color: "var(--color-state-blocked)" }}>{p}</p>)}
                {parsed.problems.length > 6 && <p className="m-0 text-[13px] text-text-secondary">and {parsed.problems.length - 6} more</p>}
              </div>
            )}
          </>
        )}
      </FormModal>
    </>
  );
}