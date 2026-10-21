import { z } from "zod";
import { registerCommand, ValidationError, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";

/**
 * Style master (Stylified demo, stage 1). Part of the inventory capability: a style is a product that comes
 * in combinations of attribute values (colour x size for apparel), and its variants are ordinary InventoryItems,
 * so stock, BOMs, orders and receipts need no new concept.
 *
 * Ownership of each piece of configuration:
 *   - tenant-controlled: the attribute lists (which colours, which size runs), the styles, which values a style is
 *     offered in;
 *   - capability-controlled: the closed set of attribute `kind`s, the SKU and key construction, the variant cap;
 *   - system-derived: variants, their SKUs and names, on-hand totals.
 *
 * Retired, never deleted: a variant, a BOM or a posted movement keeps pointing at the value it was made from.
 * Generation is idempotent and only ever adds: it cannot rename, merge or remove an existing variant.
 */

export const ENTITY_INVENTORY_ATTRIBUTE = "verity.inventory.attribute";
export const ENTITY_INVENTORY_TEMPLATE = "verity.inventory.template";

/** How the screens present an attribute: a swatch list, an ordered run, or a plain list. */
export const ATTRIBUTE_KINDS = ["colour", "size", "other"] as const;
export type AttributeKind = (typeof ATTRIBUTE_KINDS)[number];

/** One run never creates more variants than this; a style needing more is split, not generated blind. */
export const MAX_VARIANTS_PER_RUN = 500;
const MAX_AXES = 3;

const attributeKey = z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/, "use lower-case letters, digits and underscores");
const valueCode = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,12}$/, "use 1 to 12 letters or digits");
const templateCode = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{0,29}$/, "use letters, digits and hyphens");
const hsn = z.string().trim().regex(/^\d{4}(\d{2}(\d{2})?)?$/, "HSN is 4, 6 or 8 digits");
const taxRateBp = z.number().int().min(0).max(10_000);
const uuid = z.string().uuid();

type Tx = Parameters<NonNullable<CommandDefinition<unknown, unknown>["preconditions"]>>[0]["tx"];

/* ================================ attributes ================================ */

export const defineAttribute: CommandDefinition<{ key: string; label: string; kind: AttributeKind }, { id: string }> = {
  key: "verity.inventory.define_attribute",
  entity: ENTITY_INVENTORY_ATTRIBUTE,
  verb: "Create",
  input: z.object({ key: attributeKey, label: z.string().trim().min(1).max(80), kind: z.enum(ATTRIBUTE_KINDS) }),
  preconditions: async (ctx, input) => {
    if (await ctx.tx.inventoryAttribute.findFirst({ where: { key: input.key } })) {
      throw new ValidationError("E_VALIDATION: a list with that key already exists");
    }
  },
  handler: async (ctx, input) => {
    const row = await ctx.tx.inventoryAttribute.create({
      data: { tenantId: ctx.actor.tenantId, key: input.key, label: input.label, kind: input.kind },
    });
    return { result: { id: row.id }, events: [{ name: "verity.inventory.attribute_defined", entityId: row.id }] };
  },
};

export const addAttributeValue: CommandDefinition<
  { attributeId: string; code: string; label: string; sortOrder?: number; swatchHex?: string },
  { id: string }
> = {
  key: "verity.inventory.add_attribute_value",
  entity: ENTITY_INVENTORY_ATTRIBUTE,
  verb: "Edit",
  input: z.object({
    attributeId: uuid,
    code: valueCode,
    label: z.string().trim().min(1).max(80),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
    swatchHex: z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/, "use a hex colour such as #1F3A5F").optional(),
  }),
  preconditions: async (ctx, input) => {
    const attribute = await ctx.tx.inventoryAttribute.findUnique({ where: { id: input.attributeId } });
    if (!attribute) throw new ValidationError("E_VALIDATION: list not found in this tenant");
    if (!attribute.active) throw new ValidationError("E_VALIDATION: that list is retired");
    if (input.swatchHex && attribute.kind !== "colour") {
      throw new ValidationError("E_VALIDATION: only a colour list takes a swatch");
    }
    if (await ctx.tx.inventoryAttributeValue.findFirst({ where: { attributeId: input.attributeId, code: input.code } })) {
      throw new ValidationError("E_VALIDATION: that code is already used in this list");
    }
  },
  handler: async (ctx, input) => {
    let sortOrder = input.sortOrder;
    if (sortOrder === undefined) {
      const last = await ctx.tx.inventoryAttributeValue.aggregate({
        where: { attributeId: input.attributeId },
        _max: { sortOrder: true },
      });
      sortOrder = (last._max.sortOrder ?? 0) + 10;
    }
    const row = await ctx.tx.inventoryAttributeValue.create({
      data: {
        tenantId: ctx.actor.tenantId,
        attributeId: input.attributeId,
        code: input.code,
        label: input.label,
        sortOrder,
        swatchHex: input.swatchHex ?? null,
      },
    });
    return { result: { id: row.id }, events: [{ name: "verity.inventory.attribute_value_added", entityId: row.id }] };
  },
};

