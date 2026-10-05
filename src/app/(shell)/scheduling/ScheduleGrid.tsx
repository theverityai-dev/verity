"use client";

import { useMemo } from "react";

/**
 * Resource-by-time grid.
 *
 * Renders a fixed 14-day window because that is what the data supports; there is
 * no infinite scroll pretending at a calendar the platform cannot paginate.
 * Bars are positioned by proportion of the window, so a booking's width carries
 * its duration — which is the whole reason not to use a table here.
 *
 * Every bar is also a list item with a text label, so the information is
 * available to a screen reader and does not depend on seeing the geometry.
 */
export function ScheduleGrid({
  resources,
  bookings,
  unavailable,
}: {
  resources: Array<{ id: string; name: string; backing: string }>;
  bookings: Array<{ id: string; resourceId: string; startsAt: string; endsAt: string; subject: string }>;
  unavailable: Array<{ id: string; resourceId: string; startsAt: string; endsAt: string }>;
}) {
  const { start, end, days } = useMemo(() => {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const end = new Date(start.getTime() + 14 * 86_400_000);
    const days = Array.from({ length: 14 }, (_, i) => new Date(start.getTime() + i * 86_400_000));
    return { start, end, days };
  }, []);

  const span = end.getTime() - start.getTime();
  const position = (fromIso: string, toIso: string) => {
    const from = Math.max(new Date(fromIso).getTime(), start.getTime());
    const to = Math.min(new Date(toIso).getTime(), end.getTime());
    if (to <= from) return null;
    return { left: ((from - start.getTime()) / span) * 100, width: ((to - from) / span) * 100 };
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-[12px] bg-surface">
        <div className="min-w-[720px]">
          {/* Day scale */}
          <div className="flex border-b border-line pl-[180px]" aria-hidden="true">
            {days.map((day) => (
              <div
                key={day.toISOString()}
                className="tabular flex-1 border-l border-line py-2 text-center text-[12px] text-text-tertiary first:border-l-0"
              >
                {day.getUTCDate()}
              </div>
            ))}
          </div>

          <ul className="list-none m-0 p-0">
            {resources.map((resource) => {
              const rowBookings = bookings.filter((b) => b.resourceId === resource.id);
              const rowBlocks = unavailable.filter((w) => w.resourceId === resource.id);

              return (
                <li key={resource.id} className="flex items-stretch border-b border-line last:border-b-0">
                  <div className="w-[180px] shrink-0 px-4 py-3">
                    <p className="m-0 truncate text-[14px] text-text">{resource.name}</p>
                    <p className="m-0 text-[12px] text-text-tertiary">{resource.backing}</p>
                  </div>

                  <div className="relative flex-1 my-2 mr-3">
                    {rowBlocks.map((block) => {
                      const pos = position(block.startsAt, block.endsAt);
                      if (!pos) return null;
                      return (
                        <div
                          key={block.id}
                          className="absolute top-0 bottom-0 rounded-sm bg-surface-sunken border border-line-strong"
                          style={{ left: `${pos.left}%`, width: `${Math.max(pos.width, 0.6)}%` }}
                          title="Unavailable"
                        />
                      );
                    })}
                    {rowBookings.map((booking) => {
                      const pos = position(booking.startsAt, booking.endsAt);
                      if (!pos) return null;
                      return (
                        <div
                          key={booking.id}
                          // Filled, not outlined. A booking is often only a few
                          // percent of a 14-day window, and at that width an
                          // outline collapses into two lines with nothing legible
                          // between them.
                          className="absolute bottom-0 top-0 flex items-center overflow-hidden rounded-sm bg-accent px-1.5"
                          style={{ left: `${pos.left}%`, width: `${Math.max(pos.width, 1.2)}%` }}
                          title={`${booking.subject}: ${booking.startsAt} → ${booking.endsAt}`}
                        >
                          <span className="whitespace-nowrap text-[12px] font-medium text-accent-on">{booking.subject}</span>
                        </div>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/*
        The same information without the geometry. A time grid is unreadable to a
        screen reader and to anyone who needs exact times rather than relative
        widths, so the list is a peer view rather than a fallback — but it stays
        collapsed, because the grid is the answer most of the time.
      */}
      <details className="group rounded-[12px] bg-surface">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-[12px] text-text-secondary transition-colors hover:text-text [&::-webkit-details-marker]:hidden">
          <span
            aria-hidden="true"
            className="text-[10px] text-text-tertiary transition-transform group-open:rotate-90"
          >
            ▶
          </span>
          Bookings as a list
          <span className="text-text-tertiary">({bookings.length})</span>
        </summary>
        <ul className="m-0 list-none divide-y divide-line border-t border-line p-0">
          {bookings.map((b) => (
            <li key={b.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5">
              <span className="text-[13px] text-text">
                {resources.find((r) => r.id === b.resourceId)?.name ?? "Unknown resource"}
                <span className="text-text-tertiary"> · {b.subject}</span>
              </span>
              <span className="tabular text-[12px] text-text-tertiary">
                {b.startsAt.replace("T", " ").slice(0, 16)} → {b.endsAt.replace("T", " ").slice(0, 16)}
              </span>
            </li>
          ))}
        </ul>
      </details>

      <p className="m-0 text-[12px] text-text-tertiary">14-day window · times shown in UTC.</p>
    </div>
  );
}
