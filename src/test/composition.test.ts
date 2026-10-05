import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/platform/db";
import { assertRlsEnforceable, withTenant } from "@/server/platform/tenancy";
import { activateCapability, invalidateCapabilityCache } from "@/server/platform/capability";
import {
  clearContributions,
  navigationFor,
  registerContribution,
  runDueWork,
  schedulesFor,
  workspaceContributionsFor,
} from "@/server/platform/contribution";
import { clockIntentFor } from "@/server/platform/sla";
import { installCapabilities } from "@/server/capabilities/registry";

/**
 * PHASE F — future client composition tests.
 *
 * These are architectural, not business implementations. Each fixture answers
 * one question: could this capability enter the platform without the platform
 * changing? Nothing here builds Guard Patrol or Staffing; the fixtures declare
 * what such a capability *would* register and assert the platform accepts it.
 *
 * A failure here means the platform has a coupling that would force a core edit
 * for a future capability, which is precisely the condition the foundation-ready
 * definition forbids.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  const message = "composition.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

/**
 * Four hypothetical capabilities, each chosen because it stresses a different
 * part of the platform. None is implemented.
 */
const HYPOTHETICAL = [
  {
    id: "verity.capability.hypothetical_guard_patrol",
    name: "Guard Patrol",
    // Reuses: Location (sites and geofences), Evidence (checkpoint scans),
    // Scheduling (shift coverage), SLA (patrol interval), Approval (incidents).
    dependencies: ["verity.capability.location", "verity.capability.evidence", "verity.capability.scheduling"],
    entities: ["verity.hypothetical.patrol_route", "verity.hypothetical.checkpoint_scan"],
    // Owns internally: route ordering, proximity tolerance, missed-scan rules.
    lifecycle: [
      { key: "planned", category: "Draft", isInitial: true, isTerminal: false },
      { key: "in_progress", category: "Active", isInitial: false, isTerminal: false },
      { key: "suspended", category: "Blocked", isInitial: false, isTerminal: false },
      { key: "completed", category: "Completed", isInitial: false, isTerminal: true },
    ],
    nav: { href: "/patrols", label: "Patrols", shells: ["operations", "worker"] as const },
  },
  {
    id: "verity.capability.hypothetical_facilities",
    name: "Facilities Maintenance",
    dependencies: ["verity.capability.location", "verity.capability.asset", "verity.capability.approval"],
    entities: ["verity.hypothetical.maintenance_job"],
    lifecycle: [
      { key: "reported", category: "Draft", isInitial: true, isTerminal: false },
      { key: "awaiting_parts", category: "Pending", isInitial: false, isTerminal: false },
      { key: "in_progress", category: "Active", isInitial: false, isTerminal: false },
      { key: "closed", category: "Completed", isInitial: false, isTerminal: true },
    ],
    nav: { href: "/maintenance", label: "Maintenance", shells: ["operations"] as const },
  },
  {
    id: "verity.capability.hypothetical_staffing",
    name: "Staffing",
    // Depends on Scheduling for availability and conflict detection rather than
    // growing its own — ADR-008 fixed that shape so it need not be re-litigated.
    dependencies: ["verity.capability.scheduling"],
    entities: ["verity.hypothetical.shift_assignment"],
    lifecycle: [
      { key: "draft", category: "Draft", isInitial: true, isTerminal: false },
      { key: "published", category: "Active", isInitial: false, isTerminal: false },
      { key: "cancelled", category: "Cancelled", isInitial: false, isTerminal: true },
    ],
    nav: { href: "/rosters", label: "Rosters", shells: ["operations"] as const },
  },
  {
    id: "verity.capability.hypothetical_professional_services",
    name: "Professional Services",
    dependencies: ["verity.capability.approval"],
    entities: ["verity.hypothetical.engagement"],
    lifecycle: [
      { key: "proposed", category: "Draft", isInitial: true, isTerminal: false },
      { key: "delivering", category: "Active", isInitial: false, isTerminal: false },
      { key: "on_hold", category: "Pending", isInitial: false, isTerminal: false },
      { key: "delivered", category: "Completed", isInitial: false, isTerminal: true },
    ],
    nav: { href: "/engagements", label: "Engagements", shells: ["platform", "operations"] as const },
  },
] as const;