export const setAttributeValueActive: CommandDefinition<{ valueId: string; active: boolean }, { id: string }> = {
  key: "verity.inventory.set_attribute_value_active",
  entity: ENTITY_INVENTORY_ATTRIBUTE,
  verb: "Edit",
  input: z.object({ valueId: uuid, active: z.boolean() }),
  preconditions: async (ctx, input) => {
    if (!(await ctx.tx.inventoryAttributeValue.findUnique({ where: { id: input.valueId } }))) {
      throw new ValidationError("E_VALIDATION: value not found in this tenant");
    }
  },
  handler: async (ctx, input) => {
    await ctx.tx.inventoryAttributeValue.update({
      where: { id: input.valueId },
      data: { active: input.active, version: { increment: 1 } },
    });
    return { result: { id: input.valueId }, events: [] };
  },
};

/* ================================== styles ================================== */

type AxisInput = { attributeId: string; valueIds: string[] };

const axisSchema = z.object({ attributeId: uuid, valueIds: z.array(uuid).min(1).max(MAX_VARIANTS_PER_RUN) });

/** Values must be live members of the named attribute; returns them in the attribute's own order. */
async function resolveValues(tx: Tx, axis: AxisInput) {
  const attribute = await tx.inventoryAttribute.findUnique({ where: { id: axis.attributeId } });
  if (!attribute) throw new ValidationError("E_VALIDATION: list not found in this tenant");
  if (!attribute.active) throw new ValidationError(`E_VALIDATION: the "${attribute.label}" list is retired`);
  if (new Set(axis.valueIds).size !== axis.valueIds.length) {
    throw new ValidationError(`E_VALIDATION: a value is repeated under "${attribute.label}"`);
  }
  const values = await tx.inventoryAttributeValue.findMany({
    where: { attributeId: axis.attributeId, id: { in: axis.valueIds } },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });
  if (values.length !== axis.valueIds.length) {
    throw new ValidationError(`E_VALIDATION: a chosen value does not belong to "${attribute.label}"`);
  }
  const retired = values.find((v) => !v.active);
  if (retired) throw new ValidationError(`E_VALIDATION: "${retired.label}" is retired`);
  return values;
}

export const createTemplate: CommandDefinition<
  {
    code: string;
    name: string;
    itemGroupId?: string;
    unitLabel?: string;
    hsnCode?: string;
    taxRateBp?: number;
    season?: string;
    axes: AxisInput[];
  },
  { id: string }
> = {
  key: "verity.inventory.create_template",
  entity: ENTITY_INVENTORY_TEMPLATE,
  verb: "Create",
  input: z.object({
    code: templateCode,
    name: z.string().trim().min(1).max(160),
    itemGroupId: uuid.optional(),
    unitLabel: z.string().trim().min(1).max(30).optional(),
    hsnCode: hsn.optional(),
    taxRateBp: taxRateBp.optional(),
    season: z.string().trim().min(1).max(40).optional(),
    axes: z.array(axisSchema).min(1).max(MAX_AXES),
  }),
  preconditions: async (ctx, input) => {
    if (await ctx.tx.inventoryItemTemplate.findFirst({ where: { code: input.code } })) {
      throw new ValidationError("E_VALIDATION: a style with that code already exists");
    }
    if (input.itemGroupId && !(await ctx.tx.inventoryItemGroup.findUnique({ where: { id: input.itemGroupId } }))) {
      throw new ValidationError("E_VALIDATION: item group not found in this tenant");
    }
    if (new Set(input.axes.map((a) => a.attributeId)).size !== input.axes.length) {
      throw new ValidationError("E_VALIDATION: a list can be used once per style");
    }
    for (const axis of input.axes) await resolveValues(ctx.tx, axis);
  },
  handler: async (ctx, input) => {
    const template = await ctx.tx.inventoryItemTemplate.create({
      data: {
        tenantId: ctx.actor.tenantId,
        code: input.code,
        name: input.name,
        itemGroupId: input.itemGroupId ?? null,
        unitLabel: input.unitLabel ?? "pcs",
        hsnCode: input.hsnCode ?? null,
        taxRateBp: input.taxRateBp ?? null,
        season: input.season ?? null,
      },
    });
    for (const [index, axis] of input.axes.entries()) {
      const row = await ctx.tx.inventoryTemplateAxis.create({
        data: { tenantId: ctx.actor.tenantId, templateId: template.id, attributeId: axis.attributeId, sequence: index + 1 },
      });
      await ctx.tx.inventoryTemplateAxisValue.createMany({
        data: axis.valueIds.map((valueId) => ({ tenantId: ctx.actor.tenantId, axisId: row.id, valueId })),
      });
    }
    return { result: { id: template.id }, events: [{ name: "verity.inventory.template_created", entityId: template.id }] };
  },
};

