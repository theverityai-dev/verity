import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/platform/db";
import { assertRlsEnforceable, withTenant } from "@/server/platform/tenancy";
import { activateCapability, invalidateCapabilityCache } from "@/server/platform/capability";
import { checksumOf, registerStorageDriver } from "@/server/platform/files";
import { clearCommands, clearHooks, executeCommand, type ActorContext } from "@/server/platform/command";
import { clearQueries, executeQuery } from "@/server/platform/query";
import { ForbiddenError, clearScopeResolvers } from "@/server/platform/authorization";
import { clearTransitionGuards } from "@/server/platform/state";
import { clearContributions } from "@/server/platform/contribution";
import { provisionIdentity } from "@/server/platform/identity";
// Task 106 Phase 8: the insight action runs an LLM turn OUTSIDE the
// database — stubbed here so the test proves the orchestration (authorize
// as actor, persist with provenance), never the model. Hoisted by vitest.
const agentTurn = vi.hoisted(() => vi.fn());
const currentActor = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/server/platform/agent-chat", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/platform/agent-chat")>();
  realAgentTurn.value = original.runAgentTurn;
  return { ...original, runAgentTurn: agentTurn };
});
const realAgentTurn = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/server/platform/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/platform/auth")>()),
  requireActor: async () => currentActor.value,
}));
vi.mock("@/server/platform/request-limits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/platform/request-limits")>()),
  limitActorRequests: async () => undefined,
}));
vi.mock("@/server/platform/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/platform/config")>();
  // Opt-in live check below uses the deployment's real provider config.
  if (process.env.VERITY_TEST_REAL_AGENT === "1") return original;
  return { ...original, readAgentProviderConfig: () => ({ apiKey: "test", baseUrl: "http://provider.invalid", model: "test-model" }) };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
// This file registers the capability itself in `beforeAll`; the action's own
// bootstrap would register it a second time.
vi.mock("@/server/capabilities/registry", () => ({ installCapabilities: () => undefined }));
import { generateLeadInsight } from "@/server/actions/outreach";
import {
  ENTITY_AI_INSIGHT,
  ENTITY_ACTIVITY,
  ENTITY_CHECK_IN,
  ENTITY_COACHING_NOTE,
  ENTITY_CONTACT,
  ENTITY_DIRECTION,
  ENTITY_LEAD,
  ENTITY_MEETING,
  ENTITY_RESEARCH,
  ENTITY_TARGET,
  ENTITY_TASK,
  ENTITY_TEAM,
  ENTITY_TEAM_MEMBERSHIP,
  ENTITY_TEAM_WEEKLY_ASSESSMENT,
  ENTITY_WEEKLY_REPORT,
  OUTREACH_CAPABILITY,
  addTeamMember,
  advanceLeadStage,
  checkDuplicateProspect,
  confirmResearchFileUpload,
  createCoachingNote,
  createOutreachContact,
  createOutreachLead,
  createOutreachMeeting,
  createOutreachTask,
  createOutreachTeam,
  createResearchNote,
  deriveLeadHealth,
  getTeamWeeklyMemberBreakdown,
  listCoachingNotes,
  listLeadQueue,
  listOutreachContacts,
  listOutreachMeetings,
  listOutreachTasks,
  listResearchEntries,
  listTeamCheckIns,
  reserveResearchFileUpload,
  reviewCheckIn,
  flagForEscalation,
  getDailyMetrics,
  getChannelIntelligence,
  getCompanyPulse,
  getConversionFunnel,
  getCurrentDirection,
  getFunnelCounts,
  getTeamComparison,
  getVerticalIntelligence,
  INSIGHT_TOOL_KEYS,
  insightPrompt,
  listAiInsights,
  listDirections,
  recordAiInsight,
  postCompanyDirection,
  getTeamWeeklyRollup,
  listAvailableParties,
  listEscalatedLeads,
  listFollowUpQueue,
  listOutreachLeads,
  listOutreachTargets,
  listOverdueFollowUps,
  logOutreachActivity,
  reactivateLead,
  reassignOpportunityOwner,
  recordAdvancePayment,
  registerOutreachCapability,
  removeTeamMember,
  renameTeam,
  resolveEscalation,
  setOutreachTarget,
  setTaskStatus,
  submitDailyCheckIn,
  submitTeamWeeklyAssessment,
  submitWeeklyReport,
  updateMeetingOutcome,
} from "@/server/capabilities/outreach";

/**
 * CAPABILITY: OUTREACH — Task 105 Phase 4.
 *
 * Covers the business invariants the taskplan names explicitly: state-
 * machine legality (handbook Ch. 22), the terminal-state rejection-reason
 * guard (Ch. 20), the advance-payment threshold gate on Closed Won (Ch. 02),
 * the 14-day reassignment-eligibility window and the 90-day reactivation-
 * credit window (both Ch. 02), and the Phase 3 per-team scope fix.
 */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  const message = "capability-outreach.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

const DAY_MS = 24 * 60 * 60 * 1000;

