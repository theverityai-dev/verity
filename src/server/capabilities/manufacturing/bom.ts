import { z } from "zod";
import { registerCommand, ValidationError, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { validateCustomFields } from "@/server/platform/entity";
import { diffFields, recordActivity } from "@/server/platform/audit";
import {
  assertItems,
  assertOrderShape,
  ENTITY_MANUFACTURING_BOM,
  ENTITY_MANUFACTURING_ORDER,
  insertOrder,
  MAX_QTY,
} from "./shared";

/**
 * Reusable Bill of Materials (Task 118; first design partner Carxen, custom
 * car seat covers).
 *
 * A BOM is a per-UNIT recipe: the components consumed to make one of its output
 * item. An order made from it scales each line by the order quantity and
 * SNAPSHOTS the result, so editing or archiving a BOM never rewrites an order
 * already made. BOMs are archived, never deleted (an order's `bomId` must keep
 * pointing at what it came from), and a change of recipe takes a new code.
 *
 * Vehicle make/model/year/seat type are NOT columns here: they are custom
 * fields on `ENTITY_MANUFACTURING_BOM` that a tenant declares (PLA-EXT-001), so
 * the next client with different variants needs no schema change.
 */

const lineInput = z.object({
  componentItemId: z.string().uuid(),
  qtyPerUnit: z.number().int().positive().max(MAX_QTY),
});

/* -------------------------------- commands -------------------------------- */

export const createBom: CommandDefinition<
  {
    code: string;
    name: string;
    outputItemId: string;
    lines: Array<z.infer<typeof lineInput>>;
    customFields?: Record<string, unknown>;
  },
  { id: string }
> = {
  key: "verity.manufacturing.create_bom",
  entity: ENTITY_MANUFACTURING_BOM,
  verb: "Create",
  input: z.object({
    code: z.string().trim().min(1).max(60),
    name: z.string().trim().min(1).max(200),
    outputItemId: z.string().uuid(),
    lines: z.array(lineInput).min(1).max(200),
    customFields: z.record(z.string(), z.unknown()).optional(),
  }),
  preconditions: async (ctx, input) => {
    if (await ctx.tx.manufacturingBom.findUnique({ where: { tenantId_code: { tenantId: ctx.actor.tenantId, code: input.code } } })) {
      throw new ValidationError(`E_VALIDATION: a BOM with code ${input.code} already exists; a changed recipe takes a new code`);
    }
    await assertItems(ctx.tx, input.outputItemId, input.lines.map((l) => l.componentItemId));
  },
  handler: async (ctx, input) => {
    const customFields = await validateCustomFields(ctx.tx, ENTITY_MANUFACTURING_BOM, input.customFields);
    const bom = await ctx.tx.manufacturingBom.create({
      data: {
        tenantId: ctx.actor.tenantId,
        code: input.code,
        name: input.name,
        outputItemId: input.outputItemId,
        customFields: customFields as never,
      },
    });
    await ctx.tx.manufacturingBomLine.createMany({
      data: input.lines.map((l) => ({
        tenantId: ctx.actor.tenantId,
        bomId: bom.id,
        componentItemId: l.componentItemId,
        qtyPerUnit: l.qtyPerUnit,
      })),
    });
    return {
      result: { id: bom.id },
      events: [{ name: "verity.manufacturing.bom_created", entityId: bom.id }],
    };
  },
};

/** Archive or restore. Never a delete: orders keep pointing at their BOM. */
export const setBomActive: CommandDefinition<{ bomId: string; active: boolean }, { id: string }> = {
  key: "verity.manufacturing.set_bom_active",
  entity: ENTITY_MANUFACTURING_BOM,
  verb: "Edit",
  input: z.object({ bomId: z.string().uuid(), active: z.boolean() }),
  handler: async (ctx, input) => {
    const before = await ctx.tx.manufacturingBom.findUniqueOrThrow({ where: { id: input.bomId } });
    if (before.active !== input.active) {
      await ctx.tx.manufacturingBom.update({
        where: { id: before.id },
        data: { active: input.active, version: { increment: 1 } },
      });
      await recordActivity(ctx, {
        entityKey: ENTITY_MANUFACTURING_BOM,
        entityId: before.id,
        commandKey: "verity.manufacturing.set_bom_active",
        changes: diffFields({ active: before.active }, { active: input.active }),
      });
    }
    return { result: { id: before.id }, events: [{ name: "verity.manufacturing.bom_state_changed", entityId: before.id }] };
  },
};

/**
 * A draft order from a BOM: each line scaled by `outputQty`, snapshotted, and
 * the order remembers its `bomId`. Lifecycle and stock movement are then the
 * existing start/complete/cancel commands, unchanged.
 */
export const createOrderFromBom: CommandDefinition<
  { bomId: string; locationId: string; outputQty: number; reference?: string },
  { id: string }
> = {
  key: "verity.manufacturing.create_order_from_bom",
  entity: ENTITY_MANUFACTURING_ORDER,
  verb: "Create",
  input: z.object({
    bomId: z.string().uuid(),
    locationId: z.string().uuid(),
    outputQty: z.number().int().positive().max(MAX_QTY),
    reference: z.string().max(200).optional(),
  }),
  preconditions: async (ctx, input) => {
    const bom = await ctx.tx.manufacturingBom.findUnique({ where: { id: input.bomId }, include: { lines: true } });
    if (!bom) throw new ValidationError("E_VALIDATION: BOM not found in this tenant");
    if (!bom.active) throw new ValidationError("E_VALIDATION: this BOM is archived; restore it or use a newer one");
    for (const line of bom.lines) {
      if (line.qtyPerUnit * input.outputQty > MAX_QTY) {
        throw new ValidationError("E_VALIDATION: quantity too large for this BOM");
      }
    }
    await assertOrderShape(ctx.tx, {
      locationId: input.locationId,
      outputItemId: bom.outputItemId,
      componentIds: bom.lines.map((l) => l.componentItemId),
    });
  },
  handler: async (ctx, input) => {
    const bom = await ctx.tx.manufacturingBom.findUniqueOrThrow({ where: { id: input.bomId }, include: { lines: true } });
    const id = await insertOrder(ctx.tx, ctx.actor.tenantId, {
      locationId: input.locationId,
      outputItemId: bom.outputItemId,
      outputQty: input.outputQty,
      reference: input.reference,
      bomId: bom.id,
      lines: bom.lines.map((l) => ({ componentItemId: l.componentItemId, qtyRequired: l.qtyPerUnit * input.outputQty })),
    });
    return { result: { id }, events: [{ name: "verity.manufacturing.order_created", entityId: id }] };
  },
};

/* --------------------------------- queries -------------------------------- */

export const listBoms: QueryDefinition<
  { includeInactive?: boolean },
  Array<{ id: string; code: string; name: string; outputItemName: string; lineCount: number; active: boolean }>
> = {
  key: "verity.manufacturing.list_boms",
  entity: ENTITY_MANUFACTURING_BOM,
  input: z.object({ includeInactive: z.boolean().optional() }),
  handler: async (ctx, input) => {
    const boms = await ctx.tx.manufacturingBom.findMany({
      where: input.includeInactive ? {} : { active: true },
      include: { outputItem: true, _count: { select: { lines: true } } },
      orderBy: { code: "asc" },
    });
    return boms.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      outputItemName: b.outputItem.name,
      lineCount: b._count.lines,
      active: b.active,
    }));
  },
};

