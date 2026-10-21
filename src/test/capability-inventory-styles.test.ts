import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/platform/db";
import { assertRlsEnforceable, withTenant } from "@/server/platform/tenancy";
import { activateCapability, invalidateCapabilityCache } from "@/server/platform/capability";
import { clearCommands, clearHooks, executeCommand, type ActorContext } from "@/server/platform/command";
import { clearQueries, executeQuery } from "@/server/platform/query";
import { clearScopeResolvers } from "@/server/platform/authorization";
import { clearTransitionGuards } from "@/server/platform/state";
import { clearContributions } from "@/server/platform/contribution";
import { provisionIdentity } from "@/server/platform/identity";
import {
  ENTITY_INVENTORY_ATTRIBUTE,
  ENTITY_INVENTORY_ITEM,
  ENTITY_INVENTORY_STOCK,
  ENTITY_INVENTORY_TEMPLATE,
  INVENTORY_CAPABILITY,
  MAX_VARIANTS_PER_RUN,
  addAttributeValue,
  addTemplateValues,
  createItem,
  createTemplate,
  defineAttribute,
  generateVariants,
  listAttributes,
  listTemplates,
  recordStockMovement,
  registerInventoryCapability,
  setAttributeValueActive,
  setTemplateActive,
  templateDetail,
} from "@/server/capabilities/inventory";
import { LOCATION_CAPABILITY, registerLocationCapability } from "@/server/capabilities/location";

