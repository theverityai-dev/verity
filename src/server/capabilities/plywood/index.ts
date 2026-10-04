import { z } from "zod";
import { registerContribution } from "@/server/platform/contribution";
import {
  registerCommand,
  ValidationError,
  type ActorContext,
  type CommandDefinition,
} from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { runCommandBatch, type BatchResult } from "@/server/platform/batch";
import { diffFields, recordActivity } from "@/server/platform/audit";
import { notify } from "@/server/platform/notification";
import { withTenant, type TenantScopedClient } from "@/server/platform/tenancy";
import { ENTITY_PRODUCT_DETAIL, PLYWOOD_CAPABILITY } from "./keys";
import { productDetail } from "./views";
import {
  ENTITY_BRAND,
  ENTITY_PRODUCT,
  ENTITY_SUPPLIER,
  ENTITY_PURCHASE_ORDER,
  ENTITY_CUSTOMER,
  ENTITY_SALES_ORDER,
  ENTITY_STOCK_BALANCE,
  ENTITY_STOCK_LEDGER,
  ENTITY_INVOICE,
  ENTITY_PAYMENT,
  ENTITY_LEDGER_ENTRY,
  ENTITY_SUPPLIER_PRICE,
  ENTITY_GST_REGISTRATION,
  ENTITY_BUSINESS_PROFILE,
  HSN_CODE,
  captureMetricSnapshot,
  ensureBrand,
  stockOnHand as tradingStockOnHand,
} from "../trading";

/**
 * CAPABILITY: Plywood — `verity.capability.plywood`
 *
 * ADR-018 shrank this to plywood's own board-dimension/grade taxonomy —
 * everything generic (parties, orders, invoicing, GST, payments, ledger,
 * stock, brands, godown racks) now lives in `../trading`
 * (`verity.capability.trading`), which this capability depends on
 * (`CapabilityDefinition.dependencies`, DB-trigger-enforced) and re-exports
 * wholesale below, so nothing importing from `@/server/capabilities/plywood`
 * had to change.
 *
 * WHAT THIS CAPABILITY STILL OWNS
 * `createProduct`/`editProduct`/`setProductActive`/`listCatalogue` — each
 * writes/reads BOTH the generic `TradingProduct` base row (name, brand, HSN,
 * type, reorder level, unit label) and this capability's own
 * `PlywoodProductDetail` extension (thickness, category, size, grade) in one
 * transaction, so the UI-facing "create a product" contract is exactly what
 * it was before the split — one call, one form, one product.
 */

export * from "../trading";
export * from "./keys";
export * from "./views";
export {
  PRODUCT_CATEGORIES,
  SIZE_UNITS,
  CATEGORY_RULES,
  formatProductSize,
  productLabel,
  variantName,
  type ProductCategory,
  type SizeUnit,
} from "./product";
import {
  CATEGORY_RULES,
  PRODUCT_CATEGORIES,
  variantName,
  type ProductCategory,
  type SizeUnit,
} from "./product";

/**
 * What a caller may ask for. TEMPLATE is deliberately absent: it is not a
 * choice, it is what `createProduct` makes of a laminate when shades and
 * textures are given, and letting a form request one would produce a template
 * with nothing under it.
 */
export const PRODUCT_TYPES = ["PHYSICAL", "SERVICE"] as const;
export type RequestableProductType = (typeof PRODUCT_TYPES)[number];

/**
 * TEMPLATE — a laminate design that exists only as the parent of its
 * variants. It holds what they share (brand, size, HSN, thickness) and is
 * never stocked, ordered, priced or invoiced; the twenty-five rows generated
 * under it are the real products. Kept as a third `type` value rather than a
 * separate boolean so that every place already asking "is this PHYSICAL?"
 * excludes it without being told to.
 */
export const PRODUCT_TYPE_TEMPLATE = "TEMPLATE";
export const PRODUCT_TYPES_ALL = [
  "PHYSICAL",
  "SERVICE",
  PRODUCT_TYPE_TEMPLATE,
] as const;
export type ProductType = (typeof PRODUCT_TYPES_ALL)[number];

/* ================================ products ================================ */

/* ------------------------- shades and textures ------------------------- */

/**
 * The two laminate variant axes, as commands.
 *
 * AUTHORIZATION. Both run against `verity.plywood.product_detail` rather than
 * getting entity keys of their own. A shade is not an independently governed
 * thing — it is vocabulary the product detail draws from, in the same way a
 * grade is — and whoever may record a board's grade may name the shade a
 * laminate comes in. Giving them their own entities would add a permission
 * surface every existing tenant would have to be granted before the catalogue
 * worked again, to express a distinction nobody asked for.
 *
 * NEITHER IS DELETABLE. The foreign keys are ON DELETE RESTRICT, and there is
 * no remove command: a shade with products on it cannot go without either
 * orphaning or silently rewriting them, and a shade with none is harmless.
 * A discontinued shade is deactivated, which stops it being offered without
 * touching what was already sold under it.
 */

type AxisKind = "shade" | "texture";
type AxisRow = { id: string; name: string };
type AxisRowFull = AxisRow & { active: boolean };

/**
 * The two tables have identical shape, and the code below is genuinely the
 * same code twice over. Prisma still generates two unrelated delegate types,
 * so a `shade | texture` union is callable with neither — the narrow
 * structural type here is what lets one implementation serve both. It states
 * exactly the four calls this file makes, so a Prisma change that broke any of
 * them would still be a type error at the cast rather than at runtime.
 */
type AxisDelegate = {
  findMany(args: {
    where?: { active?: boolean; id?: { in: string[] } };
    orderBy?: { name: "asc" };
    include?: { _count: { select: { details: true } } };
  }): Promise<Array<AxisRowFull & { _count?: { details: number } }>>;
  findFirst(args: { where: { name: string } }): Promise<AxisRowFull | null>;
  create(args: {
    data: { tenantId: string; name: string };
  }): Promise<AxisRowFull>;
  update(args: {
    where: { id: string };
    data: { active: boolean };
  }): Promise<AxisRowFull>;
};

const axisTable = (tx: TenantScopedClient, kind: AxisKind): AxisDelegate =>
  (kind === "shade"
    ? tx.plywoodShade
    : tx.plywoodTexture) as unknown as AxisDelegate;

