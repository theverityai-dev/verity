"use client";

import { useMemo, useState } from "react";
import { CommandFailure, useCommand } from "@/components/ui/CommandForm";
import { Modal, ModalCancel } from "@/components/ui/Modal";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import type { StockRow } from "./InventoryDesk";

type Result = { adjusted: number; unchanged: number };

/**
 * Physical count for one outlet (PRD §19). Type what is on the shelf, leave
 * blank what was not counted, review the differences, then apply. The server
 * re-reads what the ledger holds when it applies, so a sale that happened while
 * counting does not turn into a false variance.
 */
export function StockCount({ stock, outletName, outletId }: { stock: StockRow[]; outletName: string; outletId: string }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"enter" | "review" | "done">("enter");
  const [category, setCategory] = useState("");
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const command = useCommand("/inventory");

  const items = useMemo(() => stock.filter((s) => s.active), [stock]);
  const categories = useMemo(() => [...new Set(items.map((s) => s.category))].sort(), [items]);
  const visible = category ? items.filter((s) => s.category === category) : items;

  const lines = useMemo(
    () =>
      items
        .filter((s) => (counted[s.id] ?? "").trim() !== "")
        .map((s) => ({ item: s, countedQty: Number(counted[s.id]) })),
    [items, counted],
  );
  const invalid = lines.some((l) => !Number.isInteger(l.countedQty) || l.countedQty < 0);
  const differences = lines.filter((l) => l.countedQty !== l.item.onHandQty);

  function close() {
    setOpen(false);
    setStep("enter");
    setCategory("");
    setCounted({});
    setNote("");
    setResult(null);
    command.clear();
  }

  function apply() {
    command.run<Result>(
      "verity.inventory.apply_stock_count",
      {
        locationId: outletId,
        note: note.trim() || undefined,
        lines: lines.map((l) => ({ itemId: l.item.id, countedQty: l.countedQty })),
      },
      (data) => {
        setResult(data);
        setStep("done");
      },
    );
  }

  const footer =
    step === "enter" ? (
      <>
        <ModalCancel onClose={close} />
        <Button variant="primary" disabled={lines.length === 0 || invalid} onClick={() => setStep("review")}>
          {lines.length === 0 ? "Review differences" : `Review ${lines.length} counted`}
        </Button>
      </>
    ) : step === "review" ? (
      <>
        <Button variant="secondary" onClick={() => setStep("enter")} disabled={command.pending}>Back</Button>
        <Button variant="primary" onClick={apply} disabled={command.pending || differences.length === 0}>
          {command.pending ? "Applying…" : `Apply ${differences.length} ${differences.length === 1 ? "correction" : "corrections"}`}
        </Button>
      </>
    ) : (
      <Button variant="primary" onClick={close}>Done</Button>
    );

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} disabled={items.length === 0}>Count stock</Button>
      <Modal
        open={open}
        onClose={close}
        width="lg"
        title="Count stock"
        description={
          step === "enter"
            ? `Enter what is on the shelf at ${outletName}. Leave an item blank if you did not count it.`
            : step === "review"
              ? "Check the differences. Applying posts each one to the stock ledger under your name."
              : "The count is saved."
        }
        footer={footer}
      >
        {step === "enter" && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Category" htmlFor="count-category">
                <Select id="count-category" value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">All categories</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Note (optional)" htmlFor="count-note">
                <Input id="count-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={150} placeholder="Sunday close" />
              </Field>
            </div>
            <ul className="m-0 flex list-none flex-col p-0">
              {visible.map((s) => {
                const value = counted[s.id] ?? "";
                const n = Number(value);
                const bad = value.trim() !== "" && (!Number.isInteger(n) || n < 0);
                return (
                  <li key={s.id} className="flex items-center gap-3 border-b border-border py-2 last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-medium">{s.name}</div>
                      <div className="text-[13px] text-text-secondary">On hand {s.onHand}</div>
                    </div>
                    <label className="flex items-center gap-2 text-[13px] text-text-secondary">
                      <span className="sr-only">Counted {s.name}</span>
                      <Input
                        inputMode="numeric"
                        value={value}
                        aria-invalid={bad || undefined}
                        onChange={(e) => setCounted((c) => ({ ...c, [s.id]: e.target.value }))}
                        className="w-24 text-right"
                        placeholder="—"
                      />
                      <span className="w-8">{s.unit}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {invalid && <p role="alert" className="m-0 text-[13px] text-danger">Counts must be whole numbers, zero or more.</p>}
          </div>
        )}

        {step === "review" && (
          <div className="flex flex-col gap-4">
            {differences.length === 0 ? (
              <p className="m-0 text-[15px]">
                Everything you counted matches the ledger ({lines.length} {lines.length === 1 ? "item" : "items"}). Nothing to correct.
              </p>
            ) : (
              <ul className="m-0 flex list-none flex-col p-0">
                {differences.map(({ item, countedQty }) => {
                  const diff = countedQty - item.onHandQty;
                  return (
                    <li key={item.id} className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-b-0">
                      <div className="min-w-0">
                        <div className="truncate text-[15px] font-medium">{item.name}</div>
                        <div className="text-[13px] text-text-secondary">Ledger {item.onHand} · counted {countedQty} {item.unit}</div>
                      </div>
                      <span className={`tabular-nums text-[15px] font-semibold ${diff < 0 ? "text-danger" : "text-success"}`}>
                        {diff > 0 ? "+" : ""}{diff} {item.unit}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <CommandFailure failure={command.failure} title="Could not apply the count" />
          </div>
        )}

        {step === "done" && result && (
          <p className="m-0 text-[15px]">
            {result.adjusted === 0
              ? "No differences, so no corrections were needed."
              : `${result.adjusted} ${result.adjusted === 1 ? "item was" : "items were"} corrected.`}
            {result.unchanged > 0 && ` ${result.unchanged} already matched.`}
          </p>
        )}
      </Modal>
    </>
  );
}
