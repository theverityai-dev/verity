import { z } from "zod";
import { registerCommand, ValidationError, type CommandDefinition } from "./command";
import { registerQuery, type QueryDefinition } from "./query";
import { ConflictError } from "./entity";
import { ForbiddenError, hasTenantPermission } from "./authorization";
import type { TenantScopedClient } from "./tenancy";

/**
 * Record objects and saved views — ADR-051 (PROPOSED).
 *
 * A capability describes a list-able object once (`registerRecordObject`): its fields, how each is filtered,
 * sorted and aggregated, and the command that edits it. Every list screen then gets the same record table,
 * board and saved views. Two rules keep this from becoming a second runtime:
 *
 *  - Reads stay in the owning capability. This module turns a view's filters and sorts into a Prisma `where` and
 *    `orderBy` (`buildWhere`, `buildOrderBy`); the capability's own query runs them under the caller's tenant and
 *    authority. Nothing here reads a capability's tables.
 *  - Writes stay commands. A field names the command that edits it; an inline edit runs that command through the
 *    ordinary pipeline. This module adds no write path to anyone's records.
 *
 * Saved views are the only data this module owns (`saved_view`, forced RLS). A personal view needs `Create` on
 * `verity.platform.saved_view`; anything shared needs `Edit`.
 */

export const ENTITY_SAVED_VIEW = "verity.platform.saved_view";

/* ================================ descriptors ================================ */