describeDb("capability: Outreach", () => {
  const tenantId = randomUUID();

  let organizationId: string;
  let founder: ActorContext;
  let seniorA: ActorContext; // leads teamA
  let seniorB: ActorContext; // leads teamB
  let teamAId: string;
  let teamBId: string;
  let founderPartyId: string;
  let seniorAPartyId: string;

  beforeAll(async () => {
    await assertRlsEnforceable();
    clearCommands();
    clearQueries();
    clearHooks();
    clearScopeResolvers();
    clearTransitionGuards();
    clearContributions();
    registerOutreachCapability();

    const everything = [
      ENTITY_TEAM,
      ENTITY_TEAM_MEMBERSHIP,
      ENTITY_LEAD,
      ENTITY_ACTIVITY,
      ENTITY_TARGET,
      ENTITY_CHECK_IN,
      ENTITY_WEEKLY_REPORT,
      ENTITY_TEAM_WEEKLY_ASSESSMENT,
      ENTITY_CONTACT,
      ENTITY_RESEARCH,
      ENTITY_TASK,
      ENTITY_MEETING,
      ENTITY_COACHING_NOTE,
      ENTITY_AI_INSIGHT,
    ];

    await withTenant(tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: "Outreach Test", timeZone: "Asia/Kolkata" } });
      await activateCapability(tx, tenantId, OUTREACH_CAPABILITY);
      organizationId = (await tx.organization.create({ data: { tenantId, name: "PlotArmour Test" } })).id;

      const role = await tx.role.create({ data: { tenantId, name: "Everyone" } });
      await tx.permission.createMany({
        data: everything.flatMap((entity) =>
          (["Read", "Create", "Edit", "ActionExecute"] as const).map((verb) => ({
            tenantId,
            roleId: role.id,
            verb,
            entity,
            scope: "Tenant" as const,
          })),
        ),
      });
      // Create on Direction is the capability's structural "Company Core"
      // signal (`listCoachingNotes`, the Outreach/Intelligence pages) — so
      // only the Founder's role carries it; everyone else may read it.
      await tx.permission.create({ data: { tenantId, roleId: role.id, verb: "Read", entity: ENTITY_DIRECTION, scope: "Tenant" } });
      const founderRole = await tx.role.create({ data: { tenantId, name: "Founder" } });
      await tx.permission.createMany({
        data: [...everything, ENTITY_DIRECTION].flatMap((entity) =>
          (["Read", "Create", "Edit", "ActionExecute"] as const).map((verb) => ({
            tenantId,
            roleId: founderRole.id,
            verb,
            entity,
            scope: "Tenant" as const,
          })),
        ),
      });

      const founderIdentity = await provisionIdentity(tx, {
        organizationId,
        authUserId: randomUUID(),
        displayName: "Founder",
      });
      await tx.tenantMembership.update({ where: { id: founderIdentity.membershipId }, data: { roleId: founderRole.id } });
      founderPartyId = founderIdentity.partyId;
      founder = {
        tenantId,
        userId: founderIdentity.userId,
        membershipId: founderIdentity.membershipId,
        organizationId,
        roleId: founderRole.id,
      };

      const seniorAIdentity = await provisionIdentity(tx, {
        organizationId,
        authUserId: randomUUID(),
        displayName: "Senior A",
      });
      await tx.tenantMembership.update({ where: { id: seniorAIdentity.membershipId }, data: { roleId: role.id } });
      seniorAPartyId = seniorAIdentity.partyId;
      seniorA = {
        tenantId,
        userId: seniorAIdentity.userId,
        membershipId: seniorAIdentity.membershipId,
        organizationId,
        roleId: role.id,
      };

      const seniorBIdentity = await provisionIdentity(tx, {
        organizationId,
        authUserId: randomUUID(),
        displayName: "Senior B",
      });
      await tx.tenantMembership.update({ where: { id: seniorBIdentity.membershipId }, data: { roleId: role.id } });
      seniorB = {
        tenantId,
        userId: seniorBIdentity.userId,
        membershipId: seniorBIdentity.membershipId,
        organizationId,
        roleId: role.id,
      };

      teamAId = (await tx.outreachTeam.create({ data: { tenantId, name: "Team A", leaderId: seniorAPartyId } })).id;
      teamBId = (
        await tx.outreachTeam.create({ data: { tenantId, name: "Team B", leaderId: seniorBIdentity.partyId } })
      ).id;
    });

    invalidateCapabilityCache();
    void seniorB;
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
      await admin.$executeRaw`DELETE FROM tenant WHERE id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM "user" WHERE id NOT IN (SELECT user_id FROM tenant_membership)`;
      await admin.$executeRaw`DELETE FROM party WHERE id NOT IN (SELECT party_id FROM "user")`;
    } finally {
      await admin.$disconnect();
    }
    await prisma.$disconnect();
  });

  it("creates a lead with the creator as originator, initial state 'research'", async () => {
    const lead = await executeCommand(founder, createOutreachLead, {
      teamId: teamAId,
      companyName: "Acme Test Co",
      whyRelevant: "Fragmented purchasing per job posting.",
      opportunityOwnerId: seniorAPartyId,
    });
    const row = await withTenant(tenantId, (tx) => tx.outreachLead.findUniqueOrThrow({ where: { id: lead.id } }));
    expect(row.state).toBe("research");
    expect(row.leadOriginatorId).toBe(founderPartyId);
    expect(row.opportunityOwnerId).toBe(seniorAPartyId);
  });

  it("stores the prospect-research sheet's fields when given (2026-09-13 batch)", async () => {
    const lead = await executeCommand(founder, createOutreachLead, {
      teamId: teamAId,
      companyName: "Research Fields Co",
      whyRelevant: "Fresh funding round per press release.",
      opportunityOwnerId: seniorAPartyId,
      location: "Melbourne, Australia",
      whatTheyDo: "A vegan-leather pet accessories brand.",
      potentialNeed: "Brand photography, launch campaign production.",
      salesHypothesis: "New launch needs a content library before competitors crowd them out.",
      linkedinUrl: "https://www.linkedin.com/in/example",
      qualityScore: 8,
    });
    const row = await withTenant(tenantId, (tx) => tx.outreachLead.findUniqueOrThrow({ where: { id: lead.id } }));
    expect(row.location).toBe("Melbourne, Australia");
    expect(row.whatTheyDo).toBe("A vegan-leather pet accessories brand.");
    expect(row.potentialNeed).toBe("Brand photography, launch campaign production.");
    expect(row.salesHypothesis).toBe("New launch needs a content library before competitors crowd them out.");
    expect(row.linkedinUrl).toBe("https://www.linkedin.com/in/example");
    expect(row.qualityScore).toBe(8);
  });

  it("logs PitchDeck and BusinessResearch activity types (daily workbook columns, 2026-09-13 batch)", async () => {
    const lead = await executeCommand(founder, createOutreachLead, {
      teamId: teamAId,
      companyName: "Pitch Deck Co",
      whyRelevant: "Test.",
      opportunityOwnerId: seniorAPartyId,
    });
    await executeCommand(founder, logOutreachActivity, {
      leadId: lead.id,
      channel: "Email",
      activityType: "PitchDeck",
      message: "Sent the deck.",
    });
    await executeCommand(founder, logOutreachActivity, {
      leadId: lead.id,
      channel: "Other",
      activityType: "BusinessResearch",
      message: "Reviewed their site and LinkedIn.",
    });
    const timeline = await withTenant(tenantId, (tx) => tx.outreachActivity.findMany({ where: { leadId: lead.id } }));
    expect(timeline.map((a) => a.activityType).sort()).toEqual(["BusinessResearch", "PitchDeck"]);

    const metrics = await executeQuery(founder, getDailyMetrics, { partyId: founderPartyId, date: new Date().toISOString() });
    expect(metrics.pitchDecks).toBeGreaterThanOrEqual(1);
    expect(metrics.businessResearch).toBeGreaterThanOrEqual(1);
  });

  describe("contacts (Task 106 Phase 3)", () => {
    it("creates a contact on a lead and lists it back", async () => {
      const lead = await executeCommand(founder, createOutreachLead, {
        teamId: teamAId,
        companyName: "Contact Test Co",
        whyRelevant: "Test.",
        opportunityOwnerId: seniorAPartyId,
      });
      const contact = await executeCommand(founder, createOutreachContact, {
        leadId: lead.id,
        fullName: "Priya Sharma",
        designation: "Operations Head",
        email: "priya@contacttest.example",
        classification: "DecisionMaker",
      });
      const contacts = await executeQuery(founder, listOutreachContacts, { leadId: lead.id });
      expect(contacts).toHaveLength(1);
      expect(contacts[0]).toMatchObject({
        id: contact.id,
        fullName: "Priya Sharma",
        designation: "Operations Head",
        email: "priya@contacttest.example",
        classification: "DecisionMaker",
      });
    });

    it("defaults classification to Unknown when omitted", async () => {
      const lead = await executeCommand(founder, createOutreachLead, {
        teamId: teamAId,
        companyName: "Contact Default Co",
        whyRelevant: "Test.",
        opportunityOwnerId: seniorAPartyId,
      });
      const contact = await executeCommand(founder, createOutreachContact, {
        leadId: lead.id,
        fullName: "Unclassified Person",
      });
      const stored = await withTenant(tenantId, (tx) => tx.outreachContact.findUniqueOrThrow({ where: { id: contact.id } }));
      expect(stored.classification).toBe("Unknown");
    });

    it("rejects a contact on a lead that does not exist", async () => {
      await expect(
        executeCommand(founder, createOutreachContact, {
          leadId: randomUUID(),
          fullName: "Ghost Contact",
        }),
      ).rejects.toThrow();
    });
  });

  describe("deriveLeadHealth (Task 106 Phase 3, spec §21 — category-only per ADR-009)", () => {
    const now = new Date();
    const daysAgo = (n: number) => new Date(now.getTime() - n * DAY_MS);
    const daysAhead = (n: number) => new Date(now.getTime() + n * DAY_MS);

    it("is Closed for Completed/Cancelled categories regardless of activity", () => {
      expect(deriveLeadHealth({ category: "Completed", lastActivityAt: daysAgo(100), nextActionAt: null, createdAt: daysAgo(100) })).toBe("Closed");
      expect(deriveLeadHealth({ category: "Cancelled", lastActivityAt: null, nextActionAt: null, createdAt: daysAgo(1) })).toBe("Closed");
    });

    it("is Stale when idle beyond 14 days, even with an Active category", () => {
      expect(deriveLeadHealth({ category: "Active", lastActivityAt: daysAgo(20), nextActionAt: null, createdAt: daysAgo(30) })).toBe("Stale");
    });

    it("is AtRisk when the next action is overdue but activity is recent", () => {
      expect(deriveLeadHealth({ category: "Active", lastActivityAt: daysAgo(1), nextActionAt: daysAgo(2), createdAt: daysAgo(10) })).toBe("AtRisk");
    });

    it("is Hot when Active with a real upcoming action", () => {
      expect(deriveLeadHealth({ category: "Active", lastActivityAt: daysAgo(1), nextActionAt: daysAhead(3), createdAt: daysAgo(10) })).toBe("Hot");
    });

    it("is Healthy for a fresh Draft/Pending lead with no overdue action", () => {
      expect(deriveLeadHealth({ category: "Draft", lastActivityAt: null, nextActionAt: null, createdAt: daysAgo(1) })).toBe("Healthy");
    });
  });

  describe("research entries (Task 106 Phase 4)", () => {
    it("creates a note and lists it back", async () => {
      const lead = await executeCommand(founder, createOutreachLead, {
        teamId: teamAId,
        companyName: "Research Note Co",
        whyRelevant: "Test.",
        opportunityOwnerId: seniorAPartyId,
      });
      const entry = await executeCommand(founder, createResearchNote, {
        leadId: lead.id,
        type: "Note",
        title: "Website analysis",
        content: "Multi-branch operations, fragmented tooling.",
      });
      const entries = await executeQuery(founder, listResearchEntries, { leadId: lead.id });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ id: entry.id, type: "Note", title: "Website analysis" });
    });

    it("rejects a Url entry with no sourceUrl", async () => {
      const lead = await executeCommand(founder, createOutreachLead, {
        teamId: teamAId,
        companyName: "Research Url Co",
        whyRelevant: "Test.",
        opportunityOwnerId: seniorAPartyId,
      });
      await expect(
        executeCommand(founder, createResearchNote, { leadId: lead.id, type: "Url", title: "Missing URL" }),
      ).rejects.toThrow();
    });

    it("reserves and confirms a file upload, creating a research entry", async () => {
      // No backend is bound in tests; stand one in that serves exactly the bytes
      // the confirm step will verify (size, checksum and PDF signature).
      const bytes = Buffer.concat([Buffer.from("%PDF-1.4 "), Buffer.alloc(1015)]);
      registerStorageDriver({
        name: "test",
        createUploadUrl: async (key) => ({ url: `https://test.invalid/put/${key}` }),
        createReadUrl: async (key) => `https://test.invalid/get/${key}`,
        storeVerified: async () => {},
        delete: async () => {},
      });
      vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes)));
      const lead = await executeCommand(founder, createOutreachLead, {
        teamId: teamAId,
        companyName: "Research File Co",
        whyRelevant: "Test.",
        opportunityOwnerId: seniorAPartyId,
      });
      const reserved = await executeCommand(founder, reserveResearchFileUpload, {
        leadId: lead.id,
        fileName: "annual-report.pdf",
        mimeType: "application/pdf",
        byteSize: 1024,
      });
      expect(reserved.fileId).toBeTruthy();

      const stored = await withTenant(tenantId, (tx) => tx.storedFile.findUniqueOrThrow({ where: { id: reserved.fileId } }));
      expect(stored.status).toBe("Pending");
      expect(stored.entityKey).toBe(ENTITY_LEAD);
      expect(stored.entityId).toBe(lead.id);

      const confirmed = await executeCommand(founder, confirmResearchFileUpload, {
        leadId: lead.id,
        fileId: reserved.fileId,
        checksum: checksumOf(bytes),
        byteSize: 1024,
        type: "Pdf",
        title: "Annual report",
      });
      expect(confirmed.status).toBe("Stored");
      vi.unstubAllGlobals();
      registerStorageDriver(null);

      const entries = await executeQuery(founder, listResearchEntries, { leadId: lead.id });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ type: "Pdf", title: "Annual report", fileId: reserved.fileId });
    });

    it("quarantines a confirm whose byteSize disagrees with the reservation, without creating an entry", async () => {
      const lead = await executeCommand(founder, createOutreachLead, {
        teamId: teamAId,
        companyName: "Research Quarantine Co",
        whyRelevant: "Test.",
        opportunityOwnerId: seniorAPartyId,
      });
      const reserved = await executeCommand(founder, reserveResearchFileUpload, {
        leadId: lead.id,
        fileName: "screenshot.png",
        mimeType: "image/png",
        byteSize: 500,
      });
      const confirmed = await executeCommand(founder, confirmResearchFileUpload, {
        leadId: lead.id,
        fileId: reserved.fileId,
        checksum: "abc123",
        byteSize: 999, // disagrees with the declared 500
        type: "Screenshot",
        title: "Mismatched upload",
      });
      expect(confirmed.status).toBe("Quarantined");
      const entries = await executeQuery(founder, listResearchEntries, { leadId: lead.id });
      expect(entries).toHaveLength(0);
    });
  });

  describe("checkDuplicateProspect (Task 106 Phase 4)", () => {
    it("finds no duplicate for a genuinely new company", async () => {
      const result = await executeQuery(founder, checkDuplicateProspect, { companyName: "Nobody Has Heard Of This Co" });
      expect(result.possibleDuplicate).toBe(false);
    });

    it("matches on normalized company name and reveals full detail when accessible", async () => {
      const lead = await executeCommand(founder, createOutreachLead, {
        teamId: teamAId,
        companyName: "Acme Manufacturing Pvt. Ltd.",
        whyRelevant: "Test.",
        opportunityOwnerId: seniorAPartyId,
      });
      const result = await executeQuery(founder, checkDuplicateProspect, { companyName: "acme manufacturing pvt ltd" });
      expect(result.possibleDuplicate).toBe(true);
      expect(result.accessible).toBe(true);
      expect(result.leadId).toBe(lead.id);
    });

    it("matches on domain and hides owner/team detail when the caller lacks access", async () => {
      await executeCommand(founder, createOutreachLead, {
        teamId: teamAId,
        companyName: "Domain Match Co",
        website: "https://domainmatch.example",
        whyRelevant: "Test.",
        opportunityOwnerId: seniorAPartyId,
      });
      // seniorB leads Team B, not Team A — the match is real but inaccessible to them.
      const result = await executeQuery(seniorB, checkDuplicateProspect, {
        companyName: "Something Else Entirely",
        website: "https://www.domainmatch.example/about",
      });
      expect(result.possibleDuplicate).toBe(true);
      expect(result.accessible).toBe(false);
      expect(result.leadId).toBeUndefined();
      expect(result.message).not.toContain("Domain Match Co");
    });
  });

  describe("tasks (Task 106 Phase 5)", () => {
    it("infers SelfCreated origin when assigning to yourself", async () => {
      const task = await executeCommand(founder, createOutreachTask, {
        teamId: teamAId,
        title: "Follow up with legal",
        assignedToPartyId: founderPartyId,
      });
      const stored = await withTenant(tenantId, (tx) => tx.outreachTask.findUniqueOrThrow({ where: { id: task.id } }));
      expect(stored.origin).toBe("SelfCreated");
      expect(stored.status).toBe("Todo");
      expect(stored.priority).toBe("Medium");
    });

    it("infers TeamLeaderAssigned origin when assigning to someone else", async () => {
      const task = await executeCommand(founder, createOutreachTask, {
        teamId: teamAId,
        title: "Research ABC Manufacturing",
        assignedToPartyId: seniorAPartyId,
        priority: "High",
      });
      const stored = await withTenant(tenantId, (tx) => tx.outreachTask.findUniqueOrThrow({ where: { id: task.id } }));
      expect(stored.origin).toBe("TeamLeaderAssigned");
      expect(stored.priority).toBe("High");
    });

    it("marks a task Done and stamps completedAt", async () => {
      const task = await executeCommand(founder, createOutreachTask, {
        teamId: teamAId,
        title: "Send pitch deck",
        assignedToPartyId: founderPartyId,
      });
      const result = await executeCommand(founder, setTaskStatus, { taskId: task.id, status: "Done" });
      expect(result.status).toBe("Done");
      const stored = await withTenant(tenantId, (tx) => tx.outreachTask.findUniqueOrThrow({ where: { id: task.id } }));
      expect(stored.completedAt).not.toBeNull();
    });

    it("lists tasks filtered by assignee", async () => {
      const tasks = await executeQuery(founder, listOutreachTasks, { assignedToPartyId: founderPartyId });
      expect(tasks.length).toBeGreaterThan(0);
      expect(tasks.every((t) => t.assignedToPartyId === founderPartyId)).toBe(true);
    });
  });

  describe("meetings (Task 106 Phase 5)", () => {
    it("creates a meeting and records its outcome", async () => {
      const lead = await executeCommand(founder, createOutreachLead, {
        teamId: teamAId,
        companyName: "Meeting Test Co",
        whyRelevant: "Test.",
        opportunityOwnerId: seniorAPartyId,
      });
      const meeting = await executeCommand(founder, createOutreachMeeting, {
        leadId: lead.id,
        scheduledAt: new Date(Date.now() + DAY_MS).toISOString(),
        purpose: "Discovery call",
      });
      const listed = await executeQuery(founder, listOutreachMeetings, { leadId: lead.id });
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ id: meeting.id, status: "Scheduled" });

      const outcome = await executeCommand(founder, updateMeetingOutcome, {
        meetingId: meeting.id,
        status: "Completed",
        outcomeNotes: "Positive, wants a proposal.",
      });
      expect(outcome.status).toBe("Completed");
    });
  });

  describe("daily check-in review (Task 106 Phase 5, spec §64-71)", () => {
    it("submits with the two new questions and reviews without touching the Junior's own text", async () => {
      const uniqueDay = new Date(Date.now() + 60 * DAY_MS).toISOString();
      const checkIn = await executeCommand(seniorA, submitDailyCheckIn, {
        checkInDate: uniqueDay,
        summary: "Worked 5 leads.",
        mostImportantDevelopment: "XYZ Corp replied positively.",
        needsAttention: "Need help closing ABC Manufacturing.",
      });

      const reviewed = await executeCommand(founder, reviewCheckIn, {
        checkInId: checkIn.id,
        reviewStatus: "NeedsClarification",
        leaderFeedback: "Which contact at XYZ replied?",
      });
      expect(reviewed.reviewStatus).toBe("NeedsClarification");

      // The review is a separate append-only row — the check-in itself
      // (the Junior's own text) is never touched, at the database level.
      const stored = await withTenant(tenantId, (tx) => tx.outreachCheckIn.findUniqueOrThrow({ where: { id: checkIn.id } }));
      expect(stored.summary).toBe("Worked 5 leads.");
      expect(stored.mostImportantDevelopment).toBe("XYZ Corp replied positively.");

      const reviewRow = await withTenant(tenantId, (tx) => tx.outreachCheckInReview.findUniqueOrThrow({ where: { id: reviewed.id } }));
      expect(reviewRow).toMatchObject({
        checkInId: checkIn.id,
        reviewStatus: "NeedsClarification",
        leaderFeedback: "Which contact at XYZ replied?",
      });
    });

    it("lists a team's check-ins for a given day, including the leader's own", async () => {
      const day = new Date(Date.now() + 61 * DAY_MS).toISOString();
      await executeCommand(seniorA, submitDailyCheckIn, { checkInDate: day, summary: "Team A day." });
      const results = await executeQuery(founder, listTeamCheckIns, { teamId: teamAId, date: day });
      const row = results.find((c) => c.summary === "Team A day.");
      expect(row).toBeDefined();
      expect(row!.currentReview).toBeNull();
    });
  });

  describe("follow-up queue bucketing (Task 106 Phase 5, spec §61)", () => {
    it("buckets active leads by next-action date", async () => {
      const overdueLead = await executeCommand(founder, createOutreachLead, {
        teamId: teamAId,
        companyName: "Overdue Bucket Co",
        whyRelevant: "Test.",
        opportunityOwnerId: seniorAPartyId,
      });
      await executeCommand(founder, logOutreachActivity, {
        leadId: overdueLead.id,
        channel: "Email",
        activityType: "FollowUp",
        nextActionAt: new Date(Date.now() - DAY_MS).toISOString(),
      });

      const upcomingLead = await executeCommand(founder, createOutreachLead, {
        teamId: teamAId,
        companyName: "Upcoming Bucket Co",
        whyRelevant: "Test.",
        opportunityOwnerId: seniorAPartyId,
      });
      await executeCommand(founder, logOutreachActivity, {
        leadId: upcomingLead.id,
        channel: "Email",
        activityType: "FollowUp",
        nextActionAt: new Date(Date.now() + 10 * DAY_MS).toISOString(),
      });

      const queue = await executeQuery(founder, listFollowUpQueue, { teamId: teamAId });
      expect(queue.overdue.some((l) => l.id === overdueLead.id)).toBe(true);
      expect(queue.upcoming.some((l) => l.id === upcomingLead.id)).toBe(true);
      expect(queue.overdue.some((l) => l.id === upcomingLead.id)).toBe(false);
    });
  });

  describe("lead review queues (Task 106 Phase 6, spec §78)", () => {
    it("NeedsResearch excludes a lead once it has a research entry", async () => {
      const lead = await executeCommand(founder, createOutreachLead, {
        teamId: teamAId,
        companyName: "Queue Research Co",
        whyRelevant: "Test.",
        opportunityOwnerId: seniorAPartyId,
      });
      let queue = await executeQuery(founder, listLeadQueue, { teamId: teamAId, queue: "NeedsResearch" });
      expect(queue.some((l) => l.id === lead.id)).toBe(true);

      await executeCommand(founder, createResearchNote, { leadId: lead.id, type: "Note", title: "Website check" });
      queue = await executeQuery(founder, listLeadQueue, { teamId: teamAId, queue: "NeedsResearch" });
      expect(queue.some((l) => l.id === lead.id)).toBe(false);
    });

    it("HighPriority filters on qualityScore >= 8", async () => {
      const highLead = await executeCommand(founder, createOutreachLead, {
        teamId: teamAId,
        companyName: "Queue High Priority Co",
        whyRelevant: "Test.",
        opportunityOwnerId: seniorAPartyId,
        qualityScore: 9,
      });
      const lowLead = await executeCommand(founder, createOutreachLead, {
        teamId: teamAId,
        companyName: "Queue Low Priority Co",
        whyRelevant: "Test.",
        opportunityOwnerId: seniorAPartyId,
        qualityScore: 3,
      });
      const queue = await executeQuery(founder, listLeadQueue, { teamId: teamAId, queue: "HighPriority" });
      expect(queue.some((l) => l.id === highLead.id)).toBe(true);
      expect(queue.some((l) => l.id === lowLead.id)).toBe(false);
    });
  });

  describe("coaching notes (Task 106 Phase 6, spec §79)", () => {
    it("a team's own leader can create and list notes, including LeaderPrivate ones", async () => {
      const note = await executeCommand(seniorA, createCoachingNote, {
        teamId: teamAId,
        aboutPartyId: seniorAPartyId,
        content: "Strong week, good qualification discipline.",
        visibility: "LeaderPrivate",
      });
      const notes = await executeQuery(seniorA, listCoachingNotes, { teamId: teamAId, aboutPartyId: seniorAPartyId });
      expect(notes.some((n) => n.id === note.id && n.visibility === "LeaderPrivate")).toBe(true);
    });

    it("a different team's leader cannot list another team's notes about someone else", async () => {
      await executeCommand(seniorA, createCoachingNote, {
        teamId: teamAId,
        aboutPartyId: seniorAPartyId,
        content: "Cross-team access check.",
      });
      await expect(executeQuery(seniorB, listCoachingNotes, { teamId: teamAId, aboutPartyId: seniorAPartyId })).rejects.toThrow();
    });
  });

  describe("weekly report member breakdown (Task 106 Phase 6, spec §80-81)", () => {
    it("returns a row per team member with real counts", async () => {
      const weekStart = new Date(Date.now() + 70 * DAY_MS).toISOString();
      const weekEnd = new Date(Date.now() + 77 * DAY_MS).toISOString();
      const breakdown = await executeQuery(founder, getTeamWeeklyMemberBreakdown, { teamId: teamAId, weekStart, weekEnd });
      expect(breakdown.some((m) => m.partyId === seniorAPartyId)).toBe(true);
      expect(breakdown.every((m) => typeof m.leads === "number" && typeof m.outreach === "number")).toBe(true);
    });
  });

  describe("state machine (handbook Ch. 22)", () => {
    it("advances only through declared transitions", async () => {
      const lead = await executeCommand(founder, createOutreachLead, {
        teamId: teamAId,
        companyName: "Linear Path Co",
        whyRelevant: "Test.",
        opportunityOwnerId: seniorAPartyId,
      });

      const afterFirst = await executeCommand(founder, advanceLeadStage, { leadId: lead.id, toState: "prospect" });
      expect(afterFirst.state).toBe("prospect");

      // Undeclared transition (skipping straight to closed_won from prospect)
      // must fail by absence, per state.ts's own MET-TRA-001 guarantee.
      await expect(
        executeCommand(founder, advanceLeadStage, { leadId: lead.id, toState: "closed_won" }),
      ).rejects.toThrow();
    });

    it("requires a rejectionReason to reach a terminal state, and locks the record after (INV-002)", async () => {
      const lead = await executeCommand(founder, createOutreachLead, {
        teamId: teamAId,
        companyName: "Dead End Co",
        whyRelevant: "Test.",
        opportunityOwnerId: seniorAPartyId,
      });

      await expect(
        executeCommand(founder, advanceLeadStage, { leadId: lead.id, toState: "not_a_fit" }),
      ).rejects.toThrow(/rejectionReason/);

      const result = await executeCommand(founder, advanceLeadStage, {
        leadId: lead.id,
        toState: "not_a_fit",
        rejectionReason: "NoFit",
      });
      expect(result.state).toBe("not_a_fit");

      const row = await withTenant(tenantId, (tx) => tx.outreachLead.findUniqueOrThrow({ where: { id: lead.id } }));
      expect(row.rejectionReason).toBe("NoFit");

      // INV-002: terminal is permanently read-only.
      await expect(
        executeCommand(founder, advanceLeadStage, { leadId: lead.id, toState: "research" }),
      ).rejects.toThrow(/terminal/);
    });

    it("blocks Closed Won until cumulative advance received clears the threshold (handbook Ch. 02)", async () => {
      const lead = await executeCommand(founder, createOutreachLead, {
        teamId: teamAId,
        companyName: "Payment Gate Co",
        whyRelevant: "Test.",
        opportunityOwnerId: seniorAPartyId,
      });
      await withTenant(tenantId, (tx) =>
        tx.outreachLead.update({
          where: { id: lead.id },
          data: {
            state: "advance_received",
            advanceThresholdMinor: 10_000,
          },
        }),
      );

      // Below threshold: blocked.
      await executeCommand(founder, recordAdvancePayment, { leadId: lead.id, amountMinor: 4_000 });
      await expect(
        executeCommand(founder, advanceLeadStage, { leadId: lead.id, toState: "closed_won" }),
      ).rejects.toThrow(/threshold/);

      // Milestone payment brings cumulative total past the threshold — never
      // replaces it, always adds (handbook Ch. 02's milestone ruling).
      await executeCommand(founder, recordAdvancePayment, { leadId: lead.id, amountMinor: 7_000 });
      const row = await withTenant(tenantId, (tx) => tx.outreachLead.findUniqueOrThrow({ where: { id: lead.id } }));
      expect(row.advanceReceivedMinor).toBe(11_000);

      const closed = await executeCommand(founder, advanceLeadStage, { leadId: lead.id, toState: "closed_won" });
      expect(closed.state).toBe("closed_won");

      const finalRow = await withTenant(tenantId, (tx) => tx.outreachLead.findUniqueOrThrow({ where: { id: lead.id } }));
      expect(finalRow.closerId).not.toBeNull();
      expect(finalRow.closedAt).not.toBeNull();
    });
  });

  describe("attribution (handbook Ch. 02)", () => {
    it("blocks owner reassignment inside the 14-day window, allows it after", async () => {
      const lead = await executeCommand(founder, createOutreachLead, {
        teamId: teamAId,
        companyName: "Reassign Co",
        whyRelevant: "Test.",
        opportunityOwnerId: seniorAPartyId,
      });

      await expect(
        executeCommand(founder, reassignOpportunityOwner, { leadId: lead.id, newOwnerId: founderPartyId }),
      ).rejects.toThrow(/14 days/);

      // Backdate creation past the window to simulate real elapsed time —
      // the command reads `lastActivityAt ?? createdAt`.
      await withTenant(tenantId, (tx) =>
        tx.outreachLead.update({ where: { id: lead.id }, data: { createdAt: new Date(Date.now() - 15 * DAY_MS) } }),
      );

      const result = await executeCommand(founder, reassignOpportunityOwner, {
        leadId: lead.id,
        newOwnerId: founderPartyId,
      });
      expect(result.opportunityOwnerId).toBe(founderPartyId);
    });

    it("keeps origination credit on reactivation within 90 days, reassigns it past that window", async () => {
      // Within window: dead 10 days ago, reactivate now -> credit stays.
      const recentDead = await executeCommand(founder, createOutreachLead, {
        teamId: teamAId,
        companyName: "Recently Dead Co",
        whyRelevant: "Test.",
        opportunityOwnerId: seniorAPartyId,
      });
      await executeCommand(founder, advanceLeadStage, {
        leadId: recentDead.id,
        toState: "not_a_fit",
        rejectionReason: "NoTiming",
      });
      await withTenant(tenantId, (tx) =>
        tx.outreachLead.update({
          where: { id: recentDead.id },
          data: { lastActivityAt: new Date(Date.now() - 10 * DAY_MS) },
        }),
      );
      const revived = await executeCommand(seniorA, reactivateLead, {
        leadId: recentDead.id,
        newOwnerId: seniorAPartyId,
        whyRelevant: "New trigger: they just raised funding.",
      });
      const revivedRow = await withTenant(tenantId, (tx) =>
        tx.outreachLead.findUniqueOrThrow({ where: { id: revived.id } }),
      );
      expect(revivedRow.leadOriginatorId).toBe(founderPartyId); // unchanged, original creator
      expect(revivedRow.reactivatedFromLeadId).toBe(recentDead.id);
      expect(revivedRow.state).toBe("research"); // fresh row, not the reopened terminal one

      // Past window: dead 100 days ago -> reactivator becomes the new originator.
      const longDead = await executeCommand(founder, createOutreachLead, {
        teamId: teamAId,
        companyName: "Long Dead Co",
        whyRelevant: "Test.",
        opportunityOwnerId: seniorAPartyId,
      });
      await executeCommand(founder, advanceLeadStage, {
        leadId: longDead.id,
        toState: "lost",
        rejectionReason: "LostToCompetitor",
      });
      await withTenant(tenantId, (tx) =>
        tx.outreachLead.update({
          where: { id: longDead.id },
          data: { lastActivityAt: new Date(Date.now() - 100 * DAY_MS) },
        }),
      );
      const revivedLate = await executeCommand(seniorA, reactivateLead, {
        leadId: longDead.id,
        newOwnerId: seniorAPartyId,
        whyRelevant: "New trigger, much later.",
      });
      const revivedLateRow = await withTenant(tenantId, (tx) =>
        tx.outreachLead.findUniqueOrThrow({ where: { id: revivedLate.id } }),
      );
      expect(revivedLateRow.leadOriginatorId).toBe(seniorAPartyId); // reactivator, not original creator

      // The dead lead itself was never reopened (INV-002).
      const originalRow = await withTenant(tenantId, (tx) =>
        tx.outreachLead.findUniqueOrThrow({ where: { id: longDead.id } }),
      );
      expect(originalRow.state).toBe("lost");
    });
  });

  it("logs activity and refreshes lastActivityAt", async () => {
    const lead = await executeCommand(founder, createOutreachLead, {
      teamId: teamAId,
      companyName: "Activity Co",
      whyRelevant: "Test.",
      opportunityOwnerId: seniorAPartyId,
    });
    await executeCommand(founder, logOutreachActivity, {
      leadId: lead.id,
      channel: "LinkedIn",
      activityType: "FirstOutreach",
      message: "Hi there",
    });
    const row = await withTenant(tenantId, (tx) => tx.outreachLead.findUniqueOrThrow({ where: { id: lead.id } }));
    expect(row.lastActivityAt).not.toBeNull();

    const timeline = await withTenant(tenantId, (tx) =>
      tx.outreachActivity.findMany({ where: { leadId: lead.id } }),
    );
    expect(timeline).toHaveLength(1);
    expect(timeline[0]!.channel).toBe("LinkedIn");
  });

  it("rejects a duplicate daily check-in for the same person and date", async () => {
    const today = new Date().toISOString();
    await executeCommand(founder, submitDailyCheckIn, { checkInDate: today, summary: "Did outreach." });
    await expect(
      executeCommand(founder, submitDailyCheckIn, { checkInDate: today, summary: "Again." }),
    ).rejects.toThrow();
  });

  it("submits a weekly report and a team weekly assessment", async () => {
    const weekStart = new Date().toISOString();
    const report = await executeCommand(founder, submitWeeklyReport, {
      weekStart,
      whatWorked: "LinkedIn outreach",
      nextWeekTargetValue: 10,
    });
    expect(report.id).toBeTruthy();

    const assessment = await executeCommand(seniorA, submitTeamWeeklyAssessment, {
      teamId: teamAId,
      weekStart,
      biggestLearning: "Personalize the first line.",
    });
    expect(assessment.id).toBeTruthy();
  });

  it("sets and lists a target", async () => {
    const periodStart = new Date().toISOString();
    const periodEnd = new Date(Date.now() + 7 * DAY_MS).toISOString();
    await executeCommand(founder, setOutreachTarget, {
      scope: "Team",
      teamId: teamAId,
      period: "Weekly",
      metric: "QualifiedProspects",
      targetValue: 10,
      periodStart,
      periodEnd,
    });
    const list = await withTenant(tenantId, (tx) => tx.outreachTarget.findMany({ where: { teamId: teamAId } }));
    expect(list.length).toBeGreaterThan(0);
  });

  it("supersedes rather than duplicates a target for the same scope/period/metric (Task 106 Phase 3)", async () => {
    const periodStart = new Date(Date.now() + 30 * DAY_MS).toISOString();
    const periodEnd = new Date(Date.now() + 37 * DAY_MS).toISOString();
    const first = await executeCommand(founder, setOutreachTarget, {
      scope: "Team",
      teamId: teamBId,
      period: "Weekly",
      metric: "Outreach",
      targetValue: 20,
      periodStart,
      periodEnd,
    });
    const second = await executeCommand(founder, setOutreachTarget, {
      scope: "Team",
      teamId: teamBId,
      period: "Weekly",
      metric: "Outreach",
      targetValue: 30,
      periodStart,
      periodEnd,
      changeReason: "Raised after strong week 1 response rate.",
    });

    const activeOnly = await executeQuery(founder, listOutreachTargets, { teamId: teamBId });
    const activeForPeriod = activeOnly.filter((t) => t.id === first.id || t.id === second.id);
    expect(activeForPeriod).toHaveLength(1);
    expect(activeForPeriod[0]).toMatchObject({ id: second.id, targetValue: 30, active: true });

    const withHistory = await executeQuery(founder, listOutreachTargets, { teamId: teamBId, includeSuperseded: true });
    const bothForPeriod = withHistory.filter((t) => t.id === first.id || t.id === second.id);
    expect(bothForPeriod).toHaveLength(2);
    const oldRow = bothForPeriod.find((t) => t.id === first.id);
    expect(oldRow).toMatchObject({ active: false, targetValue: 20 });

    const auditRows = await withTenant(tenantId, (tx) =>
      tx.activity.findMany({ where: { entityKey: ENTITY_TARGET, entityId: second.id, fieldChanged: "targetValue" } }),
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({ oldValue: "20", newValue: "30" });
  });

  describe("Phase 3: per-team query scoping", () => {
    it("lets a Founder query any team's leads", async () => {
      const leads = await executeQuery(founder, listOutreachLeads, { teamId: teamAId });
      expect(Array.isArray(leads)).toBe(true);
    });

    it("lets a Senior query their own team", async () => {
      const leads = await executeQuery(seniorA, listOutreachLeads, { teamId: teamAId });
      expect(Array.isArray(leads)).toBe(true);
    });

    it("blocks a Senior from querying another team's leads", async () => {
      await expect(executeQuery(seniorA, listOutreachLeads, { teamId: teamBId })).rejects.toThrow(ForbiddenError);
      await expect(executeQuery(seniorA, listOverdueFollowUps, { teamId: teamBId })).rejects.toThrow(ForbiddenError);
      await expect(executeQuery(seniorA, getFunnelCounts, { teamId: teamBId })).rejects.toThrow(ForbiddenError);
      await expect(
        executeQuery(seniorA, getTeamWeeklyRollup, {
          teamId: teamBId,
          weekStart: new Date(0).toISOString(),
          weekEnd: new Date().toISOString(),
        }),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  it("adds a team member with no maximum size enforced", async () => {
    const team = await executeCommand(founder, createOutreachTeam, {
      name: `Big Team ${randomUUID()}`,
      leaderId: seniorAPartyId,
    });
    for (let i = 0; i < 8; i += 1) {
      const identity = await withTenant(tenantId, (tx) =>
        provisionIdentity(tx, { organizationId, authUserId: randomUUID(), displayName: `Junior ${i}` }),
      );
      await executeCommand(founder, addTeamMember, { teamId: team.id, partyId: identity.partyId });
    }
    const memberships = await withTenant(tenantId, (tx) =>
      tx.outreachTeamMembership.findMany({ where: { teamId: team.id } }),
    );
    expect(memberships).toHaveLength(8); // no cap — 8 exceeds any "4-5" guidance, and succeeds
  });

  describe("roster management (2026-09-13 batch)", () => {
    it("soft-removes a member (active: false) rather than deleting the row", async () => {
      const identity = await withTenant(tenantId, (tx) =>
        provisionIdentity(tx, { organizationId, authUserId: randomUUID(), displayName: "Removable Junior" }),
      );
      await executeCommand(founder, addTeamMember, { teamId: teamAId, partyId: identity.partyId });
      await executeCommand(founder, removeTeamMember, { teamId: teamAId, partyId: identity.partyId });

      const membership = await withTenant(tenantId, (tx) =>
        tx.outreachTeamMembership.findFirstOrThrow({ where: { teamId: teamAId, partyId: identity.partyId } }),
      );
      expect(membership.active).toBe(false);
    });

    it("renames a team", async () => {
      const team = await executeCommand(founder, createOutreachTeam, {
        name: `Rename Me ${randomUUID()}`,
        leaderId: seniorAPartyId,
      });
      await executeCommand(founder, renameTeam, { teamId: team.id, name: "Renamed Team" });
      const row = await withTenant(tenantId, (tx) => tx.outreachTeam.findUniqueOrThrow({ where: { id: team.id } }));
      expect(row.name).toBe("Renamed Team");
    });

    it("lists only parties with no active roster slot, excluding leaders", async () => {
      const identity = await withTenant(tenantId, (tx) =>
        provisionIdentity(tx, { organizationId, authUserId: randomUUID(), displayName: "Unrostered Party" }),
      );
      const candidates = await executeQuery(founder, listAvailableParties, {});
      const ids = candidates.map((c) => c.id);
      expect(ids).toContain(identity.partyId); // never rostered anywhere — a legitimate candidate
      expect(ids).not.toContain(seniorAPartyId); // leads teamA — never offered as addable
    });
  });

  describe("escalation (2026-09-13 batch)", () => {
    it("flags a lead for escalation and resolves it", async () => {
      const lead = await executeCommand(founder, createOutreachLead, {
        teamId: teamAId,
        companyName: "Escalate Me Co",
        whyRelevant: "Test.",
        opportunityOwnerId: seniorAPartyId,
      });

      const flagged = await executeCommand(seniorA, flagForEscalation, {
        leadId: lead.id,
        note: "Large deal, needs Founder sign-off.",
        type: "Commercial",
        urgency: "High",
      });
      const flaggedRow = await withTenant(tenantId, (tx) =>
        tx.outreachLead.findUniqueOrThrow({ where: { id: flagged.id } }),
      );
      expect(flaggedRow.escalated).toBe(true);
      expect(flaggedRow.escalationNote).toBe("Large deal, needs Founder sign-off.");
      expect(flaggedRow.escalationType).toBe("Commercial");
      expect(flaggedRow.escalationUrgency).toBe("High");
      expect(flaggedRow.escalatedById).toBe(seniorAPartyId);
      expect(flaggedRow.escalatedAt).not.toBeNull();

      await executeCommand(founder, resolveEscalation, { leadId: lead.id });
      const resolvedRow = await withTenant(tenantId, (tx) =>
        tx.outreachLead.findUniqueOrThrow({ where: { id: lead.id } }),
      );
      expect(resolvedRow.escalated).toBe(false);
    });

    it("routes escalations to the Team Leader first (2026-09-13 hierarchical-architecture doc)", async () => {
      const leadA = await executeCommand(founder, createOutreachLead, {
        teamId: teamAId,
        companyName: "Team A Escalation Co",
        whyRelevant: "Test.",
        opportunityOwnerId: seniorAPartyId,
      });
      await executeCommand(seniorA, flagForEscalation, {
        leadId: leadA.id,
        note: "Needs a second look.",
        type: "TeamIssue",
        urgency: "Normal",
      });

      // Senior A, scoped to their own team, sees it.
      const seniorAView = await executeQuery(seniorA, listEscalatedLeads, { teamId: teamAId });
      expect(seniorAView.some((l) => l.id === leadA.id)).toBe(true);

      // Senior A cannot see Team B's escalation queue.
      await expect(executeQuery(seniorA, listEscalatedLeads, { teamId: teamBId })).rejects.toThrow(ForbiddenError);

      // Core, unscoped, still sees everything — no visibility was removed.
      const founderView = await executeQuery(founder, listEscalatedLeads, {});
      expect(founderView.some((l) => l.id === leadA.id)).toBe(true);

      await executeCommand(founder, resolveEscalation, { leadId: leadA.id });
    });
  });

  describe("team comparison (2026-09-13 batch)", () => {
    it("reports per-team member and lead counts across all teams", async () => {
      const rows = await executeQuery(founder, getTeamComparison, {});
      const teamARow = rows.find((r) => r.teamId === teamAId);
      expect(teamARow).toBeDefined();
      expect(teamARow!.teamName).toBe("Team A");
      expect(typeof teamARow!.leads).toBe("number");
      expect(typeof teamARow!.pipeline).toBe("number");
      expect(typeof teamARow!.closed).toBe("number");
    });
  });

  describe("company pulse + intelligence (Task 106 Phase 7, spec §84-85, §90)", () => {
    let manufacturingLeadId: string;

    beforeAll(async () => {
      const lead = await executeCommand(founder, createOutreachLead, {
        teamId: teamAId,
        companyName: "Phase Seven Manufacturing",
        whyRelevant: "Fragmented purchasing.",
        opportunityOwnerId: seniorAPartyId,
        industry: "Manufacturing",
      });
      manufacturingLeadId = lead.id;
      await executeCommand(founder, createOutreachLead, {
        teamId: teamBId,
        companyName: "Phase Seven No Industry",
        whyRelevant: "Test.",
        opportunityOwnerId: seniorAPartyId,
      });
      await executeCommand(founder, logOutreachActivity, {
        leadId: lead.id,
        channel: "LinkedIn",
        activityType: "FirstOutreach",
        message: "Intro note.",
      });
      await executeCommand(founder, logOutreachActivity, {
        leadId: lead.id,
        channel: "LinkedIn",
        activityType: "Response",
        response: "Interested.",
      });
    });

    it("reports the organisation-wide pulse, all-time and windowed", async () => {
      const allTime = await executeQuery(founder, getCompanyPulse, {});
      expect(allTime.activeTeams).toBeGreaterThanOrEqual(2);
      expect(allTime.outreach).toBeGreaterThanOrEqual(1);
      expect(allTime.responses).toBeGreaterThanOrEqual(1);
      expect(allTime.responseRate).not.toBeNull();
      expect(allTime.activePipeline).toBeGreaterThanOrEqual(1);

      // A window entirely in the past contains none of this run's activity.
      const past = await executeQuery(founder, getCompanyPulse, {
        from: new Date(Date.now() - 400 * DAY_MS).toISOString(),
        to: new Date(Date.now() - 399 * DAY_MS).toISOString(),
      });
      expect(past.outreach).toBe(0);
      expect(past.leads).toBe(0);
      expect(past.responseRate).toBeNull();
      // Open pipeline is point-in-time, never windowed.
      expect(past.activePipeline).toBe(allTime.activePipeline);
    });

    it("team comparison carries the leader's name, a window and a response rate", async () => {
      const rows = await executeQuery(founder, getTeamComparison, {});
      const teamA = rows.find((r) => r.teamId === teamAId)!;
      expect(teamA.leaderName).toBe("Senior A");
      // The Targets test above set a 10-per-period target for this team.
      expect(teamA.target).toBe(10);
      expect(teamA.outreach).toBeGreaterThanOrEqual(1);
      expect(teamA.responseRate).not.toBeNull();

      const windowed = await executeQuery(founder, getTeamComparison, {
        from: new Date(Date.now() - 400 * DAY_MS).toISOString(),
        to: new Date(Date.now() - 399 * DAY_MS).toISOString(),
      });
      expect(windowed.find((r) => r.teamId === teamAId)!.outreach).toBe(0);
    });

    it("groups performance by industry, flagging thin samples (§52-53)", async () => {
      const rows = await executeQuery(founder, getVerticalIntelligence, {});
      const manufacturing = rows.find((r) => r.key === "Manufacturing")!;
      expect(manufacturing).toBeDefined();
      expect(manufacturing.leads).toBeGreaterThanOrEqual(1);
      expect(manufacturing.outreach).toBeGreaterThanOrEqual(1);
      expect(manufacturing.responses).toBeGreaterThanOrEqual(1);
      expect(manufacturing.thinSample).toBe(true);
      // Leads with no industry land in one named bucket, never vanish.
      expect(rows.some((r) => r.key === "Unspecified")).toBe(true);
    });

    it("groups performance by channel, counting distinct leads touched (§53)", async () => {
      const rows = await executeQuery(founder, getChannelIntelligence, {});
      const linkedIn = rows.find((r) => r.key === "LinkedIn")!;
      expect(linkedIn).toBeDefined();
      expect(linkedIn.leads).toBeGreaterThanOrEqual(1);
      expect(linkedIn.outreach).toBeGreaterThanOrEqual(1);
      expect(linkedIn.responseRate).not.toBeNull();
      void manufacturingLeadId;
    });

    it("reads the funnel as reach-or-beyond so conversion is a ratio of one population (§63, §90)", async () => {
      const funnel = await executeQuery(founder, getConversionFunnel, {});
      expect(funnel.stages.map((s) => s.key)[0]).toBe("research");
      expect(funnel.stages.at(-1)!.key).toBe("closed_won");
      for (let i = 1; i < funnel.stages.length; i += 1) {
        expect(funnel.stages[i]!.reached).toBeLessThanOrEqual(funnel.stages[i - 1]!.reached);
      }
      expect(funnel.stages[0]!.conversionFromPrevious).toBeNull();
      expect(funnel.stages[0]!.reached).toBeGreaterThanOrEqual(funnel.stages[0]!.atStage);
      expect(funnel.bottleneck === null || typeof funnel.bottleneck === "string").toBe(true);
    });
  });

  describe("company direction fields (Task 106 Phase 7, spec §91, §66)", () => {
    it("stores the extended fields; the prior direction reads Closed at the next one's postedAt, derived", async () => {
      const first = await executeCommand(founder, postCompanyDirection, {
        weekLabel: "Week 1",
        priorityVertical: "Retail",
        priorityIndustries: ["Retail", "Hospitality"],
        geographicFocus: "Delhi NCR",
        targetCompanyProfile: "50-500 staff, multi-outlet",
        secondaryOpportunity: "Agency digital systems",
      });
      const current = await executeQuery(founder, getCurrentDirection, {});
      expect(current?.id).toBe(first.id);
      expect(current?.priorityIndustries).toEqual(["Retail", "Hospitality"]);
      expect(current?.geographicFocus).toBe("Delhi NCR");
      expect(current?.targetCompanyProfile).toBe("50-500 staff, multi-outlet");
      expect(current?.secondaryOpportunity).toBe("Agency digital systems");
      expect(current?.closedAt).toBeNull();

      const second = await executeCommand(founder, postCompanyDirection, { weekLabel: "Week 2", priorityVertical: "Manufacturing" });
      const history = await executeQuery(founder, listDirections, {});
      const closed = history.find((d) => d.id === first.id)!;
      const active = history.find((d) => d.id === second.id)!;
      expect(closed.status).toBe("Closed");
      expect(closed.closedAt).toEqual(active.postedAt);
      expect(active.status).toBe("Active");
      expect(active.closedAt).toBeNull();
      // The table is append-only: the earlier row itself is untouched.
      const raw = await withTenant(tenantId, (tx) => tx.outreachDirection.findUniqueOrThrow({ where: { id: first.id } }));
      expect(raw.priorityVertical).toBe("Retail");
      // Defaults when omitted: an empty list, not null.
      expect(history.find((d) => d.id === second.id)!.priorityIndustries).toEqual([]);
    });
  });

  describe("AI insights (Task 106 Phase 8, master-context §85, §32-33)", () => {
    let leadId: string;
    beforeAll(async () => {
      const lead = await executeCommand(founder, createOutreachLead, {
        teamId: teamAId,
        companyName: "Phase Eight Co",
        whyRelevant: "Test.",
        opportunityOwnerId: seniorAPartyId,
      });
      leadId = lead.id;
    });

    it("the prompt names the reads, forbids commands, and restates §85's never-list", () => {
      const prompt = insightPrompt("NextStep", leadId);
      expect(prompt).toContain(leadId);
      expect(prompt).toContain("verity.outreach.lead_timeline");
      expect(prompt).toContain("Do not call any command");
      expect(prompt).toMatch(/never claim a deal is closed/i);
      expect(prompt).toMatch(/never draft a message to send/i);
    });

    it("records a suggestion with provenance and lists it back, newest first", async () => {
      const saved = await executeCommand(founder, recordAiInsight, {
        leadId,
        kind: "Summary",
        content: "A manufacturing prospect, contacted once, awaiting reply.",
        model: "test-model",
        promptVersion: "2026-09-15.1",
        sourceReads: ["verity.outreach.list_leads", "verity.outreach.lead_timeline"],
      });
      const rows = await executeQuery(founder, listAiInsights, { leadId });
      expect(rows[0]?.id).toBe(saved.id);
      expect(rows[0]?.requestedByPartyId).toBe(founderPartyId);
      expect(rows[0]?.sourceReads).toEqual(["verity.outreach.list_leads", "verity.outreach.lead_timeline"]);
      expect(rows[0]?.model).toBe("test-model");
    });

    it("a leader of another team can neither record nor list suggestions on this lead", async () => {
      await expect(
        executeCommand(seniorB, recordAiInsight, {
          leadId,
          kind: "Summary",
          content: "x",
          model: "m",
          promptVersion: "v",
          sourceReads: [],
        }),
      ).rejects.toThrow(ForbiddenError);
      await expect(executeQuery(seniorB, listAiInsights, { leadId })).rejects.toThrow(ForbiddenError);
    });

    it("the action persists the turn's reply with the queries it actually ran as provenance", async () => {
      currentActor.value = founder;
      agentTurn.mockResolvedValueOnce({
        reply: "  Suggest a follow-up call; the last activity was a week ago.  ",
        toolCalls: [
          { key: "verity.outreach.list_leads", kind: "query", input: { leadId }, ok: true, output: [] },
          { key: "verity.outreach.lead_timeline", kind: "query", input: { leadId }, ok: true, output: [] },
          { key: "verity.outreach.list_contacts", kind: "query", input: { leadId }, ok: false, output: "boom" },
        ],
      });
      const result = await generateLeadInsight({ leadId, kind: "NextStep" });
      expect(result.ok).toBe(true);
      const rows = await executeQuery(founder, listAiInsights, { leadId });
      const row = rows.find((r) => r.kind === "NextStep")!;
      expect(row.content).toBe("Suggest a follow-up call; the last activity was a week ago.");
      // Only successful reads count as grounding; the failed one is not claimed.
      expect(row.sourceReads).toEqual(["verity.outreach.list_leads", "verity.outreach.lead_timeline"]);
      if (process.env.VERITY_TEST_REAL_AGENT !== "1") expect(row.model).toBe("test-model");
      expect(agentTurn).toHaveBeenCalledTimes(1);
      expect(agentTurn.mock.calls[0]![0]).toBe(founder);
      // The turn is narrowed to the four reads — enforced, not merely asked.
      expect(agentTurn.mock.calls[0]![3]).toEqual({ toolKeys: INSIGHT_TOOL_KEYS });
    });

    it("the action refuses to record a reply that read nothing", async () => {
      currentActor.value = founder;
      agentTurn.mockResolvedValueOnce({ reply: "Probably a great fit.", toolCalls: [] });
      const result = await generateLeadInsight({ leadId, kind: "Qualification" });
      expect(result.ok).toBe(false);
      const rows = await executeQuery(founder, listAiInsights, { leadId });
      expect(rows.some((r) => r.kind === "Qualification")).toBe(false);
    });

    // Opt-in, costs a real model call: VERITY_TEST_REAL_AGENT=1 with the
    // provider variables set. Proves the prompt actually drives the reads
    // the provenance claims, against the throwaway tenant, never a real one.
    (process.env.VERITY_TEST_REAL_AGENT === "1" ? it : it.skip)("LIVE: a real turn reads the lead's records and records a grounded summary", async () => {
      currentActor.value = founder;
      await executeCommand(founder, logOutreachActivity, {
        leadId,
        channel: "LinkedIn",
        activityType: "FirstOutreach",
        message: "Intro note about fragmented purchasing.",
      });
      agentTurn.mockImplementationOnce(realAgentTurn.value as typeof agentTurn);
      const result = await generateLeadInsight({ leadId, kind: "Summary" });
      console.log("LIVE result:", result);
      expect(result.ok).toBe(true);
      const rows = await executeQuery(founder, listAiInsights, { leadId });
      const row = rows.find((r) => r.kind === "Summary" && r.model !== "test-model")!;
      expect(row).toBeDefined();
      expect(row.sourceReads).toContain("verity.outreach.lead_timeline");
      expect(String(row.content).length).toBeGreaterThan(40);
      console.log("LIVE summary:", row.content, "\nreads:", row.sourceReads);
    }, 120_000);

    it("the action authorizes the lead as the actor before spending a turn", async () => {
      currentActor.value = seniorB;
      agentTurn.mockClear();
      const result = await generateLeadInsight({ leadId, kind: "Summary" });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.code).toBe("E_FORBIDDEN");
      expect(agentTurn).not.toHaveBeenCalled();
    });
  });
});