/**
 * Turns "these five ids plus this one new name" into five-or-six rows.
 *
 * A name that already exists is REUSED rather than rejected. The form cannot
 * know what the tenant already has when the person typing is looking at a
 * swatch, and failing the whole product creation because "Walnut" was added
 * last month is a worse answer than quietly meaning the same "Walnut".
 */
async function resolveAxis(
  ctx: { tx: TenantScopedClient; actor: { tenantId: string } },
  kind: AxisKind,
  ids: string[] | undefined,
  newNames: string[] | undefined,
): Promise<AxisRow[]> {
  const table = axisTable(ctx.tx, kind);
  const out: AxisRow[] = [];
  const seen = new Set<string>();

  if (ids?.length) {
    const rows = await table.findMany({ where: { id: { in: ids } } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) {
        throw new ValidationError(
          `E_VALIDATION: ${kind} not found in this tenant`,
        );
      }
      if (!row.active) {
        throw new ValidationError(
          `E_VALIDATION: ${row.name} is a discontinued ${kind}`,
        );
      }
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push({ id: row.id, name: row.name });
    }
  }

  for (const raw of newNames ?? []) {
    const name = raw.trim();
    if (name.length === 0) continue;
    const existing = await table.findFirst({ where: { name } });
    const row = existing ?? (await table.create({
      data: { tenantId: ctx.actor.tenantId, name },
    }));
    if (!row.active) {
      throw new ValidationError(
        `E_VALIDATION: ${row.name} is a discontinued ${kind}`,
      );
    }
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push({ id: row.id, name: row.name });
  }

  return out;
}

function axisCommands(kind: AxisKind, label: string) {
  const create: CommandDefinition<{ name: string }, { id: string }> = {
    key: `verity.plywood.create_${kind}`,
    entity: ENTITY_PRODUCT_DETAIL,
    verb: "Create",
    input: z.object({ name: z.string().min(1).max(80) }),
    handler: async (ctx, input) => {
      const name = input.name.trim();
      const clash = await axisTable(ctx.tx, kind).findFirst({ where: { name } });
      if (clash) {
        throw new ValidationError(
          `E_VALIDATION: ${label} ${name} already exists`,
        );
      }
      const row = await axisTable(ctx.tx, kind).create({
        data: { tenantId: ctx.actor.tenantId, name },
      });
      return {
        result: { id: row.id },
        events: [{ name: `verity.plywood.${kind}_created`, entityId: row.id }],
      };
    },
  };

  const setActive: CommandDefinition<
    { id: string; active: boolean },
    { id: string }
  > = {
    key: `verity.plywood.set_${kind}_active`,
    entity: ENTITY_PRODUCT_DETAIL,
    verb: "Edit",
    input: z.object({ id: z.string().uuid(), active: z.boolean() }),
    handler: async (ctx, input) => {
      const row = await axisTable(ctx.tx, kind).update({
        where: { id: input.id },
        data: { active: input.active },
      });
      return {
        result: { id: row.id },
        events: [
          {
            name: `verity.plywood.${kind}_${input.active ? "activated" : "deactivated"}`,
            entityId: row.id,
          },
        ],
      };
    },
  };

  const list: QueryDefinition<
    { includeInactive?: boolean },
    Array<{ id: string; name: string; active: boolean; productCount: number }>
  > = {
    key: `verity.plywood.list_${kind}s`,
    entity: ENTITY_PRODUCT_DETAIL,
    input: z.object({ includeInactive: z.boolean().optional() }),
    handler: async (ctx, input) => {
      const rows = await axisTable(ctx.tx, kind).findMany({
        where: input.includeInactive ? {} : { active: true },
        orderBy: { name: "asc" },
        include: { _count: { select: { details: true } } },
      });
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        active: row.active,
        productCount: row._count?.details ?? 0,
      }));
    },
  };

  return { create, setActive, list };
}

const shadeCommands = axisCommands("shade", "shade");
const textureCommands = axisCommands("texture", "texture");

export const createShade = shadeCommands.create;
export const setShadeActive = shadeCommands.setActive;
export const listShades = shadeCommands.list;
export const createTexture = textureCommands.create;
export const setTextureActive = textureCommands.setActive;
export const listTextures = textureCommands.list;


/** Named so `commitProductImport` below can type its per-row batch input
 *  without re-declaring this shape. */
type CreateProductInput = {
  brandId: string;
  name: string;
  hsnCode?: string;
  thicknessTenthMm?: number;
  category?: ProductCategory;
  widthTenth?: number;
  heightTenth?: number;
  grade?: string;
  sheetWeightGrams?: number;
  reorderLevelUnits?: number;
  unitLabel?: string;
  type?: RequestableProductType;
  shadeIds?: string[];
  newShades?: string[];
  textureIds?: string[];
  newTextures?: string[];
};

export const createProduct: CommandDefinition<
  CreateProductInput,
  { id: string; variantIds: string[] }
