"use client";

import Link from "next/link";
import { CommandButton } from "@/components/ui/CommandAccess";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EmptyState, ErrorState, Panel } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import type { CancelledDish, KitchenTicket } from "@/server/capabilities/dinein";

/**
 * The kitchen board.
 *
 * Three columns, because a cook has three questions: what is waiting, what am I
 * on, and what is ready to leave. One list sorted by state would answer none of
 * them at a glance, and glancing is the whole interaction — the reader has their
 * hands full and is standing two feet further away than anyone else using this
 * product.
 *
 * Hence the type sizes, the target sizes, and one tap per move. There is no
 * confirmation dialog: a mis-tap is corrected by a manager, and a modal between
 * a cook and a hot pan is worse than the mistake it prevents.
 *
 * URGENCY is read, never computed here. `urgencyFor()` derives it from the
 * platform's SLA clocks, which are driven by state category. A timer written in
 * this file would be the bump timer DEC-001 excludes.
 *
 * Station views, the "cancelled, confirm" lane, the new-dish sound and automatic
 * ticket printing are ADR-041. The sound and the printing are choices of THIS
 * device (a screen over the pass wants them; a manager's phone does not), so they
 * are kept on the device, not in the tenant's data.
 */

const COLUMNS = [
  { state: "queued", title: "Waiting", next: "preparing", action: "Start" },
  { state: "preparing", title: "On", next: "ready", action: "Ready" },
  { state: "ready", title: "Ready to go", next: null, action: null },
] as const;

const URGENCY_STYLE: Record<string, string> = {
  none: "border-line",
  low: "border-line",
  medium: "border-info/50",
  high: "border-warning/60",
  critical: "border-warning",
  breached: "border-danger",
};

const URGENCY_LABEL: Record<string, string> = {
  none: "",
  low: "",
  medium: "",
  high: "Getting on",
  critical: "Nearly late",
  breached: "Late",
};

const CHANNEL_TAG: Record<string, string> = {
  takeaway: "Takeaway",
  phone: "Phone",
  delivery: "Delivery",
  delivery_platform: "Platform",
  website: "Website",
  qr: "QR",
  corporate: "Corporate",
  catering: "Catering",
};

const chip = (active: boolean) =>
  "inline-flex min-h-11 items-center rounded-full px-4 text-[14px] font-medium no-underline transition-colors " +
  (active ? "bg-accent text-accent-on" : "bg-[var(--color-control)] text-text hover:bg-[var(--color-control-strong)]");

const KIND_LABEL = { new: "New", addition: "Added", void: "Withdrawn" } as const;

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

