"use client";

import { CommandButton } from "@/components/ui/CommandAccess";
import { CommandFailure, useCommand } from "@/components/ui/CommandForm";
import { DataTable } from "@/components/ui/DataTable";
import { Field, Input, Panel, Select } from "@/components/ui/primitives";
import type { PriceRuleView } from "@/server/capabilities/dinein";

function rupees(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Prices that differ by outlet and channel (ADR-043). The item's own price on the
 * Menu stays the base. A rule here says where and from when something else holds;
 * the most specific one that matches the order wins, and the order pad says which.
 * An ended rule stays on the list, so what was charged where remains readable.
 */
export function PricesAdmin({
  items,
  outlets,
  channels,
  rules,
  today,
}: {
  items: Array<{ id: string; name: string; priceMinor: number }>;
  outlets: Array<{ id: string; name: string }>;
  channels: Array<{ value: string; label: string }>;
  rules: PriceRuleView[];
  today: string;
}) {
  const save = useCommand("/menu/prices");
  const end = useCommand("/menu/prices");

  return (
    <div className="flex flex-col gap-6">
      <CommandFailure failure={save.failure} title="Could not save the price" />
      <CommandFailure failure={end.failure} title="Could not end the price" />

      <Panel title="Add a price">
        <form
          className="grid gap-4 sm:grid-cols-3"
          action={(formData) =>
            save.run("verity.dinein.save_menu_price_rule", {
              itemId: String(formData.get("itemId") ?? ""),
              locationId: formData.get("locationId") ? String(formData.get("locationId")) : null,
              channel: formData.get("channel") ? String(formData.get("channel")) : null,
              priceMinor: Math.round(Number(formData.get("price") ?? 0) * 100),
              effectiveFrom: formData.get("from") ? String(formData.get("from")) : undefined,
              effectiveTo: formData.get("to") ? String(formData.get("to")) : null,
            })
          }
        >
          <Field label="Item" htmlFor="pr-item" required>
            <Select id="pr-item" name="itemId" required defaultValue="">
              <option value="" disabled>Choose an item</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>{i.name} ({rupees(i.priceMinor)})</option>
              ))}
            </Select>
          </Field>
          <Field label="Outlet" htmlFor="pr-outlet" hint="Every outlet needs permission over every outlet.">
            <Select id="pr-outlet" name="locationId" defaultValue="">
              <option value="">Every outlet</option>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Order type" htmlFor="pr-channel">
            <Select id="pr-channel" name="channel" defaultValue="">
              <option value="">Any order type</option>
              {channels.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Price (₹)" htmlFor="pr-price" required>
            <Input id="pr-price" name="price" type="number" step="0.01" min="0" required />
          </Field>
          <Field label="From" htmlFor="pr-from" hint="Blank for today.">
            <Input id="pr-from" name="from" type="date" />
          </Field>
          <Field label="Until" htmlFor="pr-to" hint="Blank to keep going.">
            <Input id="pr-to" name="to" type="date" />
          </Field>
          <div className="sm:col-span-3">
            <CommandButton commands={"verity.dinein.save_menu_price_rule"} type="submit" variant="primary" disabled={save.pending}>
              {save.pending ? "Saving…" : "Add price"}
            </CommandButton>
          </div>
        </form>
      </Panel>

      <DataTable
        caption="Prices by outlet and order type"
        emptyTitle="No special prices"
        emptyDescription="Every item sells at its own price everywhere. Add a price above for an outlet or an order type such as a delivery platform."
        columns={[
          { key: "item", header: "Item", sortable: true, subKey: "base" },
          { key: "where", header: "Where", sortable: true },
          { key: "price", header: "Price", numeric: true },
          { key: "when", header: "When" },
          { key: "state", header: "State" },
        ]}
        rows={rules.map((r) => ({
          id: r.id,
          item: r.itemName,
          base: `Own price ${rupees(r.basePriceMinor)}`,
          where: [r.locationName ?? "Every outlet", r.channelLabel ?? "any order type"].join(", "),
          price: rupees(r.priceMinor),
          when: `${r.effectiveFrom}${r.effectiveTo ? ` to ${r.effectiveTo}` : " onwards"}`,
          state: r.overlaps ? "Overlaps another price" : r.current ? "In force" : r.effectiveTo && r.effectiveTo < today ? "Ended" : "Not yet",
        }))}
        rowActions={(row) => {
          const rule = rules.find((r) => r.id === row.id);
          if (!rule || (rule.effectiveTo && rule.effectiveTo < today)) return null;
          return (
            <CommandButton
              commands={"verity.dinein.end_menu_price_rule"}
              size="sm"
              disabled={end.pending}
              onClick={() => end.run("verity.dinein.end_menu_price_rule", { ruleId: rule.id, on: today > rule.effectiveFrom ? today : rule.effectiveFrom })}
            >
              End today
            </CommandButton>
          );
        }}
      />
    </div>
  );
}
