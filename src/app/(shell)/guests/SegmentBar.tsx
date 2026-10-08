"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@/components/ui/primitives";
import { CommandFailure, formText, useCommand } from "@/components/ui/CommandForm";

export type SegmentChip = {
  id: string;
  name: string;
  minVisits: number | null;
  minSpendMinor: number | null;
  daysSinceLastOrder: number | null;
};

const chip = (active: boolean) =>
  "inline-flex min-h-11 items-center rounded-full px-4 text-[14px] font-medium no-underline transition-colors " +
  (active ? "bg-accent text-accent-on" : "bg-[var(--color-control)] text-text hover:bg-[var(--color-control-strong)]");

/**
 * Task 125 item 5.2 — saved guest segments. The filters live in the URL
 * (`?visits=3&spend=2000&quiet=30`), so a view can be bookmarked or shared; saving
 * one stores only the filter, and who is in it is recomputed on every visit.
 */
export function SegmentBar({
  segments,
  activeSegmentId,
  visits,
  spendRupees,
  quietDays,
}: {
  segments: SegmentChip[];
  activeSegmentId: string | null;
  visits: string;
  spendRupees: string;
  quietDays: string;
}) {
  const router = useRouter();
  const save = useCommand("/guests");
  const remove = useCommand("/guests");
  const hasFilter = visits !== "" || spendRupees !== "" || quietDays !== "";
  const active = segments.find((s) => s.id === activeSegmentId) ?? null;

  return (
    <section aria-label="Guest segments" className="mb-6 flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Link href="/guests" className={chip(!active && !hasFilter)}>All guests</Link>
        {segments.map((s) => (
          <Link key={s.id} href={`/guests?segment=${s.id}`} className={chip(s.id === activeSegmentId)}>{s.name}</Link>
        ))}
      </div>

      <form method="get" action="/guests" className="grid items-end gap-3 sm:grid-cols-4">
        <Field label="At least this many visits" htmlFor="seg-visits">
          <Input id="seg-visits" name="visits" type="number" min={0} inputMode="numeric" defaultValue={visits} />
        </Field>
        <Field label="Spent at least (₹)" htmlFor="seg-spend">
          <Input id="seg-spend" name="spend" type="number" min={0} inputMode="numeric" defaultValue={spendRupees} />
        </Field>
        <Field label="Not seen for (days)" htmlFor="seg-quiet">
          <Input id="seg-quiet" name="quiet" type="number" min={0} inputMode="numeric" defaultValue={quietDays} />
        </Field>
        <Button type="submit" variant="secondary">Show guests</Button>
      </form>

      {hasFilter && !active && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const name = formText(new FormData(e.currentTarget), "name");
            save.run(
              "verity.crm.save_segment",
              {
                name,
                ...(visits !== "" ? { minVisits: Number(visits) } : {}),
                ...(spendRupees !== "" ? { minSpendMinor: Math.round(Number(spendRupees) * 100) } : {}),
                ...(quietDays !== "" ? { daysSinceLastOrder: Number(quietDays) } : {}),
              },
              (data: { id: string }) => router.push(`/guests?segment=${data.id}`),
            );
          }}
        >
          <Field label="Save this view as a segment" htmlFor="seg-name" hint="Saves the filter, not the people. Who is in it updates by itself.">
            <Input id="seg-name" name="name" required maxLength={80} placeholder="Regulars gone quiet" />
          </Field>
          <Button type="submit" disabled={save.pending}>{save.pending ? "Saving…" : "Save segment"}</Button>
        </form>
      )}
      <CommandFailure failure={save.failure} title="Could not save segment" />

      {active && (
        <div className="flex flex-wrap items-center gap-3 text-[14px] text-text-secondary">
          <span>Segment filter: {describe(active)}</span>
          <Button
            size="sm"
            variant="danger"
            disabled={remove.pending}
            onClick={() => remove.run("verity.crm.delete_segment", { segmentId: active.id }, () => router.push("/guests"))}
          >
            Delete segment
          </Button>
        </div>
      )}
      <CommandFailure failure={remove.failure} title="Could not delete segment" />
    </section>
  );
}

function describe(s: SegmentChip): string {
  const parts: string[] = [];
  if (s.minVisits !== null) parts.push(`${s.minVisits}+ visits`);
  if (s.minSpendMinor !== null) parts.push(`₹${(s.minSpendMinor / 100).toLocaleString("en-IN")}+ spent`);
  if (s.daysSinceLastOrder !== null) parts.push(`not seen for ${s.daysSinceLastOrder}+ days`);
  return parts.join(", ");
}
