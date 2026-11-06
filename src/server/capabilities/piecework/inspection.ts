import { z } from "zod";
import { registerCommand, ValidationError, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { AQL_VALUES, INSPECTION_LEVELS, inspectionPasses, samplingPlan, type AqlValue, type InspectionLevel } from "@/lib/aql";
import { asDate, isoOf, todayFor } from "./shared";

/**
 * Quality inspection of a lot (inline while it is being made, final before it ships), judged by the AQL table (`./aql.ts`). The command
 * reads the plan for the pieces offered and stores it with the defects found and the result, so the record says what was applied that day
 * even if the buyer's AQL changes later. Critical defects are always zero accepted. APPEND-ONLY; a mistake is a reversal.
 */

export const ENTITY_PIECEWORK_INSPECTION = "verity.piecework.inspection";
export const INSPECTION_KINDS = ["inline", "final"] as const;
export type InspectionKind = (typeof INSPECTION_KINDS)[number];

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
const count = z.number().int().min(0).max(100_000);

type RecordInput = {
  lotId: string; kind: InspectionKind; inspectedOn?: string; inspector: string; offeredPieces: number; level: InspectionLevel;
  aqlMajor: AqlValue; aqlMinor: AqlValue; criticalFound: number; majorFound: number; minorFound: number; note?: string;
};

export const recordInspection: CommandDefinition<RecordInput, { id: string; result: "pass" | "fail"; sampleSize: number }> = {
  key: "verity.piecework.record_inspection",
  entity: ENTITY_PIECEWORK_INSPECTION,
  verb: "Create",
  input: z.object({
    lotId: uuid,
    kind: z.enum(INSPECTION_KINDS),
    inspectedOn: isoDate.optional(),
    inspector: z.string().trim().min(2).max(120),
    offeredPieces: z.number().int().min(2).max(1_000_000),
    level: z.enum(INSPECTION_LEVELS),
    aqlMajor: z.enum(AQL_VALUES),
    aqlMinor: z.enum(AQL_VALUES),
    criticalFound: count,
    majorFound: count,
    minorFound: count,
    note: z.string().trim().max(500).optional(),
  }),
  preconditions: async (ctx, input) => {
    if ((input.inspectedOn ?? "") > (await todayFor(ctx.tx))) throw new ValidationError("E_VALIDATION: an inspection cannot be dated in the future");
    const lot = await ctx.tx.pieceworkLot.findUnique({ where: { id: input.lotId } });
    if (!lot || lot.cancelledAt) throw new ValidationError("E_VALIDATION: lot not found in this tenant");
    if (lot.status === "draft") throw new ValidationError("E_VALIDATION: a lot that has not started has nothing to inspect");
    const plan = samplingPlan(input.offeredPieces, input.level, input.aqlMajor, input.aqlMinor);
    const found = input.criticalFound + input.majorFound + input.minorFound;
    // A garment can carry more than one defect, so defects may exceed the sample; a count far past it is a typing mistake.
    if (found > plan.sampleSize * 5) throw new ValidationError(`E_VALIDATION: ${found} defects in a sample of ${plan.sampleSize} pieces looks like a typing mistake`);
  },
  handler: async (ctx, input) => {
    const plan = samplingPlan(input.offeredPieces, input.level, input.aqlMajor, input.aqlMinor);
    const result = inspectionPasses(plan, { critical: input.criticalFound, major: input.majorFound, minor: input.minorFound }) ? "pass" : "fail";
    const row = await ctx.tx.pieceworkInspection.create({
      data: {
        tenantId: ctx.actor.tenantId, lotId: input.lotId, kind: input.kind, inspectedOn: asDate(input.inspectedOn ?? (await todayFor(ctx.tx))),
        inspector: input.inspector, offeredPieces: input.offeredPieces, level: input.level, aqlMajor: input.aqlMajor, aqlMinor: input.aqlMinor,
        codeLetter: plan.codeLetter, sampleSize: plan.sampleSize, acceptMajor: plan.acceptMajor, acceptMinor: plan.acceptMinor,
        criticalFound: input.criticalFound, majorFound: input.majorFound, minorFound: input.minorFound, result, note: input.note ?? null,
        enteredById: ctx.actor.userId,
      },
    });
    return { result: { id: row.id, result, sampleSize: plan.sampleSize }, events: [{ name: "verity.piecework.inspection_recorded", entityId: row.id }] };
  },
};

export const reverseInspection: CommandDefinition<{ inspectionId: string; reason: string }, { id: string }> = {
  key: "verity.piecework.reverse_inspection",
  entity: ENTITY_PIECEWORK_INSPECTION,
  verb: "ActionExecute",
  impact: "destructive",
  input: z.object({ inspectionId: uuid, reason: z.string().trim().min(3).max(300) }),
  preconditions: async (ctx, input) => {
    const o = await ctx.tx.pieceworkInspection.findUnique({ where: { id: input.inspectionId }, include: { reversal: true } });
    if (!o) throw new ValidationError("E_VALIDATION: inspection not found in this tenant");
    if (o.reversesId) throw new ValidationError("E_VALIDATION: a reversal cannot itself be reversed; record the inspection again");
    if (o.reversal) throw new ValidationError("E_VALIDATION: that inspection is already reversed");
  },
  handler: async (ctx, input) => {
    const o = await ctx.tx.pieceworkInspection.findUniqueOrThrow({ where: { id: input.inspectionId } });
    const { id: _id, createdAt: _c, reversesId: _r, enteredById: _e, note: _n, ...copy } = o;
    const row = await ctx.tx.pieceworkInspection.create({ data: { ...copy, note: input.reason, reversesId: o.id, enteredById: ctx.actor.userId } });
    return { result: { id: row.id }, events: [{ name: "verity.piecework.inspection_reversed", entityId: row.id }] };
  },
};

export type InspectionRow = {
  id: string; kind: InspectionKind; inspectedOn: string; inspector: string; offeredPieces: number; level: string; aqlMajor: string; aqlMinor: string;
  codeLetter: string; sampleSize: number; acceptMajor: number; acceptMinor: number; criticalFound: number; majorFound: number; minorFound: number;
  result: "pass" | "fail"; note: string | null; by: string;
};

/** A lot's standing inspections, newest first (reversed ones and their reversals drop out), and whether its latest final passed. */
export const lotInspections: QueryDefinition<{ lotId: string }, { inspections: InspectionRow[]; finalResult: "pass" | "fail" | null }> = {
  key: "verity.piecework.lot_inspections",
  entity: ENTITY_PIECEWORK_INSPECTION,
  input: z.object({ lotId: uuid }),
  handler: async (ctx, input) => {
    const [rows, members] = await Promise.all([
      ctx.tx.pieceworkInspection.findMany({ where: { lotId: input.lotId }, orderBy: [{ inspectedOn: "desc" }, { createdAt: "desc" }] }),
      ctx.tx.tenantMembership.findMany({ select: { userId: true, user: { select: { party: { select: { displayName: true } } } } } }),
    ]);
    const names = new Map(members.map((m) => [m.userId, m.user.party.displayName]));
    const reversed = new Set(rows.filter((r) => r.reversesId).map((r) => r.reversesId!));
    const standing = rows.filter((r) => !r.reversesId && !reversed.has(r.id));
    const inspections = standing.map((r) => ({
      id: r.id, kind: r.kind as InspectionKind, inspectedOn: isoOf(r.inspectedOn), inspector: r.inspector, offeredPieces: r.offeredPieces, level: r.level,
      aqlMajor: r.aqlMajor, aqlMinor: r.aqlMinor, codeLetter: r.codeLetter, sampleSize: r.sampleSize, acceptMajor: r.acceptMajor, acceptMinor: r.acceptMinor,
      criticalFound: r.criticalFound, majorFound: r.majorFound, minorFound: r.minorFound, result: r.result as "pass" | "fail", note: r.note,
      by: names.get(r.enteredById) ?? "Someone",
    }));
    return { inspections, finalResult: inspections.find((i) => i.kind === "final")?.result ?? null };
  },
};

export function registerInspection(): void {
  registerCommand(recordInspection);
  registerCommand(reverseInspection);
  registerQuery(lotInspections);
}
