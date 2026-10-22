"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { runCommand, runQuery } from "@/server/actions/platform";
import { Icon, type IconName } from "@/components/ui/icons";
import { Avatar } from "@/components/ui/Avatar";
import { IconTile } from "@/components/ui/IconTile";
import { Modal, ModalCancel } from "@/components/ui/Modal";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import {
  AGGREGATE_LABEL,
  OP_LABEL,
  VALUELESS,
  dayLabel,
  daysFromToday,
  editableOf,
  hrefFor,
  isRef,
  money,
  moneyShort,
  normaliseConfig,
  patchFor,
  optionFor,
  relativeDay,
  sameConfig,
  textOf,
  type Described,
  type FieldOption,
  type FilterOp,
  type ListResult,
  type RecordField,
  type Ref,
  type Row,
  type SavedViewRow,
  type ViewConfig,
} from "./model";

/**
 * The record table, board and saved views every list screen shares (ADR-051).
 *
 * One component draws any registered record object. It never decides what a record is: the descriptor says which
 * fields exist, how they filter and which command edits them, and the server's list query does the reading. What
 * lives here is the interaction: views as tabs, a filter bar of removable chips, inline cell editing with an
 * optimistic value that rolls back with the server's reason, a board you can drag on (with a keyboard and phone
 * alternative on every card), bulk actions, a side preview and footer totals over the whole filtered set.
 *
 * ADR-033: opaque inset cells; materials only on the floating bars and overlays.
 */

/* ================================= shared bits ================================ */

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

const TONE_CLASS: Record<NonNullable<FieldOption["tone"]>, { fill: string; ink: string; dot: string }> = {
  neutral: { fill: "var(--color-state-draft-fill)", ink: "var(--color-state-draft-on)", dot: "var(--color-state-draft-on)" },
  info: { fill: "var(--color-state-active-fill)", ink: "var(--color-state-active-on)", dot: "var(--color-state-active-on)" },
  accent: { fill: "var(--color-accent-subtle)", ink: "var(--color-accent-ink)", dot: "var(--color-accent)" },
  success: { fill: "var(--color-state-completed-fill)", ink: "var(--color-state-completed-on)", dot: "var(--color-state-completed-on)" },
  warning: { fill: "var(--color-state-pending-fill)", ink: "var(--color-state-pending-on)", dot: "var(--color-state-pending-on)" },
  danger: { fill: "var(--color-state-blocked-fill)", ink: "var(--color-state-blocked-on)", dot: "var(--color-state-blocked-on)" },
};

export function OptionPill({ option, fallback }: { option?: FieldOption; fallback?: string }) {
  const tone = TONE_CLASS[option?.tone ?? "neutral"];
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full py-0.5 pl-2 pr-2.5 text-[13px] font-medium"
      style={{ backgroundColor: tone.fill, color: tone.ink }}
    >
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: tone.dot }} />
      <span className="truncate">{option?.label ?? fallback}</span>
    </span>
  );
}

/** A floating panel anchored to a control: portalled so a scrolling table or sheet cannot clip it. */
export function Floating({
  anchor,
  open,
  onClose,
  children,
  width = 320,
  label,
}: {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = Math.min(width, vw - 24);
      const left = Math.max(12, Math.min(r.left, vw - w - 12));
      const below = vh - r.bottom - 12;
      const above = r.top - 12;
      const flip = below < 260 && above > below;
      const maxHeight = Math.max(160, (flip ? above : below) - 8);
      setPos({ top: flip ? Math.max(12, r.top - 8 - Math.min(maxHeight, 480)) : r.bottom + 6, left, maxHeight: Math.min(maxHeight, 480) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, width]);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        anchor?.focus();
      }
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    const first = ref.current?.querySelector<HTMLElement>("input, select, textarea, button, [tabindex='0']");
    first?.focus();
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open, anchor, onClose]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className="glass-overlay fixed z-[60] overflow-y-auto rounded-[14px] p-2 shadow-[0_12px_40px_rgba(0,0,0,0.18)] motion-safe:animate-[verity-pop_160ms_cubic-bezier(0.2,0.9,0.3,1.2)]"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: Math.min(width, typeof window === "undefined" ? width : window.innerWidth - 24), maxHeight: pos?.maxHeight }}
    >
      {children}
    </div>,
    document.body,
  );
}

/**
 * A native select for use inside a floating panel. The shared `Select` opens its own portalled list, and a click in
 * that list would count as a click outside the panel and close it.
 */
function NativeSelect({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cx(
        "h-10 min-w-0 rounded-[10px] border-0 bg-[var(--color-control)] px-3 text-[16px] text-text sm:text-[15px]",
        "focus:outline-none focus:shadow-[0_0_0_3px_var(--color-accent-subtle)]",
        className,
      )}
    />
  );
}

function ToolbarButton({
  icon,
  label,
  count,
  active,
  onClick,
  buttonRef,
  expanded,
}: {
  icon: IconName;
  label: string;
  count?: number;
  active?: boolean;
  onClick: () => void;
  buttonRef?: (el: HTMLButtonElement | null) => void;
  expanded?: boolean;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      className={cx(
        "inline-flex min-h-9 items-center gap-1.5 rounded-[10px] px-3 text-[14px] font-medium transition-colors max-sm:min-h-11",
        "focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--color-accent-subtle)] active:opacity-70",
        active ? "bg-accent-subtle text-accent-ink" : "bg-[var(--color-control)] text-text hover:bg-[var(--color-control-strong)]",
      )}
    >
      <Icon name={icon} size={16} />
      <span>{label}</span>
      {typeof count === "number" && count > 0 && <span className="tabular rounded-full bg-accent px-1.5 text-[12px] leading-[18px] text-accent-on">{count}</span>}
    </button>
  );
}

function MenuRow({ children, onClick, active, danger }: { children: ReactNode; onClick: () => void; active?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex min-h-10 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[15px] transition-colors",
        "hover:bg-[var(--color-control)] focus-visible:bg-[var(--color-control)] focus-visible:outline-none",
        active && "font-semibold text-accent-ink",
        danger ? "text-[var(--color-danger-ink)]" : "text-text",
      )}
    >
      {children}
    </button>
  );
}

const FIELD_ICON: Record<string, IconName> = {
  text: "tag", number: "tag", currency: "wallet", date: "schedule", datetime: "clock", select: "stage", relation: "building",
  user: "user", email: "mail", phone: "bell", link: "eye", boolean: "check",
};

/* ================================= cell display ================================ */

/**
 * One value, drawn for its type. `plain` drops every link, for places that already sit inside one (a phone list row).
 * Relative dates and times read the viewer's clock, so their text may differ from the server's first render.
 */
export function FieldDisplay({ field, value, row, described, plain }: { field: RecordField; value: unknown; row?: Row; described?: Described; plain?: boolean }) {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
    return <span className="text-text-tertiary" aria-label="empty">—</span>;
  }
  switch (field.type) {
    case "select":
      return <OptionPill option={optionFor(field, value)} fallback={String((row && row[`${field.key}Label`]) ?? value)} />;
    case "user":
      return isRef(value) ? (
        <span className="inline-flex min-w-0 items-center gap-2">
          <Avatar name={value.label} size={22} />
          <span className="truncate">{value.label}</span>
        </span>
      ) : null;
    case "relation": {
      if (!isRef(value)) return null;
      const human = field.relation?.endsWith(".person");
      const chip = "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-[8px] bg-[var(--color-control)] py-0.5 pl-1 pr-2 text-[14px] text-text no-underline";
      const inner = (
        <>
          {human ? <Avatar name={value.label} size={18} /> : <IconTile icon="building" hue="indigo" size="sm" className="!size-[18px] !rounded-[5px] [&_svg]:!size-3" />}
          <span className="truncate">{value.label}</span>
        </>
      );
      if (plain || !field.relationHref) return <span className={chip}>{inner}</span>;
      return (
        <Link href={hrefFor(field.relationHref, value.id)} onClick={(e) => e.stopPropagation()} className={cx(chip, "hover:bg-[var(--color-control-strong)]")}>
          {inner}
        </Link>
      );
    }
    case "currency":
      return <span className="tabular">{money(Number(value))}</span>;
    case "date": {
      const iso = String(value);
      const late = described?.boardGroupField && row?.stageCategory === "Active" && daysFromToday(iso) < 0;
      return (
        <span className={cx("tabular", late && "font-medium text-[var(--color-danger-ink)]")} title={relativeDay(iso)} suppressHydrationWarning>
          {dayLabel(iso)}
        </span>
      );
    }
    case "email":
    case "phone":
    case "link": {
      const list = Array.isArray(value) ? (value as string[]) : [String(value)];
      const first = list[0]!;
      const href = field.type === "email" ? `mailto:${first}` : field.type === "phone" ? `tel:${first.replace(/\s/g, "")}` : `https://${first.replace(/^https?:\/\//, "")}`;
      return (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          {plain ? (
            <span className="truncate">{first}</span>
          ) : (
            <a href={href} onClick={(e) => e.stopPropagation()} className="truncate text-accent-ink no-underline hover:underline" target={field.type === "link" ? "_blank" : undefined} rel="noreferrer">
              {first}
            </a>
          )}
          {list.length > 1 && <span className="tabular shrink-0 rounded-full bg-[var(--color-control)] px-1.5 text-[12px] text-text-secondary">+{list.length - 1}</span>}
        </span>
      );
    }
    default:
      return (
        <span className={cx("truncate", (field.type === "number" || field.type === "datetime") && "tabular")} suppressHydrationWarning={field.type === "datetime"}>
          {textOf(field, value)}
        </span>
      );
  }
}

/* ================================= editors ================================ */

