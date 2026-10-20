"use client";

import Link from "next/link";
import { CommandButton } from "@/components/ui/CommandAccess";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ErrorState, FilterChipRow, StateBadge } from "@/components/ui/primitives";
import { IconTile } from "@/components/ui/IconTile";
import { Icon } from "@/components/ui/icons";
import { ProgressRing } from "@/components/ui/viz";
import { channelKindFor, type StateTone } from "@/components/ui/business/domains";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import type { CancelledDish, KitchenTicket } from "@/server/capabilities/dinein";

/**
 * The kitchen board (Task 127 §4.2, P-BOARD).
 *
 * Three columns, because a cook has three questions: what is waiting, what am I on, and what is
 * ready to leave. Inside a column the dishes of one order sit together on one docket, the way a
 * printed ticket does: a cook plates a table, not a line item. Each dish still moves on its own (a
 * starter goes before the main), and a docket with several dishes also offers the whole move.
 *
 * Age is a ring: minutes since the dish was sent, against the time the platform's SLA clock allows
 * (sent + remaining). It turns amber when the clock says "getting on" and red when late, and always
 * says so in words, because a kitchen light is bad and a cook may be colour-blind.
 *
 * URGENCY is read, never computed here. `urgencyFor()` derives it from the platform's SLA clocks,
 * which are driven by state category. A timer written in this file would be the bump timer DEC-001
 * excludes.
 *
 * Station views, the "cancelled, confirm" lane, the new-dish sound and automatic ticket printing are
 * ADR-041. The sound and the printing are choices of THIS device (a screen over the pass wants them;
 * a manager's phone does not), so they are kept on the device, not in the tenant's data.
 */

const COLUMNS = [
  { state: "queued", title: "Waiting", category: "Pending", next: "preparing", action: "Start", all: "Start all" },
  { state: "preparing", title: "On", category: "Active", next: "ready", action: "Ready", all: "All ready" },
  { state: "ready", title: "Ready to go", category: "Completed", next: null, action: null, all: null },
] as const;

/** The ring's colour for a dish's SLA urgency: the state system, never a kind hue. */
const URGENCY_TONE: Record<string, StateTone> = {
  none: "active",
  low: "active",
  medium: "active",
  high: "pending",
  critical: "pending",
  breached: "blocked",
};

const URGENCY_LABEL: Record<string, string> = {
  high: "Getting on",
  critical: "Nearly late",
  breached: "Late",
};

const URGENCY_RANK: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3, critical: 4, breached: 5 };

const CHANNEL_TAG: Record<string, string> = {
  dine_in: "Dine-in",
  takeaway: "Takeaway",
  phone: "Phone",
  delivery: "Delivery",
  delivery_platform: "Platform",
  website: "Website",
  qr: "QR",
  corporate: "Corporate",
  catering: "Catering",
};

const KIND_LABEL = { new: "New", addition: "Added", void: "Withdrawn" } as const;

type Docket = { orderId: string; label: string; channel: string; lines: KitchenTicket[] };

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    window.localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* A private window cannot remember; the toggle still works for this visit. */
  }
}

/** A short two-tone chime. Needs a tap on the toggle first, which is what unlocks audio in a browser. */
function chime(): void {
  try {
    const Audio = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Audio) return;
    const audio = new Audio();
    const gain = audio.createGain();
    gain.gain.value = 0.15;
    gain.connect(audio.destination);
    [880, 660].forEach((frequency, i) => {
      const tone = audio.createOscillator();
      tone.frequency.value = frequency;
      tone.connect(gain);
      tone.start(audio.currentTime + i * 0.18);
      tone.stop(audio.currentTime + i * 0.18 + 0.16);
    });
    setTimeout(() => void audio.close(), 700);
  } catch {
    /* No sound is not a failure. */
  }
}

