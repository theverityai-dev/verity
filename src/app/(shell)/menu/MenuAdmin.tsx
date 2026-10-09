"use client";

import { CommandButton } from "@/components/ui/CommandAccess";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, EmptyState, ErrorState, Field, Input, Panel, Select } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { runCommand, runQuery } from "@/server/actions/platform";
import type { PriceHistory } from "@/server/capabilities/dinein";
import type { ActionFailure } from "@/server/platform/action-error";
import { describeRule, type AvailabilityRule } from "@/lib/menu-availability";
import { AvailabilityEditor } from "./AvailabilityEditor";

const itemColumns: Column[] = [
  { key: "name", header: "Item", sortable: true },
  { key: "price", header: "Price", numeric: true, sortable: true },
  { key: "portions", header: "Portions", sortable: false },
  { key: "addOns", header: "Add-ons", sortable: false },
  { key: "serves", header: "Served", sortable: false },
  { key: "state", header: "State", sortable: true },
];

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
    availability: Array<AvailabilityRule & { id: string; locationName: string | null }>;
  }>;
};

function rupees(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Menu management.
 *
 * Prices are entered in rupees because that is what a manager thinks in, and
 * converted to paise before they leave the browser — the server never sees a
 * decimal amount, so there is nowhere for a rounding error to enter.
 *
 * Retiring is the only way to remove something. The button says "Retire", not
 * "Delete", because that is what it does.
 */
export function MenuAdmin({
  menu,
  outlets,
  channels,
}: {
  menu: MenuCategory[];
  outlets: Array<{ id: string; name: string }>;
  channels: Array<{ value: string; label: string }>;
}) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState(false);
  // One open inline form per screen: editing an item or adding a portion to it.
  const [editing, setEditing] = useState<{ itemId: string; mode: "edit" | "portion" | "addon" | "hours" } | null>(null);
  // The price history being shown, for one item at a time (Task 125 item 3.4).
  const [history, setHistory] = useState<{ itemId: string; data: PriceHistory } | null>(null);

  function showHistory(itemId: string) {
    setFailure(null);
    startTransition(async () => {
      const result = await runQuery<PriceHistory | null>("verity.dinein.list_menu_item_price_history", { itemId });
      if (result.ok && result.data) setHistory({ itemId, data: result.data });
      else if (!result.ok) setFailure(result);
    });
  }
  const [pending, startTransition] = useTransition();

  function run(key: string, input: unknown, after?: () => void) {
    setFailure(null);
    startTransition(async () => {
      const result = await runCommand(key, input, "/menu");
      if (result.ok) {
        after?.();
        router.refresh();
      } else {
        setFailure(result);
      }
    });
  }

  return (
    <>
      {failure && (
        <div className="mb-4">
          <ErrorState
            title="That change was refused"
            message={failure.message}
            issues={failure.issues}
            retryable={failure.retryable}
          />
        </div>
      )}

      <div className="mb-4 flex justify-end">
        <CommandButton commands={"verity.dinein.create_menu_category"} variant="primary" onClick={() => setNewCategory((open) => !open)}>
          {newCategory ? "Cancel" : "New section"}
        </CommandButton>
      </div>

      {newCategory && (
        <div className="mb-6">
          <Panel title="New section">
            <form
              className="flex flex-wrap items-end gap-3"
              action={(formData) =>
                run(
                  "verity.dinein.create_menu_category",
                  { name: String(formData.get("name") ?? "") },
                  () => setNewCategory(false),
                )
              }
            >
              <div className="min-w-[240px]">
                <Field label="Section name" htmlFor="category-name" required>
                  <Input id="category-name" name="name" required autoFocus placeholder="Starters" />
                </Field>
              </div>
              <CommandButton commands={"verity.dinein.create_menu_category"} type="submit" variant="primary" disabled={pending}>
                Create
              </CommandButton>
            </form>
          </Panel>
        </div>
      )}

      {menu.length === 0 ? (
        <Panel flush>
          <EmptyState
            compact
            title="No menu yet"
            description="Create a section, then add what goes in it."
          />
        </Panel>
      ) : (
        <div className="flex flex-col gap-4">
          {menu.map((category) => (
            <Panel
              key={category.categoryId}
              title={category.categoryName}
              action={
                <CommandButton commands={"verity.dinein.create_menu_item"}
                  size="sm"
                  onClick={() =>
                    setAddingTo(addingTo === category.categoryId ? null : category.categoryId)
                  }
                >
                  {addingTo === category.categoryId ? "Close" : "Add item"}
                </CommandButton>
              }
            >
              {addingTo === category.categoryId && (
                <form
                  className="mb-4 flex flex-wrap items-end gap-3 rounded-lg bg-surface-sunken p-3"
                  action={(formData) =>
                    run(
                      "verity.dinein.create_menu_item",
                      {
                        categoryId: category.categoryId,
                        name: String(formData.get("name") ?? ""),
                        // Rupees in, paise out. The server never sees a decimal.
                        priceMinor: Math.round(Number(formData.get("price") ?? 0) * 100),
                        featured: formData.get("featured") === "on",
                      },
                      () => setAddingTo(null),
                    )
                  }
                >
                  <div className="min-w-[220px] flex-1">
                    <Field label="Item" htmlFor={`item-${category.categoryId}`} required>
                      <Input id={`item-${category.categoryId}`} name="name" required autoFocus />
                    </Field>
                  </div>
                  <div className="w-[140px]">
                    <Field label="Price (₹)" htmlFor={`price-${category.categoryId}`} required>
                      <Input
                        id={`price-${category.categoryId}`}
                        name="price"
                        type="number"
                        step="0.01"
                        min="0"
                        required
                      />
                    </Field>
                  </div>
                  <Checkbox name="featured" label="Special dish" className="min-h-11" />
                  <CommandButton commands={"verity.dinein.create_menu_item"} type="submit" variant="primary" disabled={pending}>
                    Add
                  </CommandButton>
                </form>
              )}

              {history && category.items.some((i) => i.id === history.itemId) && (
                <section aria-label={`Price history of ${history.data.itemName}`} className="mb-4 rounded-lg bg-surface-sunken p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h4 className="m-0 text-[15px] font-semibold text-text">Price history of {history.data.itemName}</h4>
                    <Button size="sm" variant="secondary" onClick={() => setHistory(null)}>Close</Button>
                  </div>
                  <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[14px]">
                    {[...history.data.entries].reverse().map((e, i) => (
                      <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="tabular text-text">
                          {e.fromMinor === null ? `Listed at ${rupees(e.toMinor)}` : `${rupees(e.fromMinor)} → ${rupees(e.toMinor)}`}
                        </span>
                        <span className="text-[13px] text-text-secondary">
                          {new Date(e.at).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}
                          {e.by ? `, ${e.by}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="m-0 mt-2 text-[12px] text-text-tertiary">
                    Orders already taken keep the price they were sold at; this shows when the menu price changed.
                  </p>
                </section>
              )}

              {(() => {
                const item = editing && category.items.find((i) => i.id === editing.itemId);
                if (!editing || !item) return null;
                if (editing.mode === "hours") {
                  return (
                    <AvailabilityEditor
                      key={`hours-${item.id}`}
                      itemName={item.name}
                      rules={item.availability}
                      outlets={outlets}
                      channels={channels}
                      pending={pending}
                      onSave={(rules) => run("verity.dinein.set_menu_item_availability", { itemId: item.id, rules }, () => setEditing(null))}
                      onCancel={() => setEditing(null)}
                    />
                  );
                }
                if (editing.mode === "addon") {
                  return (
                    <div key={`addon-${item.id}`} className="mb-4 rounded-lg bg-surface-sunken p-3">
                      <form
                        className="flex flex-wrap items-end gap-3"
                        action={(formData) =>
                          run(
                            "verity.dinein.create_menu_modifier",
                            {
                              itemId: item.id,
                              name: String(formData.get("name") ?? "").trim(),
                              // Rupees in, paise out. Zero is a free option such as "Extra spicy".
                              priceDeltaMinor: Math.round(Number(formData.get("price") ?? 0) * 100),
                            },
                            () => setEditing(null),
                          )
                        }
                      >
                        <div className="min-w-[200px] flex-1">
                          <Field label={`Add-on for ${item.name}`} htmlFor={`addon-name-${item.id}`} required>
                            <Input id={`addon-name-${item.id}`} name="name" required autoFocus maxLength={60} placeholder="Extra cheese" />
                          </Field>
                        </div>
                        <div className="w-[200px]">
                          <Field label="Extra charge (₹)" htmlFor={`addon-price-${item.id}`} hint="0 for a free option." required>
                            <Input id={`addon-price-${item.id}`} name="price" type="number" step="0.01" min="0" defaultValue="0" required />
                          </Field>
                        </div>
                        <CommandButton commands={"verity.dinein.create_menu_modifier"} type="submit" variant="primary" disabled={pending}>
                          Add add-on
                        </CommandButton>
                        <CommandButton commands={"verity.dinein.create_menu_modifier"} type="button" onClick={() => setEditing(null)}>
                          Close
                        </CommandButton>
                      </form>
                      {item.modifiers.length > 0 && (
                        <ul className="m-0 mt-3 flex list-none flex-col gap-1 p-0">
                          {item.modifiers.map((m) => (
                            <li key={m.id} className="flex min-h-11 items-center justify-between gap-3 text-[14px]">
                              <span className={m.active ? "text-text" : "text-text-tertiary line-through"}>
                                {m.name} {m.priceDeltaMinor > 0 ? `+${rupees(m.priceDeltaMinor)}` : "(free)"}
                              </span>
                              <CommandButton
                                commands={"verity.dinein.set_menu_modifier_active"}
                                size="sm"
                                disabled={pending}
                                onClick={() => run("verity.dinein.set_menu_modifier_active", { modifierId: m.id, active: !m.active })}
                              >
                                {m.active ? "Retire" : "Bring back"}
                              </CommandButton>
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="m-0 mt-2 text-[12px] text-text-tertiary">
                        Retiring an add-on stops new orders using it; orders already taken keep what was charged.
                      </p>
                    </div>
                  );
                }
                if (editing.mode === "edit") {
                  return (
                    <form
                      key={`edit-${item.id}`}
                      className="mb-4 flex flex-wrap items-end gap-3 rounded-lg bg-surface-sunken p-3"
                      action={(formData) =>
                        run(
                          "verity.dinein.edit_menu_item",
                          {
                            itemId: item.id,
                            name: String(formData.get("name") ?? "").trim(),
                            // Rupees in, paise out. The server never sees a decimal.
                            priceMinor: Math.round(Number(formData.get("price") ?? 0) * 100),
                            featured: formData.get("featured") === "on",
                          },
                          () => setEditing(null),
                        )
                      }
                    >
                      <div className="min-w-[220px] flex-1">
                        <Field label="Item" htmlFor={`edit-name-${item.id}`} required>
                          <Input id={`edit-name-${item.id}`} name="name" required autoFocus defaultValue={item.name} maxLength={200} />
                        </Field>
                      </div>
                      <div className="w-[140px]">
                        <Field label="Price (₹)" htmlFor={`edit-price-${item.id}`} required>
                          <Input
                            id={`edit-price-${item.id}`}
                            name="price"
                            type="number"
                            step="0.01"
                            min="0"
                            required
                            defaultValue={(item.priceMinor / 100).toFixed(2)}
                          />
                        </Field>
                      </div>
                      <Checkbox name="featured" label="Special dish" defaultChecked={item.featured} className="min-h-11" />
                      <CommandButton commands={"verity.dinein.edit_menu_item"} type="submit" variant="primary" disabled={pending}>
                        Save
                      </CommandButton>
                      <CommandButton commands={"verity.dinein.edit_menu_item"} type="button" onClick={() => setEditing(null)}>
                        Cancel
                      </CommandButton>
                      <p className="m-0 w-full text-[12px] text-text-tertiary">
                        A new price applies to orders from now on; bills already raised keep their price.
                      </p>
                    </form>
                  );
                }
                return (
                  <form
                    key={`portion-${item.id}`}
                    className="mb-4 flex flex-wrap items-end gap-3 rounded-lg bg-surface-sunken p-3"
                    action={(formData) =>
                      run(
                        "verity.dinein.create_menu_variant",
                        {
                          itemId: item.id,
                          name: String(formData.get("name") ?? "").trim(),
                          priceDeltaMinor: Math.round(Number(formData.get("delta") ?? 0) * 100),
                        },
                        () => setEditing(null),
                      )
                    }
                  >
                    <div className="min-w-[200px] flex-1">
                      <Field label={`Portion of ${item.name}`} htmlFor={`portion-name-${item.id}`} required>
                        <Input id={`portion-name-${item.id}`} name="name" required autoFocus maxLength={60} placeholder="Half" />
                      </Field>
                    </div>
                    <div className="w-[200px]">
                      <Field
                        label="Price difference (₹)"
                        htmlFor={`portion-delta-${item.id}`}
                        hint={`Negative if cheaper than ${rupees(item.priceMinor)}.`}
                        required
                      >
                        <Input id={`portion-delta-${item.id}`} name="delta" type="number" step="0.01" required placeholder="-120" />
                      </Field>
                    </div>
                    <CommandButton commands={"verity.dinein.create_menu_variant"} type="submit" variant="primary" disabled={pending}>
                      Add portion
                    </CommandButton>
                    <CommandButton commands={"verity.dinein.create_menu_variant"} type="button" onClick={() => setEditing(null)}>
                      Cancel
                    </CommandButton>
                  </form>
                );
              })()}

              {category.items.length === 0 ? (
                <p className="m-0 text-[13px] text-text-secondary">Nothing in this section yet.</p>
              ) : (
                <DataTable
                  columns={itemColumns}
                  rows={category.items.map((item) => ({
                    id: item.id,
                    itemId: item.id,
                    name: item.name,
                    price: rupees(item.priceMinor),
                    portions:
                      item.variants.length === 0
                        ? "—"
                        : item.variants
                            .map(
                              (variant) =>
                                `${variant.name} ${variant.priceDeltaMinor >= 0 ? "+" : "−"}${rupees(
                                  Math.abs(variant.priceDeltaMinor),
                                )}`,
                            )
                            .join(", "),
                    addOns:
                      item.modifiers.filter((m) => m.active).length === 0
                        ? "—"
                        : item.modifiers
                            .filter((m) => m.active)
                            .map((m) => (m.priceDeltaMinor > 0 ? `${m.name} +${rupees(m.priceDeltaMinor)}` : m.name))
                            .join(", "),
                    serves:
                      item.availability.length === 0
                        ? "Always"
                        : item.availability
                            .map((r) => describeRule(r, { location: () => r.locationName ?? "an outlet", channel: (key) => channels.find((c) => c.value === key)?.label ?? key }))
                            .join("; "),
                    state: item.active ? "On the menu" : "Retired",
                    active: item.active,
                  }))}
                  caption={`${category.categoryName} items`}
                  rowActions={(row) => (
                    <div className="flex flex-wrap gap-2">
                      <CommandButton
                        commands={"verity.dinein.edit_menu_item"}
                        size="sm"
                        disabled={pending}
                        onClick={() => setEditing({ itemId: String(row.itemId), mode: "edit" })}
                      >
                        Edit
                      </CommandButton>
                      <CommandButton
                        commands={"verity.dinein.create_menu_variant"}
                        size="sm"
                        disabled={pending}
                        onClick={() => setEditing({ itemId: String(row.itemId), mode: "portion" })}
                      >
                        Add portion
                      </CommandButton>
                      <CommandButton
                        commands={"verity.dinein.create_menu_modifier"}
                        size="sm"
                        disabled={pending}
                        onClick={() => setEditing({ itemId: String(row.itemId), mode: "addon" })}
                      >
                        Add-ons
                      </CommandButton>
                      <CommandButton
                        commands={"verity.dinein.set_menu_item_availability"}
                        size="sm"
                        disabled={pending}
                        onClick={() => setEditing({ itemId: String(row.itemId), mode: "hours" })}
                      >
                        Hours
                      </CommandButton>
                      <Button size="sm" variant="secondary" disabled={pending} onClick={() => showHistory(String(row.itemId))}>
                        Price history
                      </Button>
                      <CommandButton
                        commands={"verity.dinein.set_menu_item_active"}
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          run("verity.dinein.set_menu_item_active", {
                            itemId: row.itemId,
                            active: !row.active,
                          })
                        }
                      >
                        {row.active ? "Retire" : "Bring back"}
                      </CommandButton>
                    </div>
                  )}
                />
              )}
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
