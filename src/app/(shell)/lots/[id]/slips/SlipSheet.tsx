"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button, Checkbox, Panel } from "@/components/ui/primitives";
import { SlipCard, type SlipData } from "../../bundles/[id]/slip/SlipDoc";

export type SlipItem = SlipData & { id: string; /** Nothing of it has been given out: a fresh bundle that still needs its slip on it. */ fresh: boolean };

const LAYOUTS = [
  { key: "full", label: "Full slip", hint: "10 cm, two across an A4 sheet" },
  { key: "sticker", label: "Sticker", hint: "6.4 cm, three across, for the bundle's tie" },
] as const;
type Layout = (typeof LAYOUTS)[number]["key"];
const LAYOUT_KEY = "verity-slip-layout";

/**
 * Every slip of a lot, chosen and printed in one go. All are selected to start with; one tap picks only the bundles nothing has been
 * given out from yet (the ones that still need a slip on them), another picks none. The size is remembered on this device. Only the
 * chosen slips print, and they print in bundle-number order so the stack matches the pile.
 */
export function SlipSheet({ slips, lotHref, lotNumber }: { slips: SlipItem[]; lotHref: string; lotNumber: string }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(slips.map((s) => s.id)));
  const [layout, setLayout] = useState<Layout>("full");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LAYOUT_KEY);
      if (saved === "full" || saved === "sticker") setLayout(saved);
    } catch { /* storage can be blocked; the default stands */ }
  }, []);
  const choose = (next: Layout) => {
    setLayout(next);
    try { window.localStorage.setItem(LAYOUT_KEY, next); } catch { /* not remembered */ }
  };

  const chosen = useMemo(() => slips.filter((s) => picked.has(s.id)), [slips, picked]);
  const fresh = slips.filter((s) => s.fresh);
  const toggle = (id: string, on: boolean) => setPicked((p) => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });
  const compact = layout === "sticker";

  return (
    <>
      <style>{`@media print { @page { size: A4; margin: ${compact ? "10mm" : "12mm"}; } }`}</style>
      <section className={`hidden print:grid ${compact ? "print:grid-cols-3 print:gap-2" : "print:grid-cols-2 print:gap-4"}`} aria-hidden="true">
        {chosen.map((s) => <div key={s.id} style={{ breakInside: "avoid" }}><SlipCard slip={s} compact={compact} /></div>)}
      </section>

      <div className="print:hidden">
        <Panel title={`${slips.length} slip${slips.length === 1 ? "" : "s"} for ${lotNumber}`}>
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" disabled={chosen.length === 0} onClick={() => window.print()}>Print {chosen.length === slips.length ? "all" : chosen.length} slip{chosen.length === 1 ? "" : "s"}</Button>
              <Link href={lotHref} className="inline-flex min-h-11 items-center rounded-[10px] px-4 text-[15px] font-semibold text-accent-ink no-underline hover:bg-[var(--color-control)]">Back to the lot</Link>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <div role="group" aria-label="Slip size" className="inline-flex rounded-[12px] bg-[var(--color-control)] p-1">
                {LAYOUTS.map((l) => (
                  <button key={l.key} type="button" aria-pressed={layout === l.key} title={l.hint} onClick={() => choose(l.key)}
                    className={`min-h-10 rounded-[9px] px-4 text-[14px] font-medium transition-colors ${layout === l.key ? "bg-accent text-accent-on" : "text-text-secondary hover:text-text"}`}>{l.label}</button>
                ))}
              </div>
              <p className="m-0 text-[13px] text-text-secondary">{LAYOUTS.find((l) => l.key === layout)!.hint}</p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <Button type="button" variant="ghost" size="sm" onClick={() => setPicked(new Set(slips.map((s) => s.id)))}>Select all</Button>
              <Button type="button" variant="ghost" size="sm" disabled={fresh.length === 0 || fresh.length === slips.length} onClick={() => setPicked(new Set(fresh.map((s) => s.id)))}>Only not yet given out ({fresh.length})</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPicked(new Set())}>None</Button>
              <span className="ml-auto text-[13px] text-text-secondary" aria-live="polite">{chosen.length} of {slips.length} chosen</span>
            </div>

            <ul className="m-0 grid list-none gap-4 p-0" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? "7rem" : "10.5cm"}, max-content))` }}>
              {slips.map((s) => (
                <li key={s.id} className={`flex max-w-full flex-col gap-2 transition-opacity ${picked.has(s.id) ? "" : "opacity-45"}`}>
                  <Checkbox label={`${s.bundleNumber}${s.fresh ? "" : " · work started"}`} checked={picked.has(s.id)} onChange={(e) => toggle(s.id, e.target.checked)} />
                  <div className="max-w-full overflow-x-auto"><SlipCard slip={s} compact={compact} /></div>
                </li>
              ))}
            </ul>
            <p className="m-0 text-[13px] text-text-secondary">Each QR opens its bundle on a signed-in phone. It carries only the bundle&apos;s address, no counts and no names.</p>
          </div>
        </Panel>
      </div>
    </>
  );
}