describeDb("future capability composition", () => {
  const tenantId = randomUUID();

  beforeAll(async () => {
    await assertRlsEnforceable();
    installCapabilities();

    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      for (const capability of HYPOTHETICAL) {
        await admin.capabilityDefinition.create({
          data: {
            id: capability.id,
            name: capability.name,
            version: "0.0.1",
            dependencies: [...capability.dependencies],
            entityTypes: [...capability.entities],
          },
        });
        for (const entityKey of capability.entities) {
          await admin.entityDefinition.create({
            data: { key: entityKey, capability: capability.id, class: "Persistent", tableName: entityKey.split(".").pop()! },
          });
        }
        // A lifecycle in the platform's own category vocabulary.
        for (const state of capability.lifecycle) {
          await admin.stateDefinition.create({
            data: { entityKey: capability.entities[0]!, key: state.key, category: state.category as never,
                    isInitial: state.isInitial, isTerminal: state.isTerminal },
          });
        }
      }
    } finally { await admin.$disconnect(); }

    await withTenant(tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: "Composition Tenant" } });
      // Dependencies first, exactly as a real install would have to.
      for (const capability of ["verity.capability.location", "verity.capability.asset",
                                "verity.capability.evidence", "verity.capability.scheduling",
                                "verity.capability.approval"]) {
        await activateCapability(tx, tenantId, capability);
      }
    });
    invalidateCapabilityCache();
  });

  afterEach(() => invalidateCapabilityCache());

  afterAll(async () => {
    clearContributions();
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      await admin.$executeRaw`DELETE FROM tenant WHERE id = ${tenantId}::uuid`;
      for (const capability of HYPOTHETICAL) {
        await admin.$executeRaw`DELETE FROM entity_definition WHERE capability = ${capability.id}`;
        await admin.$executeRaw`DELETE FROM capability_definition WHERE id = ${capability.id}`;
      }
    } finally { await admin.$disconnect(); }
    await prisma.$disconnect();
  });

  it.each(HYPOTHETICAL.map((c) => [c.name, c] as const))(
    "%s activates only after its declared dependencies",
    async (_name, capability) => {
      await withTenant(tenantId, (tx) => activateCapability(tx, tenantId, capability.id));
      const activation = await withTenant(tenantId, (tx) =>
        tx.tenantActivation.findFirstOrThrow({ where: { capabilityId: capability.id } }),
      );
      expect(activation.status).toBe("Active");
      // The version is pinned, so a platform upgrade cannot silently move it.
      expect(activation.pinnedVersion).toBe("0.0.1");
    },
  );

  it("refuses a capability whose dependency the tenant has not activated", async () => {
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      await admin.capabilityDefinition.create({
        data: { id: "verity.capability.hypothetical_orphan", name: "Orphan", version: "0.0.1",
                dependencies: ["verity.capability.hypothetical_never_installed"], entityTypes: [] },
      });
    } finally { await admin.$disconnect(); }

    await expect(
      withTenant(tenantId, (tx) => activateCapability(tx, tenantId, "verity.capability.hypothetical_orphan")),
    ).rejects.toThrow(/missing active dependencies/);

    const cleanup = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      await cleanup.$executeRaw`DELETE FROM capability_definition WHERE id = 'verity.capability.hypothetical_orphan'`;
    } finally { await cleanup.$disconnect(); }
  });

  it("expresses every hypothetical lifecycle in the platform's category vocabulary", async () => {
    for (const capability of HYPOTHETICAL) {
      const states = await withTenant(tenantId, (tx) =>
        tx.stateDefinition.findMany({ where: { entityKey: capability.entities[0]! } }),
      );
      expect(states.length).toBe(capability.lifecycle.length);
      // No hypothetical needed a category the platform does not have, which is
      // the evidence that ADR-009's set is behavioural rather than Work-shaped.
      for (const state of states) {
        expect(["Draft", "Pending", "Active", "Blocked", "Completed", "Cancelled"]).toContain(state.category);
      }
      // Exactly one initial state, and terminals only where meaning allows.
      expect(states.filter((s) => s.isInitial)).toHaveLength(1);
      for (const terminal of states.filter((s) => s.isTerminal)) {
        expect(["Completed", "Cancelled"]).toContain(terminal.category);
      }
    }
  });

  it("gets correct SLA behaviour from declared states without writing clock code", () => {
    for (const capability of HYPOTHETICAL) {
      for (const state of capability.lifecycle) {
        const intent = clockIntentFor(state.category as never);
        if (state.isInitial) expect(intent).toBe("idle");
        if (state.isTerminal) expect(intent).toBe("stop");
        if (state.key.includes("progress") || state.key === "published" || state.key === "delivering") {
          expect(intent).toBe("start");
        }
        if (state.key === "awaiting_parts" || state.key === "on_hold" || state.key === "suspended") {
          expect(intent).toBe("pause");
        }
      }
    }
  });

  it("contributes navigation to the right shells without touching the shell", async () => {
    clearContributions();
    for (const capability of HYPOTHETICAL) {
      registerContribution({
        capabilityId: capability.id,
        navigation: [{
          href: capability.nav.href, label: capability.nav.label,
          group: "Capabilities", requiresEntity: capability.entities[0]!,
          shells: [...capability.nav.shells],
        }],
      });
    }

    const activeIds = HYPOTHETICAL.map((c) => c.id);
    const canReadAll = () => true;

    const worker = navigationFor({ activeCapabilityIds: activeIds, shell: "worker", canRead: canReadAll });
    // Only Guard Patrol declared a worker surface.
    expect(worker.map((n) => n.label)).toEqual(["Patrols"]);

    const operations = navigationFor({ activeCapabilityIds: activeIds, shell: "operations", canRead: canReadAll });
    expect(operations.map((n) => n.label).sort()).toEqual(["Engagements", "Maintenance", "Patrols", "Rosters"]);

    // An external shell was declared by nobody, and gets nothing rather than
    // everything — absence of a declaration is not permission.
    const external = navigationFor({ activeCapabilityIds: activeIds, shell: "external", canRead: canReadAll });
    expect(external).toHaveLength(0);
  });

  it("hides a contributed surface from an actor who cannot read its entity", () => {
    const activeIds = HYPOTHETICAL.map((c) => c.id);
    const nothingReadable = navigationFor({
      activeCapabilityIds: activeIds, shell: "operations", canRead: () => false,
    });
    expect(nothingReadable).toHaveLength(0);
  });

  it("shows nothing for a capability the tenant has not activated", () => {
    const none = navigationFor({ activeCapabilityIds: [], shell: "operations", canRead: () => true });
    expect(none).toHaveLength(0);
  });

  it("contributes a workspace queue without the workspace knowing the domain", async () => {
    clearContributions();
    registerContribution({
      capabilityId: HYPOTHETICAL[0].id,
      workspace: [{
        key: "patrol.overdue", label: "Patrols overdue", href: "/patrols",
        // A real count would query the capability's own table; the platform
        // never learns what a patrol is.
        count: async () => 3,
      }],
    });
    const queues = workspaceContributionsFor({
      activeCapabilityIds: [HYPOTHETICAL[0].id], shell: "operations",
    });
    expect(queues).toHaveLength(1);
    expect(await withTenant(tenantId, (tx) => queues[0]!.count({
      tx,
      tenantId,
      roleId: null,
      userId: randomUUID(),
    }))).toBe(3);
  });

  it("composed all four without a single platform source change", async () => {
    // The substantive claim. Everything above used only the platform's public
    // registration surfaces: capability_definition, entity_definition,
    // state_definition, activation, and the contribution registry. If a
    // hypothetical had needed a new platform primitive, it could not have been
    // expressed here at all.
    const activated = await withTenant(tenantId, (tx) =>
      tx.tenantActivation.findMany({ where: { status: "Active" } }),
    );
    for (const capability of HYPOTHETICAL) {
      expect(activated.map((a) => a.capabilityId)).toContain(capability.id);
    }
  });
});

