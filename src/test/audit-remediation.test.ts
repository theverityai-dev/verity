import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { withTenant, type TenantScopedClient } from "@/server/platform/tenancy";
import { prisma } from "@/server/platform/db";
import { executeCommand, ValidationError, type ActorContext, type CommandDefinition } from "@/server/platform/command";
import { gstr3bWorking } from "@/server/capabilities/trading/tax";
import { itcReconciliation } from "@/server/capabilities/trading/itc";
import { generateInvoiceForMeter } from "@/server/capabilities/billing";
import { generateBill } from "@/server/capabilities/dinein";
import type { CommandContext } from "@/server/platform/command";
import type { QueryContext } from "@/server/platform/query";
import { executeQuery } from "@/server/platform/query";
import { assertGrantCeiling, ForbiddenError, stripRestrictedFields } from "@/server/platform/authorization";
import { assignRole, composeRole, grantPermission } from "@/server/platform/administration";
import { customerExposuresPaise } from "@/server/capabilities/trading/orders";
import { financialYearOf, nextDocumentNumber } from "@/server/capabilities/trading/finance";
import { GSTIN } from "@/server/capabilities/trading/keys";
import { readBoundedJson } from "@/server/platform/request-limits";
import { contentSecurityPolicy } from "@/server/platform/csp";
import { toActionFailure } from "@/server/platform/action-error";
import { enqueueOfflineCommand } from "@/server/platform/sync";

const tenantId = randomUUID();
const entity = "verity.test.audit_controls";
let actor: ActorContext;
let narrow: ActorContext;
let powerfulRole: string;
const command: CommandDefinition<{ name: string; fail?: boolean }, { id: string }> = {
  key: "verity.test.audit_create_customer", entity, verb: "Create",
  input: z.object({ name: z.string(), fail: z.boolean().optional() }),
  handler: async (ctx, input) => {
    const row = await ctx.tx.tradingCustomer.create({ data: { tenantId, displayName: input.name } });
    if (input.fail) throw new ValidationError("rollback requested");
    return { result: { id: row.id } };
  },
};

