"use client";

import { CommandButton } from "@/components/ui/CommandAccess";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorState, Input, Panel } from "@/components/ui/primitives";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
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

const LINE_STATE: Record<string, { label: string; tone: string }> = {
  queued: { label: "With kitchen", tone: "text-text-secondary" },
  preparing: { label: "Cooking", tone: "text-info" },
  ready: { label: "On the pass", tone: "text-accent-ink" },
  served: { label: "Served", tone: "text-success" },
  voided: { label: "Voided", tone: "text-text-tertiary line-through" },
};

/** Lines that can still be taken off: not yet served and not already voided. */
const VOIDABLE = new Set(["queued", "preparing", "ready"]);

/**
 * The order pad.
 *
 * Built for someone standing up, holding a tablet, with a guest waiting: big
 * targets, one tap to add, and the running total always visible. The
 * side-by-side layout collapses to menu-then-order on a phone rather than
 * shrinking both into uselessness.
 *
 * Nothing is calculated here that the server will calculate again. The total
 * shown is a courtesy; the bill is computed server-side from the snapshots.
 */
export function OrderPad({ order, menu }: { order: OrderDetail; menu: MenuCategory[] }) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [search, setSearch] = useState("");
  // Show only the special dishes the manager has flagged (Task 126 item 1.9).
  const [specialsOnly, setSpecialsOnly] = useState(false);
  // A note rides on the next item added ("no onion"), then clears, so it can
  // never silently attach to a second dish.
  const [note, setNote] = useState("");
  const [voiding, setVoiding] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  // Add-ons ticked per item before tapping Add; cleared once that item is added,
  // so they never carry over to the next dish.
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  const hasSpecials = useMemo(() => menu.some((category) => category.items.some((item) => item.featured)), [menu]);
  const categories = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term && !specialsOnly) return menu;
    return menu
      .map((category) => ({
        ...category,
        items: category.items.filter(
          (item) => item.name.toLowerCase().includes(term) && (!specialsOnly || item.featured),
        ),
      }))
      .filter((category) => category.items.length > 0);
  }, [menu, search, specialsOnly]);

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
  const servedCount = order.lines.filter((line) => line.state === "served").length;
  const liveCount = order.lines.filter((line) => line.state !== "voided").length;

  return (
    <>
      {failure && (
        <div className="mb-4">
          <ErrorState
            title="That did not happen"
            message={failure.message}
            issues={failure.issues}
            retryable={failure.retryable}
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <Panel title="Menu">
          <div className="mb-4">
            <label htmlFor="menu-search" className="sr-only">
              Search the menu
            </label>
            <Input
              id="menu-search"
              type="search"
              placeholder="Search the menu"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {hasSpecials && (
              <button
                type="button"
                aria-pressed={specialsOnly}
                onClick={() => setSpecialsOnly((on) => !on)}
                className={
                  "mt-2 inline-flex min-h-11 items-center rounded-full px-4 text-[14px] font-medium transition-colors " +
                  (specialsOnly ? "bg-accent text-accent-on" : "bg-[var(--color-control)] text-text hover:bg-[var(--color-control-strong)]")
                }
              >
                Specials only
              </button>
            )}
            <label htmlFor="line-note" className="sr-only">
              Note for the next item
            </label>
            <Input
              id="line-note"
              className="mt-2"
              placeholder="Note for the next item, e.g. no onion, extra spicy"
              maxLength={200}
              value={note}
              disabled={!canAdd}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          {!canAdd && (
            <p className="mb-4 mt-0 text-[13px] text-text-secondary">
              This order is {order.state.replace("_", " ")} — nothing more can be added to it.
            </p>
          )}

          <div className="flex flex-col gap-5">
            {categories.map((category) => (
              <section key={category.categoryId}>
                <h3 className="mb-2">{category.categoryName}</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {category.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-[12px] bg-surface-sunken px-3 py-2.5"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] text-text">{item.name}</span>
                        <span className="text-[12px] text-text-tertiary">
                          {rupees(item.priceMinor)}
                          {item.featured ? " · Special" : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 gap-1.5">
                        <CommandButton commands={"verity.dinein.add_order_lines"}
                          size="sm"
                          disabled={!canAdd || pending || item.hiddenReason !== null}
                          onClick={() => addLine({ itemId: item.id })}
                        >
                          Add
                        </CommandButton>
                        {item.variants.map((variant) => (
                          <CommandButton commands={"verity.dinein.add_order_lines"}
                            key={variant.id}
                            size="sm"
                            disabled={!canAdd || pending || item.hiddenReason !== null}
                            onClick={() => addLine({ itemId: item.id, variantId: variant.id })}
                          >
                            {variant.name}
                          </CommandButton>
                        ))}
                      </span>
                      {item.hiddenReason && <span className="w-full text-[12px] text-text-secondary">{item.hiddenReason}</span>}
                      {item.modifiers.length > 0 && !item.hiddenReason && (
                        <span className="flex w-full flex-wrap gap-1.5" role="group" aria-label={`Add-ons for ${item.name}`}>
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
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel title={`Order · ${liveCount} ${liveCount === 1 ? "line" : "lines"}`}>
            {order.lines.length === 0 ? (
              <p className="m-0 text-[13px] text-text-secondary">
                Nothing yet. Tap an item to start.
              </p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {order.lines.map((line) => {
                  // On a draft order nothing has reached the kitchen yet: the line
                  // is still the waiter's to change, not something to void.
                  const editable = order.state === "draft" && line.state === "queued";
                  const state = editable ? { label: "Not sent yet", tone: "text-text-secondary" } : (LINE_STATE[line.state] ?? LINE_STATE.queued!);
                  return (
                    <li key={line.id} className="border-b border-line pb-2 last:border-b-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 text-[14px] text-text">
                          {editable ? "" : `${line.qty} × `}{line.itemName}
                          {line.variantName && (
                            <span className="text-text-tertiary"> ({line.variantName})</span>
                          )}
                          {line.modifiers.length > 0 && (
                            <span className="block text-[12px] text-text-secondary">
                              {line.modifiers.map((m) => m.name).join(", ")}
                            </span>
                          )}
                        </span>
                        <span className="tabular shrink-0 text-[14px]">
                          {rupees(line.lineTotalMinor)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-3">
                        <span className={`text-[12px] ${state.tone}`}>{state.label}</span>
                        <span className="flex shrink-0 gap-1.5">
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
                          <CommandButton commands={"verity.dinein.void_order_line"}
                            size="sm"
                            variant="secondary"
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
                          <CommandButton commands={"verity.dinein.advance_order_line"}
                            size="sm"
                            disabled={pending}
                            onClick={() =>
                              run("verity.dinein.advance_order_line", {
                                lineId: line.id,
                                to: "served",
                              })
                            }
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
                            run(
                              "verity.dinein.void_order_line",
                              { lineId: line.id, reason: voidReason.trim() },
                              () => setVoiding(null),
                            );
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
                            <p className="m-0 w-full text-[12px] text-text-tertiary">
                              This dish is already cooked, so only a manager can void it.
                            </p>
                          )}
                        </form>
                      )}
                      {line.lineNote && (
                        <p className="mb-0 mt-1 text-[12px] text-text-tertiary">{line.lineNote}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="mt-4 flex items-baseline justify-between border-t border-line pt-3">
              <span className="text-[13px] text-text-secondary">Subtotal</span>
              <span className="tabular text-[16px] text-text">{rupees(order.subtotalMinor)}</span>
            </div>
            <p className="mb-0 mt-1 text-[12px] text-text-tertiary">
              Taxes are added when the counter generates the bill.
            </p>
          </Panel>

          <Panel title="Service">
            <div className="flex flex-col gap-2">
              {canPlace && (
                <CommandButton commands={"verity.dinein.place_order"}
                  variant="primary"
                  disabled={pending}
                  onClick={() => run("verity.dinein.place_order", { orderId: order.id })}
                >
                  {pending ? "Sending…" : "Send to kitchen"}
                </CommandButton>
              )}

              {order.state === "served" && (
                <p className="m-0 text-[13px] text-text-secondary">
                  Everything is served. The counter can bill this table.
                </p>
              )}

              {["draft", "placed", "partially_served"].includes(order.state) && (
                <CommandButton commands={"verity.dinein.cancel_order"}
                  variant="danger"
                  disabled={pending}
                  onClick={() => run("verity.dinein.cancel_order", { orderId: order.id })}
                >
                  Cancel order
                </CommandButton>
              )}

              <p className="mb-0 mt-1 text-[12px] text-text-tertiary">
                {servedCount} of {liveCount} served.
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
