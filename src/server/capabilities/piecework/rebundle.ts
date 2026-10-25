import { z } from "zod";
import { registerCommand, ValidationError, type CommandDefinition } from "@/server/platform/command";
import { allocateSequence } from "@/server/runtime/document-number";
import type { Tx } from "./shared";

/**
 * Re-bundling at the cutting table: split one bundle into several, or join several of one lot into one, BEFORE any of it is given
 * out. Once a bundle has work recorded its pieces already move in parts (a bundle can be given to several karigars and come back in
 * parts), so it never needs splitting; refusing it keeps the ledger simple. The old bundles are cancelled, never deleted, keep their
 * numbers, and a split's children point at their parent. Every new bundle gets a fresh number and a new slip.
 */

const ENTITY = "verity.piecework.bundle";
const SERIES = "piecework.bundle";
const uuid = z.string().uuid();
const number = (seq: number) => `B-${String(seq).padStart(4, "0")}`;

async function untouched(tx: Tx, ids: string[]) {
  for (const id of ids) await tx.$executeRaw`SELECT 1 FROM piecework_bundle WHERE id = ${id}::uuid FOR UPDATE`;
  const bundles = await tx.pieceworkBundle.findMany({ where: { id: { in: ids } }, include: { lot: true } });
  if (bundles.length !== ids.length) throw new ValidationError("E_VALIDATION: bundle not found in this tenant");
  for (const b of bundles) {
    if (b.cancelledAt) throw new ValidationError(`E_VALIDATION: ${b.number} is already cancelled`);
    if (b.lot.status === "closed" || b.lot.cancelledAt) throw new ValidationError(`E_VALIDATION: ${b.lot.number} is closed`);
  }
  const worked = await tx.pieceworkEntry.findFirst({ where: { bundleId: { in: ids } }, select: { bundleId: true } });
  if (worked) {
    const b = bundles.find((x) => x.id === worked.bundleId)!;
    throw new ValidationError(`E_VALIDATION: ${b.number} has work recorded, so its pieces already move in parts; it cannot be re-bundled`);
  }
  return bundles;
}

async function mint(tx: Tx, tenantId: string, userId: string, lotId: string, netPieces: number, sizeNote: string | null, parentBundleId: string | null) {
  const { sequenceNumber } = await allocateSequence(tx, tenantId, SERIES, "all");
  return tx.pieceworkBundle.create({ data: { tenantId, lotId, number: number(sequenceNumber), sequenceNo: sequenceNumber, netPieces, sizeNote, parentBundleId, createdById: userId } });
}

export const splitBundle: CommandDefinition<{ bundleId: string; parts: Array<{ netPieces: number; sizeNote?: string }> }, { bundleIds: string[]; numbers: string[] }> = {
  key: "verity.piecework.split_bundle",
  entity: ENTITY,
  verb: "Create",
  input: z.object({
    bundleId: uuid,
    parts: z.array(z.object({ netPieces: z.number().int().min(1).max(1_000_000), sizeNote: z.string().trim().max(200).optional() })).min(2).max(20),
  }),
  preconditions: async (ctx, input) => {
    const [b] = await untouched(ctx.tx, [input.bundleId]);
    const total = input.parts.reduce((s, p) => s + p.netPieces, 0);
    if (total !== b!.netPieces) throw new ValidationError(`E_VALIDATION: the parts add up to ${total}; ${b!.number} has ${b!.netPieces} pieces`);
  },
  handler: async (ctx, input) => {
    const parent = await ctx.tx.pieceworkBundle.findUniqueOrThrow({ where: { id: input.bundleId } });
    const made = [];
    for (const part of input.parts) made.push(await mint(ctx.tx, ctx.actor.tenantId, ctx.actor.userId, parent.lotId, part.netPieces, part.sizeNote ?? parent.sizeNote, parent.id));
    await ctx.tx.pieceworkBundle.update({ where: { id: parent.id }, data: { cancelledAt: new Date() } });
    return {
      result: { bundleIds: made.map((b) => b.id), numbers: made.map((b) => b.number) },
      events: [{ name: "verity.piecework.bundle_split", entityId: parent.id, payload: { into: made.map((b) => b.number) } }],
    };
  },
};

export const mergeBundles: CommandDefinition<{ bundleIds: string[]; sizeNote?: string }, { bundleId: string; number: string }> = {
  key: "verity.piecework.merge_bundles",
  entity: ENTITY,
  verb: "Create",
  input: z.object({ bundleIds: z.array(uuid).min(2).max(20), sizeNote: z.string().trim().max(200).optional() }),
  preconditions: async (ctx, input) => {
    if (new Set(input.bundleIds).size !== input.bundleIds.length) throw new ValidationError("E_VALIDATION: name each bundle once");
    const bundles = await untouched(ctx.tx, input.bundleIds);
    if (new Set(bundles.map((b) => b.lotId)).size > 1) throw new ValidationError("E_VALIDATION: only bundles of one lot can be joined");
  },
  handler: async (ctx, input) => {
    const bundles = await ctx.tx.pieceworkBundle.findMany({ where: { id: { in: input.bundleIds } }, orderBy: { sequenceNo: "asc" } });
    const note = input.sizeNote ?? `Joined from ${bundles.map((b) => b.number).join(", ")}`;
    const made = await mint(ctx.tx, ctx.actor.tenantId, ctx.actor.userId, bundles[0]!.lotId, bundles.reduce((s, b) => s + b.netPieces, 0), note, null);
    await ctx.tx.pieceworkBundle.updateMany({ where: { id: { in: input.bundleIds } }, data: { cancelledAt: new Date() } });
    return { result: { bundleId: made.id, number: made.number }, events: [{ name: "verity.piecework.bundles_merged", entityId: made.id, payload: { from: bundles.map((b) => b.number) } }] };
  },
};

/**
 * Notes that slips were printed, so a bundle with no slip on it can be found and flagged (the print queue). Only a bundle that has none
 * yet is stamped: reprinting does not move the date of the first. Nothing else about the bundle changes.
 */
export const markSlipsPrinted: CommandDefinition<{ bundleIds: string[] }, { stamped: number }> = {
  key: "verity.piecework.mark_slips_printed",
  entity: ENTITY,
  // Whoever may cut bundles prints their slips.
  verb: "Create",
  input: z.object({ bundleIds: z.array(uuid).min(1).max(300) }),
  handler: async (ctx, input) => {
    const done = await ctx.tx.pieceworkBundle.updateMany({ where: { id: { in: input.bundleIds }, slipPrintedAt: null, cancelledAt: null }, data: { slipPrintedAt: new Date() } });
    return { result: { stamped: done.count }, events: [] };
  },
};

export function registerRebundle(): void {
  registerCommand(splitBundle);
  registerCommand(mergeBundles);
  registerCommand(markSlipsPrinted);
}