export const bomDetail: QueryDefinition<
  { bomId: string },
  {
    id: string;
    code: string;
    name: string;
    active: boolean;
    outputItemId: string;
    outputItemName: string;
    customFields: Record<string, unknown>;
    lines: Array<{ componentItemId: string; componentItemName: string; qtyPerUnit: number }>;
  }
> = {
  key: "verity.manufacturing.bom_detail",
  entity: ENTITY_MANUFACTURING_BOM,
  input: z.object({ bomId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const bom = await ctx.tx.manufacturingBom.findUniqueOrThrow({
      where: { id: input.bomId },
      include: { outputItem: true, lines: { include: { componentItem: true } } },
    });
    return {
      id: bom.id,
      code: bom.code,
      name: bom.name,
      active: bom.active,
      outputItemId: bom.outputItemId,
      outputItemName: bom.outputItem.name,
      customFields: bom.customFields as Record<string, unknown>,
      lines: bom.lines.map((l) => ({
        componentItemId: l.componentItemId,
        componentItemName: l.componentItem.name,
        qtyPerUnit: l.qtyPerUnit,
      })),
    };
  },
};

export function registerManufacturingBom(): void {
  registerCommand(createBom);
  registerCommand(setBomActive);
  registerCommand(createOrderFromBom);
  registerQuery(listBoms);
  registerQuery(bomDetail);
}