> = {
  key: "verity.plywood.create_product",
  entity: ENTITY_PRODUCT,
  verb: "Create",
  input: z.object({
    brandId: z.string().uuid(),
    name: z.string().min(1).max(200),
    // Optional. The HSN usually arrives with the supplier's first invoice, not
    // at the moment the row is needed; refusing the product until then pushes
    // the catalogue into a spreadsheet.
    hsnCode: HSN_CODE.optional(),
    // Tenths of a millimetre: 180 is 18.0 mm. Integers because a board's
    // thickness is an exact fact, and a float would make it approximately so.
    // Optional: a SERVICE product or most hardware items have no sheet
    // dimensions at all — the database's own check constraint allows NULL
    // but still refuses zero or negative when a value is given.
    thicknessTenthMm: z.number().int().positive().optional(),
    // Which family this is. The unit its size is quoted in follows from it —
    // see CATEGORY_RULES — and is never accepted from the caller, so a louvre
    // cannot arrive measured in feet.
    category: z.enum(PRODUCT_CATEGORIES).optional(),
    // Tenths of that unit: 80 is 8.0 ft, 960 is 96.0 in, 24400 is 2440.0 mm.
    widthTenth: z.number().int().positive().optional(),
    heightTenth: z.number().int().positive().optional(),
    grade: z.string().min(1).max(60).optional(),
    sheetWeightGrams: z.number().int().positive().optional(),
    reorderLevelUnits: z.number().int().min(0).optional(),
    unitLabel: z.string().min(1).max(30).optional(),
    type: z.enum(PRODUCT_TYPES).optional(),
    // The two variant axes. Existing shades/textures by id, brand-new ones by
    // name in the same call — a client picking five shades should not have to
    // abandon a half-filled product form because the sixth one is new.
    shadeIds: z.array(z.string().uuid()).max(50).optional(),
    newShades: z.array(z.string().min(1).max(80)).max(50).optional(),
    textureIds: z.array(z.string().uuid()).max(50).optional(),
    newTextures: z.array(z.string().min(1).max(80)).max(50).optional(),
  }),
  preconditions: async (ctx, input) => {
    const brand = await ctx.tx.tradingBrand.findUnique({
      where: { id: input.brandId },
    });
    if (!brand)
      throw new ValidationError("E_VALIDATION: brand not found in this tenant");
    if (!brand.active) {
      throw new ValidationError(
        "E_VALIDATION: cannot add a product to a deactivated brand",
      );
    }

    const rules = CATEGORY_RULES[input.category ?? "OTHER"];

    // A board with no thickness is the one mistake this catalogue cannot
    // absorb: thickness is what tells two otherwise identical rows apart, and
    // an order line for "Sainik 710" with no millimetres is a guess made in
    // the godown. Checked only for a physical item — a service has no edge.
    if (
      rules.thickness === "required" &&
      (input.type ?? "PHYSICAL") === "PHYSICAL" &&
      input.thicknessTenthMm === undefined
    ) {
      throw new ValidationError(
        `E_VALIDATION: a ${rules.label.toLowerCase()} needs a thickness in mm`,
      );
    }

    // Both sides or neither. Half a size reads as a complete one on screen.
    if ((input.widthTenth === undefined) !== (input.heightTenth === undefined)) {
      throw new ValidationError(
        "E_VALIDATION: give both the width and the height, or neither",
      );
    }

    // A grade says how the glue behaves in water. Structural families are told
    // apart by it, so it stays required there; a decorative laminate has none
    // at all, and accepting one would record a fact that is not true of the
    // sheet.
    if (
      rules.grade === "expected" &&
      (input.type ?? "PHYSICAL") === "PHYSICAL" &&
      input.grade === undefined
    ) {
      throw new ValidationError(
        `E_VALIDATION: a ${rules.label.toLowerCase()} needs a grade`,
      );
    }
    if (rules.grade === "none" && input.grade !== undefined) {
      throw new ValidationError(
        `E_VALIDATION: a ${rules.label.toLowerCase()} has no grade`,
      );
    }

    const wantsVariants =
      (input.shadeIds?.length ?? 0) +
        (input.newShades?.length ?? 0) +
        (input.textureIds?.length ?? 0) +
        (input.newTextures?.length ?? 0) >
      0;
    if (wantsVariants && !rules.variants) {
      throw new ValidationError(
        `E_VALIDATION: shades and textures belong to a laminate, not a ${rules.label.toLowerCase()}`,
      );
    }
    if (wantsVariants && (input.type ?? "PHYSICAL") !== "PHYSICAL") {
      throw new ValidationError(
        "E_VALIDATION: a service has no shades or textures",
      );
    }
  },
  handler: async (ctx, input) => {
    const category = input.category ?? "OTHER";
    const rules = CATEGORY_RULES[category];
    // The client sells one laminate size. Rather than trusting the form to
    // send it, the command states it — so a laminate is 8 x 4 no matter which
    // caller wrote it, and the CHECK constraint behind this agrees.
    const size = rules.fixedSizeTenth ?? {
      widthTenth: input.widthTenth ?? null,
      heightTenth: input.heightTenth ?? null,
    };

    const shades = await resolveAxis(ctx, "shade", input.shadeIds, input.newShades);
    const textures = await resolveAxis(
      ctx,
      "texture",
      input.textureIds,
      input.newTextures,
    );
    const generates = shades.length > 0 || textures.length > 0;

    const base = {
      tenantId: ctx.actor.tenantId,
      brandId: input.brandId,
      hsnCode: input.hsnCode ?? null,
      unitLabel: input.unitLabel ?? "sheets",
    };
    const baseDetail = {
      tenantId: ctx.actor.tenantId,
      thicknessTenthMm: input.thicknessTenthMm ?? null,
      category,
      sizeUnit: rules.sizeUnit,
      widthTenth: size.widthTenth,
      heightTenth: size.heightTenth,
      grade: input.grade ?? null,
      sheetWeightGrams: input.sheetWeightGrams ?? null,
    };

    // One transaction, two tables: the generic base and plywood's own
    // dimension/grade extension (ADR-018). The UI still sees one call.
    //
    // With no variant axis this is exactly what it always was — one product.
    // With one, the row created here becomes the TEMPLATE: it carries no
    // reorder level, because nothing is ever counted against it.
    const parent = await ctx.tx.tradingProduct.create({
      data: {
        ...base,
        name: input.name,
        reorderLevelUnits: generates ? 0 : (input.reorderLevelUnits ?? 0),
        type: generates ? PRODUCT_TYPE_TEMPLATE : (input.type ?? "PHYSICAL"),
      },
    });
    await ctx.tx.plywoodProductDetail.create({
      data: { ...baseDetail, productId: parent.id },
    });

    // The matrix. An axis nobody chose contributes a single null rather than
    // nothing, so five shades and no textures generate five products — not
    // five times zero, which is the arithmetic bug this shape avoids.
    //
    // GUARDED ON `generates`, and that guard is load bearing. Filling BOTH
    // empty axes with a null gives a one-by-one matrix, so an ordinary product
    // with no shades and no textures was generating a single nameless variant
    // of itself: two catalogue rows for one board, the second stockable and
    // orderable and indistinguishable from the first. The nulls exist for the
    // five-shades-no-textures case; they must never run when nobody asked for
    // a matrix at all.
    const shadeAxis = shades.length > 0 ? shades : [null];
    const textureAxis = textures.length > 0 ? textures : [null];
    const variantIds: string[] = [];
    for (const shade of generates ? shadeAxis : []) {
      for (const texture of textureAxis) {
        const variant = await ctx.tx.tradingProduct.create({
          data: {
            ...base,
            name: variantName(input.name, shade?.name ?? null, texture?.name ?? null),
            reorderLevelUnits: input.reorderLevelUnits ?? 0,
            type: "PHYSICAL",
            parentProductId: parent.id,
          },
        });
        await ctx.tx.plywoodProductDetail.create({
          data: {
            ...baseDetail,
            productId: variant.id,
            shadeId: shade?.id ?? null,
            textureId: texture?.id ?? null,
          },
        });
        variantIds.push(variant.id);
      }
    }

    return {
      result: { id: parent.id, variantIds },
      events: [
        { name: "verity.plywood.product_created", entityId: parent.id },
        ...variantIds.map((id) => ({
          name: "verity.plywood.product_created",
          entityId: id,
        })),
      ],
    };
  },
};

