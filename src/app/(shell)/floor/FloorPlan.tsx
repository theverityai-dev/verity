"use client";

import { CommandButton, useCommandAccess } from "@/components/ui/CommandAccess";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, ErrorState, Panel, Field, Input } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import type { FloorTable } from "@/server/capabilities/dinein";

/**
 * The floor plan.
 *
 * Colour carries state, and never alone: every table shows its state in words
 * as well, because a colour-only signal fails for a colour-blind waiter and for
 * anyone reading the page aloud.
 *
 * Actions are the ones a waiter takes mid-service, and no more. Everything a
 * manager does to the floor — defining zones, dragging tables into place,
 * retiring one — belongs on the setup page, not on the screen someone is using
 * with three tables waiting.
 */

const STATE_STYLE: Record<string, { dot: string; label: string; tone: string }> = {
  available: { dot: "bg-success", label: "Free", tone: "text-success" },
  occupied: { dot: "bg-accent", label: "Seated", tone: "text-accent-ink" },
  reserved: { dot: "bg-info", label: "Reserved", tone: "text-info" },
  cleaning: { dot: "bg-warning", label: "Cleaning", tone: "text-warning" },
  out_of_service: { dot: "bg-text-tertiary", label: "Out of service", tone: "text-text-tertiary" },
};

