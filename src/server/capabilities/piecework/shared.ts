import type { CommandContext } from "@/server/platform/command";
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

export type LoadedBundle = {
  id: string; lotId: string; number: string; netPieces: number; sizeNote: string | null; createdAt: Date; cancelledAt: Date | null;
  entries: LedgerEntry[]; position: BundlePosition;
};

/** Every bundle with its derived position. One query per table, grouped in memory. */
export async function loadBundles(tx: Tx, stages: StageRef[], where: { lotId?: string; bundleId?: string } = {}): Promise<LoadedBundle[]> {
  const bundles = await tx.pieceworkBundle.findMany({
    where: { ...(where.lotId ? { lotId: where.lotId } : {}), ...(where.bundleId ? { id: where.bundleId } : {}) },
    orderBy: { sequenceNo: "asc" },
  });
  const entries = (await tx.pieceworkEntry.findMany({ where: { bundleId: { in: bundles.map((b) => b.id) } } })).map((e) => toLedger(e));
  const byBundle = new Map<string, LedgerEntry[]>();
  for (const e of entries) byBundle.set(e.bundleId, [...(byBundle.get(e.bundleId) ?? []), e]);
  return bundles.map((b) => {
    const rows = byBundle.get(b.id) ?? [];
    return { id: b.id, lotId: b.lotId, number: b.number, netPieces: b.netPieces, sizeNote: b.sizeNote, createdAt: b.createdAt, cancelledAt: b.cancelledAt, entries: rows, position: computeBundle(b.id, b.netPieces, stages, rows) };
  });
}