export const editProduct: CommandDefinition<
  {
    productId: string;
    name?: string;
    hsnCode?: string | null;
    grade?: string | null;
    sheetWeightGrams?: number | null;
    reorderLevelUnits?: number;
    unitLabel?: string;
    type?: RequestableProductType;
    category?: ProductCategory;
  },
  { id: string }
> = {
  key: "verity.plywood.edit_product",
  entity: ENTITY_PRODUCT,
  verb: "Edit",
  input: z.object({
    productId: z.string().uuid(),
    name: z.string().min(1).max(200).optional(),
    // `null` clears it. A product entered with the wrong HSN and no
    // replacement to hand is better recorded as having none than as having
    // that one — the rate then falls back to the tenant default, and the
    // period-close checklist lists it, instead of a wrong code filing quietly.
    hsnCode: HSN_CODE.nullable().optional(),
    grade: z.string().min(1).max(60).nullable().optional(),
    sheetWeightGrams: z.number().int().positive().nullable().optional(),
    reorderLevelUnits: z.number().int().min(0).optional(),
    unitLabel: z.string().min(1).max(30).optional(),
    /**
     * Correcting what a product IS.
     *
     * Audit finding U2-6b. `createProduct` takes a type and defaults to
     * PHYSICAL; `editProduct` could not change it, so a service entered
     * without ticking the box was permanently a board. It then appeared in
     * every "Board" dropdown, could be ordered, and could be received into a
     * godown — nonsense the business had no way to undo. A real example was
     * found in a live tenant: "Custom Log Sawing & Sizing Service", PHYSICAL.
     */
    type: z.enum(PRODUCT_TYPES).optional(),
    /**
     * Correcting which family a product belongs to, for the same reason
     * `type` is correctable: a laminate filed as a board is a data-entry slip,
     * and being permanently stuck with it is not a rule anyone chose. Bounded
     * by the same two guards — nothing may have moved, and the unit the size
     * is quoted in may not change underneath a size that already exists.
     */
    category: z.enum(PRODUCT_CATEGORIES).optional(),
  }),
  handler: async (ctx, input) => {
    const before = await ctx.tx.tradingProduct.findUniqueOrThrow({
      where: { id: input.productId },
      include: { plywoodDetail: true },
    });
    const beforeDetail = before.plywoodDetail;

    // A type change is only safe while the product has no stock history. Once
    // sheets have moved, calling it a service would orphan those movements —
    // the ledger would hold quantities for something the system says is not
    // held in a godown. Correcting a data-entry slip is the use; rewriting the
    // nature of a traded board is not.
    if (input.type !== undefined && input.type !== before.type) {
      const movements = await ctx.tx.stockLedgerEntry.count({
        where: { productId: input.productId },
      });
      if (movements > 0) {
        throw new ValidationError(
          `E_VALIDATION: ${before.name} already has ${movements} stock movement(s), ` +
            "so it cannot be reclassified. Withdraw it and add it again under the right type.",
        );
      }
    }

    // A family change moves the product between unit systems, so it carries
    // the same history guard as a type change, plus one of its own.
    let sizeChange: {
      category: ProductCategory;
      sizeUnit: SizeUnit;
      widthTenth: number | null;
      heightTenth: number | null;
    } | null = null;

    if (
      input.category !== undefined &&
      input.category !== beforeDetail?.category
    ) {
      const movements = await ctx.tx.stockLedgerEntry.count({
        where: { productId: input.productId },
      });
      if (movements > 0) {
        throw new ValidationError(
          `E_VALIDATION: ${before.name} already has ${movements} stock movement(s), ` +
            "so it cannot be moved to another product family. Withdraw it and add it again.",
        );
      }

      const rules = CATEGORY_RULES[input.category];
      const hasSize =
        beforeDetail?.widthTenth != null && beforeDetail?.heightTenth != null;

      // 8 ft is not 8 in. Re-labelling the unit while leaving the number alone
      // would turn a stated size into a different one without anyone typing a
      // digit, so the size has to go back through creation instead.
      if (
        hasSize &&
        rules.sizeUnit !== beforeDetail?.sizeUnit &&
        !rules.fixedSizeTenth
      ) {
        const fromUnit =
          beforeDetail?.sizeUnit === "FT"
            ? "feet"
            : beforeDetail?.sizeUnit === "IN"
              ? "inches"
              : "millimetres";
        throw new ValidationError(
          `E_VALIDATION: a ${rules.label.toLowerCase()} is sized in ` +
            `${rules.sizeUnit === "FT" ? "feet" : rules.sizeUnit === "IN" ? "inches" : "millimetres"}, ` +
            `and ${before.name} is recorded in ${fromUnit}. ` +
            "Withdraw it and add it again at the right size.",
        );
      }

      sizeChange = {
        category: input.category,
        sizeUnit: rules.sizeUnit,
        widthTenth: rules.fixedSizeTenth
          ? rules.fixedSizeTenth.widthTenth
          : (beforeDetail?.widthTenth ?? null),
        heightTenth: rules.fixedSizeTenth
          ? rules.fixedSizeTenth.heightTenth
          : (beforeDetail?.heightTenth ?? null),
      };
    }

    const after = await ctx.tx.tradingProduct.update({
      where: { id: input.productId },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.hsnCode === undefined ? {} : { hsnCode: input.hsnCode }),
        ...(input.reorderLevelUnits === undefined
          ? {}
          : { reorderLevelUnits: input.reorderLevelUnits }),
        ...(input.unitLabel === undefined
          ? {}
          : { unitLabel: input.unitLabel }),
        ...(input.type === undefined ? {} : { type: input.type }),
        version: { increment: 1 },
      },
    });
    await ctx.tx.plywoodProductDetail.update({
      where: { productId: input.productId },
      data: {
        ...(sizeChange === null ? {} : sizeChange),
        ...(input.grade === undefined ? {} : { grade: input.grade }),
        ...(input.sheetWeightGrams === undefined
          ? {}
          : { sheetWeightGrams: input.sheetWeightGrams }),
      },
    });

    // An HSN change is a tax fact and will be asked about after a filing. The
    // diff records what it was, not merely that it changed.
    await recordActivity(ctx, {
      entityKey: ENTITY_PRODUCT,
      entityId: after.id,
      commandKey: "verity.plywood.edit_product",
      changes: diffFields(
        {
          name: before.name,
          hsnCode: before.hsnCode,
          grade: beforeDetail?.grade,
          reorderLevelUnits: before.reorderLevelUnits,
          type: before.type,
          category: beforeDetail?.category,
        },
        {
          name: after.name,
          hsnCode: after.hsnCode,
          grade: input.grade ?? beforeDetail?.grade,
          reorderLevelUnits: after.reorderLevelUnits,
          type: after.type,
          category: input.category ?? beforeDetail?.category,
        },
      ),
    });

    return {
      result: { id: after.id },
      events: [{ name: "verity.plywood.product_edited", entityId: after.id }],
    };
  },
};

