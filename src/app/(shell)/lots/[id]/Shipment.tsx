"use client";

import Link from "next/link";
import { useState } from "react";
import { CommandButton } from "@/components/ui/CommandAccess";
import { FormModal, useCommand } from "@/components/ui/CommandForm";
import { DateField } from "@/components/ui/DateTimePicker";
import { Field, Input, Row, RowList, Select, StateBadge } from "@/components/ui/primitives";
import { AQL_VALUES, INSPECTION_LEVELS, samplingPlan, type AqlValue, type InspectionLevel } from "@/lib/aql";
import type { InspectionRow, PackingListSummary } from "@/server/capabilities/piecework";
import { shortDate } from "../format";

const RECORD = "verity.piecework.record_inspection";
const REVERSE = "verity.piecework.reverse_inspection";
const CREATE_PL = "verity.piecework.create_packing_list";
const CANCEL_PL = "verity.piecework.cancel_packing_list";

const n = (s: string) => (s.trim() === "" ? NaN : Number(s));
const kg = (grams: number) => `${(grams / 1000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`;
const cbm = (milli: number) => `${(milli / 1000).toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} m³`;
const verdict = (r: "pass" | "fail") => <StateBadge category={r === "pass" ? "Completed" : "Blocked"} label={r === "pass" ? "Passed" : "Failed"} />;

/**
 * Inspections of this lot against the AQL table. The form reads the plan as the pieces and AQLs are typed (sample size, how many major
 * and minor defects still pass), so the checker counts the right number of garments before writing anything down.
 */