export function OptionList({
  options,
  value,
  onPick,
  allowClear,
  search,
}: {
  options: Array<{ value: string; label: string; sub?: string | null; avatar?: boolean; option?: FieldOption }>;
  value: string;
  onPick: (value: string | null) => void;
  allowClear?: boolean;
  search?: boolean;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return options.filter((o) => words.every((w) => `${o.label} ${o.sub ?? ""}`.toLowerCase().includes(w)));
  }, [options, q]);
  const pick = (i: number) => {
    const o = shown[i];
    if (o) onPick(o.value);
  };
  return (
    <div
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, shown.length - 1)); }
        if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
        if (e.key === "Enter") { e.preventDefault(); pick(active); }
      }}
    >
      {search && (
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setActive(0); }}
          placeholder="Search…"
          aria-label="Search options"
          className="mb-1 h-10 w-full rounded-[10px] border-0 bg-[var(--color-control)] px-3 text-[16px] text-text placeholder:text-text-tertiary focus:outline-none focus:shadow-[0_0_0_3px_var(--color-accent-subtle)] sm:text-[15px]"
        />
      )}
      <ul role="listbox" className="m-0 list-none p-0">
        {shown.map((o, i) => (
          <li key={o.value} role="option" aria-selected={o.value === value}>
            <button
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => onPick(o.value)}
              className={cx(
                "flex min-h-10 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[15px] text-text",
                i === active && "bg-[var(--color-control)]",
              )}
            >
              {o.option ? <OptionPill option={o.option} /> : o.avatar ? <Avatar name={o.label} size={22} /> : null}
              {!o.option && (
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{o.label}</span>
                  {o.sub && <span className="block truncate text-[13px] text-text-secondary">{o.sub}</span>}
                </span>
              )}
              {o.option && <span className="flex-1" />}
              {o.value === value && <Icon name="check" size={16} className="shrink-0 text-accent-ink" />}
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="px-2.5 py-3 text-[14px] text-text-secondary">Nothing matches</li>}
      </ul>
      {allowClear && value && (
        <div className="mt-1 border-t border-[var(--color-separator)] pt-1">
          <MenuRow onClick={() => onPick(null)}>
            <Icon name="close" size={16} /> Clear
          </MenuRow>
        </div>
      )}
    </div>
  );
}

/** Records a relation field can point at, searched as the person types. */
export function RelationOptions({ described, field, value, onPick }: { described: Described; field: RecordField; value: string; onPick: (v: string | null, label?: string) => void }) {
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<Array<{ id: string; label: string; sub: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!described.lookupQuery || !field.relation) return;
    let live = true;
    setLoading(true);
    const t = setTimeout(async () => {
      const result = await runQuery<Array<{ id: string; label: string; sub: string | null }>>(described.lookupQuery!, { object: field.relation, search: q || undefined });
      if (live) {
        setOptions(result.ok ? result.data : []);
        setLoading(false);
      }
    }, q ? 180 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [q, described.lookupQuery, field.relation]);
  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Find a ${field.label.toLowerCase()}…`}
        aria-label={`Find a ${field.label.toLowerCase()}`}
        className="mb-1 h-10 w-full rounded-[10px] border-0 bg-[var(--color-control)] px-3 text-[16px] text-text placeholder:text-text-tertiary focus:outline-none focus:shadow-[0_0_0_3px_var(--color-accent-subtle)] sm:text-[15px]"
      />
      {loading ? (
        <p className="m-0 px-2.5 py-3 text-[14px] text-text-secondary">Searching…</p>
      ) : (
        <OptionList
          options={options.map((o) => ({ value: o.id, label: o.label, sub: o.sub, avatar: field.relation?.endsWith(".person") }))}
          value={value}
          onPick={(v) => onPick(v, options.find((o) => o.id === v)?.label)}
          allowClear
        />
      )}
    </div>
  );
}

/** The editor for one field, drawn inside a floating panel. Commits a value, or null to clear. */
export function FieldEditor({
  field,
  value,
  described,
  onCommit,
  onCancel,
}: {
  field: RecordField;
  value: unknown;
  described: Described;
  onCommit: (value: unknown) => void;
  onCancel: () => void;
}) {
  const initial = editableOf(value);
  const [draft, setDraft] = useState(initial);
  const commitText = () => {
    const v = draft.trim();
    if (v === initial) return onCancel();
    if (field.type === "number" || field.type === "currency") return onCommit(v === "" ? null : Number(v.replace(/[,\s₹]/g, "")));
    if (field.array) return onCommit(v.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean));
    onCommit(v === "" ? null : v);
  };

  if (field.type === "select") {
    return (
      <OptionList
        options={(field.options ?? []).map((o) => ({ value: o.value, label: o.label, option: o }))}
        value={initial}
        onPick={(v) => (v === initial ? onCancel() : onCommit(v))}
        allowClear={field.key !== described.boardGroupField}
        search={(field.options?.length ?? 0) > 7}
      />
    );
  }
  if (field.type === "user") {
    return (
      <OptionList
        options={described.members.map((m) => ({ value: m.id, label: m.label, avatar: true }))}
        value={initial}
        onPick={(v) => (v === initial ? onCancel() : onCommit(v))}
        allowClear
        search
      />
    );
  }
  if (field.type === "relation") {
    return <RelationOptions described={described} field={field} value={initial} onPick={(v) => (v === initial ? onCancel() : onCommit(v))} />;
  }
  const inputType = field.type === "date" ? "date" : field.type === "number" || field.type === "currency" ? "text" : field.type === "email" && !field.array ? "email" : "text";
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); commitText(); }}
      className="flex flex-col gap-2 p-1"
    >
      <label className="text-[13px] font-semibold text-text-secondary" htmlFor={`edit-${field.key}`}>
        {field.label}
        {field.array && <span className="font-normal"> · separate with commas</span>}
      </label>
      {field.key === "body" ? (
        <Textarea id={`edit-${field.key}`} value={draft} onChange={(e) => setDraft(e.target.value)} />
      ) : (
        <Input
          id={`edit-${field.key}`}
          type={inputType}
          inputMode={field.type === "number" || field.type === "currency" ? "decimal" : undefined}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoComplete="off"
        />
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" size="sm">Save</Button>
      </div>
    </form>
  );
}

/* ================================= the lost-reason sheet ================================ */

export type ReasonRule = { groups: string[]; field: string; noteField?: string; title: string };

export function ReasonSheet({
  open,
  rule,
  described,
  onClose,
  onConfirm,
}: {
  open: boolean;
  rule: ReasonRule | undefined;
  described: Described;
  onClose: () => void;
  onConfirm: (reason: string, note: string) => void;
}) {
  const field = described.fields.find((f) => f.key === rule?.field);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => { if (open) { setReason(""); setNote(""); } }, [open]);
  if (!rule || !field) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={rule.title}
      description="The reason is kept on the record, so the pipeline report can show why deals are lost."
      footer={
        <>
          <ModalCancel onClose={onClose} />
          <Button variant="primary" disabled={!reason} onClick={() => onConfirm(reason, note.trim())}>Mark as lost</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Reason" htmlFor="lost-reason" required>
          <Select id="lost-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Choose a reason</option>
            {(field.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
        {rule.noteField && (
          <Field label="What happened" htmlFor="lost-note" hint="Optional: who won it, by how much, what would have changed it.">
            <Textarea id="lost-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

/* ================================= toolbar editors ================================ */

function FilterEditor({
  described,
  initial,
  onApply,
  onRemove,
}: {
  described: Described;
  initial?: { field: string; op: FilterOp; value?: unknown };
  onApply: (f: { field: string; op: FilterOp; value?: unknown }) => void;
  onRemove?: () => void;
}) {
  const filterable = described.fields.filter((f) => f.filterable !== false);
  const [fieldKey, setFieldKey] = useState(initial?.field ?? "");
  const field = filterable.find((f) => f.key === fieldKey);
  const ops = field ? OPS_FOR(field) : [];
  const [op, setOp] = useState<FilterOp | "">(initial?.op ?? "");
  const [value, setValue] = useState<unknown>(initial?.value ?? "");
  useEffect(() => {
    if (field && !ops.includes(op as FilterOp)) setOp(ops[0] ?? "");
  }, [fieldKey]);

  if (!field) {
    return (
      <div>
        <p className="m-0 px-2.5 pb-1 pt-1.5 text-[13px] font-semibold uppercase tracking-[0.02em] text-text-secondary">Filter by</p>
        <OptionList
          options={filterable.map((f) => ({ value: f.key, label: f.label }))}
          value=""
          onPick={(v) => v && setFieldKey(v)}
          search
        />
      </div>
    );
  }
  const list = Array.isArray(value) ? (value as string[]) : [];
  const toggle = (v: string) => setValue(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const multiOptions =
    field.type === "select" ? (field.options ?? []).map((o) => ({ value: o.value, label: o.label, option: o }))
    : field.type === "user" ? described.members.map((m) => ({ value: m.id, label: m.label }))
    : null;
  const ready = op && (VALUELESS.has(op as FilterOp) || (multiOptions ? list.length > 0 : String(value ?? "").trim() !== "") || (field.type === "relation" && list.length > 0));

  return (
    <form
      className="flex flex-col gap-2 p-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        const v = VALUELESS.has(op as FilterOp) ? undefined : field.type === "number" || field.type === "currency" || op === "next_days" ? Number(value) : value;
        onApply({ field: field.key, op: op as FilterOp, value: v });
      }}
    >
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setFieldKey("")} className="inline-flex min-h-8 items-center gap-1 rounded-[8px] px-1.5 text-[15px] font-semibold text-text hover:bg-[var(--color-control)]">
          {field.label} <Icon name="chevronDown" size={14} />
        </button>
        <NativeSelect aria-label="Condition" value={op} onChange={(e) => { setOp(e.target.value as FilterOp); setValue(""); }} className="flex-1">
          {ops.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
        </NativeSelect>
      </div>
      {!VALUELESS.has(op as FilterOp) && op && (
        multiOptions && (op === "is_any_of" || op === "is_none_of") ? (
          <ul className="m-0 max-h-64 list-none overflow-y-auto p-0">
            {multiOptions.map((o) => (
              <li key={o.value}>
                <label className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 hover:bg-[var(--color-control)]">
                  <input type="checkbox" checked={list.includes(o.value)} onChange={() => toggle(o.value)} className="size-4 accent-[var(--color-accent)]" />
                  {"option" in o && o.option ? <OptionPill option={o.option as FieldOption} /> : <span className="text-[15px]">{o.label}</span>}
                </label>
              </li>
            ))}
          </ul>
        ) : field.type === "relation" ? (
          <RelationOptions described={described} field={field} value={list[0] ?? ""} onPick={(v) => setValue(v ? [v] : [])} />
        ) : (
          <div className="flex items-center gap-2">
            <Input
              aria-label="Value"
              type={field.type === "date" || field.type === "datetime" ? (op === "next_days" ? "number" : "date") : field.type === "number" || field.type === "currency" ? "number" : "text"}
              value={String(value ?? "")}
              onChange={(e) => setValue(e.target.value)}
            />
            {op === "next_days" && <span className="text-[15px] text-text-secondary">days</span>}
          </div>
        )
      )}
      <div className="mt-1 flex items-center justify-between gap-2">
        {onRemove ? <Button type="button" variant="danger" size="sm" onClick={onRemove}>Remove</Button> : <span />}
        <Button type="submit" variant="primary" size="sm" disabled={!ready}>Apply</Button>
      </div>
    </form>
  );
}

function OPS_FOR(field: RecordField): FilterOp[] {
  const table: Record<string, FilterOp[]> = {
    text: ["contains", "not_contains", "eq", "is_empty", "is_not_empty"],
    email: ["contains", "is_empty", "is_not_empty"],
    phone: ["contains", "is_empty", "is_not_empty"],
    link: ["contains", "is_empty", "is_not_empty"],
    number: ["gte", "lte", "eq", "neq", "gt", "lt", "is_empty", "is_not_empty"],
    currency: ["gte", "lte", "gt", "lt", "eq", "is_empty", "is_not_empty"],
    date: ["before", "after", "eq", "overdue", "next_days", "is_empty", "is_not_empty"],
    datetime: ["before", "after", "overdue", "next_days", "is_empty", "is_not_empty"],
    select: ["is_any_of", "is_none_of", "is_empty", "is_not_empty"],
    relation: ["is_any_of", "is_none_of", "is_empty", "is_not_empty"],
    user: ["is_me", "is_any_of", "is_none_of", "is_empty", "is_not_empty"],
    boolean: ["eq"],
  };
  return table[field.type] ?? [];
}

function filterSummary(described: Described, f: { field: string; op: FilterOp; value?: unknown }): string {
  const field = described.fields.find((x) => x.key === f.field);
  if (!field) return f.field;
  if (VALUELESS.has(f.op)) return `${field.label} ${OP_LABEL[f.op]}`;
  if (Array.isArray(f.value)) {
    const names = (f.value as string[]).map((v) =>
      field.type === "select" ? (optionFor(field, v)?.label ?? v) : field.type === "user" ? (described.members.find((m) => m.id === v)?.label ?? "someone") : "1 record",
    );
    return `${field.label} ${OP_LABEL[f.op]} ${names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ")}`;
  }
  if (f.op === "next_days") return `${field.label} in the next ${f.value} days`;
  const shown = field.type === "currency" ? money(Number(f.value)) : field.type === "date" ? dayLabel(String(f.value)) : String(f.value);
  return `${field.label} ${OP_LABEL[f.op]} ${shown}`;
}