/**
 * Scheduled work is the last contribution surface a capability needs, and the
 * one the platform lacked until now: a capability could declare where it
 * appears and what queues it owns, but not that it has work which recurs.
 *
 * These assertions are architectural. The fixture is not a business capability —
 * it declares the SHAPE of recurring work and asserts the platform accepts,
 * discovers and executes it through the public contract, under tenancy, without
 * the platform knowing anything about the domain.
 */
const SCHEDULE_CAPABILITY = "verity.capability.hypothetical";
describeDb("composition: scheduled work contributes like any other surface", () => {
  const tenantId = randomUUID();

  beforeAll(async () => {
    await assertRlsEnforceable();
    // Scheduled work fails closed unless the tenant really has the capability
    // active, so the stand-in needs a definition and an activation.
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      await admin.capabilityDefinition.upsert({
        where: { id: SCHEDULE_CAPABILITY },
        create: { id: SCHEDULE_CAPABILITY, name: "Hypothetical scheduled capability", version: "0.0.1" },
        update: {},
      });
    } finally { await admin.$disconnect(); }
    await withTenant(tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: "Composition Schedule" } });
      await activateCapability(tx, tenantId, SCHEDULE_CAPABILITY);
    });
    invalidateCapabilityCache();
  });

  afterAll(async () => {
    await withTenant(tenantId, async (tx) => {
      await tx.tenant.deleteMany({ where: { id: tenantId } });
    });
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      await admin.capabilityDefinition.deleteMany({ where: { id: SCHEDULE_CAPABILITY } });
    } finally { await admin.$disconnect(); }
  });

  afterEach(() => clearContributions());

  it("discovers recurring work declared by an active capability", () => {
    registerContribution({
      capabilityId: "verity.capability.hypothetical",
      schedules: [
        { key: "recheck", label: "Recheck due records", cadence: "daily", run: async () => ({}) },
        { key: "sweep", label: "Sweep elapsed clocks", cadence: "frequent", run: async () => ({}) },
      ],
    });

    const all = schedulesFor({ activeCapabilityIds: ["verity.capability.hypothetical"] });
    expect(all).toHaveLength(2);
    expect(all.every((s) => s.capabilityId === "verity.capability.hypothetical")).toBe(true);

    // A provider asks for one cadence at a time; it must not receive the rest.
    const frequent = schedulesFor({
      activeCapabilityIds: ["verity.capability.hypothetical"],
      cadence: "frequent",
    });
    expect(frequent.map((s) => s.key)).toEqual(["sweep"]);
  });

  it("offers nothing for a capability the tenant has not activated", () => {
    registerContribution({
      capabilityId: "verity.capability.hypothetical",
      schedules: [{ key: "recheck", label: "Recheck", cadence: "daily", run: async () => ({}) }],
    });
    expect(schedulesFor({ activeCapabilityIds: [] })).toHaveLength(0);
  });

  it("executes the work inside a tenant-scoped transaction", async () => {
    let sawTenantGuc: string | null = null;

    registerContribution({
      capabilityId: "verity.capability.hypothetical",
      schedules: [
        {
          key: "observe-scope",
          label: "Observe the scope it runs in",
          cadence: "frequent",
          run: async ({ tx }) => {
            // Scheduled work must inherit tenancy exactly as a command does.
            // There is deliberately no privileged path around withTenant.
            const [row] = await tx.$queryRaw<{ t: string }[]>`
              SELECT current_setting('verity.tenant_id', true) AS t`;
            sawTenantGuc = row?.t ?? null;
            return { events: [{ name: "verity.test.scheduled" }] };
          },
        },
      ],
    });

    const outcomes = await runDueWork({
      tenantId,
      activeCapabilityIds: ["verity.capability.hypothetical"],
    });

    expect(sawTenantGuc).toBe(tenantId);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.status).toBe("ok");
    expect(outcomes[0]!.events).toBe(1);
  });

  it("isolates a failing unit so one job cannot cancel the batch", async () => {
    const ran: string[] = [];

    registerContribution({
      capabilityId: "verity.capability.hypothetical",
      schedules: [
        {
          key: "explodes",
          label: "Fails",
          cadence: "frequent",
          run: async () => {
            ran.push("explodes");
            throw new Error("provider outage");
          },
        },
        {
          key: "survives",
          label: "Succeeds",
          cadence: "frequent",
          run: async () => {
            ran.push("survives");
            return {};
          },
        },
      ],
    });

    const outcomes = await runDueWork({
      tenantId,
      activeCapabilityIds: ["verity.capability.hypothetical"],
    });

    expect(ran).toEqual(["explodes", "survives"]);
    expect(outcomes.find((o) => o.key === "explodes")?.status).toBe("failed");
    expect(outcomes.find((o) => o.key === "explodes")?.error).toContain("provider outage");
    expect(outcomes.find((o) => o.key === "survives")?.status).toBe("ok");
  });

  it("names no scheduler vendor anywhere in the contract", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile("src/server/platform/contribution.ts", "utf8");

    // Comments are stripped first. Prose explaining WHY no vendor is bound is
    // exactly what this file should contain; what it must not contain is a
    // dependency on one. The check is about code, not about the word.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .toLowerCase();

    // DECLARATION must not know about PROVIDER. A capability says "this
    // recurs"; which runtime calls it is a deployment decision, and no
    // authority names one.
    for (const vendor of ["inngest", "vercel", "temporal", "bullmq", "agenda", "quirrel", "cron"]) {
      expect(code, `contribution.ts must not depend on ${vendor}`).not.toContain(vendor);
    }
  });
});