/** Offer an existing style in more values (a new colourway, an extra size). Generation is a separate, explicit step. */
export const addTemplateValues: CommandDefinition<{ templateId: string; attributeId: string; valueIds: string[] }, { added: number }> = {
  key: "verity.inventory.add_template_values",
  entity: ENTITY_INVENTORY_TEMPLATE,
  verb: "Edit",
  input: z.object({ templateId: uuid, attributeId: uuid, valueIds: z.array(uuid).min(1).max(MAX_VARIANTS_PER_RUN) }),
  preconditions: async (ctx, input) => {
    const template = await ctx.tx.inventoryItemTemplate.findUnique({ where: { id: input.templateId } });
    if (!template) throw new ValidationError("E_VALIDATION: style not found in this tenant");
    if (!template.active) throw new ValidationError("E_VALIDATION: that style is archived");
    const axis = await ctx.tx.inventoryTemplateAxis.findFirst({
      where: { templateId: input.templateId, attributeId: input.attributeId },
    });
    if (!axis) throw new ValidationError("E_VALIDATION: this style does not vary by that list");
    await resolveValues(ctx.tx, { attributeId: input.attributeId, valueIds: input.valueIds });
  },
  handler: async (ctx, input) => {
    const axis = await ctx.tx.inventoryTemplateAxis.findFirstOrThrow({
      where: { templateId: input.templateId, attributeId: input.attributeId },
    });
    const have = new Set(
      (await ctx.tx.inventoryTemplateAxisValue.findMany({ where: { axisId: axis.id } })).map((v) => v.valueId),
    );
    const fresh = input.valueIds.filter((id) => !have.has(id));
    if (fresh.length > 0) {
      await ctx.tx.inventoryTemplateAxisValue.createMany({
        data: fresh.map((valueId) => ({ tenantId: ctx.actor.tenantId, axisId: axis.id, valueId })),
      });
    }
    return { result: { added: fresh.length }, events: [] };
  },
};

export const setTemplateActive: CommandDefinition<{ templateId: string; active: boolean }, { id: string }> = {
  key: "verity.inventory.set_template_active",
  entity: ENTITY_INVENTORY_TEMPLATE,
  verb: "Edit",
  input: z.object({ templateId: uuid, active: z.boolean() }),
  preconditions: async (ctx, input) => {
    if (!(await ctx.tx.inventoryItemTemplate.findUnique({ where: { id: input.templateId } }))) {
      throw new ValidationError("E_VALIDATION: style not found in this tenant");
    }
  },
  handler: async (ctx, input) => {
    // Variants keep their own flags: archiving a style stops new variants and hides it, nothing lossy.
    await ctx.tx.inventoryItemTemplate.update({
      where: { id: input.templateId },
      data: { active: input.active, version: { increment: 1 } },
    });
    return { result: { id: input.templateId }, events: [] };
  },
};

type OfferedValue = { id: string; code: string; sortOrder: number; active: boolean };

/**
 * The cartesian product of a style's live offered values, one tuple per variant, in axis then value order.
 * Pure over already-loaded axes so a list of styles needs no extra round trips.
 */
function combinationsOf<V extends OfferedValue>(axes: Array<{ values: Array<{ value: V }> }>) {
  const lists = axes.map((axis) =>
    axis.values
      .map((v) => v.value)
      .filter((v) => v.active)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code)),
  );
  let combos: Array<Array<(typeof lists)[number][number]>> = [[]];
  for (const list of lists) combos = combos.flatMap((prefix) => list.map((value) => [...prefix, value]));
  return lists.some((l) => l.length === 0) ? [] : combos;
}

const variantKeyOf = (combo: Array<{ code: string }>) => combo.map((v) => v.code).join("|");

async function offeredCombinations(tx: Tx, templateId: string) {
  const axes = await tx.inventoryTemplateAxis.findMany({
    where: { templateId },
    orderBy: { sequence: "asc" },
    include: { attribute: true, values: { include: { value: true } } },
  });
  return { axes, combos: combinationsOf(axes) };
}

