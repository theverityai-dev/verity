"use client";

import { CommandButton } from "@/components/ui/CommandAccess";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorState, FilterChipRow, Input, Panel, StateBadge } from "@/components/ui/primitives";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import { ProgressBar } from "@/components/ui/viz";
import { IconTile } from "@/components/ui/IconTile";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import type { OrderDetail } from "@/server/capabilities/dinein";

type MenuCategory = {
  categoryId: string;
  categoryName: string;
  items: Array<{
    id: string;
    name: string;
    priceMinor: number;
    active: boolean;
    featured: boolean;
    /** Where this price came from when it is not the item's own, e.g. "Delivery platform price". */
    priceSource: string | null;
    variants: Array<{ id: string; name: string; priceDeltaMinor: number }>;
    modifiers: Array<{ id: string; name: string; priceDeltaMinor: number; active: boolean }>;
    /** Why the item cannot be ordered on this order right now, or null. */
    hiddenReason: string | null;
  }>;
};

/** Paise to rupees, for display only. Every calculation stays in paise. */
function rupees(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * A dish's state, in the state system's categories: Pending is somebody's move (the kitchen to start,
 * the waiter to carry), Active is time passing on its own, Completed is done.
 */
const LINE_STATE: Record<string, { label: string; category: string }> = {
  queued: { label: "With the kitchen", category: "Pending" },
  preparing: { label: "Cooking", category: "Active" },
  ready: { label: "On the pass", category: "Pending" },
  served: { label: "Served", category: "Completed" },
  voided: { label: "Voided", category: "Cancelled" },
};

/** Lines that can still be taken off: not yet served and not already voided. */
const VOIDABLE = new Set(["queued", "preparing", "ready"]);

type Line = OrderDetail["lines"][number];

/** Lines grouped into course lanes, starters first. One unnamed lane when no line carries a course. */
function lanesOf(lines: Line[]): Array<{ key: string; name: string | null; lines: Line[] }> {
  if (!lines.some((line) => line.courseName)) return [{ key: "all", name: null, lines }];
  const lanes = new Map<string, { key: string; name: string | null; priority: number; lines: Line[] }>();
  for (const line of lines) {
    const key = line.courseName ?? "";
    const lane = lanes.get(key) ?? { key: key || "none", name: line.courseName ?? "No course", priority: line.coursePriority ?? 999, lines: [] };
    lane.lines.push(line);
    lanes.set(key, lane);
  }
  return [...lanes.values()].sort((a, b) => a.priority - b.priority);
}

/**
 * The order pad (Task 127 §4.2, P-REC).
 *
 * Built for someone standing up, holding a tablet, with a guest waiting: big targets, one tap to add,
 * and the running total always visible. Menu and order sit side by side; on a phone the order follows
 * the menu rather than shrinking both into uselessness. The menu is split by category chips so a long
 * menu is a tap away from its section, and the order is split into course lanes so a waiter reads it
 * the way the kitchen sends it: starters, mains, desserts.
 *
 * Nothing is calculated here that the server will calculate again. The total shown is a courtesy; the
 * bill is computed server-side from the snapshots.
 */