/** The docket's clock: its most urgent dish decides the colour and the words. */
function DocketClock({ lines, ageMinutes }: { lines: KitchenTicket[]; ageMinutes: Record<string, number> }) {
  const worst = lines.reduce((a, b) => ((URGENCY_RANK[b.urgency] ?? 0) > (URGENCY_RANK[a.urgency] ?? 0) ? b : a));
  const age = Math.max(...lines.map((l) => ageMinutes[l.lineId] ?? 0));
  const timed = lines.filter((l) => l.remainingMinutes !== null);
  const tightest = timed.length ? timed.reduce((a, b) => (b.remainingMinutes! < a.remainingMinutes! ? b : a)) : null;
  const words = URGENCY_LABEL[worst.urgency];
  const remaining = tightest ? Math.round(tightest.remainingMinutes!) : null;

  return (
    <span className="flex shrink-0 items-center gap-2">
      <span className="text-right text-[13px] leading-4">
        <span className={"block font-semibold " + (worst.urgency === "breached" ? "text-danger" : words ? "text-warning" : "text-text-secondary")}>
          {words ?? (remaining === null ? "No target" : "On time")}
        </span>
        {remaining !== null && (
          <span className="block text-text-tertiary">{remaining < 0 ? `${-remaining} min over` : `${remaining} min left`}</span>
        )}
      </span>
      {remaining !== null ? (
        <ProgressRing
          value={age}
          total={Math.max(age + Math.max(remaining, 0), 1)}
          tone={URGENCY_TONE[worst.urgency] ?? "active"}
          centre={`${age}m`}
          size={44}
          label="Minutes since sent, against the target"
        />
      ) : (
        <span className="tabular grid size-11 place-items-center rounded-full bg-[var(--color-control)] text-[12px] font-semibold text-text">{age}m</span>
      )}
    </span>
  );
}