export const generateVariants: CommandDefinition<
  { templateId: string },
  { created: number; existing: number; total: number }
> = {
  key: "verity.inventory.generate_variants",
  entity: ENTITY_INVENTORY_TEMPLATE,
  verb: "ActionExecute",
  input: z.object({ templateId: uuid }),
  preconditions: async (ctx, input) => {
    const template = await ctx.tx.inventoryItemTemplate.findUnique({ where: { id: input.templateId } });
    if (!template) throw new ValidationError("E_VALIDATION: style not found in this tenant");
    if (!template.active) throw new ValidationError("E_VALIDATION: that style is archived");
    const { combos } = await offeredCombinations(ctx.tx, input.templateId);
    if (combos.length === 0) throw new ValidationError("E_VALIDATION: this style is not offered in any live combination");
    if (combos.length > MAX_VARIANTS_PER_RUN) {
      throw new ValidationError(
        `E_VALIDATION: ${combos.length} combinations is more than ${MAX_VARIANTS_PER_RUN} in one run; offer fewer values`,
      );
    }
  },
  handler: async (ctx, input) => {
    const template = await ctx.tx.inventoryItemTemplate.findUniqueOrThrow({ where: { id: input.templateId } });
    const { axes, combos } = await offeredCombinations(ctx.tx, input.templateId);

    const existing = await ctx.tx.inventoryItem.findMany({
      where: { templateId: template.id },
      select: { variantKey: true },
    });
    const have = new Set(existing.map((e) => e.variantKey));

    let created = 0;
    for (const combo of combos) {
      const variantKey = variantKeyOf(combo);
      if (have.has(variantKey)) continue;
      const sku = `${template.code}-${combo.map((v) => v.code).join("-")}`;
      if (sku.length > 60) throw new ValidationError(`E_VALIDATION: the code ${sku} is longer than 60 characters`);
      const clash = await ctx.tx.inventoryItem.findFirst({ where: { sku } });
      if (clash) throw new ValidationError(`E_VALIDATION: SKU ${sku} already belongs to another item`);

      const item = await ctx.tx.inventoryItem.create({
        data: {
          tenantId: ctx.actor.tenantId,
          sku,
          name: `${template.name} - ${combo.map((v) => v.label).join(" / ")}`,
          itemGroupId: template.itemGroupId,
          unitLabel: template.unitLabel,
          hsnCode: template.hsnCode,
          taxRateBp: template.taxRateBp,
          templateId: template.id,
          variantKey,
        },
      });
      await ctx.tx.inventoryItemVariantValue.createMany({
        data: combo.map((value, i) => ({
          tenantId: ctx.actor.tenantId,
          itemId: item.id,
          attributeId: axes[i]!.attributeId,
          valueId: value.id,
        })),
      });
      created += 1;
    }
    return {
      result: { created, existing: combos.length - created, total: combos.length },
      events: created > 0 ? [{ name: "verity.inventory.variants_generated", entityId: template.id }] : [],
    };
  },
};

/* ================================== queries ================================== */

export type AttributeRow = {
  id: string;
  key: string;
  label: string;
  kind: string;
  active: boolean;
  values: Array<{ id: string; code: string; label: string; sortOrder: number; swatchHex: string | null; active: boolean }>;
};

export const listAttributes: QueryDefinition<{ includeInactive?: boolean }, AttributeRow[]> = {
  key: "verity.inventory.list_attributes",
  entity: ENTITY_INVENTORY_ATTRIBUTE,
  input: z.object({ includeInactive: z.boolean().optional() }),
  handler: async (ctx, input) => {
    const rows = await ctx.tx.inventoryAttribute.findMany({
      where: input.includeInactive ? {} : { active: true },
      orderBy: [{ kind: "asc" }, { label: "asc" }],
      include: { values: { orderBy: [{ sortOrder: "asc" }, { code: "asc" }] } },
    });
    return rows.map((a) => ({
      id: a.id,
      key: a.key,
      label: a.label,
      kind: a.kind,
      active: a.active,
      values: a.values
        .filter((v) => input.includeInactive || v.active)
        .map((v) => ({ id: v.id, code: v.code, label: v.label, sortOrder: v.sortOrder, swatchHex: v.swatchHex, active: v.active })),
    }));
  },
};

export type TemplateRow = {
  id: string;
  code: string;
  name: string;
  season: string | null;
  hsnCode: string | null;
  taxRateBp: number | null;
  unitLabel: string;
  active: boolean;
  groupName: string | null;
  axes: Array<{ attributeId: string; label: string; kind: string; offered: number }>;
  variants: number;
  /** Live combinations the style is offered in right now, and how many of them have no variant yet. */
  combinations: number;
  missing: number;
};

