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
import { clearContributions, contributionFor } from "@/server/platform/contribution";
import { clearExportables } from "@/server/platform/data-export";
import { provisionIdentity } from "@/server/platform/identity";
import { registerProjectCapability, openJobFromOpportunity, jobForOpportunity } from "@/server/capabilities/project";
import {
  ENTITY_CUSTOM_FIELD,
  defineCustomField,
  listCustomFields,
  retireCustomField,
  ENTITY_SAVED_VIEW,
  buildOrderBy,
  buildWhere,
  clearRecordObjects,
  deleteView,
  listViews,
  registerViewCommands,
  saveView,
  validateViewConfig,
  viewConfigSchema,
} from "@/server/platform/views";
import {
  COMPANY_OBJECT,
  ENTITY_COMPANY,
  ENTITY_FOLLOW_UP,
  ENTITY_INTERACTION,
  ENTITY_NOTE,
  ENTITY_OPPORTUNITY,
  ENTITY_PERSON,
  ENTITY_STAGE,
  OPPORTUNITY_OBJECT,
  PERSON_OBJECT,
  RELATIONSHIP_CAPABILITY,
  addFollowUp,
  addNote,
  archiveCompanies,
  completeFollowUp,
  companyDetail,
  createCompany,
  createOpportunity,
  createPerson,
  describeObject,
  emailDomain,
  importRecords,
  listCompanies,
  listFollowUps,
  listOpportunities,
  listPeople,
  listStages,
  logInteraction,
  moveOpportunity,
  normaliseDomain,
  opportunityDetail,
  pipelineSummary,
  registerRelationshipCapability,
  restoreCompanies,
  saveStage,
  searchRecords,
  setupPipeline,
  timeline,
  updateCompany,
  updateOpportunity,
  updatePerson,
  bulkUpdateOpportunities,
  findDuplicates,
  mergeCompanies,
  mergePeople,
  pipelineInsights,
  setStagePlaybook,
} from "@/server/capabilities/relationship";

/**
 * Task 128 (CRM, ADR-050) and ADR-051 (saved views): the view layer's filter translation, then the capability
 * against the real database — records, pipeline rules, timeline, follow-up reminders, import, views and isolation.
 */

