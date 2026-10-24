"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DateField } from "@/components/ui/DateTimePicker";
import { Button, Field } from "@/components/ui/primitives";

/** The period the wage and quality figures cover: two date fields on the same calendar every other form uses. */
export function PeriodFilter({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const [a, setA] = useState(from);
  const [b, setB] = useState(to);
  const go = (nextFrom: string, nextTo: string) => {
    const q = new URLSearchParams();
    if (nextFrom) q.set("from", nextFrom);
    if (nextTo) q.set("to", nextTo);
    router.push(q.size > 0 ? `/lots/reports?${q}` : "/lots/reports");
  };
  return (
    <form className="flex flex-wrap items-end gap-3" aria-label="Choose the period for the wage and quality figures" onSubmit={(e) => { e.preventDefault(); go(a, b); }}>
      <div className="w-44"><Field label="From" htmlFor="rp-from"><DateField id="rp-from" value={a} onChange={setA} /></Field></div>
      <div className="w-44"><Field label="To" htmlFor="rp-to"><DateField id="rp-to" value={b} onChange={setB} min={a || undefined} /></Field></div>
      <Button type="submit" variant="secondary">Show period</Button>
      {(from || to) && <Button type="button" variant="ghost" onClick={() => { setA(""); setB(""); go("", ""); }}>Whole history</Button>}
    </form>
  );
}
