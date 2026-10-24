"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DateField } from "@/components/ui/DateTimePicker";
import { Button, Checkbox, Field, Surface } from "@/components/ui/primitives";
import type { Challan, ChallanDay } from "@/server/capabilities/piecework";
import { Sheet } from "../challan/[number]/ChallanDoc";
import { LABELS, type Lang } from "../labels";

/**
 * A day's challans, chosen and printed together: one A4 page each, in the order they were made. The list shows who each is made out to and
 * what moved, so the supervisor can leave out one that was only a test. The date is the same calendar every form uses.
 */
export function ChallansDay({ lang, day, sheets, business }: { lang: Lang; day: ChallanDay; sheets: Challan[]; business: string }) {
  const t = LABELS[lang];
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(day.challans.map((c) => c.number)));
  const chosen = sheets.filter((s) => picked.has(s.number));
  const toggle = (n: string, on: boolean) => setPicked((p) => { const next = new Set(p); if (on) next.add(n); else next.delete(n); return next; });

  return (
    <>
      <style>{"@media print { @page { size: A4; margin: 12mm; } }"}</style>
      <section className="hidden print:block" aria-hidden="true">
        {chosen.map((c) => <div key={c.number} style={{ breakAfter: "page" }}><Sheet c={c} business={business} /></div>)}
      </section>

      <div className="flex flex-col gap-5 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48"><Field label="Day" htmlFor="chd-day"><DateField id="chd-day" value={day.date} onChange={(v) => v && router.push(`/shopfloor/challans?date=${v}`)} required /></Field></div>
          <Button type="button" variant="primary" className="min-h-11" disabled={chosen.length === 0} onClick={() => window.print()}>{t.printChosen} ({chosen.length})</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setPicked(new Set(day.challans.map((c) => c.number)))}>{t.selectAll}</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setPicked(new Set())}>{t.selectNone}</Button>
        </div>

        {day.challans.length === 0 ? (
          <Surface className="p-6"><p className="m-0 text-[15px] text-text-secondary">{t.noChallans}</p></Surface>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))" }}>
            {day.challans.map((c) => (
              <li key={c.number} className={`list-none transition-opacity ${picked.has(c.number) ? "" : "opacity-50"}`}>
                <Surface className="flex h-full flex-col gap-2 p-4">
                  <Checkbox label={`${c.number} · ${c.workerName}`} checked={picked.has(c.number)} onChange={(e) => toggle(c.number, e.target.checked)} />
                  <p className="m-0 pl-8 text-[13px] text-text-secondary">
                    {c.lines} {c.lines === 1 ? "line" : "lines"}
                    {c.given > 0 && ` · ${c.given} ${t.given.toLowerCase()}`}{c.takenBack > 0 && ` · ${c.takenBack} ${t.takenBackShort}`}{c.by ? ` · ${c.by}` : ""}
                  </p>
                </Surface>
              </li>
            ))}
          </ul>
        )}
        <p className="m-0 text-[13px] text-text-secondary">{chosen.length} {t.chosenOf} {day.challans.length}</p>
      </div>
    </>
  );
}
