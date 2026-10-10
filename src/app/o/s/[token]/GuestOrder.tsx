"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Checkbox, Field, Input, Select } from "@/components/ui/primitives";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import type { GuestView } from "@/server/capabilities/dinein/selforder";

type Item = GuestView["menu"][number]["items"][number];
type CartLine = { key: string; item: Item; variantId: string | null; modifierIds: string[]; qty: number };

const rupees = (minor: number) => `₹${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting for a waiter to confirm",
  accepted: "Confirmed",
  rejected: "Not accepted. Please ask a waiter.",
};

/** What one cart line costs, as the page can tell it. The outlet prices the real order itself. */
function lineEstimate(line: CartLine): number {
  const variant = line.item.variants.find((v) => v.id === line.variantId);
  const add = line.modifierIds.reduce((sum, id) => sum + (line.item.modifiers.find((m) => m.id === id)?.priceDeltaMinor ?? 0), 0);
  return (line.item.priceMinor + (variant?.priceDeltaMinor ?? 0) + add) * line.qty;
}

/**
 * A guest's phone screen (ADR-042). iOS grouped lists: a large title, opaque cells, footnote section
 * headers, 17pt body. The guest names items; the outlet prices and checks them, so totals here are
 * an estimate and say so. An order is a request until a waiter confirms it, and the page says that
 * too rather than implying the kitchen has it.
 */
export function GuestOrder({ token, initial }: { token: string; initial: GuestView }) {
  const [view, setView] = useState(initial);
  const [ended, setEnded] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [picks, setPicks] = useState<Record<string, { variantId: string; modifierIds: string[] }>>({});
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  // One key per attempt, kept until it succeeds so a retry cannot send the order twice.
  const attempt = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/self-order/${token}`, { cache: "no-store" });
    if (response.status === 404) return setEnded(true);
    if (!response.ok) return;
    const body = (await response.json()) as { view: GuestView };
    setView(body.view);
  }, [token]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const total = useMemo(() => cart.reduce((sum, line) => sum + lineEstimate(line), 0), [cart]);
  const pickup = view.kind === "pickup";

  function add(item: Item) {
    const pick = picks[item.id] ?? { variantId: "", modifierIds: [] };
    const variantId = pick.variantId || null;
    const key = [item.id, variantId ?? "", [...pick.modifierIds].sort().join(",")].join("|");
    setCart((lines) => {
      const existing = lines.find((l) => l.key === key);
      if (existing) return lines.map((l) => (l.key === key ? { ...l, qty: Math.min(20, l.qty + 1) } : l));
      return [...lines, { key, item, variantId, modifierIds: pick.modifierIds, qty: 1 }];
    });
    setNotice(null);
  }

  async function post(payload: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(`/api/self-order/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload),
    });
    if (response.status === 404) {
      setEnded(true);
      return null;
    }
    const body = (await response.json()) as { ok: boolean; message?: string; result?: { status?: string } };
    if (!response.ok || !body.ok) throw new Error((body.message ?? "That did not go through. Please try again.").replace(/^E_[A-Z_]+:\s*/, ""));
    return body.result ?? {};
  }

  async function send() {
    if (cart.length === 0 || busy) return;
    setBusy(true);
    setNotice(null);
    attempt.current ??= crypto.randomUUID().replaceAll("-", "");
    try {
      const result = await post(
        {
          action: "submit",
          customerName: name.trim() || undefined,
          customerPhone: phone.trim() || undefined,
          lines: cart.map((l) => ({ itemId: l.item.id, variantId: l.variantId ?? undefined, modifierIds: l.modifierIds.length ? l.modifierIds : undefined, qty: l.qty })),
        },
        { "Idempotency-Key": attempt.current },
      );
      if (!result) return;
      attempt.current = null;
      setCart([]);
      setNotice({
        tone: "ok",
        text: result.status === "accepted" ? "Added to your table's order." : "Sent. A waiter will confirm it shortly.",
      });
      await refresh();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "That did not go through. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  async function call(kind: "waiter" | "bill") {
    setBusy(true);
    setNotice(null);
    try {
      await post({ action: "request", kind });
      await refresh();
      setNotice({ tone: "ok", text: kind === "bill" ? "We have let them know you would like the bill." : "A waiter is on the way." });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "That did not go through. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  if (ended) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-2 px-5 py-16">
        <h1 className="m-0 text-[34px] font-bold leading-[41px] tracking-[-0.02em] text-text">This visit has ended</h1>
        <p className="m-0 text-[17px] text-text-secondary">Please scan the code on your table again, or ask a waiter.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 pb-28 pt-8">
      <header className="flex flex-col gap-1 px-1">
        <p className="m-0 text-[13px] uppercase tracking-[0.02em] text-text-secondary">{view.outletName}</p>
        <h1 className="m-0 text-[34px] font-bold leading-[41px] tracking-[-0.02em] text-text">{pickup ? "Order for pickup" : `Table ${view.tableLabel}`}</h1>
      </header>

      <div role="status" aria-live="polite">
        {notice && (
          <p className={`m-0 rounded-[12px] px-4 py-3 text-[15px] ${notice.tone === "ok" ? "bg-[var(--color-control)] text-text" : "bg-[var(--color-control)] text-danger"}`}>{notice.text}</p>
        )}
      </div>

      {view.submissions.length > 0 && (
        <section aria-labelledby="sent" className="flex flex-col gap-2">
          <h2 id="sent" className="m-0 px-1 text-[13px] font-normal uppercase tracking-[0.02em] text-text-secondary">Your orders</h2>
          <ul className="glass-card m-0 flex list-none flex-col rounded-[12px] p-0">
            {view.submissions.map((s) => (
              <li key={s.id} className="flex flex-col gap-1 border-t border-line px-4 py-3 first:border-0">
                <span className="text-[17px] text-text">{s.lines.map((l) => `${l.qty} × ${l.name}`).join(", ")}</span>
                <span className="text-[13px] text-text-secondary">{STATUS_LABEL[s.status] ?? s.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.menu.map((category) => (
        <section key={category.categoryName} aria-label={category.categoryName} className="flex flex-col gap-2">
          <h2 className="m-0 px-1 text-[13px] font-normal uppercase tracking-[0.02em] text-text-secondary">{category.categoryName}</h2>
          <ul className="glass-card m-0 flex list-none flex-col rounded-[12px] p-0">
            {category.items.map((item) => {
              const pick = picks[item.id] ?? { variantId: "", modifierIds: [] };
              return (
                <li key={item.id} className="flex flex-col gap-3 border-t border-line px-4 py-3 first:border-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[17px] font-medium text-text">{item.name}</span>
                    <span className="shrink-0 text-[15px] text-text-secondary">{rupees(item.priceMinor)}</span>
                  </div>
                  {item.variants.length > 0 && (
                    <Field label="Portion" htmlFor={`v-${item.id}`}>
                      <Select
                        id={`v-${item.id}`}
                        value={pick.variantId}
                        onChange={(e) => setPicks((p) => ({ ...p, [item.id]: { ...pick, variantId: e.target.value } }))}
                      >
                        <option value="">Regular</option>
                        {item.variants.map((v) => (
                          <option key={v.id} value={v.id}>{v.name}{v.priceDeltaMinor ? ` (+${rupees(v.priceDeltaMinor)})` : ""}</option>
                        ))}
                      </Select>
                    </Field>
                  )}
                  {item.modifiers.map((m) => (
                    <Checkbox
                      key={m.id}
                      checked={pick.modifierIds.includes(m.id)}
                      onChange={(e) =>
                        setPicks((p) => ({
                          ...p,
                          [item.id]: { ...pick, modifierIds: e.target.checked ? [...pick.modifierIds, m.id] : pick.modifierIds.filter((id) => id !== m.id) },
                        }))
                      }
                      label={`${m.name}${m.priceDeltaMinor ? ` (+${rupees(m.priceDeltaMinor)})` : ""}`}
                    />
                  ))}
                  <div>
                    <Button size="sm" onClick={() => add(item)}>Add to my order</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {cart.length > 0 && (
        <section aria-labelledby="cart" className="flex flex-col gap-2">
          <h2 id="cart" className="m-0 px-1 text-[13px] font-normal uppercase tracking-[0.02em] text-text-secondary">Ready to send</h2>
          <ul className="glass-card m-0 flex list-none flex-col rounded-[12px] p-0">
            {cart.map((line) => (
              <li key={line.key} className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 first:border-0">
                <span className="flex min-w-0 flex-col">
                  <span className="text-[17px] text-text">{line.item.name}</span>
                  <span className="text-[13px] text-text-secondary">
                    {[line.item.variants.find((v) => v.id === line.variantId)?.name, ...line.modifierIds.map((id) => line.item.modifiers.find((m) => m.id === id)?.name)].filter(Boolean).join(", ") || rupees(lineEstimate(line) / line.qty)}
                  </span>
                </span>
                <QuantityStepper
                  label={line.item.name}
                  value={line.qty}
                  min={1}
                  max={20}
                  onChange={(qty) => setCart((lines) => lines.map((l) => (l.key === line.key ? { ...l, qty } : l)))}
                  onRemove={() => setCart((lines) => lines.filter((l) => l.key !== line.key))}
                />
              </li>
            ))}
          </ul>
          {pickup && (
            <div className="glass-card flex flex-col gap-3 rounded-[12px] p-4">
              <Field label="Your name" htmlFor="guest-name">
                <Input id="guest-name" value={name} maxLength={80} autoComplete="given-name" onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Phone number" htmlFor="guest-phone" hint="We use it only to reach you about this order." required>
                <Input id="guest-phone" value={phone} inputMode="tel" autoComplete="tel" onChange={(e) => setPhone(e.target.value)} />
              </Field>
            </div>
          )}
          <p className="m-0 px-1 text-[13px] text-text-secondary">
            About {rupees(total)}. The outlet confirms the final price. Taxes are added on the bill.
          </p>
          <Button variant="primary" disabled={busy || (pickup && phone.trim().length < 7)} onClick={() => void send()}>
            {busy ? "Sending…" : "Send to the restaurant"}
          </Button>
        </section>
      )}

      {!pickup && (
        <section aria-label="Ask for help" className="flex gap-3">
          <Button className="flex-1" disabled={busy || view.openRequests.includes("waiter")} onClick={() => void call("waiter")}>
            {view.openRequests.includes("waiter") ? "Waiter called" : "Call a waiter"}
          </Button>
          <Button className="flex-1" disabled={busy || view.openRequests.includes("bill")} onClick={() => void call("bill")}>
            {view.openRequests.includes("bill") ? "Bill requested" : "Ask for the bill"}
          </Button>
        </section>
      )}
      <p className="m-0 px-1 text-[13px] text-text-tertiary">You pay at the counter. Nothing is charged by sending an order.</p>
    </main>
  );
}