/**
 * Dimensions are deliberately NOT editable.
 *
 * An 18 mm board and a 12 mm board are different products, not one product with
 * a corrected field. Editing the size in place would silently restate every
 * past movement and every past invoice line that referenced it. A wrong size is
 * fixed by deactivating the product and creating the right one — which is the
 * same reasoning that makes the ledgers append-only.
 */
export const setProductActive: CommandDefinition<
  { productId: string; active: boolean },
  { id: string }
> = {
  key: "verity.plywood.set_product_active",
  entity: ENTITY_PRODUCT,
  verb: "Edit",
  input: z.object({ productId: z.string().uuid(), active: z.boolean() }),
  handler: async (ctx, input) => {
    const product = await ctx.tx.tradingProduct.update({
      where: { id: input.productId },
      data: { active: input.active, version: { increment: 1 } },
    });
    return {
      result: { id: product.id },
      events: [
        {
          name: input.active
            ? "verity.plywood.product_activated"
            : "verity.plywood.product_deactivated",
          entityId: product.id,
        },
      ],
    };
  },
};

/* ================================= import ================================= */

/**
 * CSV import, plywood half — Task 87. Lives here rather than in
 * `trading/import.ts` because it needs `createProduct` and brand-by-name
 * resolution, both plywood-owned; `trading` has no dependency back onto
 * `plywood` to point the other way (ADR-018's dependency direction).
 *
 * `brandName` stands in for `createProduct`'s `brandId` — a CSV cannot
 * carry a UUID a person has never seen — so this is its own row schema,
 * not `createProduct.input` reused verbatim the way the customer/supplier
 * importer reuses `createCustomer.input`/`createSupplier.input` unchanged.
 * Duplicates `createProduct`'s field list; kept narrow and named so the
 * duplication is visible rather than hidden inside a generic mapper.
 *
 * Deliberately does not import variants (shades/textures) — a CSV row is
 * one product, and the matrix-generating path stays a form-only feature
 * until a client actually asks to import laminates in bulk.
 */
const productImportRowSchema = z.object({
  brandName: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  hsnCode: HSN_CODE.optional(),
  thicknessTenthMm: z.number().int().positive().optional(),
  category: z.enum(PRODUCT_CATEGORIES).optional(),
  widthTenth: z.number().int().positive().optional(),
  heightTenth: z.number().int().positive().optional(),
  grade: z.string().min(1).max(60).optional(),
  sheetWeightGrams: z.number().int().positive().optional(),
  reorderLevelUnits: z.number().int().min(0).optional(),
  unitLabel: z.string().min(1).max(30).optional(),
});
export type ProductImportRow = z.infer<typeof productImportRowSchema>;

const PRODUCT_IMPORT_FIELDS = [
  "brandName",
  "name",
  "hsnCode",
  "thicknessTenthMm",
  "category",
  "widthTenth",
  "heightTenth",
  "grade",
  "sheetWeightGrams",
  "reorderLevelUnits",
  "unitLabel",
] as const;
const PRODUCT_IMPORT_NUMERIC_FIELDS = [
  "thicknessTenthMm",
  "widthTenth",
  "heightTenth",
  "sheetWeightGrams",
  "reorderLevelUnits",
] as const;

/** Same header-matching contract as `trading/import.ts`'s `normalizeRow` —
 *  duplicated rather than imported, since sharing it would mean this file
 *  importing from `trading/import.ts` importing back the other way is not
 *  a risk here, but keeping product import self-contained in one file
 *  next to the schema it validates against is easier to audit than a
 *  cross-file dependency for an eleven-line function. */
function normalizeProductRow(raw: Record<string, string>): Record<string, unknown> {
  const byLowerKey = new Map(Object.entries(raw).map(([k, v]) => [k.trim().toLowerCase(), v]));
  const out: Record<string, unknown> = {};
  for (const field of PRODUCT_IMPORT_FIELDS) {
    const value = byLowerKey.get(field.toLowerCase());
    const trimmed = value?.trim();
    if (!trimmed) continue;
    out[field] = (PRODUCT_IMPORT_NUMERIC_FIELDS as readonly string[]).includes(field)
      ? Number(trimmed)
      : trimmed;
  }
  return out;
}

export type ProductImportPreview = {
  valid: Array<{ row: number; data: ProductImportRow }>;
  invalid: Array<{ row: number; raw: Record<string, string>; errors: string[] }>;
};

export const previewProductImport: QueryDefinition<
  { rows: Record<string, string>[] },
  ProductImportPreview