export const FIELD_TYPES = [
  "text", "number", "currency", "date", "datetime", "select", "relation", "user", "email", "phone", "link", "boolean",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FILTER_OPS = [
  "contains", "not_contains", "eq", "neq", "gt", "gte", "lt", "lte", "before", "after",
  "is_any_of", "is_none_of", "is_empty", "is_not_empty", "is_me", "overdue", "next_days",
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export const AGGREGATES = ["count", "count_empty", "count_not_empty", "percent_empty", "sum", "avg", "min", "max"] as const;
export type Aggregate = (typeof AGGREGATES)[number];

/** Which operators make sense for which kind of field. The filter bar offers exactly these. */
export const OPS_FOR_TYPE: Record<FieldType, readonly FilterOp[]> = {
  text: ["contains", "not_contains", "eq", "is_empty", "is_not_empty"],
  email: ["contains", "is_empty", "is_not_empty"],
  phone: ["contains", "is_empty", "is_not_empty"],
  link: ["contains", "is_empty", "is_not_empty"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"],
  currency: ["gt", "gte", "lt", "lte", "eq", "is_empty", "is_not_empty"],
  date: ["before", "after", "eq", "overdue", "next_days", "is_empty", "is_not_empty"],
  datetime: ["before", "after", "overdue", "next_days", "is_empty", "is_not_empty"],
  select: ["is_any_of", "is_none_of", "is_empty", "is_not_empty"],
  relation: ["is_any_of", "is_none_of", "is_empty", "is_not_empty"],
  user: ["is_me", "is_any_of", "is_none_of", "is_empty", "is_not_empty"],
  boolean: ["eq"],
};

export type FieldOption = { value: string; label: string; tone?: "neutral" | "accent" | "success" | "warning" | "danger" | "info" };

export type RecordField = {
  key: string;
  label: string;
  type: FieldType;
  /**
   * Where the value lives on the model, as a dot path (`company.name` for a relation's label). Defaults to `key`.
   * Filters and sorts use it; for a relation or user field it is the foreign-key column.
   */
  column?: string;
  /** Sort by this path instead of `column` (a relation sorts by the related record's name, not its id). */
  sortColumn?: string;
  /** A text[] column (emails, phones): `contains` matches one element exactly, `is_empty` means no elements. */
  array?: boolean;
  options?: FieldOption[];
  /** For a relation field: the record object it points at, so the editor can offer its records. */
  relation?: string;
  /** For a relation field: the target object's record page (`/crm/companies/{id}`), filled in when described. */
  relationHref?: string;
  filterable?: boolean;
  sortable?: boolean;
  aggregates?: readonly Aggregate[];
  /** The command an inline edit runs, called as `{ id, version, patch: { [key]: value } }`. Absent means read-only. */
  editCommand?: string;
  /** Column width in pixels when a view has not set one. */
  width?: number;
};

export type RecordObject = {
  key: string;
  /** The entity whose Read permission gates the list. */
  entity: string;
  capability: string;
  labelSingular: string;
  labelPlural: string;
  /** A glyph name from the shared icon set. */
  icon: string;
  /** The field shown as the record's name, first column, link to the record page. */
  titleField: string;
  /** `/crm/companies/{id}`. */
  recordHref: string;
  fields: RecordField[];
  /** The query that lists the object, called with `ListInput`. */
  listQuery: string;
  /** Columns of the built-in "All" view, in order. */
  defaultColumns: string[];
  defaultSort?: { field: string; dir: "asc" | "desc" };
  /** The select or relation field a board groups by. */
  boardGroupField?: string;
  /** A currency or number field the board totals per column. */
  boardSumField?: string;
  /** Free-text search runs `contains` over these columns. */
  searchColumns: string[];
  /** The query a relation picker calls, with `{ object, search }`, for fields that point at this capability's objects. */
  lookupQuery?: string;
  /** The command a board drag runs: `{ id, version, position, [groupParam]: value }` plus any reason fields. */
  boardMove?: { command: string; groupParam: string };
  /** The command a board column's quick add runs: `{ [titleParam]: text, [groupParam]: value }`. */
  quickCreate?: { command: string; titleParam: string; groupParam: string };
};

const objects = new Map<string, RecordObject>();

export function registerRecordObject(object: RecordObject): void {
  if (objects.has(object.key)) throw new Error(`Record object already registered: ${object.key}`);
  const keys = new Set(object.fields.map((f) => f.key));
  for (const name of [object.titleField, ...object.defaultColumns, object.boardGroupField, object.boardSumField, object.defaultSort?.field]) {
    if (name && !keys.has(name)) throw new Error(`Record object ${object.key} names unknown field "${name}"`);
  }
  objects.set(object.key, object);
}

export function getRecordObject(key: string): RecordObject | undefined {
  return objects.get(key);
}

export function listRecordObjects(): RecordObject[] {
  return [...objects.values()];
}

/** Test seam. */
export function clearRecordObjects(): void {
  objects.clear();
}

/* ================================ view config ================================ */

const filterValue = z.union([z.string().max(500), z.number(), z.boolean(), z.array(z.string().max(200)).max(100), z.null()]);

export const filterSchema = z.object({ field: z.string().max(80), op: z.enum(FILTER_OPS), value: filterValue.optional() });
export const sortSchema = z.object({ field: z.string().max(80), dir: z.enum(["asc", "desc"]) });

export const viewConfigSchema = z.object({
  columns: z.array(z.object({ key: z.string().max(80), width: z.number().int().min(60).max(800).optional() })).max(60).default([]),
  filters: z.array(filterSchema).max(20).default([]),
  /** all = every filter must match; any = one is enough. */
  match: z.enum(["all", "any"]).default("all"),
  sorts: z.array(sortSchema).max(5).default([]),
  groupBy: z.string().max(80).nullable().optional(),
  hiddenGroups: z.array(z.string().max(200)).max(100).default([]),
  aggregates: z.record(z.string().max(80), z.enum(AGGREGATES)).default({}),
  search: z.string().max(200).optional(),
});
export type ViewConfig = z.infer<typeof viewConfigSchema>;
export type ViewFilter = z.infer<typeof filterSchema>;
export type ViewSort = z.infer<typeof sortSchema>;

/** Refuses a view that names a field the object does not have, or an operator its type does not support. */
export function validateViewConfig(object: RecordObject, config: ViewConfig, type: "table" | "board"): ViewConfig {
  const fields = new Map(object.fields.map((f) => [f.key, f]));
  const field = (key: string, what: string) => {
    const found = fields.get(key);
    if (!found) throw new ValidationError(`E_VALIDATION: ${object.labelPlural} have no field "${key}" to ${what}`);
    return found;
  };
  for (const c of config.columns) field(c.key, "show");
  for (const f of config.filters) {
    const def = field(f.field, "filter by");
    if (def.filterable === false) throw new ValidationError(`E_VALIDATION: ${def.label} cannot be filtered`);
    if (!OPS_FOR_TYPE[def.type].includes(f.op)) throw new ValidationError(`E_VALIDATION: ${def.label} cannot be filtered with "${f.op}"`);
  }
  for (const s of config.sorts) {
    const def = field(s.field, "sort by");
    if (def.sortable === false) throw new ValidationError(`E_VALIDATION: ${def.label} cannot be sorted`);
  }
  for (const [key, op] of Object.entries(config.aggregates)) {
    const def = field(key, "total");
    if (!(def.aggregates ?? ["count", "count_empty", "count_not_empty", "percent_empty"]).includes(op)) {
      throw new ValidationError(`E_VALIDATION: ${def.label} cannot be totalled with "${op}"`);
    }
  }
  if (config.groupBy) {
    const def = field(config.groupBy, "group by");
    if (def.type !== "select" && def.type !== "relation" && def.type !== "user") {
      throw new ValidationError(`E_VALIDATION: ${def.label} cannot group a board`);
    }
  }
  if (type === "board" && !config.groupBy && !object.boardGroupField) {
    throw new ValidationError(`E_VALIDATION: ${object.labelPlural} have no field to group a board by`);
  }
  return config;
}

/** The built-in views every object has before anyone saves one. */
export function defaultView(object: RecordObject, type: "table" | "board" = "table"): SavedViewRow {
  return {
    id: type === "board" ? "default-board" : "default",
    objectKey: object.key,
    name: type === "board" ? "Board" : `All ${object.labelPlural.toLowerCase()}`,
    type,
    visibility: "shared",
    ownerUserId: null,
    isDefault: false,
    builtIn: true,
    position: type === "board" ? -1 : -2,
    version: 0,
    config: viewConfigSchema.parse({
      columns: object.defaultColumns.map((key) => ({ key })),
      sorts: object.defaultSort ? [object.defaultSort] : [],
      groupBy: type === "board" ? (object.boardGroupField ?? null) : null,
      aggregates: object.boardSumField ? { [object.boardSumField]: "sum" } : {},
    }),
  };
}

/* ============================ filters -> Prisma where ============================ */

type Where = Record<string, unknown>;

/** `company.name` + condition -> `{ company: { name: condition } }`. */
function atPath(path: string, condition: unknown): Where {
  return path
    .split(".")
    .reverse()
    .reduce<unknown>((inner, segment) => ({ [segment]: inner }), condition) as Where;
}

function asDate(value: unknown): Date {
  const date = typeof value === "string" ? new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value) : new Date(NaN);
  if (Number.isNaN(date.getTime())) throw new ValidationError("E_VALIDATION: a date filter needs a date");
  return date;
}

function asNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new ValidationError("E_VALIDATION: a number filter needs a number");
  return n;
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value) return [value];
  return [];
}

