"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { FormModal, formText, useCommand } from "@/components/ui/CommandForm";

export type DocumentTypeOption = {
  id: string;
  key: string;
  label: string;
  pattern: string;
  segments: Array<{ key: string; label: string; options: Array<{ code: string; label: string }> }>;
  validMonths: number | null;
  requiresApproval: boolean;
};

/** What a number will look like once the codes are chosen, so the person sees the rule rather than guessing it. */
function previewNumber(type: DocumentTypeOption, chosen: Record<string, string>): string {
  return type.pattern
    .replace(/\{TYPE\}/g, type.key.toUpperCase())
    .replace(/\{YEAR\}/g, String(new Date().getFullYear()))
    .replace(/\{SEG:([a-z0-9_]+)\}/g, (_, key: string) => chosen[key] || "?")
    .replace(/\{SEQ:(\d+)\}/g, (_, n: string) => "0".repeat(Math.max(Number(n) - 1, 0)) + "1");
}

/** New document: pick the type, then the client and division the number is built from. Opens as a sheet. */
export function CreateDocumentButton({ types }: { types: DocumentTypeOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const { run, pending, failure, clear } = useCommand("/documents");
  const type = types.find((t) => t.id === typeId);

  const close = () => {
    setOpen(false);
    clear();
  };

  return (
    <>
      <CommandButton commands="verity.document.create" variant="primary" onClick={() => setOpen(true)} disabled={types.length === 0}>
        New document
      </CommandButton>
      <FormModal
        title="New document"
        description="It gets its number now and starts as a draft, revision R01."
        open={open}
        onClose={close}
        submitLabel="Create document"
        pending={pending}
        failure={failure}
        failureTitle="Could not create the document"
        onSubmit={(form) =>
          run<{ id: string }>(
            "verity.document.create",
            {
              typeId,
              title: formText(form, "title"),
              classification: formText(form, "classification") || "internal",
              segments: chosen,
            },
            (data) => {
              close();
              router.push(`/documents/${data.id}`);
            },
          )
        }
      >
        <Field label="Type" htmlFor="doc-type" required>
          <Select id="doc-type" value={typeId} onChange={(e) => { setTypeId(e.target.value); setChosen({}); }}>
            {types.map((t) => (<option key={t.id} value={t.id}>{t.label}</option>))}
          </Select>
        </Field>

        {type?.segments.map((s) => (
          <Field key={s.key} label={s.label} htmlFor={`seg-${s.key}`} required>
            <Select id={`seg-${s.key}`} required value={chosen[s.key] ?? ""} onChange={(e) => setChosen((c) => ({ ...c, [s.key]: e.target.value }))}>
              <option value="" disabled>Choose…</option>
              {s.options.map((o) => (<option key={o.code} value={o.code}>{o.code} · {o.label}</option>))}
            </Select>
          </Field>
        ))}

        {type && (
          <p className="m-0 rounded-[10px] bg-[var(--color-surface-sunken)] px-3 py-2 text-[13px] text-text-secondary">
            Number: <span className="tabular font-semibold text-text">{previewNumber(type, chosen)}</span>
            {type.validMonths ? ` · valid ${type.validMonths} months from release` : " · does not expire"}
            {type.requiresApproval ? " · needs a second person to release" : " · released when you submit it"}
          </p>
        )}

        <Field label="Title" htmlFor="doc-title" required>
          <Input id="doc-title" name="title" required minLength={3} maxLength={200} autoFocus placeholder="e.g. Coil winding jig, general arrangement" />
        </Field>

        <Field label="Who may see it" htmlFor="doc-class" hint="Customer-facing is a label only; it does not publish anything.">
          <Select id="doc-class" name="classification" defaultValue="internal">
            <option value="internal">Internal</option>
            <option value="customer">Customer-facing</option>
          </Select>
        </Field>
      </FormModal>
    </>
  );
}

/** A type's key, made from what the person typed: "Test certificate" -> "test_certificate". */
function typeKeyFor(label: string): string {
  const key = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30);
  return /^[a-z]/.test(key) ? key : `t_${key}`.slice(0, 30);
}

/**
 * One segment per line: `client | Client | A=Atomic Research Centre, B=Bharat Heavy`. The first part is the name the
 * number rule uses ({SEG:client}), then the label people see, then the codes a person picks from.
 */
export function parseSegmentLines(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [key = "", label = "", rest = ""] = line.split("|").map((p) => p.trim());
      return {
        key: key.toLowerCase(),
        label,
        options: rest
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean)
          .map((o) => {
            const [code = "", ...name] = o.split("=");
            return { code: code.trim(), label: name.join("=").trim() || code.trim() };
          }),
      };
    });
}

/** Numbering: define a document type and the rule its numbers are built from. The client owns this, not us. */
export function CreateTypeButton() {
  const [open, setOpen] = useState(false);
  const { run, pending, failure, clear } = useCommand("/documents");
  const close = () => {
    setOpen(false);
    clear();
  };
  return (
    <>
      <CommandButton commands="verity.document.define_type" variant="secondary" onClick={() => setOpen(true)}>
        Numbering
      </CommandButton>
      <FormModal
        title="Document type and numbering"
        description="Say what kind of document this is and how its number is built. You can add more types later."
        open={open}
        onClose={close}
        submitLabel="Add type"
        pending={pending}
        failure={failure}
        failureTitle="Could not add the type"
        width="lg"
        onSubmit={(form) => {
          const label = formText(form, "label");
          const months = formText(form, "validMonths");
          const segments = parseSegmentLines(formText(form, "segments"));
          run(
            "verity.document.define_type",
            {
              key: typeKeyFor(label),
              label,
              pattern: formText(form, "pattern"),
              ...(segments.length > 0 ? { segments } : {}),
              requiresApproval: form.get("requiresApproval") === "on",
              ...(months ? { validMonths: Number(months) } : {}),
            },
            () => close(),
          );
        }}
      >
        <Field label="Name" htmlFor="type-label" required>
          <Input id="type-label" name="label" required maxLength={80} autoFocus placeholder="e.g. Drawing" />
        </Field>
        <Field
          label="Number rule"
          htmlFor="type-pattern"
          required
          hint="Use {TYPE}, {YEAR}, {SEG:name} for a code someone picks, and exactly one {SEQ:3} for the running number."
        >
          <Input id="type-pattern" name="pattern" required maxLength={120} placeholder="IN-{SEG:client}{SEG:division}-{TYPE}-{SEQ:3}" />
        </Field>
        <Field
          label="Codes to pick from (optional)"
          htmlFor="type-segments"
          hint="One list per line: name | label | code=meaning, code=meaning. A client with documents already continues its own running number."
        >
          <Textarea
            id="type-segments"
            name="segments"
            rows={4}
            placeholder={"client | Client | A=Atomic Research Centre, B=Bharat Heavy\ndivision | Division | 3=Magnets, 4=Transformers"}
          />
        </Field>
        <Field label="Valid for (months)" htmlFor="type-months" hint="Leave empty if documents of this type do not expire.">
          <Input id="type-months" name="validMonths" inputMode="numeric" pattern="[0-9]*" maxLength={3} />
        </Field>
        <label className="flex min-h-11 items-center gap-2 text-[15px] text-text">
          <input type="checkbox" name="requiresApproval" defaultChecked className="size-5 accent-[var(--color-accent)]" />
          A second person must release it
        </label>
      </FormModal>
    </>
  );
}
