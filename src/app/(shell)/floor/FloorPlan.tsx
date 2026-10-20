"use client";

import { CommandButton, useCommandAccess } from "@/components/ui/CommandAccess";

import { useMemo, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { ErrorState, FilterChipRow, StateBadge } from "@/components/ui/primitives";
import { Modal, ModalCancel } from "@/components/ui/Modal";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import { IconTile } from "@/components/ui/IconTile";
import { Icon } from "@/components/ui/icons";
import { ProgressRing } from "@/components/ui/viz";
import { TABLE_STAGE, present } from "@/components/ui/business/states";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import type { FloorTable } from "@/server/capabilities/dinein";

/**
 * The floor plan (Task 127 §4.2, P-BOARD).
 *
 * A restaurant floor is a place, so a table sits where the manager put it and says three things
 * without a tap: where it is in its service (a pill, dot and word, never colour alone), how long it
 * has been seated against the outlet's "seated too long" setting (a ring that turns red past it),
 * and what is still to come out of the kitchen. On a phone the same tiles fall into a grid: a plan
 * squeezed to 390px is unreadable, and the waiter needs the tables, not the geometry.
 *
 * Actions are the ones a waiter takes mid-service, and no more: seat a free table, open a seated
 * one, mark a cleaned one free. Zones, positions and retiring tables belong on the setup page.
 */

/** Smallest tile that fits the four lines of text; a manager's smaller drawing is grown to it. */
const MIN_W = 148;
const MIN_H = 128;
const GRID_X = 168;
const GRID_Y = 148;

function footerFor(table: FloorTable): string {
  switch (table.stage) {
    case "free":
      return "Tap to seat";
    case "cleaning":
      return "Tap when clean";
    case "reserved":
      return `${table.seats} seats held`;
    case "out_of_service":
      return "Not in use";
    default: {
      const seated = `${table.covers ?? 0} of ${table.seats} seated`;
      if (table.openLines === 0) return table.stage === "seated" ? `${seated} · nothing ordered` : `${seated} · all out`;
      return `${seated} · ${table.openLines} to come`;
    }
  }
}

/** Where a tile stands: the manager's position, or a grid slot for a table never placed. */
function placement(table: FloorTable, index: number) {
  const positioned = table.posX > 0 || table.posY > 0;
  return {
    left: positioned ? table.posX : 16 + (index % 5) * GRID_X,
    top: positioned ? table.posY : 16 + Math.floor(index / 5) * GRID_Y,
    width: Math.max(table.width, MIN_W),
    height: Math.max(table.height, MIN_H),
  };
}

function TableTile({
  table,
  waiting,
  disabled,
  onActivate,
  style,
  className = "",
}: {
  table: FloorTable;
  waiting: number;
  disabled: boolean;
  onActivate: () => void;
  style?: CSSProperties;
  className?: string;
}) {
  const stage = present(TABLE_STAGE, table.stage);
  const seated = table.openMinutes !== null;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onActivate}
      style={style}
      aria-label={`Table ${table.label}, ${stage.label}${seated ? `, seated ${table.openMinutes} minutes` : ""}${waiting ? ", guest waiting" : ""}. ${footerFor(table)}`}
      className={
        "flex flex-col justify-between gap-2 rounded-[12px] bg-surface p-3 text-left " +
        "transition-[transform,background-color] duration-150 ease-out hover:bg-accent-subtle active:scale-[0.98] " +
        "focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-accent-line)] " +
        "disabled:cursor-default disabled:hover:bg-surface disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100 " +
        (table.stage === "out_of_service" ? "opacity-60 " : "") +
        className
      }
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-[20px] font-bold leading-6 text-text">{table.label}</span>
          <span className="block text-[13px] text-text-secondary">{table.seats} seats</span>
        </span>
        {seated ? (
          <ProgressRing
            value={Math.min(table.openMinutes!, table.attentionMinutes)}
            total={table.attentionMinutes}
            tone={table.needsAttention ? "blocked" : "active"}
            centre={`${table.openMinutes}m`}
            size={42}
            label={`Minutes seated, flagged at ${table.attentionMinutes}`}
          />
        ) : (
          <IconTile kind="table" size="sm" />
        )}
      </span>

      <span className="flex flex-wrap items-center gap-1.5">
        <StateBadge category={stage.category} label={stage.label} />
        {table.needsAttention && <span className="text-[12px] font-semibold text-danger">Seated long</span>}
      </span>

      <span className="flex flex-col gap-0.5">
        {waiting > 0 && (
          <span className="flex items-center gap-1 text-[13px] font-semibold text-warning">
            <Icon name="bell" size={14} />
            Guest waiting
          </span>
        )}
        <span className="text-[13px] text-text-secondary">{footerFor(table)}</span>
      </span>
    </button>
  );
}

