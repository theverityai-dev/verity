"use client";

import { CommandButton, useCommandAccess } from "@/components/ui/CommandAccess";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EmptyState, ErrorState, Field, Input, Panel, Select } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import type { FloorTable } from "@/server/capabilities/dinein";

const GRID = 20;
const TABLE_W = 110;
const TABLE_H = 84;

/**
 * Lay out the room.
 *
 * Drag to place, and the position saves when the drag ends rather than on every
 * pointer move — a command per pixel would be a hundred writes to record one
 * decision, and the audit trail would be unreadable afterwards.
 *
 * Positions snap to a 20px grid. Not decoration: a room laid out by hand ends up
 * a few pixels off everywhere, and a manager should not have to be precise with
 * a fingertip to get a tidy plan.
 *
 * Keyboard moves the selected table by the same grid step, because a floor plan
 * that can only be built by dragging cannot be built by everyone.
 */
export function FloorEditor({ tables }: { tables: FloorTable[] }) {
  const router = useRouter();
  const canCommand = useCommandAccess();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string | null>(null);
  const [addingTable, setAddingTable] = useState(false);
  const [addingZone, setAddingZone] = useState(false);

  // Positions held locally during a drag so the table follows the finger without
  // a round trip; the server is told once, on release.
  const [drafts, setDrafts] = useState<Record<string, { x: number; y: number }>>({});
  const dragging = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);

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
      const result = await runCommand(key, input, "/floor/setup");
      if (result.ok) {
        after?.();
        router.refresh();
      } else {
        setFailure(result);
      }
    });
  }

  function positionOf(table: FloorTable): { x: number; y: number } {
    return drafts[table.id] ?? { x: table.posX, y: table.posY };
  }

  function snap(value: number): number {
    return Math.max(0, Math.round(value / GRID) * GRID);
  }

  function commit(table: FloorTable, x: number, y: number) {
    const at = { x: snap(x), y: snap(y) };
    setDrafts((current) => ({ ...current, [table.id]: at }));
    if (at.x === table.posX && at.y === table.posY) return;
    run("verity.dinein.position_table", { tableId: table.id, posX: at.x, posY: at.y });
  }

  function nudge(table: FloorTable, dx: number, dy: number) {
    const at = positionOf(table);
    commit(table, at.x + dx * GRID, at.y + dy * GRID);
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

      <div className="mb-4 flex flex-wrap gap-2">
        <CommandButton commands={"verity.dinein.define_zone"} onClick={() => setAddingZone((open) => !open)}>
          {addingZone ? "Cancel" : "New zone"}
        </CommandButton>
        <CommandButton commands={"verity.dinein.define_table"}
          variant="primary"
          disabled={zones.length === 0}
          onClick={() => setAddingTable((open) => !open)}
        >
          {addingTable ? "Cancel" : "New table"}
        </CommandButton>
      </div>

      {addingZone && (
        <div className="mb-6">
          <Panel title="New zone">
            <form
              className="flex flex-wrap items-end gap-3"
              action={(formData) =>
                run(
                  "verity.dinein.define_zone",
                  {
                    name: String(formData.get("name") ?? ""),
                    floorLabel: String(formData.get("floorLabel") ?? "") || undefined,
                  },
                  () => setAddingZone(false),
                )
              }
            >
              <div className="min-w-[220px]">
                <Field label="Zone name" htmlFor="zone-name" required>
                  <Input id="zone-name" name="name" required autoFocus placeholder="Ground Floor" />
                </Field>
              </div>
              <div className="min-w-[160px]">
                <Field label="Floor label" htmlFor="zone-floor">
                  <Input id="zone-floor" name="floorLabel" placeholder="G" />
                </Field>
              </div>
              <CommandButton commands={"verity.dinein.define_zone"} type="submit" variant="primary" disabled={pending}>
                Create
              </CommandButton>
            </form>
          </Panel>
        </div>
      )}

      {addingTable && zones.length > 0 && (
        <div className="mb-6">
          <Panel title="New table">
            <form
              className="flex flex-wrap items-end gap-3"
              action={(formData) =>
                run(
                  "verity.dinein.define_table",
                  {
                    zoneId: String(formData.get("zoneId") ?? ""),
                    label: String(formData.get("label") ?? ""),
                    seats: Number(formData.get("seats") ?? 2),
                    shape: String(formData.get("shape") ?? "") || undefined,
                  },
                  () => setAddingTable(false),
                )
              }
            >
              <div className="min-w-[180px]">
                <Field label="Zone" htmlFor="table-zone" required>
                  <Select id="table-zone" name="zoneId" required>
                    {zones.map((zone) => (
                      <option key={zone.id} value={zone.id}>
                        {zone.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="w-[140px]">
                <Field label="Label" htmlFor="table-label" required>
                  <Input id="table-label" name="label" required placeholder="T-12" />
                </Field>
              </div>
              <div className="w-[110px]">
                <Field label="Seats" htmlFor="table-seats" required>
                  <Input id="table-seats" name="seats" type="number" min={1} max={50} defaultValue={4} required />
                </Field>
              </div>
              <div className="w-[140px]">
                <Field label="Shape" htmlFor="table-shape">
                  <Select id="table-shape" name="shape" defaultValue="">
                    <option value="">Unspecified</option>
                    <option value="round">Round</option>
                    <option value="square">Square</option>
                    <option value="rect">Long</option>
                  </Select>
                </Field>
              </div>
              <CommandButton commands={"verity.dinein.define_table"} type="submit" variant="primary" disabled={pending}>
                Add
              </CommandButton>
            </form>
          </Panel>
        </div>
      )}

      {zones.length === 0 ? (
        <Panel flush>
          <EmptyState
            compact
            title="No zones yet"
            description="A zone is a part of the room — Ground Floor, Terrace. Tables live inside one."
          />
        </Panel>
      ) : (
        zones.map((zone) => (
          <div key={zone.id} className="mb-6">
            <Panel
              title={zone.name}
              action={
                <span className="text-[12px] text-text-tertiary">
                  {zone.tables.length} {zone.tables.length === 1 ? "table" : "tables"}
                </span>
              }
            >
              <div
                className="relative min-h-[320px] w-full touch-none overflow-auto rounded-lg bg-surface-sunken"
                style={{
                  backgroundImage:
                    "radial-gradient(circle, var(--color-line-strong) 1px, transparent 1px)",
                  backgroundSize: `${GRID}px ${GRID}px`,
                }}
                onPointerMove={(event) => {
                  const drag = dragging.current;
                  if (!drag) return;
                  const bounds = event.currentTarget.getBoundingClientRect();
                  setDrafts((current) => ({
                    ...current,
                    [drag.id]: {
                      x: Math.max(0, event.clientX - bounds.left - drag.offsetX),
                      y: Math.max(0, event.clientY - bounds.top - drag.offsetY),
                    },
                  }));
                }}
                onPointerUp={() => {
                  const drag = dragging.current;
                  dragging.current = null;
                  if (!drag) return;
                  const table = tables.find((candidate) => candidate.id === drag.id);
                  const at = drafts[drag.id];
                  if (table && at) commit(table, at.x, at.y);
                }}
              >
                {zone.tables.map((table) => {
                  const at = positionOf(table);
                  const isSelected = selected === table.id;
                  return (
                    <button
                      key={table.id}
                      type="button"
                      disabled={!canCommand("verity.dinein.position_table")}
                      aria-label={`${table.label}, ${table.seats} seats, at ${at.x} by ${at.y}`}
                      aria-pressed={isSelected}
                      onFocus={() => setSelected(table.id)}
                      onKeyDown={(event) => {
                        const moves: Record<string, [number, number]> = {
                          ArrowLeft: [-1, 0],
                          ArrowRight: [1, 0],
                          ArrowUp: [0, -1],
                          ArrowDown: [0, 1],
                        };
                        const move = moves[event.key];
                        if (!move) return;
                        event.preventDefault();
                        nudge(table, move[0], move[1]);
                      }}
                      onPointerDown={(event) => {
                        event.currentTarget.setPointerCapture(event.pointerId);
                        const bounds = event.currentTarget.getBoundingClientRect();
                        dragging.current = {
                          id: table.id,
                          offsetX: event.clientX - bounds.left,
                          offsetY: event.clientY - bounds.top,
                        };
                        setSelected(table.id);
                      }}
                      className={
                        "absolute flex cursor-grab flex-col justify-between rounded-lg border p-2.5 text-left " +
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent " +
                        (isSelected
                          ? "border-accent bg-accent-subtle"
                          : "border-line bg-surface hover:border-line-strong")
                      }
                      style={{
                        left: at.x,
                        top: at.y,
                        width: table.width || TABLE_W,
                        height: table.height || TABLE_H,
                        borderRadius: table.shape === "round" ? "50%" : undefined,
                      }}
                    >
                      <span className="text-[14px] font-medium text-text">{table.label}</span>
                      <span className="text-[12px] text-text-tertiary">{table.seats} seats</span>
                    </button>
                  );
                })}
              </div>

              {zone.tables.filter((t) => t.id === selected).map((table) => (
                <form
                  key={`${table.id}-${table.width}-${table.height}`}
                  className="mt-3 flex flex-wrap items-end gap-3"
                  action={(formData) =>
                    run("verity.dinein.position_table", {
                      tableId: table.id,
                      posX: positionOf(table).x,
                      posY: positionOf(table).y,
                      width: Number(formData.get("width")),
                      height: Number(formData.get("height")),
                    })
                  }
                >
                  <span className="min-h-11 content-center text-[14px] font-medium text-text">Size of {table.label}</span>
                  <div className="w-[110px]">
                    <Field label="Width" htmlFor={`w-${table.id}`}>
                      <Input id={`w-${table.id}`} name="width" type="number" inputMode="numeric" min={40} max={600} step={GRID} defaultValue={table.width} />
                    </Field>
                  </div>
                  <div className="w-[110px]">
                    <Field label="Height" htmlFor={`h-${table.id}`}>
                      <Input id={`h-${table.id}`} name="height" type="number" inputMode="numeric" min={40} max={600} step={GRID} defaultValue={table.height} />
                    </Field>
                  </div>
                  <CommandButton commands={"verity.dinein.position_table"} type="submit" disabled={pending}>
                    Set size
                  </CommandButton>
                </form>
              ))}

              <p className="mb-0 mt-3 text-[12px] text-text-tertiary">
                Drag to place, or select a table and use the arrow keys. Positions snap to the grid
                and save when you let go. Select a table to change its size.
              </p>
            </Panel>
          </div>
        ))
      )}
    </>
  );
}