export function Inspections({ lotId, rows, offered, today, canRecord, canReverse }: {
  lotId: string; rows: InspectionRow[]; offered: number; today: string; canRecord: boolean; canReverse: boolean;
}) {
  const record = useCommand(`/lots/${lotId}`);
  const reverse = useCommand(`/lots/${lotId}`);
  const [open, setOpen] = useState(false);
  const [undo, setUndo] = useState<InspectionRow | null>(null);
  const [kind, setKind] = useState<"final" | "inline">("final");
  const [pieces, setPieces] = useState(String(offered || ""));
  const [level, setLevel] = useState<InspectionLevel>("II");
  const [major, setMajor] = useState<AqlValue>("2.5");
  const [minor, setMinor] = useState<AqlValue>("4.0");
  const [found, setFound] = useState({ critical: "0", major: "0", minor: "0" });
  const [day, setDay] = useState(today);

  const lotSize = n(pieces);
  const plan = Number.isInteger(lotSize) && lotSize >= 2 ? samplingPlan(lotSize, level, major, minor) : null;
  const counts = { critical: n(found.critical), major: n(found.major), minor: n(found.minor) };
  const countsOk = Object.values(counts).every((c) => Number.isInteger(c) && c >= 0);
  const outcome = plan && countsOk ? (counts.critical === 0 && counts.major <= plan.acceptMajor && counts.minor <= plan.acceptMinor ? "pass" : "fail") : null;

  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 ? (
        <p className="m-0 text-[14px] leading-[21px] text-text-secondary">No inspection recorded. A final inspection to the buyer&apos;s AQL is what most buyers ask for before the goods leave.</p>
      ) : (
        <RowList>
          {rows.map((r) => (
            <Row key={r.id}>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 text-[15px] font-medium text-text">
                  {verdict(r.result)} {r.kind === "final" ? "Final" : "Inline"} · {r.inspector}
                </span>
                <span className="text-[13px] tabular-nums text-text-secondary">
                  {shortDate(r.inspectedOn)} · {r.sampleSize} of {r.offeredPieces.toLocaleString("en-IN")} checked (level {r.level}, letter {r.codeLetter}) · found {r.criticalFound} critical, {r.majorFound}/{r.acceptMajor} major, {r.minorFound}/{r.acceptMinor} minor
                </span>
                {r.note && <span className="text-[13px] text-text-secondary">{r.note}</span>}
              </div>
              {canReverse && <CommandButton commands={REVERSE} variant="ghost" size="sm" onClick={() => { reverse.clear(); setUndo(r); }}>Reverse</CommandButton>}
            </Row>
          ))}
        </RowList>
      )}
      {canRecord && (
        <div>
          <CommandButton commands={RECORD} variant="secondary" onClick={() => { record.clear(); setOpen(true); }}>Record an inspection</CommandButton>
        </div>
      )}

      <FormModal
        open={open} onClose={() => setOpen(false)} width="lg"
        title="Record an inspection" description="AQL single sampling, normal inspection (ISO 2859-1). Critical defects are never accepted."
        submitLabel={outcome === "fail" ? "Record as failed" : "Record inspection"} submitDisabled={!plan || !countsOk}
        pending={record.pending} failure={record.failure} failureTitle="The inspection was not recorded"
        onSubmit={(fd) => record.run(RECORD, {
          lotId, kind, inspectedOn: day || undefined, inspector: String(fd.get("inspector") ?? "").trim(), offeredPieces: lotSize, level, aqlMajor: major, aqlMinor: minor,
          criticalFound: counts.critical, majorFound: counts.major, minorFound: counts.minor, note: String(fd.get("note") ?? "").trim() || undefined,
        }, () => setOpen(false))}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Inspection" htmlFor="in-kind">
            <Select id="in-kind" value={kind} onChange={(e) => setKind(e.target.value as "final" | "inline")}>
              <option value="final">Final, before shipment</option>
              <option value="inline">Inline, during making</option>
            </Select>
          </Field>
          <Field label="Inspected by" htmlFor="in-who" required><Input id="in-who" name="inspector" required minLength={2} maxLength={120} placeholder="own checker, buyer QC, agency" /></Field>
          <Field label="Date" htmlFor="in-day"><DateField id="in-day" value={day} onChange={setDay} /></Field>
          <Field label="Pieces offered" htmlFor="in-pcs" required><Input id="in-pcs" type="number" inputMode="numeric" min={2} value={pieces} onChange={(e) => setPieces(e.target.value)} /></Field>
          <Field label="Level" htmlFor="in-level">
            <Select id="in-level" value={level} onChange={(e) => setLevel(e.target.value as InspectionLevel)}>
              {INSPECTION_LEVELS.map((l) => <option key={l} value={l}>General {l}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="AQL major" htmlFor="in-major">
              <Select id="in-major" value={major} onChange={(e) => setMajor(e.target.value as AqlValue)}>{AQL_VALUES.map((a) => <option key={a} value={a}>{a}</option>)}</Select>
            </Field>
            <Field label="AQL minor" htmlFor="in-minor">
              <Select id="in-minor" value={minor} onChange={(e) => setMinor(e.target.value as AqlValue)}>{AQL_VALUES.map((a) => <option key={a} value={a}>{a}</option>)}</Select>
            </Field>
          </div>
        </div>

        {plan && (
          <div role="status" className="flex flex-wrap items-end gap-x-8 gap-y-3 rounded-[12px] bg-[var(--color-control)] px-4 py-3">
            <div><p className="micro m-0">Check</p><p className="figure m-0 text-[32px] text-text">{plan.sampleSize}</p><p className="m-0 text-[13px] text-text-secondary">{plan.hundredPercent ? "every piece" : `pieces · letter ${plan.codeLetter}`}</p></div>
            <div><p className="micro m-0">Major passes at</p><p className="figure m-0 text-[32px] text-text">≤ {plan.acceptMajor}</p></div>
            <div><p className="micro m-0">Minor passes at</p><p className="figure m-0 text-[32px] text-text">≤ {plan.acceptMinor}</p></div>
          </div>
        )}

        <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0 sm:grid-cols-3">
          <legend className="mb-1 px-1 text-[15px] font-medium text-text">Defects found in the sample</legend>
          {(["critical", "major", "minor"] as const).map((k) => (
            <Field key={k} label={k[0]!.toUpperCase() + k.slice(1)} htmlFor={`in-${k}`}>
              <Input id={`in-${k}`} type="number" inputMode="numeric" min={0} value={found[k]} onChange={(e) => setFound({ ...found, [k]: e.target.value })} />
            </Field>
          ))}
        </fieldset>
        {outcome && <p role="status" className="m-0 flex items-center gap-2 text-[14px] text-text">{verdict(outcome)} {outcome === "pass" ? "Within the AQL." : counts.critical > 0 ? "A critical defect fails the lot." : "Over the acceptance number."}</p>}
        <Field label="Note" htmlFor="in-note"><Input id="in-note" name="note" maxLength={500} placeholder="main defects, report number" /></Field>
      </FormModal>

      <FormModal
        open={undo !== null} onClose={() => setUndo(null)} destructive
        title="Reverse this inspection?" description="It stays in the record with its reversal beside it. Record it again if it was entered wrongly."
        submitLabel="Reverse it" pendingLabel="Reversing…"
        pending={reverse.pending} failure={reverse.failure} failureTitle="It was not reversed"
        onSubmit={(fd) => { if (undo) reverse.run(REVERSE, { inspectionId: undo.id, reason: String(fd.get("reason") ?? "").trim() }, () => setUndo(null)); }}
      >
        <Field label="Why?" htmlFor="in-why" required><Input id="in-why" name="reason" required minLength={3} maxLength={300} autoFocus /></Field>
      </FormModal>
    </div>
  );
}