export const listTemplates: QueryDefinition<{ includeInactive?: boolean }, TemplateRow[]> = {
  key: "verity.inventory.list_templates",
  entity: ENTITY_INVENTORY_TEMPLATE,
  input: z.object({ includeInactive: z.boolean().optional() }),
  handler: async (ctx, input) => {
    const rows = await ctx.tx.inventoryItemTemplate.findMany({
      where: input.includeInactive ? {} : { active: true },
      orderBy: { code: "asc" },
      include: {
        itemGroup: true,
        axes: { orderBy: { sequence: "asc" }, include: { attribute: true, values: { include: { value: true } } } },
        items: { select: { variantKey: true } },
      },
    });
    return rows.map((t) => {
      const combos = combinationsOf(t.axes);
      const have = new Set(t.items.map((i) => i.variantKey));
      return {
        id: t.id,
        code: t.code,
        name: t.name,
        season: t.season,
        hsnCode: t.hsnCode,
        taxRateBp: t.taxRateBp,
        unitLabel: t.unitLabel,
        active: t.active,
        groupName: t.itemGroup?.name ?? null,
        axes: t.axes.map((a) => ({ attributeId: a.attributeId, label: a.attribute.label, kind: a.attribute.kind, offered: a.values.length })),
        variants: t.items.length,
        combinations: combos.length,
        missing: combos.filter((c) => !have.has(variantKeyOf(c))).length,
      };
    });
  },
};

export type TemplateDetail = TemplateRow & {
  axisValues: Array<{
    attributeId: string;
    values: Array<{ id: string; code: string; label: string; swatchHex: string | null; sortOrder: number; active: boolean }>;
  }>;
  variantRows: Array<{
    id: string;
    sku: string;
    name: string;
    active: boolean;
    /** attributeId -> valueId */
    values: Record<string, string>;
    /** Sum across locations, from the balance rows the ledger maintains. */
    onHand: number;
  }>;
};

export const templateDetail: QueryDefinition<{ templateId: string }, TemplateDetail | null> = {
  key: "verity.inventory.template_detail",
  entity: ENTITY_INVENTORY_TEMPLATE,
  input: z.object({ templateId: uuid }),
  handler: async (ctx, input) => {
    const t = await ctx.tx.inventoryItemTemplate.findUnique({
      where: { id: input.templateId },
      include: {
        itemGroup: true,
        axes: {
          orderBy: { sequence: "asc" },
          include: { attribute: true, values: { include: { value: true } } },
        },
        items: {
          orderBy: { sku: "asc" },
          include: { variantValues: true, balances: { select: { qty: true } } },
        },
      },
    });
    if (!t) return null;
    const combos = combinationsOf(t.axes);
    const have = new Set(t.items.map((i) => i.variantKey));
    return {
      id: t.id,
      code: t.code,
      name: t.name,
      season: t.season,
      hsnCode: t.hsnCode,
      taxRateBp: t.taxRateBp,
      unitLabel: t.unitLabel,
      active: t.active,
      groupName: t.itemGroup?.name ?? null,
      axes: t.axes.map((a) => ({ attributeId: a.attributeId, label: a.attribute.label, kind: a.attribute.kind, offered: a.values.length })),
      variants: t.items.length,
      combinations: combos.length,
      missing: combos.filter((c) => !have.has(variantKeyOf(c))).length,
      axisValues: t.axes.map((a) => ({
        attributeId: a.attributeId,
        values: a.values
          .map((v) => v.value)
          .sort((x, y) => x.sortOrder - y.sortOrder || x.code.localeCompare(y.code))
          .map((v) => ({ id: v.id, code: v.code, label: v.label, swatchHex: v.swatchHex, sortOrder: v.sortOrder, active: v.active })),
      })),
      variantRows: t.items.map((i) => ({
        id: i.id,
        sku: i.sku,
        name: i.name,
        active: i.active,
        values: Object.fromEntries(i.variantValues.map((v) => [v.attributeId, v.valueId])),
        onHand: i.balances.reduce((sum, b) => sum + b.qty, 0),
      })),
    };
  },
};

/* ============================== registration ============================== */

export function registerStyles(): void {
  registerCommand(defineAttribute);
  registerCommand(addAttributeValue);
  registerCommand(setAttributeValueActive);
  registerCommand(createTemplate);
  registerCommand(addTemplateValues);
  registerCommand(setTemplateActive);
  registerCommand(generateVariants);
  registerQuery(listAttributes);
  registerQuery(listTemplates);
  registerQuery(templateDetail);
}