describe("views: filters and sorts become Prisma where and orderBy", () => {
  it("translates each operator for its field type, and combines with all or any", () => {
    const where = buildWhere(
      OPPORTUNITY_OBJECT,
      {
        filters: [
          { field: "name", op: "contains", value: "transformer" },
          { field: "amount", op: "gte", value: 100000 },
          { field: "owner", op: "is_me" },
          { field: "source", op: "is_any_of", value: ["tender", "rfq"] },
          { field: "expectedCloseOn", op: "is_empty" },
        ],
        match: "all",
        search: "acme",
      },
      { userId: "u-1" },
    );
    expect(where).toEqual({
      AND: [
        {
          AND: [
            { name: { contains: "transformer", mode: "insensitive" } },
            { amount: { gte: 100000 } },
            { ownerUserId: "u-1" },
            { source: { in: ["tender", "rfq"] } },
            { expectedCloseOn: null },
          ],
        },
        { OR: [{ name: { contains: "acme", mode: "insensitive" } }, { company: { name: { contains: "acme", mode: "insensitive" } } }] },
      ],
    });
    expect(buildWhere(PERSON_OBJECT, { filters: [{ field: "emails", op: "contains", value: "a@b.in" }], match: "any" }, { userId: "u" })).toEqual({
      AND: [{ OR: [{ emails: { has: "a@b.in" } }] }],
    });
  });

  it("sorts a relation by the related record's name, with a stable tiebreak", () => {
    expect(buildOrderBy(PERSON_OBJECT, [{ field: "company", dir: "desc" }])).toEqual([{ company: { name: "desc" } }, { id: "asc" }]);
    expect(buildOrderBy(COMPANY_OBJECT, [])).toEqual([{ name: "asc" }, { id: "asc" }]);
  });

  it("refuses a view that names a field, operator or total the object does not support", () => {
    const parse = (c: unknown) => viewConfigSchema.parse(c);
    expect(() => validateViewConfig(COMPANY_OBJECT, parse({ columns: [{ key: "nope" }] }), "table")).toThrow(/no field "nope"/);
    expect(() => validateViewConfig(COMPANY_OBJECT, parse({ filters: [{ field: "name", op: "gt", value: 1 }] }), "table")).toThrow(/cannot be filtered/);
    expect(() => validateViewConfig(COMPANY_OBJECT, parse({ filters: [{ field: "people", op: "eq", value: 1 }] }), "table")).toThrow(/cannot be filtered/);
    expect(() => validateViewConfig(COMPANY_OBJECT, parse({ aggregates: { name: "sum" } }), "table")).toThrow(/cannot be totalled/);
    expect(() => validateViewConfig(COMPANY_OBJECT, parse({}), "board")).toThrow(/no field to group a board/);
    expect(validateViewConfig(OPPORTUNITY_OBJECT, parse({ aggregates: { amount: "sum" }, groupBy: "stage" }), "board").groupBy).toBe("stage");
  });

  it("normalises domains and finds the company domain of a work email", () => {
    expect(normaliseDomain("https://www.Acme.in/about")).toBe("acme.in");
    expect(normaliseDomain("not a domain")).toBeNull();
    expect(emailDomain("ravi@bhel.co.in")).toBe("bhel.co.in");
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;
if (!hasDatabase) {
  const message = "capability-relationship.test.ts cannot run its database tests: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describeDb("capability: Relationship (CRM)", () => {
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const created = { users: [] as string[], parties: [] as string[] };
  let seller: ActorContext;
  let manager: ActorContext;
  let viewer: ActorContext;
  let outsider: ActorContext;

  const ALL = [ENTITY_COMPANY, ENTITY_PERSON, ENTITY_OPPORTUNITY, ENTITY_STAGE, ENTITY_NOTE, ENTITY_INTERACTION, ENTITY_FOLLOW_UP];

  beforeAll(async () => {
    await assertRlsEnforceable();
    clearCommands();
    clearQueries();
    clearHooks();
    clearScopeResolvers();
    clearTransitionGuards();
    clearContributions();
    clearExportables();
    clearRecordObjects();
    registerViewCommands();
    registerRelationshipCapability();
    registerProjectCapability();

    const setUp = async (id: string, name: string, people: Array<{ name: string; role: "seller" | "manager" | "viewer" }>) =>
      withTenant(id, async (tx) => {
        await tx.tenant.create({ data: { id, name, timeZone: "Asia/Kolkata" } });
        await activateCapability(tx, id, RELATIONSHIP_CAPABILITY);
        // Jobs, for opening a job from a won deal, with the capabilities it requires.
        for (const key of ["verity.capability.trading", "verity.capability.location", "verity.capability.inventory", "verity.capability.manufacturing", "verity.capability.project"]) {
          await activateCapability(tx, id, key);
        }
        const organizationId = (await tx.organization.create({ data: { tenantId: id, name } })).id;
        const grant = async (roleId: string, entities: string[], verbs: Array<"Read" | "Create" | "Edit">) =>
          tx.permission.createMany({ data: entities.flatMap((entity) => verbs.map((verb) => ({ tenantId: id, roleId, verb, entity, scope: "Tenant" as const }))) });
        const roles = {
          seller: (await tx.role.create({ data: { tenantId: id, name: "Seller" } })).id,
          manager: (await tx.role.create({ data: { tenantId: id, name: "Sales manager" } })).id,
          viewer: (await tx.role.create({ data: { tenantId: id, name: "Viewer" } })).id,
        };
        await grant(roles.seller, ALL, ["Read", "Create", "Edit"]);
        await grant(roles.seller, [ENTITY_SAVED_VIEW], ["Read", "Create"]);
        await grant(roles.manager, ALL, ["Read", "Create", "Edit"]);
        await grant(roles.manager, [ENTITY_SAVED_VIEW], ["Read", "Create", "Edit"]);
        await grant(roles.manager, [ENTITY_CUSTOM_FIELD], ["Edit"]);
        await grant(roles.seller, ["verity.project.job"], ["Read", "Create"]);
        await grant(roles.viewer, ALL, ["Read"]);
        const out: ActorContext[] = [];
        for (const p of people) {
          const identity = await provisionIdentity(tx, { organizationId, authUserId: randomUUID(), displayName: p.name });
          created.users.push(identity.userId);
          created.parties.push(identity.partyId);
          await tx.tenantMembership.update({ where: { id: identity.membershipId }, data: { roleId: roles[p.role] } });
          out.push({ tenantId: id, userId: identity.userId, membershipId: identity.membershipId, organizationId, roleId: roles[p.role] });
        }
        return out;
      });

    [seller, manager, viewer] = await setUp(tenantId, "Electric Works", [
      { name: "Sana Seller", role: "seller" },
      { name: "Manoj Manager", role: "manager" },
      { name: "Vinay Viewer", role: "viewer" },
    ]);
    [outsider] = await setUp(otherTenantId, "Other Works", [{ name: "Otto Outsider", role: "manager" }]);
    invalidateCapabilityCache();
  });

  afterAll(async () => {
    clearCommands();
    clearQueries();
    clearHooks();
    clearScopeResolvers();
    clearTransitionGuards();
    clearContributions();
    clearExportables();
    clearRecordObjects();
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      await admin.$executeRaw`DELETE FROM tenant WHERE id IN (${tenantId}::uuid, ${otherTenantId}::uuid)`;
      for (const id of created.users) await admin.$executeRaw`DELETE FROM "user" WHERE id = ${id}::uuid`;
      for (const id of created.parties) await admin.$executeRaw`DELETE FROM party WHERE id = ${id}::uuid`;
    } finally {
      await admin.$disconnect();
    }
    await prisma.$disconnect();
  });

  let bhel: string;
  let ravi: string;
  let stages: Array<{ id: string; key: string; label: string; category: string }>;

  it("creates the default pipeline once, in order, each stage in a closed category", async () => {
    await executeCommand(seller, setupPipeline, {});
    await executeCommand(seller, setupPipeline, {});
    stages = await executeQuery(seller, listStages, {});
    expect(stages.map((s) => s.key)).toEqual(["enquiry", "qualified", "quote", "negotiation", "won", "lost"]);
    expect(stages.map((s) => s.category)).toEqual(["Active", "Active", "Active", "Active", "Completed", "Cancelled"]);
  });

  it("adds a company, refuses an obvious duplicate, and matches a person to it by work email", async () => {
    bhel = (await executeCommand(seller, createCompany, { name: "Bharat Heavy Electricals", domain: "https://www.bhel.co.in", city: "Bhopal" })).id;
    const person = await executeCommand(seller, createPerson, { givenName: "Ravi", familyName: "Kumar", emails: ["Ravi@BHEL.co.in", "ravi.k@gmail.com"], jobTitle: "Purchase head" });
    ravi = person.id;
    expect(person.companyId).toBe(bhel);

    await expect(executeCommand(seller, createCompany, { name: "bharat heavy electricals" })).rejects.toThrow(/already exists/);
    await expect(executeCommand(seller, createCompany, { name: "BHEL Bhopal", domain: "bhel.co.in" })).rejects.toThrow(/already exists/);
    expect((await executeCommand(seller, createCompany, { name: "BHEL Bhopal", domain: "bhel.co.in", allowDuplicate: true })).id).toBeTruthy();
    await expect(executeCommand(seller, createPerson, { givenName: "R", emails: ["ravi@bhel.co.in"] })).rejects.toThrow(/already has ravi@bhel.co.in/);
    const free = await executeCommand(seller, createPerson, { givenName: "Gita", emails: "gita@gmail.com, gita@yahoo.com" });
    expect(free.companyId).toBeNull();
  });

  it("refuses an edit made from a stale copy, and logs readable changes", async () => {
    const before = (await executeQuery(seller, listCompanies, { search: "Bharat" })).rows[0]!;
    await executeCommand(seller, updateCompany, { id: bhel, version: before.version as number, patch: { industry: "Power", owner: manager.userId } });
    await expect(executeCommand(seller, updateCompany, { id: bhel, version: before.version as number, patch: { city: "Delhi" } })).rejects.toThrow(/changed by someone else/);
    const changes = await withTenant(tenantId, (tx) => tx.activity.findMany({ where: { entityId: bhel, fieldChanged: "owner" } }));
    expect(changes[0]?.newValue).toBe("Manoj Manager");
    await expect(executeCommand(seller, updateCompany, { id: bhel, patch: { owner: outsider.userId } })).rejects.toThrow(/not a member/);
  });

  let deal: string;

  it("opens an opportunity in the first stage, numbered per tenant, its company taken from the contact", async () => {
    const opp = await executeCommand(seller, createOpportunity, { name: "Cast resin transformer 2 MVA", contact: ravi, amount: "18,50,000", source: "tender", expectedCloseOn: "2026-12-15" });
    deal = opp.id;
    expect(opp.number).toBe(1);
    const row = (await executeQuery(seller, listOpportunities, {})).rows[0]!;
    expect(row).toMatchObject({ ref: "OPP-1", stageLabel: "Enquiry", amount: 1850000, company: { id: bhel }, contact: { id: ravi }, owner: { id: seller.userId } });
  });

  it("needs a reason to lose a deal, closes it when won or lost, and reopens it when moved back", async () => {
    const lost = stages.find((s) => s.key === "lost")!;
    const won = stages.find((s) => s.key === "won")!;
    const quote = stages.find((s) => s.key === "quote")!;
    await expect(executeCommand(seller, moveOpportunity, { id: deal, stageId: lost.id, position: 1 })).rejects.toThrow(/say why it was lost/);

    await executeCommand(seller, moveOpportunity, { id: deal, stageId: quote.id, position: 5 });
    let detail = (await executeQuery(seller, opportunityDetail, { id: deal }))!;
    expect(detail).toMatchObject({ stageLabel: "Technical quote", closedAt: null, position: 5 });

    await executeCommand(seller, moveOpportunity, { id: deal, stageId: lost.id, position: 1, lostReason: "price", lostNote: "Undercut by 8%" });
    detail = (await executeQuery(seller, opportunityDetail, { id: deal }))!;
    expect(detail).toMatchObject({ stageCategory: "Cancelled", lostReason: "price", lostNote: "Undercut by 8%" });
    expect(detail.closedAt).toBeTruthy();
    await expect(executeCommand(seller, updateOpportunity, { id: deal, patch: { lostReason: null } })).rejects.toThrow(/keeps its reason/);

    await executeCommand(seller, updateOpportunity, { id: deal, patch: { stage: won.id } });
    detail = (await executeQuery(seller, opportunityDetail, { id: deal }))!;
    expect(detail).toMatchObject({ stageCategory: "Completed", lostReason: null, lostNote: null });

    await executeCommand(seller, updateOpportunity, { id: deal, patch: { stage: quote.id } });
    detail = (await executeQuery(seller, opportunityDetail, { id: deal }))!;
    expect(detail.closedAt).toBeNull();
    expect((detail.stageHistory as Array<{ label: string }>).map((h) => h.label)).toEqual(["Enquiry", "Technical quote", "Lost", "Won", "Technical quote"]);
  });

  it("refuses a lost reason on an open deal and retiring a stage that still holds deals", async () => {
    await expect(executeCommand(seller, updateOpportunity, { id: deal, patch: { lostReason: "price" } })).rejects.toThrow(/belongs only to a lost/);
    const quote = stages.find((s) => s.key === "quote")!;
    await expect(executeCommand(seller, saveStage, { id: quote.id, label: "Quote", category: "Active", probability: 50, active: false })).rejects.toThrow(/move them first/);
    await expect(executeCommand(seller, saveStage, { id: quote.id, label: "Quote", category: "Completed", probability: 50 })).rejects.toThrow(/cannot change/);
    await executeCommand(seller, saveStage, { label: "Site survey", category: "Active", probability: 30 });
    expect((await executeQuery(seller, listStages, {})).map((s) => s.key)).toContain("site_survey");
  });

  it("puts notes, interactions, follow-ups and field changes on one timeline, and the company sees its deals' history", async () => {
    await executeCommand(seller, addNote, { opportunityId: deal, body: "Customer wants IEC 60076-11 test reports with the bid." });
    await executeCommand(seller, logInteraction, {
      personId: ravi, kind: "call", subject: "Clarified insulation class", outcome: "Class F confirmed", durationMinutes: 12,
      nextStep: { title: "Send revised quote", dueAt: new Date(Date.now() - 3_600_000).toISOString() },
    });
    await expect(
      executeCommand(seller, logInteraction, { companyId: bhel, kind: "meeting", subject: "Future", occurredAt: new Date(Date.now() + 86_400_000).toISOString() }),
    ).rejects.toThrow(/already happened/);

    const onDeal = await executeQuery(seller, timeline, { kind: "opportunity", id: deal });
    expect(onDeal.map((e) => e.kind)).toEqual(expect.arrayContaining(["note", "created", "change"]));
    const onCompany = await executeQuery(seller, timeline, { kind: "company", id: bhel });
    const kinds = new Set(onCompany.map((e) => e.kind));
    for (const k of ["note", "interaction", "follow_up", "change", "created"]) expect(kinds).toContain(k);
    const stageChange = onCompany.find((e) => e.kind === "change" && (e.meta.changes as Array<{ field: string }>).some((c) => c.field === "stage"));
    expect(stageChange?.on[0]?.label).toMatch(/^OPP-1 /);
  });

  it("keeps a logged interaction as it was: never rewritten, never deleted by the application role", async () => {
    const id = (await withTenant(tenantId, (tx) => tx.relationshipInteraction.findFirstOrThrow({ where: { personId: ravi } }))).id;
    await expect(withTenant(tenantId, (tx) => tx.relationshipInteraction.update({ where: { id }, data: { subject: "Edited" } }))).rejects.toThrow(/not rewritten/);
    await expect(withTenant(tenantId, (tx) => tx.relationshipInteraction.delete({ where: { id } }))).rejects.toThrow(/never deleted/);
  });

  it("lists my overdue follow-ups, reminds once a day, and a done follow-up leaves the list", async () => {
    const mine = await executeQuery(seller, listFollowUps, { scope: "mine", due: "overdue" });
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ title: "Send revised quote", overdue: true });

    const schedule = contributionFor(RELATIONSHIP_CAPABILITY)!.schedules![0]!;
    const first = await withTenant(tenantId, (tx) => schedule.run({ tx, tenantId, now: new Date() }));
    const again = await withTenant(tenantId, (tx) => schedule.run({ tx, tenantId, now: new Date() }));
    expect(first.events).toHaveLength(1);
    expect(again.events).toHaveLength(0);
    const notes = await withTenant(tenantId, (tx) => tx.notification.findMany({ where: { recipientId: seller.userId, key: "verity.relationship.follow_up_due" } }));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.subject).toMatch(/^Overdue follow-up: Send revised quote/);

    await executeCommand(seller, completeFollowUp, { id: mine[0]!.id });
    expect(await executeQuery(seller, listFollowUps, { scope: "mine" })).toHaveLength(0);
    const later = await executeCommand(seller, addFollowUp, { companyId: bhel, title: "Visit the plant", assigneeId: manager.userId });
    expect((await executeQuery(manager, listFollowUps, { scope: "mine" })).map((f) => f.id)).toEqual([later.id]);
  });

  it("filters, sorts and totals the list through a view, over the whole set", async () => {
    await executeCommand(seller, createOpportunity, { name: "Lifting magnet", company: bhel, amount: 250000 });
    await executeCommand(seller, createOpportunity, { name: "Control panel retrofit", amount: 75000, owner: manager.userId });
    const result = await executeQuery(seller, listOpportunities, {
      filters: [{ field: "amount", op: "gte", value: 100000 }],
      sorts: [{ field: "amount", dir: "desc" }],
      aggregates: { amount: "sum", name: "count" },
      limit: 1,
    });
    expect(result.total).toBe(2);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.name).toBe("Cast resin transformer 2 MVA");
    expect(result.aggregates).toEqual({ amount: 2100000, name: 2 });
    const managerOwned = await executeQuery(manager, listOpportunities, { filters: [{ field: "owner", op: "is_me" }] });
    expect(managerOwned.rows.map((r) => r.name)).toEqual(["Control panel retrofit"]);
    const people = await executeQuery(seller, listPeople, { filters: [{ field: "company", op: "is_any_of", value: [bhel] }] });
    expect(people.rows.map((r) => r.name)).toEqual(["Ravi Kumar"]);
  });

  it("summarises the pipeline and shows a company's open and won value", async () => {
    const summary = await executeQuery(seller, pipelineSummary, {});
    expect(summary.openCount).toBe(3);
    expect(summary.openValue).toBe(1850000 + 250000 + 75000);
    expect(summary.weightedValue).toBe(Math.round(1850000 * 0.5 + 250000 * 0.1 + 75000 * 0.1));
    expect(summary.followUpsMine).toBe(0);
    const company = (await executeQuery(seller, companyDetail, { id: bhel }))!;
    expect(company.stats).toMatchObject({ openCount: 2, openValue: 2100000, openFollowUps: 1 });
  });

  it("changes many at once, archives and restores, and searches by name, email and reference", async () => {
    const all = (await executeQuery(seller, listOpportunities, {})).rows.map((r) => r.id as string);
    await executeCommand(seller, bulkUpdateOpportunities, { ids: all, patch: { owner: manager.userId } });
    expect((await executeQuery(manager, listOpportunities, { filters: [{ field: "owner", op: "is_me" }] })).total).toBe(3);

    await executeCommand(seller, archiveCompanies, { ids: [bhel] });
    expect((await executeQuery(seller, listCompanies, { search: "Bharat" })).total).toBe(0);
    expect((await executeQuery(seller, listCompanies, { search: "Bharat", includeArchived: true })).total).toBe(1);
    await executeCommand(seller, restoreCompanies, { ids: [bhel] });

    const hits = await executeQuery(seller, searchRecords, { term: "opp-1" });
    expect(hits.map((h) => h.kind)).toContain("opportunity");
    expect((await executeQuery(seller, searchRecords, { term: "ravi@bhel.co.in" })).map((h) => h.label)).toContain("Ravi Kumar");
  });

  it("imports people with a dry run first, skipping duplicates and naming bad rows", async () => {
    const rows = [
      { givenName: "Asha", familyName: "Rao", email: "asha@bhel.co.in", jobTitle: "Engineer" },
      { givenName: "Ravi", email: "ravi@bhel.co.in" },
      { givenName: "", email: "x@y.in" },
      { givenName: "Bad", email: "not-an-email" },
      { givenName: "Kiran", company: "Nobody Ltd" },
    ];
    const dry = await executeCommand(seller, importRecords, { object: "person", rows, dryRun: true });
    expect(dry.results.map((r) => r.status)).toEqual(["would_create", "duplicate", "error", "error", "error"]);
    expect(dry.created).toBe(0);
    expect((await executeQuery(seller, listPeople, { search: "Asha" })).total).toBe(0);
    const real = await executeCommand(seller, importRecords, { object: "person", rows, dryRun: false });
    expect(real.created).toBe(1);
    // Two companies share bhel.co.in (the duplicate saved on purpose above), so the email names neither.
    const asha = (await executeQuery(seller, listPeople, { search: "Asha" })).rows[0]!;
    expect(asha.company).toBeNull();
    const named = await executeCommand(seller, importRecords, { object: "person", rows: [{ givenName: "Dev", company: "Bharat Heavy Electricals" }], dryRun: false });
    expect(named.created).toBe(1);
    expect((await executeQuery(seller, listPeople, { search: "Dev" })).rows[0]!.company).toMatchObject({ id: bhel });
  });

  it("keeps personal views to their owner and shared views to people who may share", async () => {
    const config = { columns: [{ key: "name" }, { key: "amount" }], filters: [{ field: "source", op: "is_any_of" as const, value: ["tender"] }] };
    const mine = await executeCommand(seller, saveView, { objectKey: ENTITY_OPPORTUNITY, name: "My tenders", type: "table", visibility: "personal", isDefault: true, config });
    await expect(executeCommand(seller, saveView, { objectKey: ENTITY_OPPORTUNITY, name: "Team tenders", type: "table", visibility: "shared", config })).rejects.toThrow(/sharing a view/);
    const team = await executeCommand(manager, saveView, { objectKey: ENTITY_OPPORTUNITY, name: "Team board", type: "board", visibility: "shared", config: { groupBy: "stage" } });
    await expect(executeCommand(seller, saveView, { objectKey: ENTITY_OPPORTUNITY, name: "Bad", type: "table", visibility: "personal", config: { columns: [{ key: "secret" }] } })).rejects.toThrow(/no field "secret"/);

    const sellerViews = await executeQuery(seller, listViews, { objectKey: ENTITY_OPPORTUNITY });
    expect(sellerViews.map((v) => v.name)).toEqual(["All opportunities", "Board", "My tenders", "Team board"]);
    const managerViews = await executeQuery(manager, listViews, { objectKey: ENTITY_OPPORTUNITY });
    expect(managerViews.map((v) => v.name)).not.toContain("My tenders");

    await expect(executeCommand(manager, deleteView, { id: mine.id })).rejects.toThrow(/someone else's personal view/);
    await expect(executeCommand(seller, deleteView, { id: team.id })).rejects.toThrow(/deleting a shared view/);
    await executeCommand(seller, deleteView, { id: mine.id });
  });

  it("describes an object with the tenant's stages, members and what this person may do", async () => {
    const forSeller = await executeQuery(seller, describeObject, { objectKey: ENTITY_OPPORTUNITY });
    expect(forSeller.fields.find((f) => f.key === "stage")!.options!.map((o) => o.label)).toContain("Technical quote");
    expect(forSeller.members.map((m) => m.label)).toEqual(expect.arrayContaining(["Sana Seller", "Manoj Manager"]));
    expect(forSeller).toMatchObject({ canCreate: true, canEdit: true, canShareViews: false });
    const forViewer = await executeQuery(viewer, describeObject, { objectKey: ENTITY_OPPORTUNITY });
    expect(forViewer).toMatchObject({ canCreate: false, canEdit: false });
    await expect(executeCommand(viewer, updatePerson, { id: ravi, patch: { jobTitle: "CEO" } })).rejects.toThrow(/E_FORBIDDEN|not permitted|Forbidden/i);
  });

  it("isolates tenants: another workspace sees none of it and cannot reach it by id", async () => {
    expect((await executeQuery(outsider, listCompanies, {})).total).toBe(0);
    expect(await executeQuery(outsider, companyDetail, { id: bhel })).toBeNull();
    await expect(executeCommand(outsider, updateCompany, { id: bhel, patch: { name: "Hijacked" } })).rejects.toThrow(/no such company/);
    await expect(executeCommand(outsider, addNote, { companyId: bhel, body: "x" })).rejects.toThrow(/no such company/);
    await expect(executeCommand(outsider, createPerson, { givenName: "Spy", company: bhel })).rejects.toThrow(/no such company/);
    expect((await executeQuery(outsider, listViews, { objectKey: ENTITY_OPPORTUNITY })).map((v) => v.name)).toEqual(["All opportunities", "Board"]);
  });

  /* ---------------------------- stage 3: custom fields and merging ---------------------------- */

  it("lets an administrator add custom fields that list, filter, edit, validate and retire like built-in ones", async () => {
    await expect(executeCommand(seller, defineCustomField, { entityKey: ENTITY_OPPORTUNITY, name: "Tender number", type: "String" })).rejects.toThrow(/E_FORBIDDEN|permission/i);
    await expect(executeCommand(manager, defineCustomField, { entityKey: ENTITY_OPPORTUNITY, name: "Amount", type: "Number" })).rejects.toThrow(/already have a field called Amount/);
    await expect(executeCommand(manager, defineCustomField, { entityKey: ENTITY_OPPORTUNITY, name: "EMD paid", type: "Select", options: ["Yes"] })).rejects.toThrow(/at least two choices/);
    await expect(executeCommand(manager, defineCustomField, { entityKey: ENTITY_OPPORTUNITY, name: "Portal", type: "String", required: true })).rejects.toThrow(/cannot start out required/);
    const tender = await executeCommand(manager, defineCustomField, { entityKey: ENTITY_OPPORTUNITY, name: "Tender number", type: "String" });
    await executeCommand(manager, defineCustomField, { entityKey: ENTITY_OPPORTUNITY, name: "EMD", type: "Number" });
    await executeCommand(manager, defineCustomField, { entityKey: ENTITY_OPPORTUNITY, name: "EMD status", type: "Select", options: ["Paid", "Exempt", "Pending"] });
    expect((await executeQuery(seller, listCustomFields, { entityKey: ENTITY_OPPORTUNITY })).map((f) => f.name)).toEqual(["Tender number", "EMD", "EMD status"]);

    const described = await executeQuery(seller, describeObject, { objectKey: ENTITY_OPPORTUNITY });
    expect(described.fields.find((f) => f.key === "cf:EMD status")).toMatchObject({ type: "select", custom: "EMD status", sortable: false });

    const opp = await executeCommand(seller, createOpportunity, { name: "Bus duct for metro depot", amount: 900000, customFields: { "Tender number": "CIMR/2026/114", EMD: "18,000" } });
    await expect(executeCommand(seller, updateOpportunity, { id: opp.id, patch: { customFields: { "EMD status": "Lost" } } })).rejects.toThrow(/EMD status is not valid/);
    await expect(executeCommand(seller, updateOpportunity, { id: opp.id, patch: { customFields: { Nope: "x" } } })).rejects.toThrow(/no field called "Nope"/);
    await executeCommand(seller, updateOpportunity, { id: opp.id, patch: { customFields: { "EMD status": "Paid" } } });

    const byTender = await executeQuery(seller, listOpportunities, { filters: [{ field: "cf:Tender number", op: "contains", value: "2026/114" }] });
    expect(byTender.rows.map((r) => r.name)).toEqual(["Bus duct for metro depot"]);
    expect(byTender.rows[0]!["cf:EMD"]).toBe(18000);
    expect((await executeQuery(seller, listOpportunities, { filters: [{ field: "cf:EMD", op: "gte", value: 10000 }] })).total).toBe(1);
    expect((await executeQuery(seller, listOpportunities, { filters: [{ field: "cf:EMD status", op: "is_any_of", value: ["Exempt"] }] })).total).toBe(0);

    // The change shows on the timeline under the field's own name.
    const changes = await withTenant(tenantId, (tx) => tx.activity.findMany({ where: { entityId: opp.id, fieldChanged: "EMD status" } }));
    expect(changes[0]?.newValue).toBe("Paid");

    // A saved view naming the field survives the field's retirement, minus the field; the values stay on the record.
    const view = await executeCommand(seller, saveView, { objectKey: ENTITY_OPPORTUNITY, name: "Tenders", type: "table", visibility: "personal", config: { columns: [{ key: "name" }, { key: "cf:Tender number" }] } });
    await executeCommand(manager, retireCustomField, { id: tender.id });
    const views = await executeQuery(seller, listViews, { objectKey: ENTITY_OPPORTUNITY });
    expect(views.find((v) => v.id === view.id)!.config.columns.map((c) => c.key)).toEqual(["name"]);
    await executeCommand(seller, updateOpportunity, { id: opp.id, patch: { customFields: { EMD: 20000 } } });
    const stored = await withTenant(tenantId, (tx) => tx.relationshipOpportunity.findUniqueOrThrow({ where: { id: opp.id } }));
    expect(stored.customFields).toMatchObject({ "Tender number": "CIMR/2026/114", EMD: 20000, "EMD status": "Paid" });
  });

  it("finds duplicates and merges them without losing a note, deal or logged call", async () => {
    const groups = await executeQuery(seller, findDuplicates, { object: "company" });
    const bhelGroup = groups.find((g) => g.records.some((r) => r.id === bhel))!;
    expect(bhelGroup.records).toHaveLength(2);
    const duplicate = bhelGroup.records.find((r) => r.id !== bhel)!.id;
    await executeCommand(seller, addNote, { companyId: duplicate, body: "Note left on the duplicate." });
    await executeCommand(seller, logInteraction, { companyId: duplicate, kind: "call", subject: "Called the Bhopal office" });
    await executeCommand(seller, createOpportunity, { name: "Spares for Bhopal", company: duplicate, amount: 50000 });

    await expect(executeCommand(seller, mergeCompanies, { survivorId: bhel, duplicateId: bhel })).rejects.toThrow(/two different/);
    await executeCommand(seller, mergeCompanies, { survivorId: bhel, duplicateId: duplicate });
    await expect(executeCommand(seller, mergeCompanies, { survivorId: bhel, duplicateId: duplicate })).rejects.toThrow(/already merged/);

    const detail = (await executeQuery(seller, companyDetail, { id: bhel }))!;
    expect((detail.opportunities as Array<{ name: string }>).map((o) => o.name)).toContain("Spares for Bhopal");
    const merged = (await executeQuery(seller, companyDetail, { id: duplicate }))!;
    expect(merged).toMatchObject({ archived: true, mergedInto: { id: bhel } });
    const titles = (await executeQuery(seller, timeline, { kind: "company", id: bhel })).map((e) => `${e.title} ${e.body ?? ""}`).join("\n");
    expect(titles).toMatch(/Note left on the duplicate/);
    expect(titles).toMatch(/Called the Bhopal office/);
    expect((await executeQuery(seller, findDuplicates, { object: "company" })).some((g) => g.records.some((r) => r.id === duplicate))).toBe(false);

    const twin = await executeCommand(seller, createPerson, { givenName: "Ravi", familyName: "Kumar", company: bhel, phones: ["+91 90000 00001"], allowDuplicate: true });
    await executeCommand(seller, mergePeople, { survivorId: ravi, duplicateId: twin.id });
    const ravis = await withTenant(tenantId, (tx) => tx.relationshipPerson.findUniqueOrThrow({ where: { id: ravi } }));
    expect(ravis.phones).toContain("+91 90000 00001");
  });

  /* ---------------------------- stage 4: playbooks and insights ---------------------------- */

  it("runs a stage's playbook when a deal enters it: follow-ups for the owner, and a notice", async () => {
    const quote = stages.find((s) => s.key === "quote")!;
    await executeCommand(seller, setStagePlaybook, { id: quote.id, playbook: { followUps: [{ title: "Send the technical offer", dueInDays: 2 }], notifyOwner: true } });
    const deal2 = await executeCommand(seller, createOpportunity, { name: "Playbook check", owner: manager.userId });
    await executeCommand(seller, moveOpportunity, { id: deal2.id, stageId: quote.id, position: 1 });
    const planned = await executeQuery(manager, listFollowUps, { scope: "mine" });
    expect(planned.find((f) => f.title === "Send the technical offer")?.on.map((o) => o.kind)).toContain("opportunity");
    const notice = await withTenant(tenantId, (tx) => tx.notification.findFirst({ where: { recipientId: manager.userId, key: "verity.relationship.opportunity_entered_stage" } }));
    expect(notice?.subject).toMatch(/moved to Technical quote/);
  });

  it("reports the funnel, lost reasons, forecast and ageing from real deals", async () => {
    const insights = await executeQuery(seller, pipelineInsights, {});
    expect(insights.funnel.map((f) => f.label)).toEqual(expect.arrayContaining(["Enquiry", "Qualified", "Technical quote", "Won"]));
    expect(insights.funnel.find((f) => f.label === "Enquiry")!.entered).toBeGreaterThanOrEqual(insights.funnel.find((f) => f.label === "Technical quote")!.entered);
    expect(insights.forecast).toHaveLength(6);
    expect(insights.ageing.reduce((n, b) => n + b.count, 0)).toBeGreaterThan(0);
  });

  it("opens one job from a won deal, through the jobs capability, and the deal's timeline says so", async () => {
    const won = stages.find((s) => s.key === "won")!;
    const deal3 = await executeCommand(seller, createOpportunity, { name: "Furnace transformer", contact: ravi, amount: 1200000 });
    const customerId = await withTenant(tenantId, async (tx) => (await tx.tradingCustomer.create({ data: { tenantId, displayName: "Bharat Heavy Electricals" } })).id);
    await expect(executeCommand(seller, openJobFromOpportunity, { opportunityId: deal3.id, customerId })).rejects.toThrow(/only a won opportunity/);
    await executeCommand(seller, moveOpportunity, { id: deal3.id, stageId: won.id, position: 0 });
    const job = await executeCommand(seller, openJobFromOpportunity, { opportunityId: deal3.id, customerId });
    await expect(executeCommand(seller, openJobFromOpportunity, { opportunityId: deal3.id, customerId })).rejects.toThrow(/already opened/);
    const linked = await executeQuery(seller, jobForOpportunity, { opportunityId: deal3.id });
    expect(linked).toMatchObject({ id: job.id, title: "Furnace transformer" });
    const feed = await executeQuery(seller, timeline, { kind: "opportunity", id: deal3.id });
    expect(feed.some((e) => e.title.startsWith("Opened job J-"))).toBe(true);
  });
});