type Line = { cartons: string; colour: string; qty: string[]; net: string; gross: string; l: string; w: string; h: string };
const blankLine = (sizes: number, prev?: Line): Line => ({ cartons: "", colour: prev?.colour ?? "", qty: Array(sizes).fill(""), net: prev?.net ?? "", gross: prev?.gross ?? "", l: prev?.l ?? "60", w: prev?.w ?? "40", h: prev?.h ?? "40" });

/** Carton numbers follow the order of the lines; weights typed in kg become grams. */
function buildCartons(lines: Line[], sizes: string[]) {
  const out = [];
  let next = 1;
  for (const l of lines) {
    const count = n(l.cartons);
    const from = next;
    const to = Number.isInteger(count) && count >= 1 ? from + count - 1 : from - 1;
    next = to + 1;
    const qty = sizes.map((size, i) => ({ size, qty: n(l.qty[i] ?? "") })).filter((s) => Number.isInteger(s.qty) && s.qty > 0);
    out.push({
      ok: to >= from && qty.length > 0 && n(l.net) > 0 && n(l.gross) >= n(l.net) && [l.l, l.w, l.h].every((d) => Number.isInteger(n(d)) && n(d) > 0),
      from, to, perCarton: qty.reduce((s, x) => s + x.qty, 0),
      line: { from, to, colour: l.colour.trim() || undefined, sizes: qty, netGrams: Math.round(n(l.net) * 1000), grossGrams: Math.round(n(l.gross) * 1000), lengthCm: n(l.l), widthCm: n(l.w), heightCm: n(l.h) },
    });
  }
  return out;
}

/**
 * The lot's packing lists and a sheet to make one. The sizes are named once for the list; each line is a run of identical cartons with
 * the pieces of each size in one carton. Carton numbers are given in order, so a list cannot have a gap or a carton twice.
 */