export function FloorPlan({ tables, waiting = {} }: { tables: FloorTable[]; waiting?: Record<string, number> }) {
  const router = useRouter();
  const canCommand = useCommandAccess();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [seating, setSeating] = useState<FloorTable | null>(null);
  const [covers, setCovers] = useState(2);
  const [zoneFilter, setZoneFilter] = useState<string | null>(null);
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

  const shown = zoneFilter ? zones.filter((zone) => zone.id === zoneFilter) : zones;
  const canSeat = canCommand("verity.dinein.create_order") && canCommand("verity.dinein.move_table");

  function activate(table: FloorTable) {
    if (table.stage === "free") {
      setCovers(Math.min(2, table.seats));
      setSeating(table);
    } else if (table.orderId) {
      router.push(`/floor/${table.orderId}`);
    } else if (table.stage === "cleaning") {
      setFailure(null);
      startTransition(async () => {
        const result = await runCommand("verity.dinein.move_table", { tableId: table.id, to: "available" }, "/floor");
        if (result.ok) router.refresh();
        else setFailure(result);
      });
    }
  }

  function inert(table: FloorTable): boolean {
    if (pending) return true;
    if (table.stage === "free") return !canSeat;
    if (table.stage === "cleaning") return !canCommand("verity.dinein.move_table");
    return !table.orderId;
  }

  function seat(table: FloorTable) {
    setFailure(null);
    startTransition(async () => {
      // Two commands, in order, because they are two facts: the table is now occupied, and there
      // is now an order on it. Collapsing them would hide a seated table with no order, which is
      // exactly the state a waiter needs to see when they walk past.
      const occupied = await runCommand("verity.dinein.move_table", { tableId: table.id, to: "occupied" }, "/floor");
      if (!occupied.ok) {
        setFailure(occupied);
        return;
      }
      const order = await runCommand<{ id: string }>("verity.dinein.create_order", { tableId: table.id, covers }, "/floor");
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
          <ErrorState title="That did not happen" message={failure.message} issues={failure.issues} retryable={failure.retryable} />
        </div>
      )}

      {zones.length > 1 && (
        <FilterChipRow
          className="mb-4"
          chips={[
            { label: "All areas", count: tables.length, active: zoneFilter === null, onClick: () => setZoneFilter(null) },
            ...zones.map((zone) => ({
              label: zone.name,
              count: zone.tables.length,
              active: zoneFilter === zone.id,
              onClick: () => setZoneFilter(zone.id),
            })),
          ]}
        />
      )}

      {tables.length === 0 && (
        <div className="glass-card flex flex-col items-center gap-2 px-6 py-12 text-center">
          <IconTile kind="table" size="lg" />
          <p className="m-0 mt-2 text-[17px] font-semibold text-text">No tables yet</p>
          <p className="m-0 max-w-[42ch] text-[15px] text-text-secondary">
            Add areas and tables in Floor setup, then drag them to where they stand in the room.
          </p>
        </div>
      )}

      {shown.map((zone) => {
        const free = zone.tables.filter((table) => table.stage === "free").length;
        const boxes = zone.tables.map(placement);
        const width = Math.max(640, ...boxes.map((b) => b.left + b.width)) + 16;
        const height = Math.max(240, ...boxes.map((b) => b.top + b.height)) + 16;
        return (
          <section key={zone.id} aria-label={zone.name} className="mb-8">
            <h2 className="m-0 mb-2 px-1 text-[13px] font-normal uppercase tracking-[0.02em] text-text-secondary">
              {zone.name} <span className="normal-case tracking-normal">· {free} free of {zone.tables.length}</span>
            </h2>

            {/* Wide screens: the room as the manager drew it. */}
            <div className="hidden overflow-x-auto rounded-[16px] bg-surface-sunken md:block">
              <div className="relative" style={{ width, height }}>
                {zone.tables.map((table, index) => (
                  <TableTile
                    key={table.id}
                    table={table}
                    waiting={waiting[table.id] ?? 0}
                    disabled={inert(table)}
                    onActivate={() => activate(table)}
                    className="absolute"
                    style={boxes[index]}
                  />
                ))}
              </div>
            </div>

            {/* Phones: the same tiles in a grid, in label order. */}
            <div className="grid grid-cols-2 gap-3 md:hidden">
              {zone.tables.map((table) => (
                <TableTile
                  key={table.id}
                  table={table}
                  waiting={waiting[table.id] ?? 0}
                  disabled={inert(table)}
                  onActivate={() => activate(table)}
                />
              ))}
            </div>
          </section>
        );
      })}

      <Modal
        open={seating !== null}
        onClose={() => !pending && setSeating(null)}
        title={seating ? `Seat table ${seating.label}` : "Seat a table"}
        description="Marks the table seated and opens its order."
        width="sm"
        footer={
          <>
            <ModalCancel onClose={() => setSeating(null)} disabled={pending} />
            <CommandButton
              commands={["verity.dinein.move_table", "verity.dinein.create_order"]}
              variant="primary"
              disabled={pending || seating === null}
              onClick={() => seating && seat(seating)}
            >
              {pending ? "Seating…" : "Seat and start order"}
            </CommandButton>
          </>
        }
      >
        {seating && (
          <div className="flex items-center justify-between gap-4">
            <span>
              <span className="block text-[17px] font-semibold text-text">Guests</span>
              <span className="block text-[13px] text-text-secondary">Up to {seating.seats} at this table</span>
            </span>
            <QuantityStepper value={covers} onChange={setCovers} min={1} max={seating.seats} disabled={pending} label="Guests" />
          </div>
        )}
      </Modal>
    </>
  );
}
