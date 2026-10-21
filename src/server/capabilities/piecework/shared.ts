import type { CommandContext } from "@/server/platform/command";
import type { LedgerEntry, StageRef } from "./ledger";

export type Tx = CommandContext["tx"];

/** Business dates are YYYY-MM-DD; the database holds them as DATE at UTC midnight. */
export const asDate = (d: string) => new Date(`${d}T00:00:00.000Z`);
export const isoOf = (d: Date) => d.toISOString().slice(0, 10);

/** Today in the tenant's own time zone, so a late-evening entry in India is not dated tomorrow in UTC. */
export async function todayFor(tx: Tx): Promise<string> {
  const tenant = await tx.tenant.findFirst({ select: { timeZone: true } });
  return new Intl.DateTimeFormat("en-CA", { timeZone: tenant?.timeZone ?? "UTC" }).format(new Date());
}

export const toLedger = (r: {
  id: string; stageId: string; workerId: string; kind: string; pieces: number; reversesId: string | null; entryDate: Date; rateMinor: number | null;
}): LedgerEntry => ({
  id: r.id,
  stageId: r.stageId,
  workerId: r.workerId,
  kind: r.kind as LedgerEntry["kind"],
  pieces: r.pieces,
  reversesId: r.reversesId,
  entryDate: isoOf(r.entryDate),
  rateMinor: r.rateMinor,
});

export async function activeStages(tx: Tx): Promise<Array<StageRef & { stageKey: string }>> {
  const rows = await tx.pieceworkStage.findMany({ where: { active: true }, orderBy: { sequence: "asc" } });
  return rows.map((s) => ({ id: s.id, sequence: s.sequence, label: s.label, stageKey: s.stageKey }));
}