export function PackingLists({ lotId, lists, readyToPack, today, canCreate, canCancel }: {
  lotId: string; lists: PackingListSummary[]; readyToPack: number; today: string; canCreate: boolean; canCancel: boolean;
}) {
  const create = useCommand(`/lots/${lotId}`);
  const cancel = useCommand(`/lots/${lotId}`);
  const [open, setOpen] = useState(false);
  const [undo, setUndo] = useState<PackingListSummary | null>(null);
  const [sizesText, setSizesText] = useState("S, M, L, XL");
  const [lines, setLines] = useState<Line[]>([blankLine(4)]);
  const [day, setDay] = useState(today);

  const sizes = sizesText.split(",").map((s) => s.trim()).filter(Boolean);
  const setSizes = (text: string) => {
    const next = text.split(",").map((s) => s.trim()).filter(Boolean);
    setSizesText(text);
    setLines(lines.map((l) => ({ ...l, qty: next.map((_, i) => l.qty[i] ?? "") })));
  };
  const patch = (i: number, p: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));

  const built = buildCartons(lines, sizes);
  const pieces = built.reduce((s, b) => s + (b.to >= b.from ? (b.to - b.from + 1) * b.perCarton : 0), 0);
  const cartons = (built.at(-1)?.to ?? 0);
  const ready = built.length > 0 && built.every((b) => b.ok) && new Set(sizes.map((s) => s.toLowerCase())).size === sizes.length;
  const over = pieces > readyToPack;

  return (
    <div className="flex flex-col gap-4">
      {lists.length === 0 ? (
        <p className="m-0 text-[14px] leading-[21px] text-text-secondary">No packing list yet. {readyToPack > 0 ? `${readyToPack.toLocaleString("en-IN")} ready pieces can be packed.` : "Pieces can be packed once the last stage takes them back as good."}</p>
      ) : (
        <RowList>
          {lists.map((p) => (
            <Row key={p.id} className={p.cancelled ? "opacity-70" : ""}>
              <Link href={`/lots/${lotId}/packing/${p.id}`} className="flex min-w-0 flex-1 flex-col gap-0.5 text-text no-underline hover:underline active:opacity-70">
                <span className="text-[15px] font-medium">{p.number} · {p.buyer}{p.cancelled ? " · cancelled" : ""}</span>
                <span className="text-[13px] tabular-nums text-text-secondary">
                  {shortDate(p.packedOn)} · {p.totals.cartons} cartons · {p.totals.pieces.toLocaleString("en-IN")} pcs · {kg(p.totals.grossGrams)} gross · {cbm(p.totals.cbmMilli)}{p.reference ? ` · ${p.reference}` : ""}
                </span>
                {p.cancelled && p.cancelReason && <span className="text-[13px] text-text-secondary">{p.cancelReason}</span>}
              </Link>
              {canCancel && !p.cancelled && <CommandButton commands={CANCEL_PL} variant="ghost" size="sm" onClick={() => { cancel.clear(); setUndo(p); }}>Cancel</CommandButton>}
            </Row>
          ))}
        </RowList>
      )}
      {canCreate && readyToPack > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <CommandButton commands={CREATE_PL} variant="secondary" onClick={() => { create.clear(); setOpen(true); }}>Make a packing list</CommandButton>
          <span className="text-[13px] text-text-secondary">{readyToPack.toLocaleString("en-IN")} ready pieces not yet packed</span>
        </div>
      )}

      <FormModal
        open={open} onClose={() => setOpen(false)} width="lg"
        title="Make a packing list" description="Name the sizes once, then add a line for each run of identical cartons. Carton numbers are given in order."
        submitLabel={ready && !over ? `Save ${cartons} cartons, ${pieces.toLocaleString("en-IN")} pcs` : "Save packing list"} submitDisabled={!ready || over}
        pending={create.pending} failure={create.failure} failureTitle="The packing list was not saved"
        onSubmit={(fd) => create.run(CREATE_PL, {
          lotId, buyer: String(fd.get("buyer") ?? "").trim(), reference: String(fd.get("reference") ?? "").trim() || undefined,
          destination: String(fd.get("destination") ?? "").trim() || undefined, packedOn: day || undefined, cartons: built.map((b) => b.line),
          note: String(fd.get("note") ?? "").trim() || undefined,
        }, () => { setOpen(false); setLines([blankLine(sizes.length)]); })}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Buyer" htmlFor="pl-buyer" required><Input id="pl-buyer" name="buyer" required minLength={2} maxLength={120} /></Field>
          <Field label="Order and invoice number" htmlFor="pl-ref"><Input id="pl-ref" name="reference" maxLength={80} placeholder="PO 4471 / AE/EXP/0040" /></Field>
          <Field label="Destination" htmlFor="pl-dest"><Input id="pl-dest" name="destination" maxLength={120} placeholder="port or city" /></Field>
          <Field label="Packed on" htmlFor="pl-day"><DateField id="pl-day" value={day} onChange={setDay} /></Field>
        </div>
        <Field label="Sizes, in carton order" htmlFor="pl-sizes" hint="Separate with commas, as the buyer writes them."><Input id="pl-sizes" value={sizesText} onChange={(e) => setSizes(e.target.value)} /></Field>

        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {lines.map((l, i) => {
            const b = built[i]!;
            return (
              <li key={i} className="flex flex-col gap-3 rounded-[12px] border border-[var(--color-line)] p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[15px] font-medium text-text">{b.to >= b.from ? `Cartons ${b.from}${b.to > b.from ? `–${b.to}` : ""}` : `From carton ${b.from}`}</span>
                  <span className="text-[13px] tabular-nums text-text-secondary">{b.perCarton > 0 ? `${b.perCarton} pcs a carton` : "Enter the pieces of each size"}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(88px,1fr))]">
                  <Field label="Cartons" htmlFor={`pl-${i}-n`} required><Input id={`pl-${i}-n`} type="number" inputMode="numeric" min={1} value={l.cartons} onChange={(e) => patch(i, { cartons: e.target.value })} /></Field>
                  {sizes.map((s, k) => (
                    <Field key={`${s}-${k}`} label={s} htmlFor={`pl-${i}-s${k}`}><Input id={`pl-${i}-s${k}`} type="number" inputMode="numeric" min={0} value={l.qty[k] ?? ""} onChange={(e) => patch(i, { qty: l.qty.map((q, j) => (j === k ? e.target.value : q)) })} /></Field>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(110px,1fr))]">
                  <Field label="Colour" htmlFor={`pl-${i}-c`}><Input id={`pl-${i}-c`} maxLength={60} value={l.colour} onChange={(e) => patch(i, { colour: e.target.value })} /></Field>
                  <Field label="Net kg a carton" htmlFor={`pl-${i}-nw`} required><Input id={`pl-${i}-nw`} type="number" inputMode="decimal" min={0.01} step="0.01" value={l.net} onChange={(e) => patch(i, { net: e.target.value })} /></Field>
                  <Field label="Gross kg a carton" htmlFor={`pl-${i}-gw`} required><Input id={`pl-${i}-gw`} type="number" inputMode="decimal" min={0.01} step="0.01" value={l.gross} onChange={(e) => patch(i, { gross: e.target.value })} /></Field>
                  <Field label="L × W × H cm" htmlFor={`pl-${i}-l`}>
                    <span className="grid grid-cols-3 gap-1.5">
                      <Input id={`pl-${i}-l`} aria-label="Length cm" type="number" inputMode="numeric" min={1} value={l.l} onChange={(e) => patch(i, { l: e.target.value })} />
                      <Input aria-label="Width cm" type="number" inputMode="numeric" min={1} value={l.w} onChange={(e) => patch(i, { w: e.target.value })} />
                      <Input aria-label="Height cm" type="number" inputMode="numeric" min={1} value={l.h} onChange={(e) => patch(i, { h: e.target.value })} />
                    </span>
                  </Field>
                </div>
                {n(l.gross) < n(l.net) && <p role="alert" className="m-0 text-[13px] text-[var(--color-danger-ink)]">Gross weight is less than net.</p>}
                {lines.length > 1 && <button type="button" className="self-start text-[13px] font-medium text-accent-ink active:opacity-70" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove this line</button>}
              </li>
            );
          })}
        </ol>
        <button type="button" className="self-start text-[14px] font-medium text-accent-ink active:opacity-70" onClick={() => setLines([...lines, blankLine(sizes.length, lines.at(-1))])}>Add another carton line</button>
        <p role="status" className={`m-0 text-[14px] tabular-nums ${over ? "text-[var(--color-danger-ink)]" : "text-text-secondary"}`}>
          {cartons} cartons · {pieces.toLocaleString("en-IN")} of {readyToPack.toLocaleString("en-IN")} ready pieces{over ? " — more than is ready" : ""}
        </p>
        <Field label="Note" htmlFor="pl-note"><Input id="pl-note" name="note" maxLength={500} placeholder="shipping marks, vessel, container" /></Field>
      </FormModal>

      <FormModal
        open={undo !== null} onClose={() => setUndo(null)} destructive
        title={`Cancel ${undo?.number ?? ""}?`} description="The list keeps its number and stays in the record as cancelled. Its pieces can be packed again."
        submitLabel="Cancel the list" pendingLabel="Cancelling…"
        pending={cancel.pending} failure={cancel.failure} failureTitle="It was not cancelled"
        onSubmit={(fd) => { if (undo) cancel.run(CANCEL_PL, { packingListId: undo.id, reason: String(fd.get("reason") ?? "").trim() }, () => setUndo(null)); }}
      >
        <Field label="Why?" htmlFor="pl-why" required><Input id="pl-why" name="reason" required minLength={3} maxLength={300} autoFocus /></Field>
      </FormModal>
    </div>
  );
}
