"use client";

import { useState } from "react";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { formatMinute, parseMinute, type AvailabilityRule } from "@/lib/menu-availability";

type Draft = { locationId: string; channel: string; from: string; to: string };

const toDraft = (r: AvailabilityRule): Draft => ({
  locationId: r.locationId ?? "",
  channel: r.channel ?? "",
  from: r.fromMinute === null ? "" : formatMinute(r.fromMinute),
  to: r.toMinute === null ? "" : formatMinute(r.toMinute),
});

/**
 * Where and when one item can be ordered (Task 125 items 3.2 and 3.3).
 *
 * No rule means the item is available wherever it is on the menu. Each rule
 * narrows that: an outlet, a channel, a daily window, or any mix, and the item
 * can be ordered where at least one rule matches. Times are on the outlet's own
 * clock; an end earlier than the start runs past midnight.
 */
export function AvailabilityEditor({
  itemName,
  rules,
  outlets,
  channels,
  pending,
  onSave,
  onCancel,
}: {
  itemName: string;
  rules: AvailabilityRule[];
  outlets: Array<{ id: string; name: string }>;
  channels: Array<{ value: string; label: string }>;
  pending: boolean;
  onSave: (rules: AvailabilityRule[]) => void;
  onCancel: () => void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>(rules.map(toDraft));
  const [problem, setProblem] = useState<string | null>(null);

  const set = (index: number, patch: Partial<Draft>) =>
    setDrafts((all) => all.map((d, i) => (i === index ? { ...d, ...patch } : d)));

  function save() {
    const parsed: AvailabilityRule[] = [];
    for (const d of drafts) {
      const from = d.from ? parseMinute(d.from) : null;
      const to = d.to ? parseMinute(d.to) : null;
      if ((d.from === "") !== (d.to === "") || (d.from && from === null) || (d.to && to === null)) {
        return setProblem("Give both a start and an end time, or leave both empty.");
      }
      if (from !== null && from === to) return setProblem("A start and end time must differ.");
      if (!d.locationId && !d.channel && from === null) return setProblem("Each rule must limit an outlet, a channel or a time.");
      parsed.push({ locationId: d.locationId || null, channel: d.channel || null, fromMinute: from, toMinute: to });
    }
    setProblem(null);
    onSave(parsed);
  }

  return (
    <div className="mb-4 rounded-lg bg-surface-sunken p-3">
      <p className="m-0 mb-3 text-[13px] text-text-secondary">
        {drafts.length === 0
          ? `${itemName} is available at every outlet, on every channel, all day. Add a rule to limit that.`
          : `${itemName} can be ordered only where one of these rules matches.`}
      </p>
      <div className="flex flex-col gap-3">
        {drafts.map((d, index) => (
          <div key={index} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[160px]">
              <Field label="Outlet" htmlFor={`av-outlet-${index}`}>
                <Select id={`av-outlet-${index}`} value={d.locationId} onChange={(e) => set(index, { locationId: e.target.value })}>
                  <option value="">Any outlet</option>
                  {outlets.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="min-w-[160px]">
              <Field label="Channel" htmlFor={`av-channel-${index}`}>
                <Select id={`av-channel-${index}`} value={d.channel} onChange={(e) => set(index, { channel: e.target.value })}>
                  <option value="">Any channel</option>
                  {channels.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="w-[130px]">
              <Field label="From" htmlFor={`av-from-${index}`}>
                <Input id={`av-from-${index}`} type="time" value={d.from} onChange={(e) => set(index, { from: e.target.value })} />
              </Field>
            </div>
            <div className="w-[130px]">
              <Field label="Until" htmlFor={`av-to-${index}`}>
                <Input id={`av-to-${index}`} type="time" value={d.to} onChange={(e) => set(index, { to: e.target.value })} />
              </Field>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setDrafts((all) => all.filter((_, i) => i !== index))}>
              Remove
            </Button>
          </div>
        ))}
      </div>
      {problem && (
        <p role="alert" className="m-0 mt-3 text-[13px] text-danger">
          {problem}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => setDrafts((all) => [...all, { locationId: "", channel: "", from: "", to: "" }])}>
          Add rule
        </Button>
        <CommandButton commands={"verity.dinein.set_menu_item_availability"} size="sm" variant="primary" disabled={pending} onClick={save}>
          Save
        </CommandButton>
        <Button size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