function SortEditor({ described, sorts, onChange }: { described: Described; sorts: ViewConfig["sorts"]; onChange: (s: ViewConfig["sorts"]) => void }) {
  const sortable = described.fields.filter((f) => f.sortable !== false);
  return (
    <div className="flex flex-col gap-1.5 p-1">
      <p className="m-0 px-1.5 pt-1 text-[13px] font-semibold uppercase tracking-[0.02em] text-text-secondary">Sort by</p>
      {sorts.map((s, i) => (
        <div key={`${s.field}-${i}`} className="flex items-center gap-1.5">
          <NativeSelect aria-label="Field" value={s.field} onChange={(e) => onChange(sorts.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))} className="flex-1">
            {sortable.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </NativeSelect>
          <button
            type="button"
            onClick={() => onChange(sorts.map((x, j) => (j === i ? { ...x, dir: x.dir === "asc" ? "desc" : "asc" } : x)))}
            className="min-h-10 min-w-[84px] rounded-[10px] bg-[var(--color-control)] px-2.5 text-[14px] font-medium text-text hover:bg-[var(--color-control-strong)]"
          >
            {s.dir === "asc" ? "A → Z" : "Z → A"}
          </button>
          <button type="button" aria-label="Remove sort" onClick={() => onChange(sorts.filter((_, j) => j !== i))} className="grid size-10 place-items-center rounded-[10px] text-text-secondary hover:bg-[var(--color-control)]">
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}
      {sorts.length < 3 && (
        <MenuRow onClick={() => onChange([...sorts, { field: sortable.find((f) => !sorts.some((s) => s.field === f.key))?.key ?? sortable[0]!.key, dir: "asc" }])}>
          <Icon name="plus" size={16} /> Add a sort
        </MenuRow>
      )}
    </div>
  );
}

function FieldsEditor({ described, columns, onChange }: { described: Described; columns: ViewConfig["columns"]; onChange: (c: ViewConfig["columns"]) => void }) {
  const shown = columns.map((c) => c.key);
  const hidden = described.fields.filter((f) => !shown.includes(f.key));
  const move = (i: number, d: -1 | 1) => {
    const next = [...columns];
    const j = i + d;
    if (j < 1 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <div className="p-1">
      <p className="m-0 px-1.5 pb-1 pt-1 text-[13px] font-semibold uppercase tracking-[0.02em] text-text-secondary">Shown</p>
      <ul className="m-0 list-none p-0">
        {columns.map((c, i) => {
          const f = described.fields.find((x) => x.key === c.key);
          if (!f) return null;
          const title = c.key === described.titleField;
          return (
            <li key={c.key} className="flex min-h-10 items-center gap-1 rounded-[10px] px-1.5 hover:bg-[var(--color-control)]">
              <Icon name={FIELD_ICON[f.type] ?? "tag"} size={16} className="text-text-secondary" />
              <span className="flex-1 truncate text-[15px]">{f.label}</span>
              {!title && (
                <>
                  <button type="button" aria-label={`Move ${f.label} left`} onClick={() => move(i, -1)} disabled={i <= 1} className="grid size-8 place-items-center rounded-[8px] text-text-secondary hover:bg-[var(--color-control-strong)] disabled:opacity-30">
                    <Icon name="chevronRight" size={14} className="-rotate-90" />
                  </button>
                  <button type="button" aria-label={`Move ${f.label} right`} onClick={() => move(i, 1)} disabled={i === columns.length - 1} className="grid size-8 place-items-center rounded-[8px] text-text-secondary hover:bg-[var(--color-control-strong)] disabled:opacity-30">
                    <Icon name="chevronRight" size={14} className="rotate-90" />
                  </button>
                  <button type="button" aria-label={`Hide ${f.label}`} onClick={() => onChange(columns.filter((x) => x.key !== c.key))} className="grid size-8 place-items-center rounded-[8px] text-text-secondary hover:bg-[var(--color-control-strong)]">
                    <Icon name="eyeOff" size={15} />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {hidden.length > 0 && (
        <>
          <p className="m-0 mt-2 border-t border-[var(--color-separator)] px-1.5 pb-1 pt-2 text-[13px] font-semibold uppercase tracking-[0.02em] text-text-secondary">Hidden</p>
          <ul className="m-0 list-none p-0">
            {hidden.map((f) => (
              <li key={f.key}>
                <MenuRow onClick={() => onChange([...columns, { key: f.key }])}>
                  <Icon name={FIELD_ICON[f.type] ?? "tag"} size={16} className="text-text-secondary" />
                  <span className="flex-1 truncate">{f.label}</span>
                  <Icon name="eye" size={15} className="text-text-secondary" />
                </MenuRow>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/* ================================= toasts ================================ */

type Toast = { id: number; text: string; tone: "error" | "ok" };

function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  if (!toasts.length) return null;
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+88px)] z-[70] flex flex-col items-center gap-2 px-4 lg:bottom-6">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === "error" ? "alert" : "status"}
          className="glass-overlay pointer-events-auto flex max-w-[520px] items-start gap-3 rounded-[14px] px-4 py-3 text-[15px] shadow-[0_10px_30px_rgba(0,0,0,0.18)]"
        >
          <Icon name={t.tone === "error" ? "flag" : "check"} size={18} className={t.tone === "error" ? "mt-0.5 text-[var(--color-danger-ink)]" : "mt-0.5 text-[var(--color-state-completed-ink)]"} />
          <span className="flex-1 text-text">{t.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="grid size-6 place-items-center rounded-full text-text-secondary hover:bg-[var(--color-control)]">
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

const cleanMessage = (m: string) => m.replace(/^E_[A-Z_]+:\s*/, "").replace(/^./, (c) => c.toUpperCase());

/* ================================= the table ================================ */

const ROW_H = 44;

function RecordTable({
  described,
  rows,
  columns,
  aggregates,
  aggregateChoice,
  onAggregate,
  selected,
  onSelect,
  onEdit,
  onPreview,
  total,
}: {
  described: Described;
  rows: Row[];
  columns: Array<{ field: RecordField; width: number }>;
  aggregates: Record<string, number | null>;
  aggregateChoice: Record<string, string>;
  onAggregate: (field: string, op: string | null) => void;
  selected: Set<string>;
  onSelect: (ids: string[], on: boolean) => void;
  onEdit: (row: Row, field: RecordField, value: unknown) => void;
  onPreview: (row: Row) => void;
  total: number;
}) {
  const [cursor, setCursor] = useState<{ r: number; c: number } | null>(null);
  const [editing, setEditing] = useState<{ r: number; c: number; anchor: HTMLElement } | null>(null);
  const [aggFor, setAggFor] = useState<{ key: string; anchor: HTMLElement } | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const editable = (field: RecordField) => described.canEdit && Boolean(field.editCommand);
  const cellEl = (r: number, c: number) => tableRef.current?.querySelector<HTMLElement>(`[data-cell="${r}:${c}"]`) ?? null;
  const focusCell = (r: number, c: number) => {
    setCursor({ r, c });
    requestAnimationFrame(() => cellEl(r, c)?.focus());
  };
  const startEdit = (r: number, c: number) => {
    const col = columns[c];
    const el = cellEl(r, c);
    if (!col || !el || !editable(col.field)) return;
    setEditing({ r, c, anchor: el });
  };

  const onKey = (e: ReactKeyboardEvent, r: number, c: number) => {
    if (editing) return;
    const last = { r: rows.length - 1, c: columns.length - 1 };
    if (e.key === "ArrowDown") { e.preventDefault(); focusCell(Math.min(r + 1, last.r), c); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusCell(Math.max(r - 1, 0), c); }
    else if (e.key === "ArrowRight" || (e.key === "Tab" && !e.shiftKey && c < last.c)) { e.preventDefault(); focusCell(r, Math.min(c + 1, last.c)); }
    else if (e.key === "ArrowLeft" || (e.key === "Tab" && e.shiftKey && c > 0)) { e.preventDefault(); focusCell(r, Math.max(c - 1, 0)); }
    else if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); if (c === 0 && e.key === "Enter") onPreview(rows[r]!); else startEdit(r, c); }
    else if (e.key === " " && c === 0) { e.preventDefault(); onSelect([rows[r]!.id], !selected.has(rows[r]!.id)); }
  };

  const titleCol = columns[0];
  const widthTotal = 44 + columns.reduce((s, c) => s + c.width, 0) + 48;

  return (
    <div className="glass-card overflow-hidden rounded-[12px] max-sm:hidden">
      <div ref={tableRef} className="relative max-h-[calc(100dvh-280px)] min-h-[240px] overflow-auto overscroll-contain" role="grid" aria-rowcount={total + 1} aria-colcount={columns.length + 1} aria-label={described.labelPlural}>
        <div style={{ minWidth: widthTotal }}>
          {/* header */}
          <div role="row" className="sticky top-0 z-20 flex border-b border-[var(--color-separator)] bg-[var(--color-surface)]" style={{ height: 40 }}>
            <div role="columnheader" className="sticky left-0 z-10 flex w-11 shrink-0 items-center justify-center bg-[var(--color-surface)]">
              <input
                type="checkbox"
                aria-label={allOn ? "Clear selection" : "Select all shown"}
                checked={allOn}
                onChange={() => onSelect(rows.map((r) => r.id), !allOn)}
                className="size-4 accent-[var(--color-accent)]"
              />
            </div>
            {columns.map((col, c) => (
              <div
                key={col.field.key}
                role="columnheader"
                className={cx(
                  "flex shrink-0 items-center gap-1.5 px-3 text-[13px] font-semibold text-text-secondary",
                  c === 0 && "sticky left-11 z-10 bg-[var(--color-surface)] shadow-[1px_0_0_var(--color-separator)]",
                  (col.field.type === "currency" || col.field.type === "number") && "justify-end",
                )}
                style={{ width: col.width }}
              >
                <Icon name={FIELD_ICON[col.field.type] ?? "tag"} size={14} className="shrink-0 opacity-70" />
                <span className="truncate">{col.field.label}</span>
              </div>
            ))}
            <div className="w-12 shrink-0" />
          </div>

          {/* rows */}
          {rows.map((row, r) => {
            const on = selected.has(row.id);
            return (
              <div
                key={row.id}
                role="row"
                aria-rowindex={r + 2}
                aria-selected={on}
                className={cx("group flex border-b border-[var(--color-separator)] last:border-b-0", on ? "bg-accent-subtle" : "hover:bg-[var(--color-surface-sunken)]", row.archived && "opacity-60")}
                style={{ height: ROW_H }}
              >
                <div className={cx("sticky left-0 z-10 flex w-11 shrink-0 items-center justify-center", on ? "bg-accent-subtle" : "bg-[var(--color-surface)] group-hover:bg-[var(--color-surface-sunken)]")}>
                  <input type="checkbox" aria-label={`Select ${String(row[described.titleField] ?? "")}`} checked={on} onChange={() => onSelect([row.id], !on)} className="size-4 accent-[var(--color-accent)]" />
                </div>
                {columns.map((col, c) => {
                  const value = row[col.field.key];
                  const isTitle = c === 0 && titleCol?.field.key === described.titleField;
                  const isCursor = cursor?.r === r && cursor.c === c;
                  return (
                    <div
                      key={col.field.key}
                      role="gridcell"
                      data-cell={`${r}:${c}`}
                      tabIndex={isCursor || (!cursor && r === 0 && c === 0) ? 0 : -1}
                      aria-readonly={!editable(col.field)}
                      onClick={() => setCursor({ r, c })}
                      onDoubleClick={() => startEdit(r, c)}
                      onKeyDown={(e) => onKey(e, r, c)}
                      className={cx(
                        "flex shrink-0 items-center px-3 text-[15px] text-text outline-none",
                        c === 0 && cx("sticky left-11 z-10 shadow-[1px_0_0_var(--color-separator)]", on ? "bg-accent-subtle" : "bg-[var(--color-surface)] group-hover:bg-[var(--color-surface-sunken)]"),
                        (col.field.type === "currency" || col.field.type === "number") && "justify-end",
                        "focus-visible:shadow-[inset_0_0_0_2px_var(--color-accent)]",
                        editable(col.field) && !isTitle && "cursor-text",
                      )}
                      style={{ width: col.width }}
                    >
                      {isTitle ? (
                        <span className="relative flex min-w-0 flex-1 items-center gap-2">
                          <Link href={hrefFor(described.recordHref, row.id)} className="min-w-0 truncate font-semibold text-text no-underline hover:underline" tabIndex={-1}>
                            {String(value ?? "Untitled")}
                          </Link>
                          {typeof row.ref === "string" && <span className="tabular shrink-0 text-[13px] text-text-tertiary">{row.ref}</span>}
                          <button
                            type="button"
                            tabIndex={-1}
                            onClick={(e) => { e.stopPropagation(); onPreview(row); }}
                            className="absolute right-0 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded-[8px] bg-[var(--color-surface)] px-2 py-0.5 shadow-[0_0_0_6px_var(--color-surface-sunken)] text-[13px] font-medium text-text-secondary opacity-0 transition-opacity hover:text-text group-hover:opacity-100 focus-visible:opacity-100"
                          >
                            Open <Icon name="chevronRight" size={12} />
                          </button>
                        </span>
                      ) : (
                        <span className="min-w-0 truncate">
                          <FieldDisplay field={col.field} value={value} row={row} described={described} />
                        </span>
                      )}
                    </div>
                  );
                })}
                <div className="w-12 shrink-0" />
              </div>
            );
          })}

          {rows.length === 0 && <div className="px-6 py-14 text-center text-[15px] text-text-secondary">No {described.labelPlural.toLowerCase()} match this view.</div>}

          {/* footer totals */}
          {rows.length > 0 && (
            <div role="row" className="sticky bottom-0 z-20 flex border-t border-[var(--color-separator)] bg-[var(--color-surface)]" style={{ height: 38 }}>
              <div className="sticky left-0 z-10 w-11 shrink-0 bg-[var(--color-surface)]" />
              {columns.map((col, c) => {
                const op = aggregateChoice[col.field.key];
                const v = aggregates[col.field.key];
                return (
                  <button
                    key={col.field.key}
                    type="button"
                    onClick={(e) => setAggFor({ key: col.field.key, anchor: e.currentTarget })}
                    className={cx(
                      "group/agg flex shrink-0 items-center gap-1.5 px-3 text-[13px] text-text-secondary hover:bg-[var(--color-surface-sunken)]",
                      c === 0 && "sticky left-11 z-10 bg-[var(--color-surface)]",
                      (col.field.type === "currency" || col.field.type === "number") && "justify-end",
                    )}
                    style={{ width: col.width }}
                  >
                    {c === 0 && !op ? (
                      <span className="tabular">{total} {total === 1 ? described.labelSingular.toLowerCase() : described.labelPlural.toLowerCase()}</span>
                    ) : op ? (
                      <>
                        <span>{AGGREGATE_LABEL[op]}</span>
                        <span className="tabular font-semibold text-text">
                          {v === null || v === undefined ? "—" : col.field.type === "currency" && !op.startsWith("count") && op !== "percent_empty" ? moneyShort(v) : op === "percent_empty" ? `${v}%` : v.toLocaleString("en-IN")}
                        </span>
                      </>
                    ) : (
                      <span className="opacity-0 transition-opacity group-hover/agg:opacity-100">Calculate</span>
                    )}
                  </button>
                );
              })}
              <div className="w-12 shrink-0" />
            </div>
          )}
        </div>
      </div>

      {editing && columns[editing.c] && rows[editing.r] && (
        <Floating anchor={editing.anchor} open onClose={() => { setEditing(null); focusCell(editing.r, editing.c); }} label={`Edit ${columns[editing.c]!.field.label}`} width={columns[editing.c]!.field.type === "relation" || columns[editing.c]!.field.type === "user" ? 320 : 300}>
          <FieldEditor
            field={columns[editing.c]!.field}
            value={rows[editing.r]![columns[editing.c]!.field.key]}
            described={described}
            onCancel={() => { setEditing(null); focusCell(editing.r, editing.c); }}
            onCommit={(v) => { onEdit(rows[editing.r]!, columns[editing.c]!.field, v); setEditing(null); focusCell(editing.r, editing.c); }}
          />
        </Floating>
      )}
      {aggFor && (
        <Floating anchor={aggFor.anchor} open onClose={() => setAggFor(null)} label="Choose a total" width={220}>
          {(() => {
            const field = described.fields.find((f) => f.key === aggFor.key)!;
            const allowed = field.aggregates ?? ["count", "count_empty", "count_not_empty", "percent_empty"];
            return (
              <div>
                <MenuRow onClick={() => { onAggregate(aggFor.key, null); setAggFor(null); }} active={!aggregateChoice[aggFor.key]}>None</MenuRow>
                {allowed.map((op) => (
                  <MenuRow key={op} active={aggregateChoice[aggFor.key] === op} onClick={() => { onAggregate(aggFor.key, op); setAggFor(null); }}>
                    {AGGREGATE_LABEL[op]}
                  </MenuRow>
                ))}
              </div>
            );
          })()}
        </Floating>
      )}
    </div>
  );
}

/** Phones get a list of cells, not a squeezed table: title, the next two shown fields, and a chevron. */
function RecordList({ described, rows, columns, selected, onSelect }: { described: Described; rows: Row[]; columns: Array<{ field: RecordField }>; selected: Set<string>; onSelect: (ids: string[], on: boolean) => void }) {
  const extra = columns.slice(1, 4);
  return (
    <ul className="glass-card m-0 list-none overflow-hidden rounded-[12px] p-0 sm:hidden">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center gap-3 border-b border-[var(--color-separator)] px-4 py-3 last:border-b-0">
          <input type="checkbox" aria-label={`Select ${String(row[described.titleField] ?? "")}`} checked={selected.has(row.id)} onChange={() => onSelect([row.id], !selected.has(row.id))} className="size-5 shrink-0 accent-[var(--color-accent)]" />
          <Link href={hrefFor(described.recordHref, row.id)} className="flex min-w-0 flex-1 items-center gap-3 text-text no-underline">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[17px] font-semibold">{String(row[described.titleField] ?? "Untitled")}</span>
              <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-text-secondary">
                {extra.map((c) => {
                  const v = row[c.field.key];
                  if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) return null;
                  return <span key={c.field.key} className="min-w-0 max-w-full truncate"><FieldDisplay field={c.field} value={v} row={row} described={described} plain /></span>;
                })}
              </span>
            </span>
            <Icon name="chevronRight" size={16} className="shrink-0 text-text-tertiary" />
          </Link>
        </li>
      ))}
      {rows.length === 0 && <li className="px-6 py-12 text-center text-[15px] text-text-secondary">No {described.labelPlural.toLowerCase()} match this view.</li>}
    </ul>
  );
}

/* ================================= the board ================================ */

function Board({
  described,
  rows,
  groupField,
  hiddenGroups,
  onMove,
  onQuickCreate,
  onPreview,
}: {
  described: Described;
  rows: Row[];
  groupField: RecordField;
  hiddenGroups: string[];
  onMove: (row: Row, group: string, position: number) => void;
  onQuickCreate?: (group: string, title: string) => Promise<boolean>;
  onPreview: (row: Row) => void;
}) {
  const groups = (groupField.options ?? []).filter((o) => !hiddenGroups.includes(o.value));
  const sumField = described.fields.find((f) => f.key === described.boardSumField);
  const byGroup = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const g of groups) m.set(g.value, []);
    for (const r of rows) m.get(String(r[groupField.key]))?.push(r);
    for (const list of m.values()) list.sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
    return m;
  }, [rows, groups, groupField.key]);
  const [drag, setDrag] = useState<{ id: string } | null>(null);
  const [over, setOver] = useState<{ group: string; index: number } | null>(null);
  const [moveMenu, setMoveMenu] = useState<{ row: Row; anchor: HTMLElement } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  const positionAt = (group: string, index: number, movingId: string) => {
    const list = (byGroup.get(group) ?? []).filter((r) => r.id !== movingId);
    const before = list[index - 1];
    const after = list[index];
    const p = (r?: Row) => Number(r?.position ?? 0);
    if (!before && !after) return 0;
    if (!before) return p(after) - 1;
    if (!after) return p(before) + 1;
    return (p(before) + p(after)) / 2;
  };

  const dropIndex = (e: React.DragEvent, group: string) => {
    const cards = Array.from((e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("[data-card]"));
    const y = e.clientY;
    const i = cards.findIndex((c) => {
      const r = c.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return i === -1 ? cards.length : i;
  };

  return (
    <div className="-mx-4 overflow-x-auto overscroll-x-contain px-4 pb-4 sm:-mx-0 sm:px-0 max-sm:snap-x max-sm:snap-mandatory" role="list" aria-label={`${described.labelPlural} by ${groupField.label.toLowerCase()}`}>
      <div className="flex min-h-[420px] gap-3">
        {groups.map((g) => {
          const list = byGroup.get(g.value) ?? [];
          const sum = sumField ? list.reduce((s, r) => s + (Number(r[sumField.key]) || 0), 0) : null;
          const tone = TONE_CLASS[g.tone ?? "neutral"];
          return (
            <section
              key={g.value}
              role="listitem"
              aria-label={`${g.label}, ${list.length}`}
              onDragOver={(e) => { if (!drag) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver({ group: g.value, index: dropIndex(e, g.value) }); }}
              onDragLeave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver((o) => (o?.group === g.value ? null : o)); }}
              onDrop={(e) => {
                e.preventDefault();
                const row = rows.find((r) => r.id === drag?.id);
                const index = dropIndex(e, g.value);
                setDrag(null);
                setOver(null);
                if (row) onMove(row, g.value, positionAt(g.value, index, row.id));
              }}
              className={cx(
                "flex w-[288px] shrink-0 flex-col rounded-[14px] bg-[var(--color-surface-sunken)] p-2 transition-shadow max-sm:w-[84vw] max-sm:snap-start",
                over?.group === g.value && "shadow-[inset_0_0_0_2px_var(--color-accent)]",
              )}
            >
              <header className="flex items-center gap-2 px-1.5 pb-2 pt-1">
                <span aria-hidden="true" className="size-2.5 rounded-full" style={{ backgroundColor: tone.dot }} />
                <h3 className="m-0 truncate text-[15px] font-semibold text-text">{g.label}</h3>
                <span className="tabular rounded-full bg-[var(--color-control)] px-1.5 text-[13px] font-semibold text-text-secondary">{list.length}</span>
                {sum !== null && <span className="tabular ml-auto text-[13px] font-semibold text-text-secondary">{moneyShort(sum)}</span>}
              </header>
              <ol className="m-0 flex min-h-12 list-none flex-col gap-2 p-0">
                {list.map((row, i) => (
                  <li key={row.id}>
                    {over?.group === g.value && over.index === i && drag?.id !== row.id && <div className="mb-2 h-1 rounded-full bg-accent" aria-hidden="true" />}
                    <BoardCard
                      described={described}
                      row={row}
                      dragging={drag?.id === row.id}
                      onDragStart={() => setDrag({ id: row.id })}
                      onDragEnd={() => { setDrag(null); setOver(null); }}
                      onMoveMenu={(anchor) => setMoveMenu({ row, anchor })}
                      onPreview={() => onPreview(row)}
                    />
                  </li>
                ))}
                {over?.group === g.value && over.index >= list.length && <li aria-hidden="true" className="h-1 rounded-full bg-accent" />}
              </ol>
              {onQuickCreate && described.canCreate && (
                adding === g.value ? (
                  <form
                    className="mt-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const input = (e.currentTarget.elements.namedItem("title") as HTMLInputElement);
                      const title = input.value.trim();
                      if (!title) return setAdding(null);
                      if (await onQuickCreate(g.value, title)) { input.value = ""; }
                    }}
                  >
                    <input
                      name="title"
                      autoFocus
                      placeholder={`New ${described.labelSingular.toLowerCase()} name`}
                      aria-label={`New ${described.labelSingular.toLowerCase()} in ${g.label}`}
                      onKeyDown={(e) => { if (e.key === "Escape") setAdding(null); }}
                      onBlur={(e) => { if (!e.currentTarget.value.trim()) setAdding(null); }}
                      className="h-11 w-full rounded-[10px] border-0 bg-[var(--color-surface)] px-3 text-[16px] text-text placeholder:text-text-tertiary focus:outline-none focus:shadow-[0_0_0_3px_var(--color-accent-subtle)] sm:text-[15px]"
                    />
                  </form>
                ) : (
                  <button type="button" onClick={() => setAdding(g.value)} className="mt-2 flex min-h-10 items-center gap-1.5 rounded-[10px] px-2 text-[14px] font-medium text-text-secondary hover:bg-[var(--color-control)] hover:text-text">
                    <Icon name="plus" size={16} /> New
                  </button>
                )
              )}
            </section>
          );
        })}
      </div>
      {moveMenu && (
        <Floating anchor={moveMenu.anchor} open onClose={() => setMoveMenu(null)} label="Move to" width={260}>
          <p className="m-0 px-2.5 pb-1 pt-1.5 text-[13px] font-semibold uppercase tracking-[0.02em] text-text-secondary">Move to</p>
          <OptionList
            options={groups.map((o) => ({ value: o.value, label: o.label, option: o }))}
            value={String(moveMenu.row[groupField.key])}
            onPick={(v) => {
              const row = moveMenu.row;
              setMoveMenu(null);
              if (v && v !== row[groupField.key]) onMove(row, v, positionAt(v, 0, row.id));
            }}
          />
        </Floating>
      )}
    </div>
  );
}

function BoardCard({
  described,
  row,
  dragging,
  onDragStart,
  onDragEnd,
  onMoveMenu,
  onPreview,
}: {
  described: Described;
  row: Row;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMoveMenu: (anchor: HTMLElement) => void;
  onPreview: () => void;
}) {
  const company = isRef(row.company) ? row.company : null;
  const owner = isRef(row.owner) ? row.owner : null;
  const amount = typeof row.amount === "number" ? row.amount : null;
  const close = typeof row.expectedCloseOn === "string" ? row.expectedCloseOn : null;
  const bid = typeof row.submissionDueOn === "string" ? row.submissionDueOn : null;
  const open = row.stageCategory === "Active";
  const dueSoon = (iso: string | null) => (iso ? daysFromToday(iso) : null);
  const bidDays = dueSoon(bid);
  const closeDays = dueSoon(close);
  return (
    <article
      data-card
      draggable={described.canEdit}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", row.id); onDragStart(); }}
      onDragEnd={onDragEnd}
      className={cx(
        "group/card relative rounded-[12px] bg-[var(--color-surface)] p-3 shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition-[transform,opacity,box-shadow] duration-150",
        described.canEdit && "cursor-grab active:cursor-grabbing",
        dragging ? "scale-[0.98] opacity-40" : "hover:shadow-[0_6px_18px_rgba(0,0,0,0.10)]",
      )}
    >
      <div className="flex items-start gap-2">
        <Link href={hrefFor(described.recordHref, row.id)} draggable={false} className="min-w-0 flex-1 text-[15px] font-semibold leading-[20px] text-text no-underline hover:underline">
          {String(row[described.titleField] ?? "Untitled")}
        </Link>
        {described.canEdit && (
          <button
            type="button"
            aria-label={`Move ${String(row[described.titleField] ?? "")}`}
            onClick={(e) => onMoveMenu(e.currentTarget)}
            className="-mr-1 -mt-1 grid size-8 shrink-0 place-items-center rounded-[8px] text-text-tertiary hover:bg-[var(--color-control)] hover:text-text max-sm:size-10"
          >
            <Icon name="moreHorizontal" size={16} />
          </button>
        )}
      </div>
      {company && <p className="m-0 mt-0.5 truncate text-[14px] text-text-secondary">{company.label}</p>}
      <div className="mt-2.5 flex items-center gap-2">
        {amount !== null ? <span className="tabular text-[17px] font-medium text-text">{moneyShort(amount)}</span> : <span className="text-[14px] text-text-tertiary">No amount</span>}
        <span className="flex-1" />
        {owner && <Avatar name={owner.label} size={24} />}
      </div>
      {(close || bid || typeof row.ref === "string") && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px]">
          {typeof row.ref === "string" && <span className="tabular text-text-tertiary">{row.ref}</span>}
          {open && bid && bidDays !== null && bidDays <= 14 && (
            <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium", bidDays < 0 ? "bg-[var(--color-state-blocked-fill)] text-[var(--color-state-blocked-on)]" : "bg-[var(--color-state-pending-fill)] text-[var(--color-state-pending-on)]")} suppressHydrationWarning>
              <Icon name="flag" size={12} /> Bid {bidDays < 0 ? "overdue" : relativeDay(bid)}
            </span>
          )}
          {close && (
            <span className={cx("inline-flex items-center gap-1 tabular", open && closeDays !== null && closeDays < 0 ? "font-medium text-[var(--color-danger-ink)]" : "text-text-secondary")}>
              <Icon name="schedule" size={12} /> {dayLabel(close)}
            </span>
          )}
        </div>
      )}
      <button type="button" onClick={onPreview} className="absolute inset-x-3 bottom-0 h-0 overflow-hidden opacity-0 focus-visible:static focus-visible:mt-2 focus-visible:h-auto focus-visible:opacity-100">
        Preview
      </button>
    </article>
  );
}

/* ================================= side preview ================================ */

function Preview({ described, row, onClose, onEdit }: { described: Described; row: Row; onClose: () => void; onEdit: (row: Row, field: RecordField, value: unknown) => void }) {
  const [editing, setEditing] = useState<{ field: RecordField; anchor: HTMLElement } | null>(null);
  const shown = described.fields.filter((f) => f.key !== described.titleField);
  return (
    <Modal open onClose={onClose} title={String(row[described.titleField] ?? "Untitled")} description={typeof row.ref === "string" ? row.ref : described.labelSingular} width="md"
      footer={
        <>
          <ModalCancel onClose={onClose}>Close</ModalCancel>
          <Link href={hrefFor(described.recordHref, row.id)} className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] bg-accent px-4 text-[15px] font-semibold text-accent-on no-underline active:opacity-80">
            Open {described.labelSingular.toLowerCase()} <Icon name="chevronRight" size={14} />
          </Link>
        </>
      }
    >
      <dl className="m-0 divide-y divide-[var(--color-separator)]">
        {shown.map((f) => {
          const can = described.canEdit && Boolean(f.editCommand);
          return (
            <div key={f.key} className="flex min-h-11 items-center gap-3 py-1.5">
              <dt className="w-36 shrink-0 text-[15px] text-text-secondary">{f.label}</dt>
              <dd className="m-0 min-w-0 flex-1">
                {can ? (
                  <button type="button" onClick={(e) => setEditing({ field: f, anchor: e.currentTarget })} className="flex min-h-9 w-full min-w-0 items-center rounded-[8px] px-2 -mx-2 text-left text-[15px] text-text hover:bg-[var(--color-control)]">
                    <span className="min-w-0 truncate"><FieldDisplay field={f} value={row[f.key]} row={row} described={described} /></span>
                  </button>
                ) : (
                  <span className="text-[15px]"><FieldDisplay field={f} value={row[f.key]} row={row} described={described} /></span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      {editing && (
        <Floating anchor={editing.anchor} open onClose={() => setEditing(null)} label={`Edit ${editing.field.label}`}>
          <FieldEditor field={editing.field} value={row[editing.field.key]} described={described} onCancel={() => setEditing(null)} onCommit={(v) => { onEdit(row, editing.field, v); setEditing(null); }} />
        </Floating>
      )}
    </Modal>
  );
}

/* ================================= bulk bar ================================ */

export type BulkAction =
  | { kind: "field"; label: string; command: string; field: string }
  | { kind: "simple"; label: string; command: string; destructive?: boolean; confirm?: string };

function BulkBar({
  described,
  count,
  actions,
  onRun,
  onClear,
}: {
  described: Described;
  count: number;
  actions: BulkAction[];
  onRun: (action: BulkAction, value?: unknown) => void;
  onClear: () => void;
}) {
  const [menu, setMenu] = useState<{ action: Extract<BulkAction, { kind: "field" }>; anchor: HTMLElement } | null>(null);
  const [confirming, setConfirming] = useState<Extract<BulkAction, { kind: "simple" }> | null>(null);
  if (!count) return null;
  const field = menu ? described.fields.find((f) => f.key === menu.action.field) : undefined;
  return (
    <>
      <div role="toolbar" aria-label="Selected records" className="glass-shell fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+76px)] z-[55] mx-auto flex max-w-[720px] flex-wrap items-center gap-2 rounded-[16px] px-3 py-2 shadow-[0_12px_36px_rgba(0,0,0,0.2)] lg:bottom-6 motion-safe:animate-[verity-rise_220ms_cubic-bezier(0.2,0.9,0.3,1)]">
        <span className="tabular px-1.5 text-[15px] font-semibold text-text">{count} selected</span>
        <span className="flex-1" />
        {described.canEdit &&
          actions.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={(e) => (a.kind === "field" ? setMenu({ action: a, anchor: e.currentTarget }) : a.confirm ? setConfirming(a) : onRun(a))}
              className={cx(
                "inline-flex min-h-9 items-center rounded-[10px] px-3 text-[14px] font-semibold max-sm:min-h-11",
                a.kind === "simple" && a.destructive ? "bg-[var(--color-control)] text-[var(--color-danger-ink)]" : "bg-[var(--color-control)] text-accent-ink",
              )}
            >
              {a.label}
            </button>
          ))}
        <button type="button" onClick={onClear} aria-label="Clear selection" className="grid size-9 place-items-center rounded-full bg-[var(--color-control)] text-text-secondary max-sm:size-11">
          <Icon name="close" size={16} />
        </button>
      </div>
      {menu && field && (
        <Floating anchor={menu.anchor} open onClose={() => setMenu(null)} label={menu.action.label}>
          <FieldEditor field={field} value={null} described={described} onCancel={() => setMenu(null)} onCommit={(v) => { onRun(menu.action, v); setMenu(null); }} />
        </Floating>
      )}
      <Modal
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        title={`${confirming?.label ?? ""} ${count} ${count === 1 ? described.labelSingular.toLowerCase() : described.labelPlural.toLowerCase()}?`}
        description={confirming?.confirm}
        width="sm"
        footer={
          <>
            <ModalCancel onClose={() => setConfirming(null)} />
            <Button variant="danger" onClick={() => { if (confirming) onRun(confirming); setConfirming(null); }}>{confirming?.label}</Button>
          </>
        }
      >
        <span />
      </Modal>
    </>
  );
}

/* ================================= the view ================================ */

export function RecordView({
  described,
  views: initialViews,
  initialViewId,
  initial,
  bulkActions = [],
  reasonRule,
  emptyState,
}: {
  described: Described;
  views: SavedViewRow[];
  initialViewId?: string;
  initial: ListResult;
  bulkActions?: BulkAction[];
  /** A board group that needs a reason before a record may enter it (lost deals). */
  reasonRule?: ReasonRule;
  /** Shown instead of the table when the object has no records at all. */
  emptyState?: ReactNode;
}) {
  const router = useRouter();
  const [views, setViews] = useState(initialViews);
  const pick = (id?: string) => views.find((v) => v.id === id) ?? views.find((v) => v.isDefault && v.visibility === "personal") ?? views.find((v) => v.isDefault) ?? views[0]!;
  const [viewId, setViewId] = useState(() => pick(initialViewId).id);
  const view = views.find((v) => v.id === viewId) ?? views[0]!;
  const [type, setType] = useState<"table" | "board">(view.type);
  const [config, setConfig] = useState<ViewConfig>(() => normaliseConfig(view.config));
  const [search, setSearch] = useState("");
  const [data, setData] = useState<ListResult>(initial);
  const [loading, startLoading] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Row | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [popover, setPopover] = useState<{ kind: "filter" | "sort" | "fields" | "save" | "views"; anchor: HTMLElement; index?: number } | null>(null);
  const [pendingMove, setPendingMove] = useState<{ row: Row; group: string; position: number } | null>(null);
  const anchors = useRef<Record<string, HTMLElement | null>>({});
  const firstLoad = useRef(true);
  const toastId = useRef(0);
  const searchId = useId();

  const toast = useCallback((text: string, tone: Toast["tone"] = "error") => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 7000 : 3500);
  }, []);

  const fields = useMemo(() => new Map(described.fields.map((f) => [f.key, f])), [described.fields]);
  const groupField = fields.get(config.groupBy ?? described.boardGroupField ?? "");
  const columns = useMemo(() => {
    const keys = config.columns.length ? config.columns : described.defaultColumns.map((key) => ({ key, width: undefined as number | undefined }));
    const withTitle = keys.some((c) => c.key === described.titleField) ? keys : [{ key: described.titleField }, ...keys];
    const ordered = [...withTitle.filter((c) => c.key === described.titleField), ...withTitle.filter((c) => c.key !== described.titleField)];
    return ordered
      .map((c) => ({ field: fields.get(c.key)!, width: ("width" in c && c.width) || fields.get(c.key)?.width || 160 }))
      .filter((c) => c.field);
  }, [config.columns, described.defaultColumns, described.titleField, fields]);

  const load = useCallback(
    (cfg: ViewConfig, t: "table" | "board", q: string, offset = 0) => {
      startLoading(async () => {
        const result = await runQuery<ListResult>(described.listQuery, {
          filters: cfg.filters,
          match: cfg.match,
          sorts: t === "board" ? [] : cfg.sorts,
          search: q || undefined,
          aggregates: t === "board" ? {} : cfg.aggregates,
          limit: t === "board" ? 500 : 100,
          offset,
        });
        if (!result.ok) {
          setFailed(cleanMessage(result.message));
          return;
        }
        setFailed(null);
        setData((d) => (offset ? { ...result.data, rows: [...d.rows, ...result.data.rows] } : result.data));
      });
    },
    [described.listQuery],
  );

  useEffect(() => {
    if (firstLoad.current) { firstLoad.current = false; return; }
    const t = setTimeout(() => load(config, type, search), search ? 220 : 0);
    return () => clearTimeout(t);
  }, [config, type, search, load]);

  const switchView = (id: string) => {
    const next = views.find((v) => v.id === id);
    if (!next) return;
    setViewId(id);
    setType(next.type);
    setConfig(normaliseConfig(next.config));
    setSelected(new Set());
    const url = new URL(window.location.href);
    url.searchParams.set("view", id);
    window.history.replaceState(null, "", url);
  };

  const dirty = !sameConfig(config, normaliseConfig(view.config)) || type !== view.type;

  /* -------- edits: optimistic, rolled back with the server's reason -------- */

  const patchRow = (id: string, patch: Partial<Row>) => setData((d) => ({ ...d, rows: d.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));

  const displayValue = (field: RecordField, value: unknown): unknown => {
    if (value === null) return null;
    if (field.type === "user") return described.members.find((m) => m.id === value) ?? null;
    if (field.type === "relation") return { id: String(value), label: "…" };
    return value;
  };

  const edit = async (row: Row, field: RecordField, value: unknown, extra: Record<string, unknown> = {}) => {
    if (!field.editCommand) return;
    if (reasonRule && field.key === groupField?.key && reasonRule.groups.includes(String(value)) && !extra[reasonRule.field]) {
      setPendingMove({ row, group: String(value), position: Number(row.position ?? 0) });
      return;
    }
    const before = { [field.key]: row[field.key], version: row.version };
    patchRow(row.id, { [field.key]: displayValue(field, value) });
    const result = await runCommand<{ id: string; version: number }>(field.editCommand, { id: row.id, version: row.version, patch: { ...patchFor(field, value), ...extra } });
    if (!result.ok) {
      patchRow(row.id, before);
      toast(cleanMessage(result.message));
      return;
    }
    patchRow(row.id, { version: result.data.version });
    if (field.type === "relation" || field.key === groupField?.key) load(config, type, search);
    router.refresh();
  };

  const move = async (row: Row, group: string, position: number, extra: Record<string, unknown> = {}) => {
    if (!described.boardMove || !groupField) return;
    if (reasonRule && reasonRule.groups.includes(group) && !extra[reasonRule.field] && row[groupField.key] !== group) {
      setPendingMove({ row, group, position });
      return;
    }
    const before = { [groupField.key]: row[groupField.key], position: row.position, version: row.version };
    patchRow(row.id, { [groupField.key]: group, position });
    const result = await runCommand<{ id: string; version: number }>(described.boardMove.command, {
      id: row.id, version: row.version, position, [described.boardMove.groupParam]: group, ...extra,
    });
    if (!result.ok) {
      patchRow(row.id, before);
      toast(cleanMessage(result.message));
      return;
    }
    const option = groupField.options?.find((o) => o.value === group);
    patchRow(row.id, { version: result.data.version, stageCategory: option?.tone === "success" ? "Completed" : option?.tone === "danger" ? "Cancelled" : "Active" });
    if (row[groupField.key] !== group && option) toast(`Moved to ${option.label}`, "ok");
    router.refresh();
  };

  const quickCreate = async (group: string, title: string) => {
    if (!described.quickCreate) return false;
    const result = await runCommand(described.quickCreate.command, { [described.quickCreate.titleParam]: title, [described.quickCreate.groupParam]: group });
    if (!result.ok) {
      toast(cleanMessage(result.message));
      return false;
    }
    load(config, type, search);
    router.refresh();
    return true;
  };

  const runBulk = async (action: BulkAction, value?: unknown) => {
    const ids = [...selected];
    const input = action.kind === "field" ? { ids, patch: { [action.field]: value } } : { ids };
    const result = await runCommand<{ count: number }>(action.command, input);
    if (!result.ok) return toast(cleanMessage(result.message));
    toast(`${action.label}: ${result.data.count} ${result.data.count === 1 ? described.labelSingular.toLowerCase() : described.labelPlural.toLowerCase()}`, "ok");
    setSelected(new Set());
    load(config, type, search);
    router.refresh();
  };

  /* -------- saving views -------- */

  const saveCurrent = async (asNew: { name: string; visibility: "personal" | "shared"; isDefault: boolean } | null) => {
    const base = { objectKey: described.key, type, config: { ...config, search: undefined } };
    const input = asNew || view.builtIn
      ? { ...base, name: asNew?.name ?? view.name, visibility: asNew?.visibility ?? "personal", isDefault: asNew?.isDefault ?? false }
      : { ...base, id: view.id, version: view.version, name: view.name, visibility: view.visibility };
    const result = await runCommand<{ id: string; version: number }>("verity.view.save", input);
    if (!result.ok) return toast(cleanMessage(result.message));
    const list = await runQuery<SavedViewRow[]>("verity.view.list", { objectKey: described.key });
    if (list.ok) setViews(list.data);
    setViewId(result.data.id);
    toast(asNew ? `Saved “${asNew.name}”` : "View updated", "ok");
    setPopover(null);
  };

  const deleteCurrent = async () => {
    if (view.builtIn) return;
    const result = await runCommand("verity.view.delete", { id: view.id });
    if (!result.ok) return toast(cleanMessage(result.message));
    const list = await runQuery<SavedViewRow[]>("verity.view.list", { objectKey: described.key });
    if (list.ok) {
      setViews(list.data);
      const first = list.data[0]!;
      setViewId(first.id);
      setType(first.type);
      setConfig(normaliseConfig(first.config));
    }
    setPopover(null);
  };

  const setFilters = (filters: ViewConfig["filters"]) => setConfig((c) => ({ ...c, filters }));
  const canSaveShared = described.canShareViews;
  const canChangeThis = view.builtIn || view.visibility === "personal" || canSaveShared;

  if (data.total === 0 && config.filters.length === 0 && !search && emptyState) return <>{emptyState}</>;

  return (
    <div>
      {/* views */}
      <div className="mb-3 flex items-center gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Views">
        {views.map((v) => (
          <button
            key={v.id}
            role="tab"
            type="button"
            aria-selected={v.id === viewId}
            onClick={() => switchView(v.id)}
            className={cx(
              "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-pill px-3.5 text-[14px] font-medium transition-colors max-lg:min-h-11",
              v.id === viewId ? "bg-accent text-accent-on" : "bg-[var(--color-control)] text-text hover:bg-[var(--color-control-strong)]",
            )}
          >
            <Icon name={v.type === "board" ? "stage" : "catalogue"} size={15} />
            {v.name}
            {v.visibility === "personal" && !v.builtIn && <Icon name="lock" size={12} className="opacity-70" />}
          </button>
        ))}
        <button
          type="button"
          ref={(el) => { anchors.current.save = el; }}
          onClick={() => setPopover({ kind: "save", anchor: anchors.current.save! })}
          className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-pill px-3 text-[14px] font-medium text-accent-ink hover:bg-accent-subtle max-lg:min-h-11"
        >
          <Icon name="plus" size={15} /> Save as view
        </button>
      </div>

      {/* toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-[320px]">
          <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <label htmlFor={searchId} className="sr-only">Search {described.labelPlural.toLowerCase()}</label>
          <input
            id={searchId}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${described.labelPlural.toLowerCase()}`}
            className="h-9 w-full rounded-[10px] border-0 bg-[var(--color-control)] pl-9 pr-3 text-[16px] text-text placeholder:text-text-tertiary focus:outline-none focus:shadow-[0_0_0_3px_var(--color-accent-subtle)] max-sm:h-11 sm:text-[15px]"
          />
        </div>
        <ToolbarButton icon="eyedropper" label="Filter" count={config.filters.length} buttonRef={(el) => { anchors.current.filter = el; }} expanded={popover?.kind === "filter" && popover.index === undefined} onClick={() => setPopover({ kind: "filter", anchor: anchors.current.filter! })} />
        {type === "table" && (
          <>
            <ToolbarButton icon="expand" label="Sort" count={config.sorts.length} buttonRef={(el) => { anchors.current.sort = el; }} expanded={popover?.kind === "sort"} onClick={() => setPopover({ kind: "sort", anchor: anchors.current.sort! })} />
            <ToolbarButton icon="catalogue" label="Fields" buttonRef={(el) => { anchors.current.fields = el; }} expanded={popover?.kind === "fields"} onClick={() => setPopover({ kind: "fields", anchor: anchors.current.fields! })} />
          </>
        )}
        <span className="flex-1" />
        {described.boardGroupField && (
          <div role="radiogroup" aria-label="Layout" className="inline-flex rounded-[10px] bg-[var(--color-control)] p-0.5">
            {(["table", "board"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={type === t}
                onClick={() => { setType(t); if (t === "board" && !config.groupBy) setConfig((c) => ({ ...c, groupBy: described.boardGroupField ?? null })); }}
                className={cx("inline-flex min-h-8 items-center gap-1.5 rounded-[8px] px-3 text-[14px] font-semibold transition-colors max-sm:min-h-10", type === t ? "bg-[var(--color-surface)] text-text shadow-[0_1px_3px_rgba(0,0,0,0.12)]" : "text-text-secondary")}
              >
                <Icon name={t === "board" ? "stage" : "catalogue"} size={15} /> {t === "board" ? "Board" : "Table"}
              </button>
            ))}
          </div>
        )}
        {dirty && (
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => { setConfig(normaliseConfig(view.config)); setType(view.type); }}>Reset</Button>
            {canChangeThis && !view.builtIn ? (
              <Button variant="secondary" size="sm" onClick={() => saveCurrent(null)}>Update view</Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => setPopover({ kind: "save", anchor: anchors.current.save! })}>Save as view</Button>
            )}
          </div>
        )}
        {loading && <span className="text-[13px] text-text-tertiary" aria-live="polite">Updating…</span>}
      </div>

      {/* filter chips */}
      {config.filters.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {config.filters.length > 1 && (
            <button type="button" onClick={() => setConfig((c) => ({ ...c, match: c.match === "all" ? "any" : "all" }))} className="min-h-8 rounded-pill bg-[var(--color-control)] px-3 text-[13px] font-semibold text-text-secondary hover:text-text">
              Match {config.match === "all" ? "all" : "any"}
            </button>
          )}
          {config.filters.map((f, i) => (
            <span key={`${f.field}-${i}`} className="inline-flex min-h-8 items-center rounded-pill bg-accent-subtle text-[14px] text-accent-ink">
              <button
                type="button"
                ref={(el) => { anchors.current[`chip-${i}`] = el; }}
                onClick={() => setPopover({ kind: "filter", anchor: anchors.current[`chip-${i}`]!, index: i })}
                className="min-h-8 rounded-l-pill pl-3 pr-1 font-medium"
              >
                {filterSummary(described, f as { field: string; op: FilterOp; value?: unknown })}
              </button>
              <button type="button" aria-label="Remove filter" onClick={() => setFilters(config.filters.filter((_, j) => j !== i))} className="grid size-8 place-items-center rounded-r-pill hover:bg-[var(--color-accent-muted)]">
                <Icon name="close" size={13} />
              </button>
            </span>
          ))}
          <button type="button" onClick={() => setFilters([])} className="min-h-8 px-2 text-[13px] font-medium text-text-secondary hover:text-text">Clear all</button>
        </div>
      )}

      {failed ? (
        <div className="glass-card rounded-[12px] px-6 py-10 text-center">
          <p className="m-0 text-[17px] font-semibold text-text">This view could not load</p>
          <p className="mx-auto mb-4 mt-1 max-w-[52ch] text-[15px] text-text-secondary">{failed}</p>
          <Button variant="secondary" onClick={() => load(config, type, search)}>Try again</Button>
        </div>
      ) : type === "board" && groupField ? (
        <Board
          described={described}
          rows={data.rows}
          groupField={groupField}
          hiddenGroups={config.hiddenGroups}
          onMove={(row, group, position) => move(row, group, position)}
          onQuickCreate={described.quickCreate ? quickCreate : undefined}
          onPreview={setPreview}
        />
      ) : (
        <>
          <RecordTable
            described={described}
            rows={data.rows}
            columns={columns}
            aggregates={data.aggregates}
            aggregateChoice={config.aggregates}
            onAggregate={(key, op) =>
              setConfig((c) => {
                const next = { ...c.aggregates };
                if (op) next[key] = op as ViewConfig["aggregates"][string];
                else delete next[key];
                return { ...c, aggregates: next };
              })
            }
            selected={selected}
            onSelect={(ids, on) => setSelected((s) => { const n = new Set(s); for (const id of ids) { if (on) n.add(id); else n.delete(id); } return n; })}
            onEdit={(row, field, value) => edit(row, field, value)}
            onPreview={setPreview}
            total={data.total}
          />
          <RecordList described={described} rows={data.rows} columns={columns} selected={selected} onSelect={(ids, on) => setSelected((s) => { const n = new Set(s); for (const id of ids) { if (on) n.add(id); else n.delete(id); } return n; })} />
          {data.rows.length < data.total && (
            <div className="mt-3 flex justify-center">
              <Button variant="secondary" onClick={() => load(config, type, search, data.rows.length)} disabled={loading}>
                Show more ({data.total - data.rows.length} left)
              </Button>
            </div>
          )}
        </>
      )}

      {/* popovers */}
      {popover?.kind === "filter" && (
        <Floating anchor={popover.anchor} open onClose={() => setPopover(null)} label="Filter" width={340}>
          <FilterEditor
            described={described}
            initial={popover.index !== undefined ? (config.filters[popover.index] as { field: string; op: FilterOp; value?: unknown }) : undefined}
            onRemove={popover.index !== undefined ? () => { setFilters(config.filters.filter((_, j) => j !== popover.index)); setPopover(null); } : undefined}
            onApply={(f) => {
              const next = [...config.filters];
              if (popover.index !== undefined) next[popover.index] = f as ViewConfig["filters"][number];
              else next.push(f as ViewConfig["filters"][number]);
              setFilters(next);
              setPopover(null);
            }}
          />
        </Floating>
      )}
      {popover?.kind === "sort" && (
        <Floating anchor={popover.anchor} open onClose={() => setPopover(null)} label="Sort" width={360}>
          <SortEditor described={described} sorts={config.sorts} onChange={(sorts) => setConfig((c) => ({ ...c, sorts }))} />
        </Floating>
      )}
      {popover?.kind === "fields" && (
        <Floating anchor={popover.anchor} open onClose={() => setPopover(null)} label="Fields" width={300}>
          <FieldsEditor described={described} columns={columns.map((c) => ({ key: c.field.key, width: c.width }))} onChange={(cols) => setConfig((c) => ({ ...c, columns: cols }))} />
        </Floating>
      )}
      {popover?.kind === "save" && (
        <Floating anchor={popover.anchor} open onClose={() => setPopover(null)} label="Save as view" width={320}>
          <form
            className="flex flex-col gap-3 p-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              const name = String(form.get("name") ?? "").trim();
              if (!name) return;
              saveCurrent({ name, visibility: form.get("shared") ? "shared" : "personal", isDefault: Boolean(form.get("default")) });
            }}
          >
            <Field label="View name" htmlFor="view-name" required>
              <Input id="view-name" name="name" maxLength={80} placeholder="e.g. Tenders closing this month" autoComplete="off" />
            </Field>
            <label className={cx("flex min-h-10 items-center gap-2.5 text-[15px]", !canSaveShared && "opacity-50")}>
              <input type="checkbox" name="shared" disabled={!canSaveShared} className="size-4 accent-[var(--color-accent)]" />
              Share with everyone
            </label>
            {!canSaveShared && <p className="-mt-2 m-0 text-[13px] text-text-secondary">Sharing views needs the “manage shared views” permission.</p>}
            <label className="flex min-h-10 items-center gap-2.5 text-[15px]">
              <input type="checkbox" name="default" className="size-4 accent-[var(--color-accent)]" />
              Open this view by default
            </label>
            <div className="flex items-center justify-between gap-2">
              {!view.builtIn && (view.visibility === "personal" || canSaveShared) ? (
                <Button type="button" variant="danger" size="sm" onClick={deleteCurrent}>Delete “{view.name}”</Button>
              ) : <span />}
              <Button type="submit" variant="primary" size="sm">Save view</Button>
            </div>
          </form>
        </Floating>
      )}

      {preview && (
        <Preview
          described={described}
          row={data.rows.find((r) => r.id === preview.id) ?? preview}
          onClose={() => setPreview(null)}
          onEdit={(row, field, value) => edit(row, field, value)}
        />
      )}
      <ReasonSheet
        open={Boolean(pendingMove)}
        rule={reasonRule}
        described={described}
        onClose={() => setPendingMove(null)}
        onConfirm={(reason, note) => {
          const p = pendingMove;
          setPendingMove(null);
          if (!p || !reasonRule) return;
          const extra: Record<string, unknown> = { [reasonRule.field]: reason, ...(reasonRule.noteField && note ? { [reasonRule.noteField]: note } : {}) };
          if (type === "board") move(p.row, p.group, p.position, extra);
          else if (groupField) edit(p.row, groupField, p.group, extra);
        }}
      />
      <BulkBar described={described} count={selected.size} actions={bulkActions} onRun={runBulk} onClear={() => setSelected(new Set())} />
      <Toasts toasts={toasts} dismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  );
}

export type { Ref };