/**
 * Stylified demo, stage 1: the style master. Lists the tenant owns (colour, size), a style offered in chosen
 * values, variants generated as ordinary inventory items, idempotently, never destructively.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;
if (!hasDatabase) {
  const message = "capability-inventory-styles.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describeDb("capability: inventory style master", () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const created = { users: [] as string[], parties: [] as string[] };

  let locationId: string;
  let actorA: ActorContext;
  let actorB: ActorContext;
  let groupId: string;

  let colourId: string;
  let sizeId: string;
  const colour: Record<string, string> = {};
  const size: Record<string, string> = {};
  let styleId: string;

  async function makeTenant(tenantId: string, name: string) {
    return withTenant(tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name, timeZone: "Asia/Kolkata" } });
      await activateCapability(tx, tenantId, LOCATION_CAPABILITY);
      await activateCapability(tx, tenantId, INVENTORY_CAPABILITY);
      const organizationId = (await tx.organization.create({ data: { tenantId, name } })).id;
      const location = await tx.location.create({ data: { tenantId, organizationId, name: "Finished goods store" } });
      const role = await tx.role.create({ data: { tenantId, name: "Merchandiser" }, select: { id: true } });
      const entities = [ENTITY_INVENTORY_ITEM, ENTITY_INVENTORY_STOCK, ENTITY_INVENTORY_ATTRIBUTE, ENTITY_INVENTORY_TEMPLATE];
      await tx.permission.createMany({
        data: entities.flatMap((entity) =>
          (["Read", "Create", "Edit", "ActionExecute"] as const).map((verb) => ({
            tenantId, roleId: role.id, verb, entity, scope: "Tenant" as const,
          })),
        ),
      });
      const identity = await provisionIdentity(tx, { organizationId, authUserId: randomUUID(), displayName: `${name} user` });
      created.users.push(identity.userId);
      created.parties.push(identity.partyId);
      await tx.tenantMembership.update({ where: { id: identity.membershipId }, data: { roleId: role.id } });
      const actor: ActorContext = { tenantId, userId: identity.userId, membershipId: identity.membershipId, organizationId, roleId: role.id };
      return { actor, locationId: location.id };
    });
  }

  beforeAll(async () => {
    await assertRlsEnforceable();
    clearCommands();
    clearQueries();
    clearHooks();
    clearScopeResolvers();
    clearTransitionGuards();
    clearContributions();
    registerLocationCapability();
    registerInventoryCapability();

    const a = await makeTenant(tenantA, "Knitwear Test Works");
    const b = await makeTenant(tenantB, "Other Test Works");
    actorA = a.actor;
    actorB = b.actor;
    locationId = a.locationId;
    invalidateCapabilityCache();

    colourId = (await executeCommand(actorA, defineAttribute, { key: "colour", label: "Colour", kind: "colour" })).id;
    sizeId = (await executeCommand(actorA, defineAttribute, { key: "size_adult", label: "Size (adult)", kind: "size" })).id;
    for (const [code, label, hex] of [["NVY", "Navy", "#1F3A5F"], ["BLK", "Black", "#111111"], ["WHT", "White", "#F5F5F5"], ["MAR", "Maroon", "#6D1A2B"]] as const) {
      colour[code] = (await executeCommand(actorA, addAttributeValue, { attributeId: colourId, code, label, swatchHex: hex })).id;
    }
    // Added out of order on purpose: the size run must read S..XXL by sort order, not by insertion or by name.
    for (const [code, label, sortOrder] of [["M", "M", 20], ["S", "S", 10], ["XXL", "XXL", 50], ["L", "L", 30], ["XL", "XL", 40]] as const) {
      size[code] = (await executeCommand(actorA, addAttributeValue, { attributeId: sizeId, code, label, sortOrder })).id;
    }
    const group = await withTenant(tenantA, (tx) => tx.inventoryItemGroup.create({ data: { tenantId: tenantA, name: "Finished garments" } }));
    groupId = group.id;
  });

  afterAll(async () => {
    clearCommands();
    clearQueries();
    clearHooks();
    clearScopeResolvers();
    clearTransitionGuards();
    clearContributions();
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      await admin.$executeRaw`DELETE FROM tenant WHERE id IN (${tenantA}::uuid, ${tenantB}::uuid)`;
      for (const id of created.users) await admin.$executeRaw`DELETE FROM "user" WHERE id = ${id}::uuid`;
      for (const id of created.parties) await admin.$executeRaw`DELETE FROM party WHERE id = ${id}::uuid`;
    } finally {
      await admin.$disconnect();
    }
    await prisma.$disconnect();
  });

  const reject = (promise: Promise<unknown>, pattern: RegExp) => expect(promise).rejects.toThrow(pattern);

  it("keeps a list's codes unique, normalised, and swatches to colour lists only", async () => {
    await reject(executeCommand(actorA, defineAttribute, { key: "colour", label: "Again", kind: "colour" }), /already exists/);
    await reject(executeCommand(actorA, addAttributeValue, { attributeId: colourId, code: "nvy", label: "Navy again" }), /already used/);
    await reject(executeCommand(actorA, addAttributeValue, { attributeId: sizeId, code: "XS", label: "XS", swatchHex: "#000000" }), /only a colour list/);
    // Input-shape failures (a swatch that is not a hex colour) surface as the platform's generic input rejection.
    await reject(
      executeCommand(actorA, addAttributeValue, { attributeId: colourId, code: "BAD", label: "Bad", swatchHex: "navy" }),
      /input rejected for verity\.inventory\.add_attribute_value/,
    );

    const lists = await executeQuery(actorA, listAttributes, {});
    const sizes = lists.find((l) => l.key === "size_adult")!;
    expect(sizes.values.map((v) => v.code)).toEqual(["S", "M", "L", "XL", "XXL"]);
  });

  it("creates a style, then generates its colour x size variants as ordinary items", async () => {
    styleId = (
      await executeCommand(actorA, createTemplate, {
        code: "tee-crew",
        name: "Crew neck tee, 180 GSM",
        itemGroupId: groupId,
        hsnCode: "6109",
        taxRateBp: 500,
        season: "SS27",
        axes: [
          { attributeId: colourId, valueIds: [colour.NVY!, colour.BLK!, colour.WHT!] },
          { attributeId: sizeId, valueIds: [size.S!, size.M!, size.L!, size.XL!, size.XXL!] },
        ],
      })
    ).id;

    // Nothing exists until it is generated: creating a style is not creating stock-keeping items.
    expect((await executeQuery(actorA, templateDetail, { templateId: styleId }))!.variants).toBe(0);
    expect((await executeQuery(actorA, templateDetail, { templateId: styleId }))!.missing).toBe(15);

    const run = await executeCommand(actorA, generateVariants, { templateId: styleId });
    expect(run).toEqual({ created: 15, existing: 0, total: 15 });

    const detail = (await executeQuery(actorA, templateDetail, { templateId: styleId }))!;
    expect(detail.code).toBe("TEE-CREW");
    expect(detail.variants).toBe(15);
    expect(detail.missing).toBe(0);
    const skus = detail.variantRows.map((r) => r.sku);
    expect(skus).toContain("TEE-CREW-NVY-S");
    expect(skus).toContain("TEE-CREW-WHT-XXL");
    expect(new Set(skus).size).toBe(15);
    const navyL = detail.variantRows.find((r) => r.sku === "TEE-CREW-NVY-L")!;
    expect(navyL.name).toBe("Crew neck tee, 180 GSM - Navy / L");
    expect(navyL.values).toEqual({ [colourId]: colour.NVY, [sizeId]: size.L });

    // They are real inventory items carrying the style's classification, so the rest of the system needs nothing new.
    const items = await withTenant(tenantA, (tx) => tx.inventoryItem.findMany({ where: { templateId: styleId } }));
    expect(items).toHaveLength(15);
    for (const item of items) {
      expect(item.hsnCode).toBe("6109");
      expect(item.taxRateBp).toBe(500);
      expect(item.itemGroupId).toBe(groupId);
      expect(item.unitLabel).toBe("pcs");
    }
  });

  it("is idempotent: a second run creates nothing and changes nothing", async () => {
    const before = await withTenant(tenantA, (tx) => tx.inventoryItem.findMany({ where: { templateId: styleId }, orderBy: { sku: "asc" } }));
    const run = await executeCommand(actorA, generateVariants, { templateId: styleId });
    expect(run).toEqual({ created: 0, existing: 15, total: 15 });
    const after = await withTenant(tenantA, (tx) => tx.inventoryItem.findMany({ where: { templateId: styleId }, orderBy: { sku: "asc" } }));
    expect(after.map((i) => [i.id, i.version, i.sku])).toEqual(before.map((i) => [i.id, i.version, i.sku]));
  });

  it("adds a colourway later and generates only the new combinations", async () => {
    expect(await executeCommand(actorA, addTemplateValues, { templateId: styleId, attributeId: colourId, valueIds: [colour.MAR!, colour.NVY!] })).toEqual({ added: 1 });
    expect((await executeQuery(actorA, templateDetail, { templateId: styleId }))!.missing).toBe(5);
    // The list view reports the same coverage the detail does, without a query per style.
    const before = (await executeQuery(actorA, listTemplates, {})).find((t) => t.id === styleId)!;
    expect({ variants: before.variants, combinations: before.combinations, missing: before.missing }).toEqual({ variants: 15, combinations: 20, missing: 5 });
    expect(await executeCommand(actorA, generateVariants, { templateId: styleId })).toEqual({ created: 5, existing: 15, total: 20 });
    const after = (await executeQuery(actorA, listTemplates, {})).find((t) => t.id === styleId)!;
    expect({ variants: after.variants, combinations: after.combinations, missing: after.missing }).toEqual({ variants: 20, combinations: 20, missing: 0 });
  });

  it("skips a retired value and refuses to offer one", async () => {
    await executeCommand(actorA, setAttributeValueActive, { valueId: colour.WHT!, active: false });
    const retiredStyle = (
      await executeCommand(actorA, createTemplate, {
        code: "POLO", name: "Polo", axes: [{ attributeId: colourId, valueIds: [colour.NVY!, colour.BLK!] }],
      })
    ).id;
    await reject(
      executeCommand(actorA, createTemplate, { code: "POLO2", name: "Polo 2", axes: [{ attributeId: colourId, valueIds: [colour.WHT!] }] }),
      /retired/,
    );
    // White is retired, so the tee's existing white variants stay (history) but no new white is ever generated.
    const detail = (await executeQuery(actorA, templateDetail, { templateId: styleId }))!;
    expect(detail.variantRows.filter((r) => r.values[colourId] === colour.WHT)).toHaveLength(5);
    expect((await executeCommand(actorA, generateVariants, { templateId: retiredStyle })).created).toBe(2);
    await executeCommand(actorA, setAttributeValueActive, { valueId: colour.WHT!, active: true });
  });

  it("rejects a value from another list, a repeated list, and an unknown group", async () => {
    await reject(
      executeCommand(actorA, createTemplate, { code: "BAD1", name: "Bad", axes: [{ attributeId: colourId, valueIds: [size.S!] }] }),
      /does not belong/,
    );
    await reject(
      executeCommand(actorA, createTemplate, {
        code: "BAD2", name: "Bad",
        axes: [{ attributeId: colourId, valueIds: [colour.NVY!] }, { attributeId: colourId, valueIds: [colour.BLK!] }],
      }),
      /once per style/,
    );
    await reject(
      executeCommand(actorA, createTemplate, { code: "BAD3", name: "Bad", itemGroupId: randomUUID(), axes: [{ attributeId: colourId, valueIds: [colour.NVY!] }] }),
      /item group not found/,
    );
    await reject(executeCommand(actorA, createTemplate, { code: "TEE-CREW", name: "Dup", axes: [{ attributeId: colourId, valueIds: [colour.NVY!] }] }), /already exists/);
    await reject(
      executeCommand(actorA, createTemplate, { code: "BAD4", name: "Bad", hsnCode: "61", axes: [{ attributeId: colourId, valueIds: [colour.NVY!] }] }),
      /input rejected for verity\.inventory\.create_template/,
    );
    expect((await executeQuery(actorA, listTemplates, { includeInactive: true })).some((t) => t.code === "BAD4")).toBe(false);
  });

  it("refuses to take over an SKU that belongs to an unrelated item, and leaves nothing half-made", async () => {
    await executeCommand(actorA, createItem, { sku: "HOOD-NVY-M", name: "Legacy hoodie" });
    const hood = (
      await executeCommand(actorA, createTemplate, {
        code: "HOOD", name: "Hoodie",
        axes: [{ attributeId: colourId, valueIds: [colour.BLK!, colour.NVY!] }, { attributeId: sizeId, valueIds: [size.M!, size.L!] }],
      })
    ).id;
    // The run is all-or-nothing: the clash on one SKU rolls back the variants made before it.
    await reject(executeCommand(actorA, generateVariants, { templateId: hood }), /already belongs to another item/);
    expect((await executeQuery(actorA, templateDetail, { templateId: hood }))!.variants).toBe(0);
  });

  it("caps one run so a runaway matrix is refused, not generated", async () => {
    const big = (await executeCommand(actorA, defineAttribute, { key: "bulk", label: "Bulk", kind: "other" })).id;
    const ids: string[] = [];
    await withTenant(tenantA, async (tx) => {
      for (let i = 0; i < MAX_VARIANTS_PER_RUN + 1; i += 1) {
        const row = await tx.inventoryAttributeValue.create({
          data: { tenantId: tenantA, attributeId: big, code: `V${i}`, label: `V${i}`, sortOrder: i },
        });
        ids.push(row.id);
      }
    });
    const style = (await executeCommand(actorA, createTemplate, { code: "BIG", name: "Big", axes: [{ attributeId: big, valueIds: ids.slice(0, 2) }] })).id;
    await executeCommand(actorA, addTemplateValues, { templateId: style, attributeId: big, valueIds: ids.slice(2, MAX_VARIANTS_PER_RUN) });
    await executeCommand(actorA, addTemplateValues, { templateId: style, attributeId: big, valueIds: ids.slice(MAX_VARIANTS_PER_RUN) });
    await reject(executeCommand(actorA, generateVariants, { templateId: style }), /more than 500/);
  });

  it("archives a style without touching its variants, and refuses new work on it", async () => {
    const archived = (await executeCommand(actorA, createTemplate, { code: "OLD", name: "Old style", axes: [{ attributeId: colourId, valueIds: [colour.BLK!] }] })).id;
    await executeCommand(actorA, generateVariants, { templateId: archived });
    await executeCommand(actorA, setTemplateActive, { templateId: archived, active: false });
    await reject(executeCommand(actorA, generateVariants, { templateId: archived }), /archived/);
    await reject(executeCommand(actorA, addTemplateValues, { templateId: archived, attributeId: colourId, valueIds: [colour.NVY!] }), /archived/);
    expect((await executeQuery(actorA, listTemplates, {})).some((t) => t.code === "OLD")).toBe(false);
    const all = await executeQuery(actorA, listTemplates, { includeInactive: true });
    expect(all.find((t) => t.code === "OLD")).toMatchObject({ active: false, variants: 1 });
    const variants = await withTenant(tenantA, (tx) => tx.inventoryItem.findMany({ where: { templateId: archived } }));
    expect(variants.every((v) => v.active)).toBe(true);
  });

  it("reads on-hand per variant from the stock ledger, never a stored total", async () => {
    const detail = (await executeQuery(actorA, templateDetail, { templateId: styleId }))!;
    const target = detail.variantRows.find((r) => r.sku === "TEE-CREW-BLK-M")!;
    await executeCommand(actorA, recordStockMovement, { itemId: target.id, locationId, kind: "Receipt", qty: 120, reference: "opening" });
    await executeCommand(actorA, recordStockMovement, { itemId: target.id, locationId, kind: "Issue", qty: -20, reference: "sample" });
    const after = (await executeQuery(actorA, templateDetail, { templateId: styleId }))!;
    expect(after.variantRows.find((r) => r.sku === "TEE-CREW-BLK-M")!.onHand).toBe(100);
    expect(after.variantRows.find((r) => r.sku === "TEE-CREW-BLK-L")!.onHand).toBe(0);
  });

  it("isolates tenants: another tenant sees no list, style or variant, and cannot generate", async () => {
    expect(await executeQuery(actorB, listAttributes, {})).toEqual([]);
    expect(await executeQuery(actorB, listTemplates, { includeInactive: true })).toEqual([]);
    expect(await executeQuery(actorB, templateDetail, { templateId: styleId })).toBeNull();
    await reject(executeCommand(actorB, generateVariants, { templateId: styleId }), /not found/);
    // The same codes are free in another tenant: uniqueness is per tenant, not global.
    const own = await executeCommand(actorB, defineAttribute, { key: "colour", label: "Colour", kind: "colour" });
    expect(own.id).not.toBe(colourId);
  });

  it("holds its invariants in the database, not only in the commands", async () => {
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      // A variant is wholly specified or not a variant: a template id without a key is refused.
      await expect(
        admin.$executeRaw`INSERT INTO inventory_item (id, tenant_id, sku, name, template_id, updated_at)
                          VALUES (gen_random_uuid(), ${tenantA}::uuid, 'ORPHAN-1', 'Orphan', ${styleId}::uuid, now())`,
      ).rejects.toThrow(/inventory_item_variant_pair/);
      // GST rate is a sane percentage in basis points.
      await expect(
        admin.$executeRaw`INSERT INTO inventory_item (id, tenant_id, sku, name, tax_rate_bp, updated_at)
                          VALUES (gen_random_uuid(), ${tenantA}::uuid, 'BADTAX-1', 'Bad tax', 20000, now())`,
      ).rejects.toThrow(/inventory_item_tax_rate_range/);
      // The same combination cannot exist twice for one style, whatever the SKU says.
      await expect(
        admin.$executeRaw`INSERT INTO inventory_item (id, tenant_id, sku, name, template_id, variant_key, updated_at)
                          VALUES (gen_random_uuid(), ${tenantA}::uuid, 'TWIN-1', 'Twin', ${styleId}::uuid, 'NVY|L', now())`,
      ).rejects.toThrow(/\(template_id, variant_key\)=.*already exists/);
    } finally {
      await admin.$disconnect();
    }
  });

  it("fails closed: with no tenant scope the runtime role sees none of it", async () => {
    expect(await prisma.inventoryItemTemplate.count()).toBe(0);
    expect(await prisma.inventoryAttributeValue.count()).toBe(0);
    expect(await prisma.inventoryItemVariantValue.count()).toBe(0);
  });
});