describe("September audit regression controls (isolated database)", () => {
  beforeAll(async () => {
    await withTenant(tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: "Disposable audit regression", timeZone: "Asia/Kolkata" } });
      const org = await tx.organization.create({ data: { tenantId, name: "Branch" } });
      const role = await tx.role.create({ data: { tenantId, name: "Limited administrator" } });
      const branch = await tx.role.create({ data: { tenantId, name: "Branch reader" } });
      const powerful = await tx.role.create({ data: { tenantId, name: "Higher authority" } });
      powerfulRole = powerful.id;
      await tx.permission.createMany({ data: [
        { tenantId, roleId: role.id, verb: "Create", entity, scope: "Tenant" },
        { tenantId, roleId: role.id, verb: "Read", entity, scope: "Tenant" },
        { tenantId, roleId: role.id, verb: "Edit", entity: "verity.platform.role", scope: "Tenant" },
        { tenantId, roleId: role.id, verb: "Edit", entity: "verity.platform.membership", scope: "Tenant" },
        { tenantId, roleId: branch.id, verb: "Read", entity, scope: "Organization" },
        { tenantId, roleId: powerful.id, verb: "Delete", entity, scope: "Tenant" },
      ] });
      actor = { tenantId, organizationId: org.id, roleId: role.id, userId: randomUUID(), membershipId: randomUUID() };
      narrow = { ...actor, roleId: branch.id, userId: randomUUID() };
    });
  });
  afterAll(async () => {
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    await admin.tenant.delete({ where: { id: tenantId } });
    await admin.$disconnect();
    await prisma.$disconnect();
  });

  it("backfills explicit audit grants only for tenant administrators", async () => {
    const migration = readFileSync("prisma/migrations/20260907000000_audit_controls/migration.sql", "utf8");
    const grants = migration.slice(migration.indexOf("DO $$ DECLARE target_tenant_id"), migration.indexOf("-- Migration bookkeeping"));
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try { await admin.$executeRawUnsafe(grants); } finally { await admin.$disconnect(); }
    const rows = await withTenant(tenantId, (tx) => tx.permission.findMany({ where: { entity: "verity.platform.activity" } }));
    expect(rows).toEqual([expect.objectContaining({ roleId: actor.roleId, scope: "Tenant", verb: "Read" })]);
    await expect(prisma.$queryRaw`SELECT id FROM public._prisma_migrations LIMIT 1`).rejects.toThrow();
  });

  it("records real field values even when a command supplies no Activity or Event", async () => {
    const result = await executeCommand(actor, command, { name: "Recorded customer" });
    const rows = await withTenant(tenantId, (tx) => tx.activity.findMany({ where: { entityId: result.id } }));
    expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({
      fieldChanged: "display_name", oldValue: null, newValue: "Recorded customer",
      actorUserId: actor.userId, commandKey: command.key, source: "api",
    })]));
    expect(rows.every((row) => row.correlationId)).toBe(true);
  });
  it("withholds secret configuration values from automatic activity", async () => {
    const configCommand: CommandDefinition<Record<string, never>, { id: string }> = {
      key: "verity.test.write_config", entity, verb: "Create", input: z.object({}),
      handler: async (ctx) => {
        const row = await ctx.tx.configParameter.create({ data: {
          tenantId, key: "verity.test.secret", scope: "Tenant", value: "must-not-appear-in-audit",
        } });
        return { result: { id: row.id } };
      },
    };
    const result = await executeCommand(actor, configCommand, {});
    const rows = await withTenant(tenantId, (tx) => tx.activity.findMany({ where: { entityId: result.id } }));
    expect(JSON.stringify(rows)).not.toContain("must-not-appear-in-audit");
    expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ fieldChanged: "value", newValue: "[redacted]" })]));
  });

  it("rolls back both data and automatic activity", async () => {
    const before = await withTenant(tenantId, (tx) => tx.activity.count());
    await expect(executeCommand(actor, command, { name: "Never committed", fail: true })).rejects.toBeInstanceOf(ValidationError);
    expect(await withTenant(tenantId, (tx) => tx.activity.count())).toBe(before);
    expect(await withTenant(tenantId, (tx) => tx.tradingCustomer.count({ where: { displayName: "Never committed" } }))).toBe(0);
  });
  it("denies narrow grants on unanchored queries before reading, and retains the refusal", async () => {
    const handler = vi.fn(async () => [{ secret: "hidden" }]);
    await expect(executeQuery(narrow, { key: "verity.test.narrow", entity, input: z.object({}), handler }, {})).rejects.toBeInstanceOf(ForbiddenError);
    expect(handler).not.toHaveBeenCalled();
    expect(await withTenant(tenantId, (tx) => tx.securityAuditEvent.count({ where: { eventType: "AuthorizationDenied" } }))).toBeGreaterThan(0);
  });
  it("blocks role assignment, permission grants and composition above the actor's ceiling", async () => {
    await expect(executeCommand(actor, assignRole, { membershipId: randomUUID(), roleId: powerfulRole })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(executeCommand(actor, grantPermission, { roleId: actor.roleId, verb: "Delete", entity, scope: "Tenant" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(executeCommand(actor, composeRole, { parentRoleId: actor.roleId, childRoleId: powerfulRole, attach: true })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(executeCommand(actor, assignRole, { membershipId: actor.membershipId, roleId: actor.roleId })).rejects.toBeInstanceOf(ValidationError);
  });
  it("does not let a branch grant be relocated through a shared role", async () => {
    await expect(withTenant(tenantId, (tx) => assertGrantCeiling(tx, narrow, [{ entity, verb: "Read", scope: "Organization" }]))).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("allocates concurrent first-in-year document numbers without a unique violation", async () => {
    const results = await Promise.all([1, 2].map(() => withTenant(tenantId, (tx) => nextDocumentNumber(tx, tenantId, "AUDIT", "2026-27"))));
    expect(results.map((r) => r.sequenceNumber).sort()).toEqual([1, 2]);
  });
  it("accepts exactly one simultaneous offline enqueue and surfaces database failures", async () => {
    const args = { tenantId, commandId: randomUUID(), commandKey: command.key, actorUserId: actor.userId, payload: {}, deviceTimestamp: new Date() };
    const results = await Promise.all([1, 2].map(() => withTenant(tenantId, (tx) => enqueueOfflineCommand(tx, args))));
    expect(results.filter((r) => r.accepted)).toHaveLength(1);
    expect(results[0].duplicateOf).toBe(results[1].duplicateOf);
    const offlineCommand = { findUnique: vi.fn().mockResolvedValue(null), createMany: vi.fn().mockRejectedValue(new Error("connection lost")) };
    await expect(enqueueOfflineCommand({ offlineCommand } as unknown as TenantScopedClient, args)).rejects.toThrow("connection lost");
  });
});

describe("audit pure regressions", () => {
  it("uses a bounded number of reads and allocations, with per-invoice clamping", async () => {
    const customers = Array.from({ length: 250 }, (_, i) => `customer-${i}`);
    const invoiceRead = vi.fn().mockResolvedValueOnce([
      { customerId: customers[0], totalPaise: 1000, allocations: [{ amountPaise: 800 }], notes: [{ noteType: "credit", totalPaise: 100 }] },
      { customerId: customers[0], totalPaise: 1000, allocations: [{ amountPaise: 2000 }], notes: [] },
    ]).mockResolvedValueOnce([{ salesOrderId: "order", totalPaise: 1000 }]);
    const orderRead = vi.fn().mockResolvedValue([{ id: "order", customerId: customers[0], totalPricePaise: 1500 }]);
    const result = await customerExposuresPaise({ tradingInvoice: { findMany: invoiceRead }, tradingSalesOrder: { findMany: orderRead } } as unknown as TenantScopedClient, customers);
    expect(result.get(customers[0])).toBe(600);
    expect(result.get(customers[1])).toBe(0);
    expect(invoiceRead).toHaveBeenCalledTimes(2);
    expect(orderRead).toHaveBeenCalledTimes(1);
    expect(invoiceRead.mock.calls[0][0].select.allocations).toBeDefined();
  });
  it("changes document year at midnight in the tenant zone", () => {
    expect(financialYearOf(new Date("2026-03-31T18:29:59Z"), "Asia/Kolkata")).toBe("2025-26");
    expect(financialYearOf(new Date("2026-03-31T18:30:00Z"), "Asia/Kolkata")).toBe("2026-27");
    expect(financialYearOf(new Date("2026-04-01T00:00:00Z"), "America/New_York")).toBe("2025-26");
  });
  it("validates GSTIN check digits and state codes", () => {
    expect(GSTIN.safeParse("27AAPFU0939F1ZV").success).toBe(true);
    expect(GSTIN.safeParse("27AAPFU0939F1ZA").success).toBe(false);
    expect(GSTIN.safeParse("00AAPFU0939F1ZV").success).toBe(false);
  });
  it("redacts nested object and list fields without destroying dates", () => {
    const at = new Date();
    expect(stripRestrictedFields({ detail: { cost: 10, at }, rows: [{ cost: 3, name: "ok" }] }, new Set(["cost"])))
      .toEqual({ detail: { at }, rows: [{ name: "ok" }] });
  });
  it("never sends an unknown database error message to a browser", () => {
    expect(toActionFailure(new Error("Prisma SELECT secret FROM customer"))).toMatchObject({ code: "E_UNKNOWN" });
    expect(toActionFailure(new Error("Prisma SELECT secret FROM customer")).message).not.toContain("Prisma");
  });
  it("rejects chunked oversized bodies even without Content-Length", async () => {
    const request = new Request("https://example.test", { method: "POST", body: "x".repeat(101) });
    await expect(readBoundedJson(request, 100)).rejects.toThrow("body too large");
  });
  it("sets an enforcing nonce CSP and confines eval to development", () => {
    expect(contentSecurityPolicy("nonce", false)).toContain("'nonce-nonce' 'strict-dynamic'");
    expect(contentSecurityPolicy("nonce", false)).not.toContain("unsafe-eval");
    expect(contentSecurityPolicy("nonce", true)).toContain("unsafe-eval");
  });
});


describe("financial evidence requirements", () => {
  const context = (tx: unknown) => ({ tx, actor: { organizationId: randomUUID(), tenantId: randomUUID() } }) as QueryContext & CommandContext;
  it("keeps provisional ITC in books but excludes it from eligible credit and cash payable", async () => {
    const base = { notes: [], taxablePaise: 1000, cgstPaise: 90, sgstPaise: 90, igstPaise: 0, supplierId: "supplier", customerId: null, confirmation: null };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ effective_time_zone: "Asia/Kolkata" }]),
      tradingGstRegistration: { findFirst: vi.fn().mockResolvedValue(null) },
      tradingInvoice: { findMany: vi.fn().mockResolvedValue([
        { ...base, confirmation: { id: "supplier-bill" } }, base,
        { ...base, supplierId: null, customerId: "customer", customer: { stateCode: "07" }, cgstPaise: 300, sgstPaise: 300 },
      ]) },
    };
    const result = await gstr3bWorking.handler(context(tx), {});
    expect(result.inward).toMatchObject({ booksItcPaise: 360, eligibleItcPaise: 180, unsubstantiatedItcPaise: 180, unsubstantiatedCount: 1 });
    expect(result.netCashRequiredPaise).toBe(420);
    expect(result.ready).toBe(false);
    expect(tx.tradingInvoice.findMany.mock.calls[0][0].include.confirmation).toBe(true);
  });
  it("filters provisional bills before matching the purchase register to the portal", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await itcReconciliation.handler(context({
      $queryRaw: vi.fn().mockResolvedValue([{ effective_time_zone: "Asia/Kolkata" }]),
      tradingInvoice: { findMany }, tradingGstPortalRecord: { findMany: vi.fn().mockResolvedValue([]) },
    }), { periodKey: "2026-09" });
    expect(findMany.mock.calls[0][0].where.confirmation).toEqual({ isNot: null });
  });
  it("refuses absent meter readings but accepts an explicit zero reading", async () => {
    const create = vi.fn().mockResolvedValue({ id: "invoice" });
    const aggregate = vi.fn().mockResolvedValue({ _sum: { readingUnits: null } });
    const ctx = context({
      billingMeter: { findUniqueOrThrow: vi.fn().mockResolvedValue({ ratePerUnitMinor: 10 }) },
      billingPeriod: { findUniqueOrThrow: vi.fn().mockResolvedValue({ periodStart: new Date(), periodEnd: new Date() }) },
      billingMeterReading: { aggregate }, billingInvoice: { create },
    });
    const input = { meterId: randomUUID(), billingPeriodId: randomUUID() };
    await expect(generateInvoiceForMeter.handler(ctx, input)).rejects.toBeInstanceOf(ValidationError);
    expect(create).not.toHaveBeenCalled();
    aggregate.mockResolvedValue({ _sum: { readingUnits: 0 } });
    expect((await generateInvoiceForMeter.handler(ctx, input)).result.amountMinor).toBe(0);
  });
  it("refuses dine-in billing before any bill is stored if rates are missing", async () => {
    const create = vi.fn();
    // An outlet with no profile bills as it always has, which is the path this test is about.
    const ctx = context({ orderLine: { findMany: vi.fn().mockResolvedValue([]) },
      diningOrder: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "o", locationId: "l", channel: "dine_in", state: "served" }) },
      outletProfile: { findFirst: vi.fn().mockResolvedValue(null) },
      configParameter: { findFirst: vi.fn().mockResolvedValue(null) }, bill: { create } });
    await expect(generateBill.handler(ctx, { orderId: randomUUID() })).rejects.toBeInstanceOf(ValidationError);
    expect(create).not.toHaveBeenCalled();
  });
});