export function KitchenBoard({
  tickets,
  ageMinutes,
  cancelled,
  stations,
  activeStationId,
  recent,
  nextUnprintedId,
}: {
  tickets: KitchenTicket[];
  ageMinutes: Record<string, number>;
  cancelled: CancelledDish[];
  stations: Array<{ id: string; name: string }>;
  activeStationId: string | null;
  recent: Array<{ id: string; number: string; kind: "new" | "addition" | "void"; stationName: string | null; prints: number }>;
  nextUnprintedId: string | null;
}) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const [sound, setSound] = useState(false);
  const [autoPrint, setAutoPrint] = useState(false);
  const seen = useRef<Set<string> | null>(null);

  // Device preferences, read once on arrival.
  useEffect(() => {
    setSound(readFlag("verity.kitchen.sound"));
    setAutoPrint(readFlag("verity.kitchen.autoprint"));
  }, []);

  // Polled, not pushed. D1 records the decision: at Kent's scale a refresh every ten seconds is
  // indistinguishable from a socket, and a socket is a transport to run, secure and reconnect. It
  // becomes worth it above ten devices or below a second, and neither is true here.
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(timer);
  }, [router]);

  // A dish that was not here the last time we looked is new: sound once per arrival.
  useEffect(() => {
    const waiting = new Set(tickets.filter((t) => t.state === "queued").map((t) => t.lineId));
    if (seen.current && sound && [...waiting].some((id) => !seen.current!.has(id))) chime();
    seen.current = waiting;
  }, [tickets, sound]);

  // Column -> dockets, keeping the query's order (oldest first, starters before mains).
  const byState = useMemo(() => {
    const grouped = new Map<string, Docket[]>();
    for (const ticket of tickets) {
      const dockets = grouped.get(ticket.state) ?? [];
      let docket = dockets.find((d) => d.orderId === ticket.orderId);
      if (!docket) {
        docket = { orderId: ticket.orderId, label: ticket.label, channel: ticket.channel, lines: [] };
        dockets.push(docket);
      }
      docket.lines.push(ticket);
      grouped.set(ticket.state, dockets);
    }
    return grouped;
  }, [tickets]);

  const late = tickets.filter((t) => t.urgency === "breached" && t.state !== "ready").length;

  function advance(lineIds: string[], to: string) {
    setFailure(null);
    startTransition(async () => {
      // One command per dish, in order, so each move is its own audited fact; stop at the first refusal.
      for (const lineId of lineIds) {
        const result = await runCommand("verity.dinein.advance_order_line", { lineId, to }, "/kitchen");
        if (!result.ok) {
          setFailure(result);
          break;
        }
      }
      router.refresh();
    });
  }

  function acknowledge(lineId: string) {
    setFailure(null);
    startTransition(async () => {
      const result = await runCommand("verity.dinein.acknowledge_cancelled_line", { lineId }, "/kitchen");
      if (result.ok) router.refresh();
      else setFailure(result);
    });
  }

  const toggle =
    "inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[14px] font-medium transition-colors focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-accent-line)] ";
  const toggleOn = "bg-accent text-accent-on";
  const toggleOff = "bg-[var(--color-control)] text-text hover:bg-[var(--color-control-strong)]";

  return (
    <>
      {failure && (
        <div className="mb-4">
          <ErrorState title="That did not happen" message={failure.message} issues={failure.issues} retryable={failure.retryable} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {stations.length > 0 && (
          <nav aria-label="Station" className="min-w-0">
            <FilterChipRow
              chips={[
                { label: "All stations", active: activeStationId === null, href: "/kitchen" },
                ...stations.map((s) => ({ label: s.name, active: activeStationId === s.id, href: `/kitchen?station=${s.id}` })),
              ]}
            />
          </nav>
        )}
        {late > 0 && (
          <span className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-[var(--color-state-blocked-fill)] px-4 text-[14px] font-semibold text-[var(--color-state-blocked-ink)]">
            <Icon name="clock" size={16} />
            {late} late
          </span>
        )}
        <span className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={sound}
            onClick={() => {
              const next = !sound;
              setSound(next);
              writeFlag("verity.kitchen.sound", next);
              if (next) chime();
            }}
            className={toggle + (sound ? toggleOn : toggleOff)}
          >
            <Icon name="bell" size={16} />
            {sound ? "Sound on" : "Sound off"}
          </button>
          <button
            type="button"
            aria-pressed={autoPrint}
            onClick={() => {
              const next = !autoPrint;
              setAutoPrint(next);
              writeFlag("verity.kitchen.autoprint", next);
            }}
            className={toggle + (autoPrint ? toggleOn : toggleOff)}
          >
            <Icon name="receipt" size={16} />
            {autoPrint ? "Printing new tickets" : "Print new tickets"}
          </button>
        </span>
      </div>

      {/* The next unprinted ticket opens in a hidden frame that prints itself and records it. */}
      {autoPrint && nextUnprintedId && (
        <iframe key={nextUnprintedId} src={`/kitchen/ticket/${nextUnprintedId}?auto=1`} title="Printing a ticket" className="hidden" />
      )}

      {cancelled.length > 0 && (
        <section aria-label="Cancelled dishes" className="mb-5 rounded-[12px] bg-[var(--color-state-blocked-fill)] p-4">
          <h2 className="m-0 mb-3 flex items-center gap-2 text-[17px] font-semibold text-[var(--color-state-blocked-ink)]">
            Stop making these
            <span className="tabular rounded-full bg-surface px-2 text-[13px]">{cancelled.length}</span>
          </h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {cancelled.map((dish) => (
              <li key={dish.lineId} className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] bg-surface p-3.5">
                <span className="text-[17px] text-text">
                  <span className="tabular font-bold">{dish.qty} ×</span>{" "}
                  <span className="line-through decoration-danger decoration-2">{dish.itemName}</span>
                  <span className="ml-2 text-[14px] text-text-secondary">{dish.label}{dish.stationName ? `, ${dish.stationName}` : ""}</span>
                </span>
                <CommandButton commands={"verity.dinein.acknowledge_cancelled_line"} disabled={pending} onClick={() => acknowledge(dish.lineId)}>
                  Seen
                </CommandButton>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
        {COLUMNS.map((column) => {
          const dockets = byState.get(column.state) ?? [];
          const dishes = dockets.reduce((sum, d) => sum + d.lines.length, 0);
          return (
            <section key={column.state} aria-label={column.title} className="flex flex-col gap-3 rounded-[16px] bg-surface-sunken p-3">
              <h2 className="m-0 flex items-center justify-between gap-2 px-1 text-[17px] font-semibold text-text">
                {column.title}
                <StateBadge category={column.category} label={`${dishes} dish${dishes === 1 ? "" : "es"}`} />
              </h2>

              {dockets.length === 0 ? (
                <p className="m-0 px-3 py-8 text-center text-[15px] text-text-tertiary">
                  {column.state === "queued" ? "Nothing waiting. New orders land here." : column.state === "preparing" ? "Nothing on the go." : "Nothing waiting to go out."}
                </p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                  {dockets.map((docket) => (
                    <li key={docket.orderId} className="rounded-[12px] bg-surface">
                      <div className="flex items-center justify-between gap-3 px-3.5 pb-2 pt-3">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <IconTile kind={channelKindFor(docket.channel)} size="sm" />
                          <span className="min-w-0">
                            <span className="block truncate text-[19px] font-bold leading-6 text-text">{docket.label}</span>
                            <span className="block text-[13px] text-text-secondary">{CHANNEL_TAG[docket.channel] ?? docket.channel}</span>
                          </span>
                        </span>
                        {column.next ? (
                          <DocketClock lines={docket.lines} ageMinutes={ageMinutes} />
                        ) : (
                          <span className="text-[13px] font-semibold text-success">Ready</span>
                        )}
                      </div>

                      <ul className="m-0 list-none p-0">
                        {docket.lines.map((ticket) => (
                          <li key={ticket.lineId} className="flex items-start justify-between gap-3 border-t border-line px-3.5 py-3">
                            <span className="min-w-0 text-[17px] leading-6 text-text">
                              {/* Quantity first and large: the number is what a cook acts on, and "2 ×" read as "1 ×" is a wasted dish. */}
                              <span className="tabular mr-1.5 font-bold">{ticket.qty} ×</span>
                              {ticket.itemName}
                              {ticket.variantName && <span className="text-text-secondary"> ({ticket.variantName})</span>}
                              {ticket.courseName && (
                                <span className="ml-2 align-middle text-[12px] font-semibold uppercase tracking-[0.03em] text-text-secondary">{ticket.courseName}</span>
                              )}
                              {ticket.modifiers.length > 0 && <span className="block text-[15px] font-semibold text-text">+ {ticket.modifiers.join(", ")}</span>}
                              {ticket.lineNote && <span className="block text-[15px] text-accent-ink">“{ticket.lineNote}”</span>}
                            </span>
                            {column.next && column.action && (
                              <CommandButton
                                commands={"verity.dinein.advance_order_line"}
                                size="md"
                                variant={docket.lines.length === 1 ? "primary" : "secondary"}
                                disabled={pending}
                                onClick={() => advance([ticket.lineId], column.next!)}
                                aria-label={`${column.action}: ${ticket.qty} ${ticket.itemName}, ${docket.label}`}
                              >
                                {column.action}
                              </CommandButton>
                            )}
                          </li>
                        ))}
                      </ul>

                      {column.next && column.all && docket.lines.length > 1 && (
                        <div className="border-t border-line p-3">
                          <CommandButton
                            commands={"verity.dinein.advance_order_line"}
                            size="md"
                            variant="primary"
                            className="w-full"
                            disabled={pending}
                            onClick={() => advance(docket.lines.map((l) => l.lineId), column.next!)}
                          >
                            {column.all} {docket.lines.length}
                          </CommandButton>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {recent.length > 0 && (
        <section aria-label="Recent tickets" className="mt-6">
          <h2 className="m-0 mb-2 px-1 text-[13px] font-normal uppercase tracking-[0.02em] text-text-secondary">Recent tickets</h2>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {recent.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/kitchen/ticket/${t.id}`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-surface px-3 text-[14px] text-text no-underline hover:bg-accent-subtle focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-accent-line)]"
                >
                  <Icon name="receipt" size={16} className="text-text-secondary" />
                  <span className="tabular font-semibold">{t.number}</span>
                  <span className="text-text-secondary">{KIND_LABEL[t.kind]}{t.stationName ? `, ${t.stationName}` : ""}</span>
                  <span className="text-accent-ink">{t.prints === 0 ? "Print" : "Reprint"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mb-0 mt-4 text-[12px] text-text-tertiary">
        Refreshes every ten seconds. A dish tapped by mistake is corrected by a manager: there are no backwards steps here, so
        the board always reads as what happened. Sound and printing are choices of this screen only.
      </p>
    </>
  );
}
