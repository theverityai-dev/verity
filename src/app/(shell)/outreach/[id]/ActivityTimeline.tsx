"use client";

import { useMemo, useState } from "react";
import { EmptyState, Row, RowList } from "@/components/ui/primitives";

type Activity = {
  id: string;
  activityType: string;
  channel: string;
  message: string | null;
  response: string | null;
  actorPartyId: string;
  occurredAt: string;
};

/**
 * Activity timeline with a per-type filter (Task 114 P1.5 item 4, second
 * half). The review asked for outreach/replies/meetings/payments/stage-
 * changes/notes/tasks filters — payments, stage-changes and tasks are
 * separate panels on this page (Attribution, stage badge, Tasks), not rows
 * in `outreachActivity`, so this filters the set that IS logged here: the
 * activity type the command itself records (`log_activity`'s own enum).
 */
export function ActivityTimeline({ activities, partyName }: { activities: Activity[]; partyName: Map<string, string> }) {
  const [filter, setFilter] = useState<string>("all");

  const types = useMemo(() => [...new Set(activities.map((a) => a.activityType))].sort(), [activities]);
  const filtered = filter === "all" ? activities : activities.filter((a) => a.activityType === filter);

  if (activities.length === 0) {
    return (
      <EmptyState
        title="No activity logged"
        description="Nothing has been recorded against this lead yet. Field rule: if it isn't recorded, it didn't happen."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {types.length > 1 && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {["all", ...types].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setFilter(t)}
              aria-pressed={filter === t}
              className={
                "rounded-pill border px-2.5 py-1 text-[11.5px] font-medium transition-colors " +
                (filter === t
                  ? "border-transparent bg-accent-subtle text-accent-ink"
                  : "border-line text-text-tertiary hover:bg-surface-sunken hover:text-text")
              }
            >
              {t === "all" ? "All" : t.replace(/([A-Z])/g, " $1").trim()}
            </button>
          ))}
        </div>
      )}
      {filtered.length === 0 ? (
        <p className="px-1 text-[13px] text-text-tertiary">No activity of this type.</p>
      ) : (
        <RowList>
          {filtered.map((a) => (
            <Row key={a.id}>
              <span className="flex flex-col gap-0.5">
                <span className="text-[14px] text-text">
                  {a.activityType.replace(/([A-Z])/g, " $1").trim()} · {a.channel}
                </span>
                {a.message && <span className="text-[12px] text-text-secondary">{a.message}</span>}
                {a.response && <span className="text-[12px] text-text-tertiary">Response: {a.response}</span>}
                <span className="text-[12px] text-text-tertiary">{partyName.get(a.actorPartyId) ?? "—"}</span>
              </span>
              <span className="tabular shrink-0 text-[12px] text-text-tertiary">
                {a.occurredAt.slice(0, 16).replace("T", " ")}
              </span>
            </Row>
          ))}
        </RowList>
      )}
    </div>
  );
}