const startOfDay = (d: Date) => new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);

export type FilterContext = { userId: string; now?: Date };

function condition(field: RecordField, filter: ViewFilter, ctx: FilterContext): Where {
  const column = field.column ?? field.key;
  const v = filter.value;
  const now = ctx.now ?? new Date();
  const text = typeof v === "string" ? v.trim() : String(v ?? "");
  const dateLike = field.type === "date" || field.type === "datetime";
  const numeric = field.type === "number" || field.type === "currency";
  const cast = (x: unknown) => (dateLike ? asDate(x) : numeric ? asNumber(x) : x);

  switch (filter.op) {
    case "contains":
      if (!text) return {};
      return atPath(column, field.array ? { has: text } : { contains: text, mode: "insensitive" });
    case "not_contains":
      if (!text) return {};
      return { NOT: atPath(column, { contains: text, mode: "insensitive" }) };
    case "eq":
      if (field.type === "boolean") return atPath(column, v === true || v === "true");
      if (dateLike) {
        const day = asDate(v);
        return atPath(column, { gte: day, lt: new Date(day.getTime() + 86_400_000) });
      }
      return atPath(column, field.type === "text" ? { equals: text, mode: "insensitive" } : cast(v));
    case "neq":
      return { NOT: atPath(column, cast(v)) };
    case "gt":
    case "after":
      return atPath(column, { gt: cast(v) });
    case "gte":
      return atPath(column, { gte: cast(v) });
    case "lt":
    case "before":
      return atPath(column, { lt: cast(v) });
    case "lte":
      return atPath(column, { lte: cast(v) });
    case "is_any_of": {
      const list = asList(v);
      return list.length ? atPath(column, { in: list }) : {};
    }
    case "is_none_of": {
      const list = asList(v);
      return list.length ? { OR: [atPath(column, null), { NOT: atPath(column, { in: list }) }] } : {};
    }
    case "is_empty":
      if (field.array) return atPath(column, { isEmpty: true });
      return field.type === "text" ? { OR: [atPath(column, null), atPath(column, "")] } : atPath(column, null);
    case "is_not_empty":
      if (field.array) return atPath(column, { isEmpty: false });
      return field.type === "text"
        ? { AND: [{ NOT: atPath(column, null) }, { NOT: atPath(column, "") }] }
        : { NOT: atPath(column, null) };
    case "is_me":
      return atPath(column, ctx.userId);
    case "overdue":
      return atPath(column, { lt: field.type === "date" ? startOfDay(now) : now });
    case "next_days": {
      const days = Math.min(Math.max(Math.round(asNumber(v ?? 7)), 1), 365);
      const start = field.type === "date" ? startOfDay(now) : now;
      return atPath(column, { gte: start, lt: new Date(start.getTime() + days * 86_400_000) });
    }
  }
}