export function KitchenBoard({
  tickets,
  cancelled,
  stations,
  activeStationId,
  recent,
  nextUnprintedId,
}: {
  tickets: KitchenTicket[];
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

  // Polled, not pushed. D1 records the decision: at Kent's scale a refresh every
  // ten seconds is indistinguishable from a socket, and a socket is a transport
  // to run, secure and reconnect. It becomes worth it above ten devices or below
  // a second, and neither is true here.
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

  const byState = useMemo(() => {
    const grouped = new Map<string, KitchenTicket[]>();
    for (const ticket of tickets) {
      grouped.set(ticket.state, [...(grouped.get(ticket.state) ?? []), ticket]);
    }
    return grouped;
  }, [tickets]);

  function advance(lineId: string, to: string) {
    setFailure(null);
    startTransition(async () => {
      const result = await runCommand("verity.dinein.advance_order_line", { lineId, to }, "/kitchen");
      if (result.ok) router.refresh();
      else setFailure(result);
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

  return (
    <>
      {failure && (
        <div className="mb-4">
          <ErrorState title="That did not happen" message={failure.message} issues={failure.issues} retryable={failure.retryable} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {stations.length > 0 && (
          <nav aria-label="Station" className="flex flex-wrap gap-2">
            <Link href="/kitchen" className={chip(activeStationId === null)}>All stations</Link>
            {stations.map((s) => (
              <Link key={s.id} href={`/kitchen?station=${s.id}`} className={chip(activeStationId === s.id)}>{s.name}</Link>
            ))}
          </nav>
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
            className={chip(sound)}
          >
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
            className={chip(autoPrint)}
          >
            {autoPrint ? "Printing new tickets" : "Print new tickets"}
          </button>
        </span>
      </div>

      {/* The next unprinted ticket opens in a hidden frame that prints itself and records it. */}
      {autoPrint && nextUnprintedId && (
        <iframe key={nextUnprintedId} src={`/kitchen/ticket/${nextUnprintedId}?auto=1`} title="Printing a ticket" className="hidden" />
      )}

      {cancelled.length > 0 && (
        <div className="mb-4">
          <Panel title="Cancelled, please confirm" action={<span className="tabular text-[13px] text-danger">{cancelled.length}</span>}>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {cancelled.map((dish) => (
                <li key={dish.lineId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-danger bg-surface p-3.5">
                  <span className="text-[17px] text-text">
                    <span className="tabular font-medium">{dish.qty} ×</span> {dish.itemName}
                    <span className="ml-2 text-[14px] text-text-secondary">{dish.label}{dish.stationName ? `, ${dish.stationName}` : ""}</span>
                    <span className="ml-2 text-[14px] font-medium text-danger">Stop making this</span>
                  </span>
                  <CommandButton commands={"verity.dinein.acknowledge_cancelled_line"} disabled={pending} onClick={() => acknowledge(dish.lineId)}>
                    Seen
                  </CommandButton>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {COLUMNS.map((column) => {
          const items = byState.get(column.state) ?? [];
          return (
            <Panel key={column.state} title={column.title} action={<span className="tabular text-[13px] text-text-tertiary">{items.length}</span>}>
              {items.length === 0 ? (
                <EmptyState compact title="Nothing here" />
              ) : (
                <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                  {items.map((ticket) => (
                    <li key={ticket.lineId} className={"rounded-lg border-2 bg-surface p-3.5 " + (URGENCY_STYLE[ticket.urgency] ?? "border-line")}>
                      <div className="flex items-baseline justify-between gap-3">
                        {/* Quantity first and large: the number is what a cook
                            acts on, and "2 ×" read as "1 ×" is a wasted dish. */}
                        <span className="text-[17px] text-text">
                          <span className="tabular font-medium">{ticket.qty} ×</span> {ticket.itemName}
                          {ticket.variantName && <span className="text-text-secondary"> ({ticket.variantName})</span>}
                        </span>
                        <span className="shrink-0 text-right text-[14px] font-medium text-text-secondary">
                          {ticket.label}
                          {CHANNEL_TAG[ticket.channel] && <span className="block text-[12px] font-normal text-info">{CHANNEL_TAG[ticket.channel]}</span>}
                        </span>
                      </div>

                      {/* The cook needs the words, not the prices. */}
                      {ticket.courseName && <p className="mb-0 mt-1.5 text-[13px] font-medium text-text-secondary">{ticket.courseName}</p>}
                      {ticket.modifiers.length > 0 && <p className="mb-0 mt-1.5 text-[15px] font-medium text-text">+ {ticket.modifiers.join(", ")}</p>}
                      {ticket.lineNote && <p className="mb-0 mt-1.5 text-[14px] text-accent-ink">{ticket.lineNote}</p>}

                      <div className="mt-3 flex items-center justify-between gap-3">
                        <span className="text-[13px]">
                          {/* Never colour alone: a kitchen light is bad, and a
                              cook may be colour-blind. */}
                          {URGENCY_LABEL[ticket.urgency] ? (
                            <span className={ticket.urgency === "breached" ? "text-danger" : "text-warning"}>
                              {URGENCY_LABEL[ticket.urgency]}
                              {ticket.remainingMinutes !== null &&
                                ` · ${Math.abs(Math.round(ticket.remainingMinutes))} min ${ticket.remainingMinutes < 0 ? "over" : "left"}`}
                            </span>
                          ) : (
                            <span className="text-text-tertiary">
                              {ticket.remainingMinutes === null ? "No target" : `${Math.round(ticket.remainingMinutes)} min left`}
                            </span>
                          )}
                        </span>

                        {column.next && column.action && (
                          <CommandButton commands={"verity.dinein.advance_order_line"} size="md" variant="primary" disabled={pending} onClick={() => advance(ticket.lineId, column.next!)}>
                            {column.action}
                          </CommandButton>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          );
        })}
      </div>

      {recent.length > 0 && (
        <div className="mt-4">
          <Panel title="Recent tickets">
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {recent.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/kitchen/ticket/${t.id}`}
                    className="inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-[var(--color-control)] px-3 text-[14px] text-text no-underline hover:bg-[var(--color-control-strong)]"
                  >
                    <span className="tabular font-medium">{t.number}</span>
                    <span className="text-text-secondary">{KIND_LABEL[t.kind]}{t.stationName ? `, ${t.stationName}` : ""}</span>
                    <span className="text-text-tertiary">{t.prints === 0 ? "Print" : "Reprint"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      <p className="mb-0 mt-4 text-[12px] text-text-tertiary">
        Refreshes every ten seconds. A dish tapped by mistake is corrected by a manager — there are no backwards steps here, so
        that a board always reads as what happened. Sound and printing are choices of this screen only.
      </p>
    </>
  );
}
