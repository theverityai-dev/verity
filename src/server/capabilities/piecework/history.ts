import { z } from "zod";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { isoOf, type Tx } from "./shared";

/**
 * Change history for the owner (FR-022): who did what to which record, newest first. It reads the platform's own event log, which every
 * command writes, so nothing here can drift from what really happened; nothing is edited or hidden. A posted entry is never changed,
 * so "what changed" is the list of what was posted and what was reversed, each with the person who did it.
 */

export const HISTORY_GROUPS = ["work", "fabric", "money", "lots", "settings"] as const;
export type HistoryGroup = (typeof HISTORY_GROUPS)[number];

const EVENT_GROUP: Record<string, HistoryGroup> = {
  pieces_issued: "work", pieces_returned: "work", entry_reversed: "work", bundle_created: "work", bundle_split: "work", bundles_merged: "work", day_closed: "work",
  roll_received: "fabric", roll_cancelled: "fabric", fabric_moved: "fabric",
  payment_recorded: "money", payment_reversed: "money", approval_requested: "money", approval_decided: "money", lot_cost_added: "money", lot_cost_reversed: "money", lot_cost_shared: "money", lot_share_reversed: "money",
  lot_created: "lots", lot_status_changed: "lots", lot_cancelled: "lots", lot_rates_set: "lots",
};
const group = (name: string): HistoryGroup => EVENT_GROUP[name] ?? "settings";

const LABEL: Record<string, string> = {
  pieces_issued: "Gave out pieces", pieces_returned: "Took pieces back", entry_reversed: "Reversed an entry", bundle_created: "Cut a bundle", bundle_split: "Split a bundle",
  bundles_merged: "Joined bundles", day_closed: "Closed the day", roll_received: "Received a roll", roll_cancelled: "Cancelled a roll", fabric_moved: "Moved fabric",
  payment_recorded: "Recorded a payment", payment_reversed: "Reversed a payment", approval_requested: "Asked for approval", approval_decided: "Decided a request",
  lot_cost_added: "Added a cost", lot_cost_reversed: "Reversed a cost", lot_cost_shared: "Moved cost to another lot", lot_share_reversed: "Reversed a cost move", lot_created: "Created a lot", lot_status_changed: "Changed a lot's status", lot_cancelled: "Cancelled a lot",
  lot_rates_set: "Changed a rate card", stage_defined: "Added a stage", stage_updated: "Changed a stage", stages_reordered: "Re-ordered the stages", worker_defined: "Added a karigar",
  stages_assigned: "Assigned stages", limits_set: "Changed manager limits",
};
const labelOf = (name: string) => LABEL[name] ?? name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export type HistoryRow = {
  id: string; at: string; day: string; group: HistoryGroup; what: string; by: string;
  subject: string | null; href: string | null;
};

type Ref = { text: string; href: string | null };

async function userNames(tx: Tx, ids: string[]): Promise<Map<string, string>> {
  const rows = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, party: { select: { displayName: true } } } });
  return new Map(rows.map((u) => [u.id, u.party.displayName]));
}