/** The Prisma `where` for a view's filters and search. The caller adds its own base conditions (archived, etc.). */
export function buildWhere(object: RecordObject, config: Pick<ViewConfig, "filters" | "match" | "search">, ctx: FilterContext): Where {
  const fields = new Map(object.fields.map((f) => [f.key, f]));
  const parts = config.filters
    .map((f) => {
      const field = fields.get(f.field);
      if (!field) throw new ValidationError(`E_VALIDATION: ${object.labelPlural} have no field "${f.field}" to filter by`);
      if (!OPS_FOR_TYPE[field.type].includes(f.op)) throw new ValidationError(`E_VALIDATION: ${field.label} cannot be filtered with "${f.op}"`);
      return condition(field, f, ctx);
    })
    .filter((w) => Object.keys(w).length > 0);
  const where: Where[] = [];
  if (parts.length) where.push(config.match === "any" ? { OR: parts } : { AND: parts });
  const term = config.search?.trim();
  if (term) where.push({ OR: object.searchColumns.map((c) => atPath(c, { contains: term, mode: "insensitive" })) });
  return where.length ? { AND: where } : {};
}

/** The Prisma `orderBy` for a view's sorts, with the object's default and a stable tiebreak. */
export function buildOrderBy(object: RecordObject, sorts: ViewSort[]): Where[] {
  const fields = new Map(object.fields.map((f) => [f.key, f]));
  const chosen = sorts.length ? sorts : object.defaultSort ? [object.defaultSort] : [];
  const order = chosen.map((s) => {
    const field = fields.get(s.field);
    if (!field || field.sortable === false) throw new ValidationError(`E_VALIDATION: ${object.labelPlural} cannot be sorted by "${s.field}"`);
    return atPath(field.sortColumn ?? field.column ?? field.key, s.dir);
  });
  return [...order, { id: "asc" }];
}

/** What every list query accepts: a saved or ad hoc view's filters and sorts, and a page. */
export const listInputSchema = z.object({
  filters: z.array(filterSchema).max(20).default([]),
  match: z.enum(["all", "any"]).default("all"),
  sorts: z.array(sortSchema).max(5).default([]),
  search: z.string().max(200).optional(),
  aggregates: z.record(z.string().max(80), z.enum(AGGREGATES)).default({}),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).max(100_000).default(0),
  includeArchived: z.boolean().default(false),
});
export type ListInput = z.input<typeof listInputSchema>;
export type ParsedListInput = z.infer<typeof listInputSchema>;
export type ListResult = { rows: Array<Record<string, unknown>>; total: number; aggregates: Record<string, number | null> };

type CountAndAggregate = {
  count: (args: { where: Where }) => Promise<number>;
  aggregate: (args: never) => Promise<unknown>;
};

/**
 * Totals for the table footer, computed over the whole filtered set (not just the page) with the model's own
 * aggregate and count, inside the caller's transaction. `delegate` is the capability's Prisma model.
 */