export function OrderPad({ order, menu }: { order: OrderDetail; menu: MenuCategory[] }) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [search, setSearch] = useState("");
  // Show only the special dishes the manager has flagged (Task 126 item 1.9).
  const [specialsOnly, setSpecialsOnly] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  // A note rides on the next item added ("no onion"), then clears, so it can
  // never silently attach to a second dish.
  const [note, setNote] = useState("");
  const [voiding, setVoiding] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  // Add-ons ticked per item before tapping Add; cleared once that item is added,
  // so they never carry over to the next dish.
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  const hasSpecials = useMemo(() => menu.some((c) => c.items.some((item) => item.featured)), [menu]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term && !specialsOnly) return menu;
    return menu
      .map((c) => ({
        ...c,
        items: c.items.filter((item) => item.name.toLowerCase().includes(term) && (!specialsOnly || item.featured)),
      }))
      .filter((c) => c.items.length > 0);
  }, [menu, search, specialsOnly]);
  // A chosen category that the search has emptied falls back to all, rather than showing nothing.
  const activeCategory = filtered.some((c) => c.categoryId === category) ? category : null;
  const categories = activeCategory ? filtered.filter((c) => c.categoryId === activeCategory) : filtered;

  function run(key: string, input: unknown, after?: () => void) {
    setFailure(null);
    startTransition(async () => {
      const result = await runCommand(key, input, `/floor/${order.id}`);
      if (result.ok) {
        after?.();
        router.refresh();
      } else {
        setFailure(result);
      }
    });
  }

  const canAdd = ["draft", "placed", "partially_served"].includes(order.state);
  const toggleAddOn = (itemId: string, modifierId: string) =>
    setPicked((current) => {
      const now = current[itemId] ?? [];
      return { ...current, [itemId]: now.includes(modifierId) ? now.filter((id) => id !== modifierId) : [...now, modifierId] };
    });
  const addLine = (line: { itemId: string; variantId?: string }) =>
    run(
      "verity.dinein.add_order_lines",
      {
        orderId: order.id,
        lines: [{ ...line, qty: 1, lineNote: note.trim() || undefined, modifierIds: (picked[line.itemId] ?? []).length > 0 ? picked[line.itemId] : undefined }],
      },
      () => {
        setNote("");
        setPicked((current) => ({ ...current, [line.itemId]: [] }));
      },
    );
  const canPlace = order.state === "draft" && order.lines.length > 0;
  const live = order.lines.filter((line) => line.state !== "voided");
  const servedCount = live.filter((line) => line.state === "served").length;
  const lanes = lanesOf(order.lines);

  return (
    <>
      {failure && (
        <div className="mb-4">
          <ErrorState title="That did not happen" message={failure.message} issues={failure.issues} retryable={failure.retryable} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_400px] lg:items-start">
        <Panel title="Menu">
          <div className="mb-4 flex flex-col gap-2">
            <label htmlFor="menu-search" className="sr-only">
              Search the menu
            </label>
            <Input id="menu-search" type="search" placeholder="Search the menu" value={search} onChange={(event) => setSearch(event.target.value)} />
            <label htmlFor="line-note" className="sr-only">
              Note for the next item
            </label>
            <Input
              id="line-note"
              placeholder="Note for the next item, e.g. no onion, extra spicy"
              maxLength={200}
              value={note}
              disabled={!canAdd}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          <FilterChipRow
            className="mb-4"
            chips={[
              {
                label: "All",
                count: filtered.reduce((sum, c) => sum + c.items.length, 0),
                active: activeCategory === null && !specialsOnly,
                onClick: () => {
                  setCategory(null);
                  setSpecialsOnly(false);
                },
              },
              ...(hasSpecials ? [{ label: "Specials", icon: "flag" as const, active: specialsOnly, onClick: () => setSpecialsOnly((on) => !on) }] : []),
              ...filtered.map((c) => ({
                label: c.categoryName,
                count: c.items.length,
                active: activeCategory === c.categoryId,
                onClick: () => setCategory(activeCategory === c.categoryId ? null : c.categoryId),
              })),
            ]}
          />

          {!canAdd && (
            <p className="mb-4 mt-0 text-[13px] text-text-secondary">
              This order is {order.state.replace("_", " ")}, so nothing more can be added to it.
            </p>
          )}

          {categories.length === 0 && <p className="m-0 py-8 text-center text-[15px] text-text-secondary">Nothing on the menu matches that.</p>}

          <div className="flex flex-col gap-6">
            {categories.map((c) => (
              <section key={c.categoryId} aria-label={c.categoryName}>
                <h3 className="m-0 mb-2 px-1 text-[13px] font-normal uppercase tracking-[0.02em] text-text-secondary">{c.categoryName}</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {c.items.map((item) => (
                    <div key={item.id} className="flex flex-col gap-2 rounded-[12px] bg-surface-sunken p-3">
                      <span className="flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block text-[15px] font-semibold leading-5 text-text">{item.name}</span>
                          {(item.featured || item.priceSource) && (
                            <span className="block text-[12px] text-text-secondary">
                              {item.featured ? "Special" : ""}
                              {item.featured && item.priceSource ? " · " : ""}
                              {item.priceSource ?? ""}
                            </span>
                          )}
                        </span>
                        <span className="tabular shrink-0 text-[15px] font-semibold text-text">{rupees(item.priceMinor)}</span>
                      </span>

                      {item.hiddenReason ? (
                        <span className="text-[13px] text-text-secondary">{item.hiddenReason}</span>
                      ) : (
                        <>
                          {item.modifiers.length > 0 && (
                            <span className="flex flex-wrap gap-1.5" role="group" aria-label={`Add-ons for ${item.name}`}>
                              {item.modifiers.map((m) => {
                                const on = (picked[item.id] ?? []).includes(m.id);
                                return (
                                  <button
                                    key={m.id}
                                    type="button"
                                    aria-pressed={on}
                                    disabled={!canAdd}
                                    onClick={() => toggleAddOn(item.id, m.id)}
                                    className={
                                      "inline-flex min-h-8 cursor-pointer items-center rounded-full px-3 text-[13px] font-medium transition-colors max-sm:min-h-11 disabled:cursor-not-allowed disabled:opacity-40 " +
                                      (on ? "bg-accent text-accent-on" : "bg-[var(--color-control)] text-text hover:bg-[var(--color-control-strong)]")
                                    }
                                  >
                                    {m.name}
                                    {m.priceDeltaMinor > 0 && <span className="ml-1 opacity-80">+{rupees(m.priceDeltaMinor)}</span>}
                                  </button>
                                );
                              })}
                            </span>
                          )}
                          <span className="flex flex-wrap gap-1.5">
                            <CommandButton commands={"verity.dinein.add_order_lines"} size="sm" variant="primary" disabled={!canAdd || pending} onClick={() => addLine({ itemId: item.id })}>
                              Add
                            </CommandButton>
                            {item.variants.map((variant) => (
                              <CommandButton
                                commands={"verity.dinein.add_order_lines"}
                                key={variant.id}
                                size="sm"
                                disabled={!canAdd || pending}
                                onClick={() => addLine({ itemId: item.id, variantId: variant.id })}
                              >
                                {variant.name}
                                {variant.priceDeltaMinor !== 0 && ` ${variant.priceDeltaMinor > 0 ? "+" : "−"}${rupees(Math.abs(variant.priceDeltaMinor))}`}
                              </CommandButton>
                            ))}
                          </span>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </Panel>

        <div className="lg:sticky lg:top-4">
          <Panel title={`Order · ${live.length} ${live.length === 1 ? "line" : "lines"}`} action={<IconTile kind={order.tableId ? "table" : "channel-takeaway"} size="sm" />}>
            {order.lines.length === 0 ? (
              <p className="m-0 py-6 text-center text-[15px] text-text-secondary">Nothing yet. Tap Add on a dish to start.</p>
            ) : (
              <>
                {live.length > 0 && order.state !== "draft" && (
                  <div className="mb-4">
                    <ProgressBar value={servedCount} total={live.length} tone="completed" label="Dishes served" figures={`${servedCount} of ${live.length} served`} />
                  </div>
                )}

                <div className="flex flex-col gap-4">
                  {lanes.map((lane) => {
                    const laneLive = lane.lines.filter((line) => line.state !== "voided");
                    const laneServed = laneLive.filter((line) => line.state === "served").length;
                    return (
                      <section key={lane.key} aria-label={lane.name ?? "Order lines"}>
                        {lane.name && (
                          <h3 className="m-0 mb-1 flex items-baseline justify-between gap-2 text-[13px] font-normal uppercase tracking-[0.02em] text-text-secondary">
                            {lane.name}
                            {order.state !== "draft" && laneLive.length > 0 && (
                              <span className="tabular normal-case tracking-normal">
                                {laneServed} of {laneLive.length} served
                              </span>
                            )}
                          </h3>
                        )}
                        <ul className="m-0 flex list-none flex-col p-0">
                          {lane.lines.map((line) => {
                            // On a draft order nothing has reached the kitchen yet: the line is still the
                            // waiter's to change, not something to void.
                            const editable = order.state === "draft" && line.state === "queued";
                            const state = editable ? { label: "Not sent yet", category: "Draft" } : (LINE_STATE[line.state] ?? LINE_STATE.queued!);
                            return (
                              <li key={line.id} className="border-t border-line py-3 first:border-t-0">
                                <div className="flex items-start justify-between gap-3">
                                  <span className={"min-w-0 text-[15px] leading-5 " + (line.state === "voided" ? "text-text-tertiary line-through" : "text-text")}>
                                    {!editable && <span className="tabular mr-1 font-semibold">{line.qty} ×</span>}
                                    {line.itemName}
                                    {line.variantName && <span className="text-text-secondary"> ({line.variantName})</span>}
                                    {line.modifiers.length > 0 && (
                                      <span className="block text-[13px] text-text-secondary">+ {line.modifiers.map((m) => m.name).join(", ")}</span>
                                    )}
                                    {line.lineNote && <span className="block text-[13px] text-text-secondary">“{line.lineNote}”</span>}
                                  </span>
                                  <span className="tabular shrink-0 text-[15px] font-semibold text-text">{rupees(line.lineTotalMinor)}</span>
                                </div>
                                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                  <StateBadge category={state.category} label={state.label} />
                                  <span className="flex shrink-0 items-center gap-1.5">
                                    {editable && (
                                      <QuantityStepper
                                        label={line.itemName}
                                        value={line.qty}
                                        max={99}
                                        disabled={pending}
                                        onChange={(qty) => run("verity.dinein.set_order_line_qty", { lineId: line.id, qty })}
                                        onRemove={() => run("verity.dinein.set_order_line_qty", { lineId: line.id, qty: 0 })}
                                      />
                                    )}
                                    {!editable && VOIDABLE.has(line.state) && voiding !== line.id && (
                                      <CommandButton
                                        commands={"verity.dinein.void_order_line"}
                                        size="sm"
                                        variant="ghost"
                                        disabled={pending}
                                        onClick={() => {
                                          setVoiding(line.id);
                                          setVoidReason("");
                                        }}
                                      >
                                        Void
                                      </CommandButton>
                                    )}
                                    {line.state === "ready" && (
                                      <CommandButton
                                        commands={"verity.dinein.advance_order_line"}
                                        size="sm"
                                        variant="primary"
                                        disabled={pending}
                                        onClick={() => run("verity.dinein.advance_order_line", { lineId: line.id, to: "served" })}
                                      >
                                        Mark served
                                      </CommandButton>
                                    )}
                                  </span>
                                </div>
                                {voiding === line.id && (
                                  <form
                                    className="mt-2 flex flex-wrap items-center gap-2"
                                    onSubmit={(event) => {
                                      event.preventDefault();
                                      run("verity.dinein.void_order_line", { lineId: line.id, reason: voidReason.trim() }, () => setVoiding(null));
                                    }}
                                  >
                                    <label htmlFor={`void-${line.id}`} className="sr-only">
                                      Reason for voiding {line.itemName}
                                    </label>
                                    <Input
                                      id={`void-${line.id}`}
                                      className="min-w-0 flex-1"
                                      placeholder="Reason, e.g. guest changed their mind"
                                      maxLength={200}
                                      required
                                      autoFocus
                                      value={voidReason}
                                      onChange={(event) => setVoidReason(event.target.value)}
                                    />
                                    <Button type="submit" size="sm" variant="danger" disabled={pending}>
                                      Void line
                                    </Button>
                                    <Button type="button" size="sm" variant="secondary" onClick={() => setVoiding(null)}>
                                      Keep
                                    </Button>
                                    {line.state === "ready" && (
                                      <p className="m-0 w-full text-[13px] text-text-secondary">This dish is already cooked, so only a manager can void it.</p>
                                    )}
                                  </form>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    );
                  })}
                </div>
              </>
            )}

            <div className="mt-4 flex items-baseline justify-between border-t border-line pt-3">
              <span className="text-[15px] text-text-secondary">Subtotal</span>
              <span className="tabular text-[22px] font-bold text-text">{rupees(order.subtotalMinor)}</span>
            </div>
            <p className="mb-0 mt-1 text-[13px] text-text-tertiary">Taxes are added when the counter raises the bill.</p>

            <div className="mt-4 flex flex-col gap-2">
              {canPlace && (
                <CommandButton commands={"verity.dinein.place_order"} variant="primary" disabled={pending} onClick={() => run("verity.dinein.place_order", { orderId: order.id })}>
                  {pending ? "Sending…" : "Send to kitchen"}
                </CommandButton>
              )}
              {order.state === "served" && <p className="m-0 text-[15px] text-text-secondary">Everything is served. The counter can bill this table.</p>}
              {["draft", "placed", "partially_served"].includes(order.state) && (
                <CommandButton commands={"verity.dinein.cancel_order"} variant="danger" disabled={pending} onClick={() => run("verity.dinein.cancel_order", { orderId: order.id })}>
                  Cancel order
                </CommandButton>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