/** Turns the id an event carries into words a person recognises, one batched read per kind of record. */
async function subjects(tx: Tx, events: Array<{ name: string; entityId: string | null }>): Promise<Map<string, Ref>> {
  const ids = (names: string[]) => [...new Set(events.filter((e) => e.entityId && names.includes(e.name)).map((e) => e.entityId!))];
  const out = new Map<string, Ref>();
  const put = (id: string, text: string, href: string | null) => out.set(id, { text, href });

  const entryIds = ids(["pieces_issued", "pieces_returned", "entry_reversed"]);
  const bundleIds = ids(["bundle_created", "bundle_split", "bundles_merged"]);
  const lotIds = ids(["lot_created", "lot_status_changed", "lot_cancelled", "lot_rates_set"]);
  const costIds = ids(["lot_cost_added", "lot_cost_reversed"]);
  const shareIds = ids(["lot_cost_shared", "lot_share_reversed"]);
  const rollIds = ids(["roll_received", "roll_cancelled"]);
  const moveIds = ids(["fabric_moved"]);
  const payIds = ids(["payment_recorded", "payment_reversed"]);
  const appIds = ids(["approval_requested", "approval_decided"]);
  const workerIds = ids(["worker_defined"]);

  const entries = await tx.pieceworkEntry.findMany({ where: { id: { in: entryIds } }, select: { id: true, bundleId: true, stageId: true, workerId: true, pieces: true, challanNumber: true } });
  const costs = await tx.pieceworkLotCost.findMany({ where: { id: { in: costIds } }, select: { id: true, lotId: true, category: true, amountMinor: true } });
  const shares = await tx.pieceworkLotShare.findMany({ where: { id: { in: shareIds } }, select: { id: true, sourceLotId: true, targetLotId: true, basisPoints: true } });
  const moves = await tx.pieceworkRollMove.findMany({ where: { id: { in: moveIds } }, select: { id: true, rollId: true, deltaCenti: true } });
  const pays = await tx.pieceworkPayment.findMany({ where: { id: { in: payIds } }, select: { id: true, workerId: true, kind: true, amountMinor: true } });
  const apps = await tx.pieceworkApproval.findMany({ where: { id: { in: appIds } }, select: { id: true, kind: true, workerId: true, lotId: true } });

  const allBundles = [...new Set([...bundleIds, ...entries.map((e) => e.bundleId)])];
  const allLots = [...new Set([...lotIds, ...costs.map((c) => c.lotId), ...shares.flatMap((s) => [s.sourceLotId, s.targetLotId]),...apps.flatMap((a) => (a.lotId ? [a.lotId] : []))])];
  const allRolls = [...new Set([...rollIds, ...moves.map((m) => m.rollId)])];
  const allWorkers = [...new Set([...workerIds, ...entries.map((e) => e.workerId), ...pays.map((p) => p.workerId), ...apps.flatMap((a) => (a.workerId ? [a.workerId] : []))])];
  const [bundles, lots, rolls, workers, stages] = await Promise.all([
    tx.pieceworkBundle.findMany({ where: { id: { in: allBundles } }, select: { id: true, number: true } }),
    tx.pieceworkLot.findMany({ where: { id: { in: allLots } }, select: { id: true, number: true, name: true, design: true } }),
    tx.pieceworkRoll.findMany({ where: { id: { in: allRolls } }, select: { id: true, number: true, unit: true } }),
    tx.pieceworkWorker.findMany({ where: { id: { in: allWorkers } }, select: { id: true, name: true } }),
    tx.pieceworkStage.findMany({ select: { id: true, label: true } }),
  ]);
  const bNo = new Map(bundles.map((b) => [b.id, b.number]));
  const lotText = new Map(lots.map((l) => [l.id, `${l.number} · ${l.name ?? l.design}`]));
  const rNo = new Map(rolls.map((r) => [r.id, r]));
  const wName = new Map(workers.map((w) => [w.id, w.name]));
  const sLabel = new Map(stages.map((s) => [s.id, s.label]));

  for (const id of bundleIds) put(id, bNo.get(id) ?? "a bundle", `/lots/bundles/${id}`);
  for (const id of lotIds) put(id, lotText.get(id) ?? "a lot", `/lots/${id}`);
  for (const id of rollIds) put(id, rNo.get(id)?.number ?? "a roll", `/fabric/${id}`);
  for (const id of workerIds) put(id, wName.get(id) ?? "a karigar", `/karigars/${id}`);
  for (const e of entries) put(e.id, `${bNo.get(e.bundleId) ?? "bundle"} · ${sLabel.get(e.stageId) ?? "stage"} · ${wName.get(e.workerId) ?? "karigar"} · ${e.pieces} pieces${e.challanNumber ? ` · ${e.challanNumber}` : ""}`, `/lots/bundles/${e.bundleId}`);
  for (const c of costs) put(c.id, `${lotText.get(c.lotId) ?? "lot"} · ${c.category} ₹${(c.amountMinor / 100).toLocaleString("en-IN")}`, `/lots/${c.lotId}`);
  for (const s of shares) put(s.id, `${lotText.get(s.sourceLotId) ?? "lot"} → ${lotText.get(s.targetLotId) ?? "lot"} · ${(s.basisPoints / 100).toLocaleString("en-IN")}%`, `/lots/${s.targetLotId}`);
  for (const m of moves) { const r = rNo.get(m.rollId); put(m.id, `${r?.number ?? "roll"} · ${m.deltaCenti > 0 ? "+" : ""}${(m.deltaCenti / 100).toLocaleString("en-IN")} ${r?.unit ?? ""}`, `/fabric/${m.rollId}`); }
  for (const p of pays) put(p.id, `${wName.get(p.workerId) ?? "karigar"} · ${p.kind} ₹${(p.amountMinor / 100).toLocaleString("en-IN")}`, `/karigars/${p.workerId}`);
  for (const a of apps) put(a.id, `${a.kind}${a.workerId ? ` · ${wName.get(a.workerId) ?? ""}` : ""}${a.lotId ? ` · ${lotText.get(a.lotId) ?? ""}` : ""}`, "/shopfloor/approvals");
  return out;
}

export type History = { rows: HistoryRow[]; counts: Record<HistoryGroup, number>; truncated: boolean };

const LIMIT = 400;

export const pieceworkHistory: QueryDefinition<{ group?: HistoryGroup; by?: string }, History> = {
  key: "verity.piecework.history",
  // Who did what to money and stock is the owner's and manager's to read: the same grant as the settings page.
  entity: "verity.piecework.setting",
  input: z.object({ group: z.enum(HISTORY_GROUPS).optional(), by: z.string().uuid().optional() }),
  handler: async (ctx, input) => {
    const raw = await ctx.tx.domainEvent.findMany({
      where: { name: { startsWith: "verity.piecework." }, ...(input.by ? { actorUserId: input.by } : {}) },
      orderBy: { occurredAt: "desc" },
      take: LIMIT * 3,
      select: { id: true, name: true, entityId: true, actorUserId: true, occurredAt: true },
    });
    const events = raw.map((e) => ({ ...e, short: e.name.replace("verity.piecework.", "") }));
    const counts = Object.fromEntries(HISTORY_GROUPS.map((g) => [g, events.filter((e) => group(e.short) === g).length])) as Record<HistoryGroup, number>;
    const shown = events.filter((e) => !input.group || group(e.short) === input.group).slice(0, LIMIT);
    const [names, refs] = await Promise.all([
      userNames(ctx.tx, [...new Set(shown.flatMap((e) => (e.actorUserId ? [e.actorUserId] : [])))]),
      subjects(ctx.tx, shown.map((e) => ({ name: e.short, entityId: e.entityId }))),
    ]);
    return {
      rows: shown.map((e) => {
        const ref = e.entityId ? refs.get(e.entityId) : undefined;
        return {
          id: e.id, at: e.occurredAt.toISOString(), day: isoOf(e.occurredAt), group: group(e.short), what: labelOf(e.short),
          by: e.actorUserId ? names.get(e.actorUserId) ?? "A person" : "The system", subject: ref?.text ?? null, href: ref?.href ?? null,
        };
      }),
      counts, truncated: events.length >= LIMIT * 3 || shown.length >= LIMIT,
    };
  },
};

export function registerHistory(): void {
  registerQuery(pieceworkHistory);
}