export async function computeAggregates(
  object: RecordObject,
  delegate: CountAndAggregate,
  where: Where,
  requested: Record<string, Aggregate>,
  total: number,
): Promise<Record<string, number | null>> {
  const fields = new Map(object.fields.map((f) => [f.key, f]));
  const out: Record<string, number | null> = {};
  for (const [key, op] of Object.entries(requested)) {
    const field = fields.get(key);
    if (!field) continue;
    const column = field.column ?? field.key;
    if (op === "count") {
      out[key] = total;
      continue;
    }
    if (column.includes(".")) continue;
    if (op === "count_empty" || op === "count_not_empty" || op === "percent_empty") {
      const empty = await delegate.count({ where: { AND: [where, field.array ? { [column]: { isEmpty: true } } : { [column]: null }] } });
      out[key] = op === "count_empty" ? empty : op === "count_not_empty" ? total - empty : total ? Math.round((empty / total) * 1000) / 10 : 0;
      continue;
    }
    if (field.type !== "number" && field.type !== "currency") continue;
    const prismaOp = `_${op}`;
    const result = (await delegate.aggregate({ where, [prismaOp]: { [column]: true } } as never)) as Record<string, Record<string, unknown>>;
    const value = result[prismaOp]?.[column];
    out[key] = value === null || value === undefined ? null : Number(value);
  }
  return out;
}

/* ================================ people for user fields ================================ */

