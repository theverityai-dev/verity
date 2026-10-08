"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import dayjs, { type Dayjs } from "dayjs";
import { Icon } from "./icons";
import { PolishedSelect } from "./PolishedSelect";
import { prefersReducedMotion, reducedMotionFade, springDefault } from "@/lib/motion";

/**
 * In-house Date/DateTime fields — Verity's design system had no themed
 * replacement for `<input type="date"|"datetime-local">`, so every form
 * needing one (`TaskPanel`, `MeetingPanel`, and any future capability)
 * reached for the native control, which renders the OS's own calendar
 * flyout regardless of any CSS applied to the closed field — the one part
 * of the picker CSS can never theme (`::-webkit-calendar-picker-indicator`
 * only skins the trigger icon, never the popup). `verity-client-capability-
 * builder`'s "every input control uses Verity's own design-system
 * components" rule names this exact gap.
 *
 * Popover mechanics (portal, fixed-position anchor measurement that flips
 * above/below and stays clipping-safe inside a `<dialog>`, spring motion,
 * outside-click/Escape close) are lifted directly from `Combobox.tsx` —
 * same problem (a floating panel that must never be clipped by a modal's
 * `overflow-y-auto` body or trapped under its top-layer stacking), same
 * fix, so this doesn't invent a second popover system next to the first.
 *
 * Time selection uses two themed `<select>`s (hour, 5-minute steps) rather
 * than a from-scratch scroll wheel — `Select` is already this codebase's
 * accepted themed-native-control pattern (used everywhere), unlike a date
 * input which has no partially-themeable middle ground at all.
 */

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDateLabel(d: Dayjs): string {
  return d.format("D MMM YYYY");
}

function formatTimeLabel(d: Dayjs): string {
  return d.format("h:mm A");
}

type Anchor = { left: number; top: number; width: number; above: boolean };

/** Shared positioning: mirrors Combobox's own anchor/host measurement exactly. */
function usePopoverAnchor(open: boolean, rootRef: React.RefObject<HTMLDivElement | null>) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);

  const measure = useCallback(() => {
    const field = rootRef.current;
    if (!field) return;
    const box = field.getBoundingClientRect();
    const panelHeight = 360;
    const below = window.innerHeight - box.bottom - 8;
    const above = box.top - 8;
    const openAbove = below < panelHeight && above > below;
    setAnchor({
      left: box.left,
      width: box.width,
      top: openAbove ? box.top - 4 : box.bottom + 4,
      above: openAbove,
    });
  }, [rootRef]);

  useLayoutEffect(() => {
    if (!open) return;
    setHost(rootRef.current?.closest("dialog") ?? document.body);
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open, measure, rootRef]);

  return { anchor, host };
}

function useOutsideClose(open: boolean, close: () => void, refs: Array<React.RefObject<HTMLElement | null>>) {
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (refs.some((ref) => ref.current?.contains(target))) return;
      close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  });
}