> = {
  key: "verity.plywood.preview_product_import",
  entity: ENTITY_PRODUCT,
  input: z.object({ rows: z.array(z.record(z.string(), z.string())).min(1).max(2000) }),
  handler: async (_ctx, input) => {
    const valid: ProductImportPreview["valid"] = [];
    const invalid: ProductImportPreview["invalid"] = [];
    input.rows.forEach((raw, index) => {
      const parsed = productImportRowSchema.safeParse(normalizeProductRow(raw));
      if (parsed.success) {
        valid.push({ row: index + 1, data: parsed.data });
      } else {
        invalid.push({
          row: index + 1,
          raw,
          errors: parsed.error.issues.map(
            (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
          ),
        });
      }
    });
    return { valid, invalid };
  },
};

export type ProductImportCommitResult = {
  brands: BatchResult<{ id: string }>;
  products: BatchResult<{ id: string; variantIds: string[] }>;
};

/**
 * Two-pass commit, never one giant transaction (Task 91's own anti-pattern
 * rule): first every distinct brand name in the batch is resolved through
 * `ensureBrand` (find-or-create, each row its own transaction), then every
 * row whose brand resolved becomes a `createProduct` call in a second
 * batch. A row whose brand failed to resolve is reported failed without
 * ever reaching `createProduct` — never silently dropped, never guessed at
 * with a placeholder brand.
 *
 * Called directly by the server action, not itself a `CommandDefinition`:
 * it issues MULTIPLE real commands, exactly the shape `executeConfirmedPreview`
 * (`agent-chat.ts`) already established for "run several real commands and
 * report what happened to each."
 */
export async function commitProductImport(
  actor: ActorContext,
  rows: ProductImportRow[],
): Promise<ProductImportCommitResult> {
  const distinctBrandNames = [...new Set(rows.map((r) => r.brandName))];
  const brands = await runCommandBatch(actor, ensureBrand, distinctBrandNames.map((name) => ({ name })));

  const brandIdByName = new Map<string, string>();
  for (const item of brands.items) {
    if (item.outcome.status === "succeeded") {
      brandIdByName.set(distinctBrandNames[item.index]!, item.outcome.result.id);
    }
  }

  const productInputs: Array<CreateProductInput | null> = rows.map((row) => {
    const brandId = brandIdByName.get(row.brandName);
    if (!brandId) return null;
    const { brandName: _brandName, ...rest } = row;
    return { ...rest, brandId };
  });

  // Rows whose brand never resolved are reported failed at the SAME index
  // the caller's `rows` array uses, without ever calling `createProduct` —
  // `runCommandBatch` only sees the rows that did resolve, so its own
  // indices are re-mapped back onto the original row numbers here.
  const resolvedIndices = productInputs
    .map((input, index) => (input === null ? null : index))
    .filter((i): i is number => i !== null);
  const resolvedInputs = resolvedIndices.map((i) => productInputs[i]!);
  const resolvedBatch = await runCommandBatch(actor, createProduct, resolvedInputs);

  const items: BatchResult<{ id: string; variantIds: string[] }>["items"] = rows.map((row, index) => {
    const resolvedAt = resolvedIndices.indexOf(index);
    if (resolvedAt === -1) {
      return {
        index,
        outcome: {
          status: "failed" as const,
          reason: `E_VALIDATION: brand "${row.brandName}" could not be resolved`,
          code: "E_VALIDATION",
        },
      };
    }
    return resolvedBatch.items[resolvedAt]!;
  });

  const products: BatchResult<{ id: string; variantIds: string[] }> = {
    total: rows.length,
    succeeded: items.filter((i) => i.outcome.status === "succeeded").length,
    failed: items.filter((i) => i.outcome.status === "failed").length,
    needsApproval: items.filter((i) => i.outcome.status === "needs_approval").length,
    items,
  };

  return { brands, products };
}

/* ================================= queries ================================= */

export const listCatalogue: QueryDefinition<
  { includeInactive?: boolean; brandId?: string },
  Array<{
    brandId: string;
    brandName: string;
    brandActive: boolean;
    products: Array<{
      id: string;
      name: string;
      hsnCode: string | null;
      thicknessTenthMm: number | null;
      category: ProductCategory;
      sizeUnit: SizeUnit;
      widthTenth: number | null;
      heightTenth: number | null;
      grade: string | null;
      unitLabel: string;
      reorderLevelUnits: number;
      active: boolean;
      type: ProductType;
      /** Null on an ordinary product and on a template; set on a variant. */
      parentProductId: string | null;
      shadeName: string | null;
      textureName: string | null;
      /** How many variants hang off this row. Zero unless it is a template. */
      variantCount: number;
    }>;
  }>
> = {
  key: "verity.plywood.list_catalogue",
  entity: ENTITY_PRODUCT,
  input: z.object({
    includeInactive: z.boolean().optional(),
    brandId: z.string().uuid().optional(),
  }),
  handler: async (ctx, input) => {
    const brands = await ctx.tx.tradingBrand.findMany({
      where: {
        ...(input.includeInactive ? {} : { active: true }),
        ...(input.brandId ? { id: input.brandId } : {}),
      },
      orderBy: { name: "asc" },
      include: {
        products: {
          where: input.includeInactive ? {} : { active: true },
          orderBy: [{ name: "asc" }],
          include: {
            plywoodDetail: { include: { shade: true, texture: true } },
            _count: { select: { variants: true } },
          },
        },
      },
    });

    return brands.map((brand) => ({
      brandId: brand.id,
      brandName: brand.name,
      brandActive: brand.active,
      products: brand.products.map((product) => ({
        id: product.id,
        name: product.name,
        hsnCode: product.hsnCode,
        thicknessTenthMm: product.plywoodDetail?.thicknessTenthMm ?? null,
        category: (product.plywoodDetail?.category ?? "OTHER") as ProductCategory,
        sizeUnit: (product.plywoodDetail?.sizeUnit ?? "MM") as SizeUnit,
        widthTenth: product.plywoodDetail?.widthTenth ?? null,
        heightTenth: product.plywoodDetail?.heightTenth ?? null,
        grade: product.plywoodDetail?.grade ?? null,
        unitLabel: product.unitLabel,
        reorderLevelUnits: product.reorderLevelUnits,
        active: product.active,
        type: product.type as ProductType,
        parentProductId: product.parentProductId,
        shadeName: product.plywoodDetail?.shade?.name ?? null,
        textureName: product.plywoodDetail?.texture?.name ?? null,
        variantCount: product._count.variants,
      })),
    }));
  },
};

/**
 * `trading.stockOnHand`, augmented with plywood's `grade` — the one field
 * the stock board (`StockBoard.tsx`) actually renders per row that the
 * generic query cannot know about. Shadows the star-re-exported binding
 * from `../trading` (ES module semantics: a local export always wins over
 * one brought in by `export *`), so anything importing `stockOnHand` from
 * `@/server/capabilities/plywood` gets this version. Registered under its
 * own key — `verity.trading.stock_on_hand` is already taken by the
 * ungraded version `registerTradingCapability()` registers (now called
 * standalone at top level in `registry.ts`, before `registerPlywoodCapability()`).
 */
export const stockOnHand: QueryDefinition<
  { locationId?: string; productId?: string },
  Array<{
    productId: string;
    productName: string;
    brandName: string;
    grade: string;
    unitLabel: string;
    locationId: string;
    locationName: string;
    qtyUnits: number;
    avgUnitCostPaise: number;
    valuePaise: number;
  }>
> = {
  key: "verity.plywood.stock_on_hand",
  scopeHandling: tradingStockOnHand.scopeHandling,
  entity: ENTITY_STOCK_BALANCE,
  input: tradingStockOnHand.input,
  handler: async (ctx, input) => {
    const rows = await tradingStockOnHand.handler(ctx, input);
    if (rows.length === 0) return [];
    const details = await ctx.tx.plywoodProductDetail.findMany({
      where: { productId: { in: [...new Set(rows.map((r) => r.productId))] } },
      select: { productId: true, grade: true },
    });
    const gradeOf = new Map(details.map((d) => [d.productId, d.grade]));
    return rows.map((row) => ({
      ...row,
      grade: gradeOf.get(row.productId) ?? "",
    }));
  },
};

/* ============================== registration ============================== */

export function registerPlywoodCapability(): void {
  registerContribution({
    capabilityId: PLYWOOD_CAPABILITY,
    navigation: [
      // The client's navigation, in the business's own words.
      //
      // Authority: taskplans/archive/45_plywood_workflow_program.md §8. Groups are the
      // five the specification names — TRADE, INVENTORY, MONEY, INSIGHTS,
      // ADMINISTRATION — not the platform's own "Capabilities" and
      // "Administration", which are implementation vocabulary. A client seeing
      // "Capabilities" is the foundation leaking into the product.
      //
      // Order is dense within a group and leaves gaps between them, so the
      // slices still to come (Suppliers, Customers, Tax & Compliance, People &
      // Roles, Business Settings) drop in without renumbering everything.
      {
        href: "/overview",
        label: "Overview",
        group: "Overview",
        order: 10,
        icon: "overview",
        requiresEntity: ENTITY_INVOICE,
        shells: ["platform"],
      },

      /* ---- TRADE ---- */
      {
        href: "/catalogue",
        label: "Catalogue",
        group: "Trade",
        order: 20,
        icon: "catalogue",
        requiresEntity: ENTITY_PRODUCT,
        shells: ["platform"],
      },
      {
        href: "/suppliers",
        label: "Suppliers",
        group: "Trade",
        order: 21,
        icon: "supplier",
        requiresEntity: ENTITY_SUPPLIER,
        shells: ["platform"],
      },
      {
        href: "/purchases",
        label: "Purchases",
        group: "Trade",
        order: 22,
        icon: "purchases",
        requiresEntity: ENTITY_PURCHASE_ORDER,
        shells: ["platform", "operations"],
      },
      {
        href: "/customers",
        label: "Customers",
        group: "Trade",
        order: 23,
        icon: "parties",
        requiresEntity: ENTITY_CUSTOMER,
        shells: ["platform"],
      },
      {
        href: "/sales",
        label: "Sales",
        group: "Trade",
        order: 24,
        icon: "sales",
        requiresEntity: ENTITY_SALES_ORDER,
        shells: ["platform", "operations"],
      },

      /* ---- INVENTORY ---- */
      {
        href: "/stock",
        label: "Stock",
        group: "Inventory",
        order: 30,
        icon: "stock",
        requiresEntity: ENTITY_STOCK_BALANCE,
        shells: ["platform", "operations"],
      },
      {
        href: "/godowns",
        label: "Godowns",
        group: "Inventory",
        order: 32,
        icon: "locations",
        // §0 — a plywood business has godowns, not "Locations" and not
        // "Assets". Both generic entries present concepts this screen already
        // covers in the client's own word, and showing all three is the
        // foundation leaking into the product. The routes still exist and still
        // authorize; only the menu entry is replaced.
        supersedes: ["/locations", "/assets"],
        // Gated on the LOCATION, not on racks. Racks were withdrawn, and a
        // menu entry that checks a permission for a feature nobody can reach
        // hides the page from whoever happens to lack a grant nothing uses.
        requiresEntity: "verity.location.location",
        requiresVerb: "Create",
        shells: ["platform"],
      },

      /* ---- MONEY ---- */
      {
        href: "/finance",
        label: "Finance",
        group: "Money",
        order: 40,
        icon: "finance",
        requiresEntity: ENTITY_INVOICE,
        shells: ["platform"],
      },
      {
        // The cash book, and the only place a payment is entered. Above the
        // ledgers because "what money moved" is asked far more often than
        // "what happened with this one party".
        href: "/transactions",
        label: "Transactions",
        group: "Money",
        order: 41,
        icon: "ledger",
        requiresEntity: ENTITY_PAYMENT,
        shells: ["platform"],
      },
      {
        href: "/ledgers",
        // Asked for by the name people look for (2026-09-15: "add ledgers
        // option in sidebar" — it was there as "Who owes what" and not found).
        label: "Ledgers",
        group: "Money",
        order: 42,
        icon: "ledger",
        requiresEntity: ENTITY_LEDGER_ENTRY,
        shells: ["platform"],
      },

      {
        href: "/prices",
        label: "Agreed prices",
        group: "Money",
        order: 43,
        icon: "finance",
        requiresEntity: ENTITY_SUPPLIER_PRICE,
        requiresVerb: "Edit",
        shells: ["platform"],
      },

      {
        // The centre, not the close screen. Closing a period is one thing an
        // accountant does at the end of a month; reading the position is what
        // they do every day, and the nav should land on the second.
        href: "/tax",
        label: "Tax & Compliance",
        group: "Money",
        order: 44,
        icon: "tax",
        requiresEntity: ENTITY_INVOICE,
        requiresVerb: "Read",
        shells: ["platform"],
      },

      /* ---- INSIGHTS ---- */
      {
        href: "/reports",
        label: "Reports",
        group: "Insights",
        order: 50,
        icon: "audit",
        requiresEntity: ENTITY_INVOICE,
        shells: ["platform"],
      },

      /* ---- ADMINISTRATION ---- */
      {
        href: "/people",
        label: "People & Roles",
        group: "Administration",
        order: 58,
        icon: "people",
        // Gated on the platform's membership entity, not a plywood one: who
        // works here is a platform fact, and the capability only supplies the
        // vocabulary the role editor speaks.
        requiresEntity: "verity.platform.membership",
        requiresVerb: "Read",
        shells: ["platform"],
      },
      {
        href: "/settings/tax",
        label: "Tax Settings",
        group: "Administration",
        order: 62,
        icon: "tax",
        // Edit on the registration: the people who may change a GSTIN or a
        // rate are a much smaller set than those who read tax figures.
        requiresEntity: ENTITY_GST_REGISTRATION,
        requiresVerb: "Edit",
        shells: ["platform"],
      },
      {
        href: "/audit",
        label: "Audit",
        group: "Administration",
        order: 64,
        icon: "audit",
        requiresEntity: ENTITY_INVOICE,
        requiresVerb: "Read",
        shells: ["platform"],
      },
      {
        href: "/settings/business",
        label: "Business Settings",
        group: "Administration",
        order: 60,
        icon: "configuration",
        // Edit, not Read: this is where the business's legal identity is set,
        // and everyone who can read an invoice can already see it printed on
        // one. The people who may change it are a much smaller set.
        requiresEntity: ENTITY_BUSINESS_PROFILE,
        requiresVerb: "Edit",
        shells: ["platform"],
      },
      {
        // Task 87. Gated on Create/Customer — whoever may add a customer
        // by hand may also add a batch of them; the finer-grained checks
        // (Create/Supplier, Create/Product) are still enforced per row by
        // the underlying commands this page's actions call, this is only
        // the coarse menu-visibility filter.
        href: "/import",
        label: "Import data",
        group: "Administration",
        order: 61,
        icon: "configuration",
        requiresEntity: ENTITY_CUSTOMER,
        requiresVerb: "Create",
        shells: ["platform"],
      },
    ],
    workspace: [
      {
        key: "verity.plywood.low_stock",
        label: "Boards at or below reorder level",
        href: "/stock",
        count: async ({ tx }) => {
          const rows = await tx.$queryRaw<{ count: bigint }[]>`
              SELECT count(*)::bigint AS count
                FROM trading_product p
               WHERE p.active
                 AND p.reorder_level_units > 0
                 AND COALESCE((
                       SELECT sum(b.qty_units) FROM stock_balance b WHERE b.product_id = p.id
                     ), 0) <= p.reorder_level_units`;
          return Number(rows[0]?.count ?? 0);
        },
        shells: ["platform", "operations"],
      },
    ],
    schedules: [
      {
        key: "verity.plywood.sweep_low_stock",
        label: "Notify on boards at or below reorder level",
        // Daily, not frequent. A board that dropped below its reorder level an
        // hour ago is not a different fact from one that dropped this morning,
        // and a purchase decision is made once a day. Cadence rather than a cron
        // string: the capability knows how often the fact changes and does not
        // know what runs it.
        cadence: "daily",
        run: async ({ tx, tenantId }) => {
          const short = await tx.$queryRaw<
            {
              id: string;
              name: string;
              on_hand: bigint;
              reorder_level_units: number;
            }[]
          >`SELECT p.id,
                   p.name,
                   COALESCE((SELECT sum(b.qty_units) FROM stock_balance b WHERE b.product_id = p.id), 0) AS on_hand,
                   p.reorder_level_units
              FROM trading_product p
             WHERE p.active
               AND p.reorder_level_units > 0
               AND COALESCE((SELECT sum(b.qty_units) FROM stock_balance b WHERE b.product_id = p.id), 0)
                   <= p.reorder_level_units`;

          if (short.length === 0) return { events: [] };

          // Whoever may create a purchase order is who needs to know. Derived
          // from the permission rather than from a role name, because role names
          // belong to the client and permissions are the model.
          const buyers = await tx.tenantMembership.findMany({
            where: {
              role: {
                permissions: {
                  some: { verb: "Create", entity: ENTITY_STOCK_LEDGER },
                },
              },
            },
            select: { userId: true },
          });

          if (buyers.length > 0) {
            await notify(tx, {
              tenantId,
              key: "verity.plywood.low_stock",
              recipientIds: buyers.map((membership) => membership.userId),
              variables: { count: String(short.length) },
              fallback: {
                subject: `${short.length} board${short.length === 1 ? "" : "s"} at or below reorder level`,
                // §72 — a notification says what to do, not that something is
                // wrong. "Low stock" is a fact the reader must then go and
                // investigate; the board, the figure, the threshold and the
                // next action is something they can act on without leaving the
                // message.
                body: [
                  ...short.map(
                    (row) =>
                      `${row.name} — ${row.on_hand} available, reorder at ${row.reorder_level_units}`,
                  ),
                  "",
                  "Raise a purchase order: /purchases",
                ].join("\n"),
              },
            });
          }

          // Idempotent by construction: the sweep reads a condition and notifies,
          // writing no state that a retry would double. Every real scheduler
          // retries, and this one changes nothing the second time.
          return {
            events: short.map((row) => ({
              name: "verity.plywood.stock_below_reorder_level",
              entityId: row.id,
            })),
          };
        },
      },
      {
        key: "verity.plywood.capture_metric_snapshot",
        label: "Capture today's business metrics for the trend history",
        // Daily — a metric snapshot is a business-day fact, not something
        // that needs frequent/hourly resolution. Task 100's own missing
        // prerequisite for a real sparkline: see captureMetricSnapshot's
        // module comment in trading/finance.ts for the full reasoning.
        cadence: "daily",
        run: async ({ tx, tenantId }) => captureMetricSnapshot(tx, tenantId),
      },
    ],
  });

  registerCommand(createProduct);
  registerCommand(editProduct);
  registerCommand(setProductActive);
  registerCommand(createShade);
  registerCommand(setShadeActive);
  registerCommand(createTexture);
  registerCommand(setTextureActive);

  registerQuery(listCatalogue);
  registerQuery(productDetail);
  registerQuery(stockOnHand);
  registerQuery(listShades);
  registerQuery(listTextures);
  registerQuery(previewProductImport);
}