/** Everyone active in this tenant, by user id and display name: the options of a user field and the names on its cells. */
export async function memberDirectory(tx: TenantScopedClient): Promise<Array<{ userId: string; name: string }>> {
  const rows = await tx.tenantMembership.findMany({
    where: { disabledAt: null },
    select: { userId: true, user: { select: { party: { select: { displayName: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  const seen = new Set<string>();
  const out: Array<{ userId: string; name: string }> = [];
  for (const r of rows) {
    if (seen.has(r.userId)) continue;
    seen.add(r.userId);
    out.push({ userId: r.userId, name: r.user.party.displayName });
  }
  return out;
}

/* ================================ saved views ================================ */

export type SavedViewRow = {
  id: string;
  objectKey: string;
  name: string;
  type: "table" | "board";
  visibility: "personal" | "shared";
  ownerUserId: string | null;
  isDefault: boolean;
  builtIn: boolean;
  position: number;
  version: number;
  config: ViewConfig;
};

function toRow(v: {
  id: string; objectKey: string; name: string; type: string; visibility: string; ownerUserId: string | null;
  isDefault: boolean; position: number; version: number; config: unknown;
}): SavedViewRow {
  return {
    id: v.id,
    objectKey: v.objectKey,
    name: v.name,
    type: v.type === "board" ? "board" : "table",
    visibility: v.visibility === "personal" ? "personal" : "shared",
    ownerUserId: v.ownerUserId,
    isDefault: v.isDefault,
    builtIn: false,
    position: v.position,
    version: v.version,
    config: viewConfigSchema.parse(v.config ?? {}),
  };
}

function requireObject(key: string): RecordObject {
  const object = getRecordObject(key);
  if (!object) throw new ValidationError(`E_VALIDATION: no record object "${key}"`);
  return object;
}

/** The views someone can choose for an object: built-in ones, everything shared, and their own personal ones. */
export const listViews: QueryDefinition<{ objectKey: string }, SavedViewRow[]> = {
  key: "verity.view.list",
  entity: ENTITY_SAVED_VIEW,
  description: "List the saved views for a kind of record.",
  input: z.object({ objectKey: z.string().max(120) }),
  handler: async (ctx, input) => {
    const object = requireObject(input.objectKey);
    const rows = await ctx.tx.savedView.findMany({
      where: { objectKey: object.key, OR: [{ visibility: "shared" }, { visibility: "personal", ownerUserId: ctx.actor.userId }] },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    const builtIns = [defaultView(object, "table"), ...(object.boardGroupField ? [defaultView(object, "board")] : [])];
    return [...builtIns, ...rows.map(toRow)];
  },
};

export const saveView: CommandDefinition<
  {
    id?: string;
    version?: number;
    objectKey: string;
    name: string;
    type: "table" | "board";
    visibility: "personal" | "shared";
    isDefault?: boolean;
    config: z.input<typeof viewConfigSchema>;
  },
  { id: string; version: number }
> = {
  key: "verity.view.save",
  entity: ENTITY_SAVED_VIEW,
  verb: "Create",
  description: "Save how a list of records is shown: columns, filters, sorts and grouping.",
  input: z.object({
    id: z.string().uuid().optional(),
    version: z.number().int().optional(),
    objectKey: z.string().max(120),
    name: z.string().trim().min(1).max(80),
    type: z.enum(["table", "board"]),
    visibility: z.enum(["personal", "shared"]),
    isDefault: z.boolean().optional(),
    config: viewConfigSchema,
  }),
  handler: async (ctx, input) => {
    const object = requireObject(input.objectKey);
    const config = validateViewConfig(object, viewConfigSchema.parse(input.config), input.type);
    const existing = input.id ? await ctx.tx.savedView.findUnique({ where: { id: input.id } }) : null;
    if (input.id && !existing) throw new ValidationError("E_VALIDATION: no such view");
    if (existing && existing.objectKey !== object.key) throw new ValidationError("E_VALIDATION: a view cannot move to another kind of record");

    const touchesShared = input.visibility === "shared" || existing?.visibility === "shared";
    if (touchesShared && !(await hasTenantPermission(ctx.tx, ctx.actor.roleId, "Edit", ENTITY_SAVED_VIEW))) {
      throw new ForbiddenError("E_FORBIDDEN: sharing a view, or changing a shared one, needs permission to manage shared views");
    }
    if (existing?.visibility === "personal" && existing.ownerUserId !== ctx.actor.userId) {
      throw new ForbiddenError("E_FORBIDDEN: this is someone else's personal view");
    }
    if (existing && input.version !== undefined && existing.version !== input.version) {
      throw new ConflictError("E_CONFLICT: someone changed this view since you opened it; reload and try again");
    }

    const ownerUserId = input.visibility === "personal" ? ctx.actor.userId : null;
    if (input.isDefault) {
      await ctx.tx.savedView.updateMany({
        where: { objectKey: object.key, visibility: input.visibility, ownerUserId, isDefault: true, ...(existing ? { NOT: { id: existing.id } } : {}) },
        data: { isDefault: false },
      });
    }
    const data = {
      name: input.name,
      type: input.type,
      visibility: input.visibility,
      ownerUserId,
      config: config as object,
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
    };
    if (existing) {
      const saved = await ctx.tx.savedView.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } });
      return { result: { id: saved.id, version: saved.version } };
    }
    const top = await ctx.tx.savedView.aggregate({ where: { objectKey: object.key }, _max: { position: true } });
    const saved = await ctx.tx.savedView.create({
      data: { tenantId: ctx.actor.tenantId, objectKey: object.key, position: (top._max.position ?? 0) + 1, ...data },
    });
    return { result: { id: saved.id, version: saved.version } };
  },
};

export const deleteView: CommandDefinition<{ id: string }, { id: string }> = {
  key: "verity.view.delete",
  entity: ENTITY_SAVED_VIEW,
  verb: "Create",
  impact: "destructive",
  description: "Delete a saved view. The records it showed are not touched.",
  input: z.object({ id: z.string().uuid() }),
  handler: async (ctx, input) => {
    const view = await ctx.tx.savedView.findUnique({ where: { id: input.id } });
    if (!view) throw new ValidationError("E_VALIDATION: no such view");
    if (view.visibility === "personal" && view.ownerUserId !== ctx.actor.userId) {
      throw new ForbiddenError("E_FORBIDDEN: this is someone else's personal view");
    }
    if (view.visibility === "shared" && !(await hasTenantPermission(ctx.tx, ctx.actor.roleId, "Edit", ENTITY_SAVED_VIEW))) {
      throw new ForbiddenError("E_FORBIDDEN: deleting a shared view needs permission to manage shared views");
    }
    await ctx.tx.savedView.delete({ where: { id: view.id } });
    return { result: { id: view.id } };
  },
};

/** Registers the saved-view commands and query. Called once by the capability bootstrap, and by tests. */
export function registerViewCommands(): void {
  registerCommand(saveView as never);
  registerCommand(deleteView as never);
  registerQuery(listViews as never);
}
