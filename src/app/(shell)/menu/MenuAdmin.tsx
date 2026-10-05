"use client";

import { CommandButton } from "@/components/ui/CommandAccess";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EmptyState, ErrorState, Field, Input, Panel, Select } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

const itemColumns: Column[] = [
  { key: "name", header: "Item", sortable: true },
  { key: "price", header: "Price", numeric: true, sortable: true },
  { key: "portions", header: "Portions", sortable: false },
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
    variants: Array<{ id: string; name: string; priceDeltaMinor: number }>;
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
export function MenuAdmin({ menu }: { menu: MenuCategory[] }) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState(false);
  // One open inline form per screen: editing an item or adding a portion to it.
  const [editing, setEditing] = useState<{ itemId: string; mode: "edit" | "portion" } | null>(null);
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
                  <CommandButton commands={"verity.dinein.create_menu_item"} type="submit" variant="primary" disabled={pending}>
                    Add
                  </CommandButton>
                </form>
              )}

              {(() => {
                const item = editing && category.items.find((i) => i.id === editing.itemId);
                if (!editing || !item) return null;
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