/** A month grid. `selected` and `onSelect` carry day-precision only — time lives outside this. */
function MonthGrid({
  viewMonth,
  onViewMonthChange,
  selected,
  onSelect,
  min,
}: {
  viewMonth: Dayjs;
  onViewMonthChange: (d: Dayjs) => void;
  selected: Dayjs | null;
  onSelect: (d: Dayjs) => void;
  min?: Dayjs;
}) {
  const today = dayjs();
  const startOfMonth = viewMonth.startOf("month");
  const gridStart = startOfMonth.subtract(startOfMonth.day(), "day");
  const days = Array.from({ length: 42 }, (_, i) => gridStart.add(i, "day"));

  return (
    <div className="w-[280px] p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => onViewMonthChange(viewMonth.subtract(1, "month"))}
          className="grid size-8 max-sm:size-11 cursor-pointer place-items-center rounded-md border-none bg-transparent text-text-secondary transition-colors hover:bg-surface-sunken hover:text-text"
        >
          <Icon name="chevronRight" size={14} className="rotate-180" />
        </button>
        <span className="text-[13px] font-medium text-text">{viewMonth.format("MMMM YYYY")}</span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => onViewMonthChange(viewMonth.add(1, "month"))}
          className="grid size-8 max-sm:size-11 cursor-pointer place-items-center rounded-md border-none bg-transparent text-text-secondary transition-colors hover:bg-surface-sunken hover:text-text"
        >
          <Icon name="chevronRight" size={14} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {WEEKDAY_LABELS.map((w, i) => (
          <span key={i} aria-hidden="true" className="grid h-7 place-items-center text-[12px] text-text-tertiary">
            {w}
          </span>
        ))}
        {days.map((d) => {
          const inMonth = d.month() === viewMonth.month();
          const isSelected = selected != null && d.isSame(selected, "day");
          const isToday = d.isSame(today, "day");
          const disabled = min != null && d.isBefore(min, "day");
          return (
            <button
              key={d.format("YYYY-MM-DD")}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(d)}
              aria-current={isToday ? "date" : undefined}
              aria-pressed={isSelected}
              className={
                "grid h-8 max-sm:h-11 cursor-pointer place-items-center rounded-md text-[13px] transition-colors " +
                (disabled
                  ? "cursor-not-allowed text-text-tertiary opacity-40"
                  : isSelected
                    ? "bg-accent font-medium text-accent-on"
                    : isToday
                      ? "font-medium text-accent-ink hover:bg-surface-sunken"
                      : inMonth
                        ? "text-text hover:bg-surface-sunken"
                        : "text-text-tertiary hover:bg-surface-sunken")
              }
            >
              {d.date()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function fieldShellClass(disabled?: boolean) {
  return (
    "bg-control flex h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-[10px] px-4 text-[14px] " +
    "transition-[border-color,box-shadow] duration-200 hover:border-line-strong " +
    "focus-within:border-accent focus-within:shadow-[var(--shadow-highlight),0_0_0_3px_var(--color-accent-subtle)] " +
    (disabled ? "cursor-not-allowed opacity-55 " : "")
  );
}

function ClearGlyph({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClear();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onClear();
        }
      }}
      className="grid size-5 cursor-pointer place-items-center rounded text-text-tertiary hover:text-text"
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    </span>
  );
}

/** Controlled date field. `value`/`onChange` carry `YYYY-MM-DD` or `""`. */
export function DateField({
  id,
  value,
  onChange,
  placeholder = "Select date",
  required,
  disabled,
  min,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  /** Earliest selectable date, `YYYY-MM-DD`. */
  min?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const selected = value ? dayjs(value) : null;
  const [viewMonth, setViewMonth] = useState(() => selected ?? dayjs());
  const { anchor, host } = usePopoverAnchor(open, rootRef);
  const panelId = useId();

  useOutsideClose(open, () => setOpen(false), [rootRef, panelRef]);

  useEffect(() => {
    if (open) setViewMonth(selected ?? dayjs());
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={fieldShellClass(disabled)}
      >
        <span className={value ? "text-text" : "text-text-tertiary"}>
          {selected ? formatDateLabel(selected) : placeholder}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {value && !required && !disabled && <ClearGlyph label="Clear date" onClear={() => onChange("")} />}
          <Icon name="chevronDown" size={13} className="shrink-0 text-text-tertiary" />
        </span>
      </button>

      {anchor &&
        host &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                ref={panelRef}
                id={panelId}
                role="dialog"
                aria-label="Choose a date"
                initial={{ opacity: 0, scaleY: 0.95 }}
                animate={{ opacity: 1, scaleY: 1 }}
                exit={{ opacity: 0, scaleY: 0.95 }}
                transition={prefersReducedMotion() ? reducedMotionFade : springDefault}
                style={{
                  position: "fixed",
                  left: anchor.left,
                  width: 280,
                  transformOrigin: anchor.above ? "bottom" : "top",
                  ...(anchor.above ? { bottom: window.innerHeight - anchor.top } : { top: anchor.top }),
                }}
                className="glass-overlay z-[100] overflow-hidden rounded-lg"
              >
                <MonthGrid
                  viewMonth={viewMonth}
                  onViewMonthChange={setViewMonth}
                  selected={selected}
                  min={min ? dayjs(min) : undefined}
                  onSelect={(d) => {
                    onChange(d.format("YYYY-MM-DD"));
                    setOpen(false);
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>,
          host,
        )}
    </div>
  );
}

/** Uncontrolled `DateField` for a plain `<form action>` — posts `YYYY-MM-DD` through a hidden input. */
export function FormDateField({
  name,
  defaultValue = "",
  ...rest
}: Omit<React.ComponentProps<typeof DateField>, "value" | "onChange"> & {
  name: string;
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <>
      <input type="hidden" name={name} value={value} readOnly />
      <DateField {...rest} value={value} onChange={setValue} />
    </>
  );
}

/** Controlled datetime field. `value`/`onChange` carry `YYYY-MM-DDTHH:mm` or `""`. */
export function DateTimeField({
  id,
  value,
  onChange,
  placeholder = "Select date & time",
  required,
  disabled,
  min,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  /** Earliest selectable date, `YYYY-MM-DD`. */
  min?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const current = value ? dayjs(value) : null;
  const [viewMonth, setViewMonth] = useState(() => current ?? dayjs());
  const { anchor, host } = usePopoverAnchor(open, rootRef);
  const panelId = useId();

  useOutsideClose(open, () => setOpen(false), [rootRef, panelRef]);

  useEffect(() => {
    if (open) setViewMonth(current ?? dayjs());
  }, [open]);

  function commitDay(d: Dayjs) {
    const base = current ?? dayjs().hour(9).minute(0);
    const next = d.hour(base.hour()).minute(base.minute()).second(0).millisecond(0);
    onChange(next.format("YYYY-MM-DDTHH:mm"));
  }

  function commitHour(h: number) {
    const base = current ?? dayjs().minute(0);
    onChange(base.hour(h).second(0).millisecond(0).format("YYYY-MM-DDTHH:mm"));
  }

  function commitMinute(m: number) {
    const base = current ?? dayjs().hour(9);
    onChange(base.minute(m).second(0).millisecond(0).format("YYYY-MM-DDTHH:mm"));
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={fieldShellClass(disabled)}
      >
        <span className={value ? "text-text" : "text-text-tertiary"}>
          {current ? `${formatDateLabel(current)} · ${formatTimeLabel(current)}` : placeholder}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {value && !required && !disabled && (
            <ClearGlyph label="Clear date and time" onClear={() => onChange("")} />
          )}
          <Icon name="chevronDown" size={13} className="shrink-0 text-text-tertiary" />
        </span>
      </button>

      {anchor &&
        host &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                ref={panelRef}
                id={panelId}
                role="dialog"
                aria-label="Choose a date and time"
                initial={{ opacity: 0, scaleY: 0.95 }}
                animate={{ opacity: 1, scaleY: 1 }}
                exit={{ opacity: 0, scaleY: 0.95 }}
                transition={prefersReducedMotion() ? reducedMotionFade : springDefault}
                style={{
                  position: "fixed",
                  left: anchor.left,
                  width: 280,
                  transformOrigin: anchor.above ? "bottom" : "top",
                  ...(anchor.above ? { bottom: window.innerHeight - anchor.top } : { top: anchor.top }),
                }}
                className="glass-overlay z-[100] overflow-hidden rounded-lg"
              >
                <MonthGrid
                  viewMonth={viewMonth}
                  onViewMonthChange={setViewMonth}
                  selected={current}
                  min={min ? dayjs(min) : undefined}
                  onSelect={commitDay}
                />
                <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
                  <span className="text-[12px] text-text-tertiary">Time</span>
                  <PolishedSelect
                    aria-label="Hour"
                    value={current ? current.hour() : 9}
                    onChange={(e) => commitHour(Number(e.target.value))}
                    containerClassName="w-auto"
                    className="h-8 max-sm:h-11 w-auto rounded-md px-2 text-[13px]"
                  >
                    {HOURS.map((h) => (
                      <option key={h} value={h}>
                        {pad2(h % 12 === 0 ? 12 : h % 12)} {h < 12 ? "AM" : "PM"}
                      </option>
                    ))}
                  </PolishedSelect>
                  <PolishedSelect
                    aria-label="Minute"
                    value={current ? current.minute() - (current.minute() % 5) : 0}
                    onChange={(e) => commitMinute(Number(e.target.value))}
                    containerClassName="w-auto"
                    className="h-8 max-sm:h-11 w-auto rounded-md px-2 text-[13px]"
                  >
                    {MINUTES.map((m) => (
                      <option key={m} value={m}>
                        {pad2(m)}
                      </option>
                    ))}
                  </PolishedSelect>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="ml-auto cursor-pointer rounded-md border-none bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-on transition-colors hover:bg-accent-hover"
                  >
                    Done
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          host,
        )}
    </div>
  );
}

/** Uncontrolled `DateTimeField` for a plain `<form action>` — posts `YYYY-MM-DDTHH:mm` through a hidden input. */
export function FormDateTimeField({
  name,
  defaultValue = "",
  ...rest
}: Omit<React.ComponentProps<typeof DateTimeField>, "value" | "onChange"> & {
  name: string;
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <>
      <input type="hidden" name={name} value={value} readOnly />
      <DateTimeField {...rest} value={value} onChange={setValue} />
    </>
  );
}
