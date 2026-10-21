import type { FieldOption, FieldType, FilterOp, RecordField, SavedViewRow, ViewConfig } from "@/server/platform/views";

/**
 * Client-side shapes for the record table, board and saved views (ADR-051). Type-only imports from the platform
 * module: nothing server-side reaches the bundle.
 */

export type { FieldOption, FieldType, FilterOp, RecordField, SavedViewRow, ViewConfig };

export type Ref = { id: string; label: string };
export type Row = Record<string, unknown> & { id: string; version?: number; archived?: boolean };

/** A record object as `describe` returns it: descriptor + tenant options + this person's permissions. */
export type Described = {
  key: string;
  entity: string;
  labelSingular: string;
  labelPlural: string;
  icon: string;
  titleField: string;
  recordHref: string;
  fields: RecordField[];
  listQuery: string;
  defaultColumns: string[];
  defaultSort?: { field: string; dir: "asc" | "desc" };
  boardGroupField?: string;
  boardSumField?: string;
  lookupQuery?: string;
  boardMove?: { command: string; groupParam: string };
  quickCreate?: { command: string; titleParam: string; groupParam: string };
  customFieldsCommand?: string;
  canCreate: boolean;
  canEdit: boolean;
  canShareViews: boolean;
  /** May declare and retire this workspace's custom fields. */
  canDefineFields?: boolean;
  members: Ref[];
};

export type ListResult = { rows: Row[]; total: number; aggregates: Record<string, number | null> };

export const OP_LABEL: Record<FilterOp, string> = {
  contains: "contains",
  not_contains: "does not contain",
  eq: "is",
  neq: "is not",
  gt: "more than",
  gte: "at least",
  lt: "less than",
  lte: "at most",
  before: "before",
  after: "after",
  is_any_of: "is any of",
  is_none_of: "is none of",
  is_empty: "is empty",
  is_not_empty: "is not empty",
  is_me: "is me",
  overdue: "is overdue",
  next_days: "in the next",
};

/** Operators that need no value from the person. */
export const VALUELESS = new Set<FilterOp>(["is_empty", "is_not_empty", "is_me", "overdue"]);

export const AGGREGATE_LABEL: Record<string, string> = {
  count: "Count",
  count_empty: "Empty",
  count_not_empty: "Not empty",
  percent_empty: "% empty",
  sum: "Sum",
  avg: "Average",
  min: "Min",
  max: "Max",
};

export const hrefFor = (pattern: string, id: string) => pattern.replace("{id}", encodeURIComponent(id));

/** The `patch` an edit command receives for one field: a custom field goes inside `customFields` by its name. */
export function patchFor(field: RecordField, value: unknown): Record<string, unknown> {
  return field.custom ? { customFields: { [field.custom]: value } } : { [field.key]: value };
}

export function isRef(v: unknown): v is Ref {
  return typeof v === "object" && v !== null && "id" in v && "label" in v;
}

export function optionFor(field: RecordField, value: unknown): FieldOption | undefined {
  return field.options?.find((o) => o.value === value);
}

/* --------------------------------- formatting -------------------------------- */

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** ₹18,50,000 — the exact figure, in Indian grouping. */
export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return `₹${inr.format(Math.round(value))}`;
}

/** ₹18.5L, ₹1.2Cr — for board totals and tiles, where the exact figure is noise. */
export function moneyShort(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = Math.round(value);
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 10_000_000) return `${sign}₹${(a / 10_000_000).toFixed(a >= 100_000_000 ? 0 : 2)}Cr`;
  if (a >= 100_000) return `${sign}₹${(a / 100_000).toFixed(a >= 10_000_000 ? 0 : 1)}L`;
  return `${sign}₹${inr.format(a)}`;
}

const dayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const dayYearFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const timeFmt = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" });

/** "15 Dec" this year, "15 Dec 2027" otherwise. Dates are calendar days (UTC midnight). */
export function dayLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00.000Z` : iso);
  return d.getUTCFullYear() === new Date().getUTCFullYear() ? dayFmt.format(d) : dayYearFmt.format(d);
}

/** Whole days from today to a calendar date: negative is past. */
export function daysFromToday(iso: string): number {
  const today = new Date();
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00.000Z` : iso);
  return Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - t) / 86_400_000);
}

/** "today", "tomorrow", "in 4 days", "3 days ago". */
export function relativeDay(iso: string): string {
  const n = daysFromToday(iso);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** "just now", "12 min ago", "3 h ago", "Yesterday 4:10 pm", "12 Oct". */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000 && diff > -60_000) return "just now";
  if (diff > 0 && diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (diff > 0 && diff < 6 * 3_600_000) return `${Math.round(diff / 3_600_000)} h ago`;
  const days = -daysFromToday(iso);
  if (days === 0) return `Today ${timeFmt.format(d)}`;
  if (days === 1) return `Yesterday ${timeFmt.format(d)}`;
  return dayLabel(iso);
}

/** Plain text for a cell value: what search, copy and screen readers get. */
export function textOf(field: RecordField, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) return value.join(", ");
  if (isRef(value)) return value.label;
  switch (field.type) {
    case "currency":
      return money(Number(value));
    case "number":
      return field.key === "probability" ? `${value}%` : inr.format(Number(value));
    case "date":
      return dayLabel(String(value));
    case "datetime":
      return relativeTime(String(value));
    case "select":
      return optionFor(field, value)?.label ?? String(value);
    case "boolean":
      return value ? "Yes" : "No";
    default:
      return String(value);
  }
}

/** The value an editor starts from: the raw scalar, the ref's id, or the list joined. */
export function editableOf(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (isRef(value)) return value.id;
  return String(value);
}

/** A view config with every field present, for comparing and saving. */
export function normaliseConfig(c: Partial<ViewConfig>): ViewConfig {
  return {
    columns: c.columns ?? [],
    filters: c.filters ?? [],
    match: c.match ?? "all",
    sorts: c.sorts ?? [],
    groupBy: c.groupBy ?? null,
    hiddenGroups: c.hiddenGroups ?? [],
    aggregates: c.aggregates ?? {},
    search: c.search,
  };
}

export function sameConfig(a: ViewConfig, b: ViewConfig): boolean {
  const strip = (c: ViewConfig) => JSON.stringify({ ...normaliseConfig(c), search: undefined });
  return strip(a) === strip(b);
}