export function FloorPlan({ tables, waiting = {} }: { tables: FloorTable[]; waiting?: Record<string, number> }) {
  const router = useRouter();
  const canCommand = useCommandAccess();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [seating, setSeating] = useState<FloorTable | null>(null);
  const [pending, startTransition] = useTransition();

  const zones = useMemo(() => {
    const grouped = new Map<string, { name: string; tables: FloorTable[] }>();
    for (const table of tables) {
      const zone = grouped.get(table.zoneId) ?? { name: table.zoneName, tables: [] };
      zone.tables.push(table);
      grouped.set(table.zoneId, zone);
    }
    return [...grouped.entries()].map(([id, zone]) => ({ id, ...zone }));
  }, [tables]);

  function run(key: string, input: unknown, after?: () => void) {
    setFailure(null);
    startTransition(async () => {
      const result = await runCommand(key, input, "/floor");
      if (result.ok) {
        after?.();
        router.refresh();
      } else {
        setFailure(result);
      }
    });
  }

  async function seat(table: FloorTable, covers: number) {
    setFailure(null);
    startTransition(async () => {
      // Two commands, in order, because they are two facts: the table is now
      // occupied, and there is now an order on it. Collapsing them into one
      // would hide a seated table with no order — which is exactly the state a
      // waiter needs to see when they walk past.
      const occupied = await runCommand(
        "verity.dinein.move_table",
        { tableId: table.id, to: "occupied" },
        "/floor",
      );
      if (!occupied.ok) {
        setFailure(occupied);
        return;
      }
      const order = await runCommand<{ id: string }>(
        "verity.dinein.create_order",
        { tableId: table.id, covers },
        "/floor",
      );
      if (!order.ok) {
        setFailure(order);
        return;
      }
      setSeating(null);
      router.push(`/floor/${order.data.id}`);
    });
  }

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

      {seating && (
        <div className="mb-6">
          <Panel title={`Seat ${seating.label}`}>
            <form
              className="flex flex-wrap items-end gap-3"
              action={(formData) => seat(seating, Number(formData.get("covers") ?? 1))}
            >
              <div className="w-[160px]">
                <Field label="Covers" htmlFor="covers" required>
                  <Input
                    id="covers"
                    name="covers"
                    type="number"
                    min={1}
                    max={seating.seats}
                    defaultValue={Math.min(2, seating.seats)}
                    required
                    autoFocus
                  />
                </Field>
              </div>
              <CommandButton commands={["verity.dinein.move_table","verity.dinein.create_order"]} type="submit" variant="primary" disabled={pending}>
                {pending ? "Seating…" : "Seat and start order"}
              </CommandButton>
              <Button type="button" onClick={() => setSeating(null)} disabled={pending}>
                Cancel
              </Button>
            </form>
          </Panel>
        </div>
      )}

      {zones.map((zone) => (
        <div key={zone.id} className="mb-6">
          <Panel title={zone.name}>
            {/* The plan. Positions are the ones a manager dragged; the grid is
                a fallback for anything that has never been positioned. */}
            <div className="relative min-h-[280px] w-full overflow-x-auto rounded-lg bg-surface-sunken p-4">
              <div className="relative" style={{ minWidth: 640, minHeight: 240 }}>
                {zone.tables.map((table, index) => {
                  const style = STATE_STYLE[table.state] ?? STATE_STYLE.available!;
                  const positioned = table.posX > 0 || table.posY > 0;
                  return (
                    <button
                      key={table.id}
                      type="button"
                      disabled={pending || (table.state === "available"
                        ? !canCommand("verity.dinein.create_order") || !canCommand("verity.dinein.move_table")
                        : table.state === "cleaning" && !canCommand("verity.dinein.move_table"))}
                      onClick={() => {
                        if (table.state === "available") setSeating(table);
                        else if (table.orderId) router.push(`/floor/${table.orderId}`);
                        else if (table.state === "cleaning")
                          run("verity.dinein.move_table", { tableId: table.id, to: "available" });
                      }}
                      className={
                        "absolute flex flex-col justify-between rounded-lg border p-3 text-left " +
                        "transition-[border-color,transform] duration-150 hover:border-line-strong active:translate-y-px " +
                        (table.needsAttention
                          ? "border-warning bg-surface"
                          : table.state === "occupied"
                            ? "border-accent-line bg-accent-subtle"
                            : "border-line bg-surface")
                      }
                      style={{
                        left: positioned ? table.posX : 16 + (index % 5) * 140,
                        top: positioned ? table.posY : 16 + Math.floor(index / 5) * 120,
                        // The size the manager drew, but never smaller than the three lines of text need.
                        width: Math.max(table.width, 124),
                        height: Math.max(table.height, 104),
                      }}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[15px] font-medium text-text">{table.label}</span>
                        <span className="text-[12px] text-text-tertiary">{table.seats} seats</span>
                      </span>

                      <span className="flex items-center gap-2">
                        <span aria-hidden="true" className={`size-2 rounded-full ${style.dot}`} />
                        <span className={`text-[12px] ${style.tone}`}>{style.label}</span>
                        {waiting[table.id] ? <span className="text-[12px] font-medium text-warning">· Guest waiting</span> : null}
                      </span>

                      <span className="text-[12px] text-text-secondary">
                        {table.state === "occupied"
                          ? `${table.covers} covers · ${table.openLines} out · ${table.openMinutes ?? 0} min${table.needsAttention ? ", long" : ""}`
                          : table.state === "cleaning"
                            ? "Tap when clean"
                            : "Tap to seat"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* The same information as a list. Not a fallback nobody maintains:
                it is what a screen reader reads and what a phone shows. */}
            <DataTable
              columns={[
                { key: "label", header: "Table", sortable: true },
                { key: "state", header: "State", sortable: true },
                { key: "covers", header: "Covers", sortable: true },
                { key: "outstanding", header: "Outstanding", numeric: true, sortable: true },
              ]}
              rows={zone.tables.map((table) => ({
                id: table.id,
                tableId: table.id,
                label: table.label,
                state: `${(STATE_STYLE[table.state] ?? STATE_STYLE.available!).label}${waiting[table.id] ? " · guest waiting" : ""}`,
                covers: table.covers ?? "—",
                outstanding: table.openLines,
                tableState: table.state,
                orderId: table.orderId ?? null,
                table_: table,
              }))}
              caption={`${zone.name} tables`}
              rowActions={(row) => (
                <>
                  {row.tableState === "available" && (
                    <CommandButton
                      commands={["verity.dinein.move_table", "verity.dinein.create_order"]}
                      size="sm"
                      disabled={pending}
                      onClick={() => setSeating(row.table_ as FloorTable)}
                    >
                      Seat
                    </CommandButton>
                  )}
                  {row.orderId != null && (
                    <Link
                      href={`/floor/${row.orderId}`}
                      className="text-[13px] text-accent-ink no-underline hover:underline"
                    >
                      Open order
                    </Link>
                  )}
                  {row.tableState === "cleaning" && (
                    <CommandButton
                      commands={"verity.dinein.move_table"}
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        run("verity.dinein.move_table", { tableId: row.tableId, to: "available" })
                      }
                    >
                      Mark clean
                    </CommandButton>
                  )}
                </>
              )}
            />
          </Panel>
        </div>
      ))}
    </>
  );
}
