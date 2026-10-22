import type { CommandContext } from "@/server/platform/command";
import { readUrlFor } from "@/server/platform/files";
import { computeBundle, type BundlePosition, type LedgerEntry, type StageRef, type WageBasis } from "./ledger";

export type Tx = CommandContext["tx"];

/** Business dates are YYYY-MM-DD; the database holds them as DATE at UTC midnight. */
export const asDate = (d: string) => new Date(`${d}T00:00:00.000Z`);
export const isoOf = (d: Date) => d.toISOString().slice(0, 10);
export const isoOrNull = (d: Date | null) => (d ? isoOf(d) : null);

/** Today in the tenant's own time zone, so a late-evening entry in India is not dated tomorrow in UTC. */
export async function todayFor(tx: Tx): Promise<string> {
  const tenant = await tx.tenant.findFirst({ select: { timeZone: true } });
  return new Intl.DateTimeFormat("en-CA", { timeZone: tenant?.timeZone ?? "UTC" }).format(new Date());
}

export type EntryRow = {
  id: string; bundleId: string; stageId: string; workerId: string; kind: string; pieces: number;
  goodPieces: number | null; rejectedPieces: number | null; reworkPieces: number | null; shortPieces: number | null;
  issueId: string | null; isRework: boolean; wageBasis: string | null; reversesId: string | null;
  entryDate: Date; rateMinor: number | null; dueDate: Date | null;
};

/** The columns the ledger arithmetic reads. A screen that only derives positions and money selects these, not the whole row. */
export const LEDGER_SELECT = {
  id: true, bundleId: true, stageId: true, workerId: true, kind: true, pieces: true, goodPieces: true, rejectedPieces: true, reworkPieces: true,
  shortPieces: true, issueId: true, isRework: true, wageBasis: true, reversesId: true, entryDate: true, rateMinor: true, dueDate: true,
} as const;

export const toLedger = (r: EntryRow): LedgerEntry => ({
  id: r.id,
  bundleId: r.bundleId,
  stageId: r.stageId,
  workerId: r.workerId,
  kind: r.kind as LedgerEntry["kind"],
  pieces: r.pieces,
  good: r.goodPieces ?? 0,
  rejected: r.rejectedPieces ?? 0,
  rework: r.reworkPieces ?? 0,
  short: r.shortPieces ?? 0,
  issueId: r.issueId,
  isRework: r.isRework,
  wageBasis: (r.wageBasis as WageBasis | null) ?? null,
  reversesId: r.reversesId,
  entryDate: isoOf(r.entryDate),
  rateMinor: r.rateMinor,
  dueDate: isoOrNull(r.dueDate),
});

export async function activeStages(tx: Tx): Promise<Array<StageRef & { stageKey: string }>> {
  const rows = await tx.pieceworkStage.findMany({ where: { active: true }, orderBy: { sequence: "asc" } });
  return rows.map((s) => ({ id: s.id, sequence: s.sequence, label: s.label, stageKey: s.stageKey }));
}

/**
 * A lot's picture, as a short-lived link: the newest photograph taken for the lot (platform Evidence about it), else the still the
 * demo tenant was seeded with. Never blank and never an error: a deployment with no file storage, or a photo that cannot be read,
 * simply has no cover and the screen shows a typed tile. Only the lots named are looked up, so a list does not sign every lot.
 */
export async function lotCovers(tx: Tx, lots: Array<{ id: string; customFields: unknown }>): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const seeded = (custom: unknown): string | null => {
    const c = (custom as { coverImage?: unknown } | null)?.coverImage;
    return typeof c === "string" && c.startsWith("/") ? c : null;
  };
  const rows = lots.length === 0 ? [] : await tx.evidence.findMany({
    where: { entityKey: "verity.piecework.lot", entityId: { in: lots.map((l) => l.id) }, kind: "Photo", fileId: { not: null } },
    orderBy: { capturedAt: "desc" },
    select: { entityId: true, fileId: true },
  });
  const newest = new Map<string, string>();
  for (const r of rows) if (!newest.has(r.entityId)) newest.set(r.entityId, r.fileId!);
  for (const l of lots) {
    let url: string | null = null;
    const file = newest.get(l.id);
    if (file) {
      try { url = await readUrlFor(tx, file); } catch { url = null; }
    }
    out.set(l.id, url ?? seeded(l.customFields));
  }
  return out;
}

export type LoadedBundle = {
  id: string; lotId: string; number: string; netPieces: number; sizeNote: string | null; createdAt: Date; cancelledAt: Date | null;
  entries: LedgerEntry[]; position: BundlePosition;
};

/**
 * Every bundle with its derived position. One query per table, grouped in memory. A screen that needs only some bundles says
 * which (lotIds, bundleIds), so a factory with a year of closed lots does not derive the position of all of them on every
 * page. A caller that already holds every entry passes them as entries and the second query is skipped.
 */
export async function loadBundles(
  tx: Tx,
  stages: StageRef[],
  where: { lotId?: string; lotIds?: string[]; bundleId?: string; bundleIds?: string[]; entries?: LedgerEntry[] } = {},
): Promise<LoadedBundle[]> {
  const bundles = await tx.pieceworkBundle.findMany({
    where: {
      ...(where.lotId ? { lotId: where.lotId } : {}),
      ...(where.lotIds ? { lotId: { in: where.lotIds } } : {}),
      ...(where.bundleId ? { id: where.bundleId } : {}),
      ...(where.bundleIds ? { id: { in: where.bundleIds } } : {}),
    },
    orderBy: { sequenceNo: "asc" },
  });
  const wanted = new Set(bundles.map((b) => b.id));
  const entries = where.entries
    ? where.entries.filter((e) => wanted.has(e.bundleId))
    : (await tx.pieceworkEntry.findMany({ where: { bundleId: { in: bundles.map((b) => b.id) } }, select: LEDGER_SELECT })).map((e) => toLedger(e));
  const byBundle = new Map<string, LedgerEntry[]>();
  for (const e of entries) byBundle.set(e.bundleId, [...(byBundle.get(e.bundleId) ?? []), e]);
  return bundles.map((b) => {
    const rows = byBundle.get(b.id) ?? [];
    return { id: b.id, lotId: b.lotId, number: b.number, netPieces: b.netPieces, sizeNote: b.sizeNote, createdAt: b.createdAt, cancelledAt: b.cancelledAt, entries: rows, position: computeBundle(b.id, b.netPieces, stages, rows) };
  });
}
