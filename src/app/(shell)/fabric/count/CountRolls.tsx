"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { CommandFailure } from "@/components/ui/CommandForm";
import { Input } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import { qty } from "../format";
import { fill, type OfficeLabels } from "../office-labels";

const COUNT = "verity.piecework.count_rolls";

export type CountRoll = { id: string; number: string; fabricType: string; unit: string; balanceCenti: number };

/**
 * Count the shelf: scan or type each roll's number to jump to its box, type what is found, and post only the differences. A roll left blank
 * is left as the ledger says. Nothing is posted until the button is pressed, and every difference is shown first.
 */
export function CountRolls({ o, rolls }: { o: OfficeLabels; rolls: CountRoll[] }) {
  const router = useRouter();
  const [found, setFound] = useState<Record<string, string>>({});
  const [lookup, setLookup] = useState("");
  const [miss, setMiss] = useState<string | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [done, setDone] = useState<{ counted: number; adjusted: number } | null>(null);
  const [pending, start] = useTransition();

  const centi = (text: string) => (text.trim() === "" ? null : Math.round(Number(text) * 100));
  const rows = useMemo(() => rolls.map((r) => {
    const c = centi(found[r.id] ?? "");
    return { ...r, counted: c !== null && Number.isFinite(c) && c >= 0 ? c : null, delta: c !== null && Number.isFinite(c) && c >= 0 ? c - r.balanceCenti : 0 };
  }), [rolls, found]);
  const counted = rows.filter((r) => r.counted !== null);
  const different = counted.filter((r) => r.delta !== 0);

  const jump = (text: string) => {
    const t = text.trim().toLowerCase().replace(/^r-?/, "");
    const hit = rolls.find((r) => r.number.toLowerCase().replace(/^r-?0*/, "") === t.replace(/^0+/, ""));
    if (!hit) { setMiss(text.trim()); return; }
    setMiss(null);
    setLookup("");
    const box = document.querySelector<HTMLInputElement>(`input[data-roll="${hit.id}"]`);
    box?.scrollIntoView({ block: "center", behavior: "smooth" });
    box?.focus();
  };

  const post = () => {
    setFailure(null);
    start(async () => {
      const result = await runCommand<{ counted: number; adjusted: number }>(COUNT, { counts: counted.map((r) => ({ rollId: r.id, countedCenti: r.counted! })) }, "/fabric");
      if (result.ok) { setDone(result.data!); setFound({}); router.refresh(); } else setFailure(result);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="glass-card flex flex-col gap-2 p-4">
        <label htmlFor="count-scan" className="text-[13px] font-medium text-text">{o.scanOrType}</label>
        <Input id="count-scan" value={lookup} onChange={(e) => { setLookup(e.target.value); setMiss(null); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); jump(lookup); } }} placeholder="R-0004" autoComplete="off" autoCapitalize="characters" inputMode="text" />
        {miss && <p role="alert" className="m-0 text-[13px]" style={{ color: "var(--color-state-blocked-ink)" }}>{fill(o.noRollNumbered, { n: miss })}</p>}
      </div>

      {done && (
        <p role="status" className="m-0 rounded-[12px] bg-[var(--color-control)] px-4 py-3 text-[15px] text-text">
          {fill(o.countedRolls, { n: done.counted })}, {done.adjusted === 0 ? o.allMatched : fill(o.differencesPosted, { n: done.adjusted })}.
        </p>
      )}

      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map((r) => (
          <li key={r.id} className="list-none">
            <div className="glass-card grid grid-cols-[1fr_auto] items-center gap-3 p-4 sm:grid-cols-[1.4fr_1fr_9rem_1fr]">
              <span className="min-w-0"><span className="block truncate text-[15px] font-medium text-text">{r.number}</span><span className="block truncate text-[13px] text-text-secondary">{r.fabricType}</span></span>
              <span className="tabular text-right text-[13px] text-text-secondary sm:text-left">{fill(o.ledgerQty, { q: qty(r.balanceCenti, r.unit) })}</span>
              <Input
                aria-label={fill(o.foundAria, { n: r.number, u: r.unit })}
                data-roll={r.id}
                type="number" inputMode="decimal" min={0} step="0.01" placeholder={r.unit}
                value={found[r.id] ?? ""} onChange={(e) => { setFound({ ...found, [r.id]: e.target.value }); setDone(null); }}
              />
              <span className="tabular col-span-2 text-[13px] font-medium sm:col-span-1" style={r.counted === null ? { color: "var(--color-text-tertiary)" } : r.delta === 0 ? { color: "var(--color-state-completed-ink)" } : { color: "var(--color-state-pending-ink)" }}>
                {r.counted === null ? o.notCounted : r.delta === 0 ? o.matches : `${r.delta > 0 ? "+" : "−"}${qty(Math.abs(r.delta), r.unit)}`}
              </span>
            </div>
          </li>
        ))}
      </ul>

      <CommandFailure failure={failure} title={o.countFailTitle} />
      <div className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-[16px] bg-[var(--color-surface)] px-4 py-3 shadow-[var(--shadow-card)]">
        <p className="m-0 text-[14px] text-text">{fill(o.countBar, { c: counted.length, d: different.length, l: rolls.length - counted.length })}</p>
        <CommandButton commands={COUNT} variant="primary" disabled={pending || counted.length === 0} onClick={post}>{pending ? o.posting : different.length === 0 ? o.recordCount : different.length === 1 ? o.postOneDiff : fill(o.postDiffs, { n: different.length })}</CommandButton>
      </div>
    </div>
  );
}
