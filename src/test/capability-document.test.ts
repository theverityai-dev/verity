import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { checksumOf, registerStorageDriver } from "@/server/platform/files";
import {
  DOCUMENT_CAPABILITY,
  ENTITY_DOCUMENT,
  ENTITY_DOCUMENT_RELEASE,
  ENTITY_DOCUMENT_REVISION,
  ENTITY_DOCUMENT_SELF_RELEASE,
  ENTITY_DOCUMENT_TYPE,
  addMonths,
  approveRevision,
  attachRevisionFile,
  chooseSegments,
  createDocument,
  defineDocumentType,
  documentDetail,
  documentsFor,
  fillNumber,
  linkRevision,
  listDocuments,
  numberPrefix,
  obsoleteRevision,
  openRevision,
  parsePattern,
  registerDocumentCapability,
  rejectRevision,
  reserveRevisionFile,
  startRevision,
  submitRevision,
} from "@/server/capabilities/document";
import type { Segment } from "@/server/capabilities/document/numbering";

/**
 * Controlled documents (ADR-048): numbers from a pattern and chosen codes, a revision lifecycle with a separate
 * release permission, immutability that also holds in the database, an append-only access log, and isolation.
 */

const SEGMENTS: Segment[] = [
  { key: "client", label: "Client", options: [{ code: "A", label: "Atomic Research Centre" }, { code: "B", label: "Bharat Heavy" }] },
  { key: "division", label: "Division", options: [{ code: "3", label: "Magnets" }, { code: "4", label: "Transformers" }] },
];

describe("document number patterns", () => {
  it("builds a prefix from the pattern and fills the running part", () => {
    const tokens = parsePattern("IN-{SEG:client}{SEG:division}-{TYPE}-{SEQ:3}", SEGMENTS);
    const prefix = numberPrefix(tokens, { typeKey: "drg", year: "2026", chosen: { client: "A", division: "4" } });
    expect(prefix).toBe("IN-A4-DRG-#");
    expect(fillNumber(prefix, tokens, 7)).toBe("IN-A4-DRG-007");
  });

  it("refuses patterns that cannot produce a safe, unique number", () => {
    expect(() => parsePattern("{TYPE}", SEGMENTS)).toThrow(/exactly one \{SEQ/);
    expect(() => parsePattern("{SEQ:3}{SEQ:3}", SEGMENTS)).toThrow(/exactly one \{SEQ/);
    expect(() => parsePattern("{SEG:region}-{SEQ:3}", SEGMENTS)).toThrow(/no segment "region"/);
    expect(() => parsePattern("{NOPE}-{SEQ:3}", SEGMENTS)).toThrow(/unknown token/);
    expect(() => parsePattern("A B-{SEQ:3}", SEGMENTS)).toThrow(/letters, digits/);
    expect(() => parsePattern("{SEQ:1}", SEGMENTS)).toThrow(/between 2 and 8/);
  });

  it("needs one of the type's own codes for every segment, and refuses a full series", () => {
    expect(() => chooseSegments(SEGMENTS, { client: "A" })).toThrow(/choose a division/);
    expect(() => chooseSegments(SEGMENTS, { client: "Z", division: "3" })).toThrow(/choose a client/);
    expect(chooseSegments(SEGMENTS, { client: "B", division: "3" })).toEqual({ client: "B", division: "3" });
    const tokens = parsePattern("D-{SEQ:2}", []);
    expect(() => fillNumber("D-#", tokens, 100)).toThrow(/series is full/);
  });

  it("adds months keeping the day, clamped at month end", () => {
    expect(addMonths("2026-10-19", 12)).toBe("2027-10-19");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 3)).toBe("2027-03-15");
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;
if (!hasDatabase) {
  const message = "capability-document.test.ts cannot run its database tests: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describeDb("capability: Document (controlled engineering documents)", () => {
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const created = { users: [] as string[], parties: [] as string[] };

  let author: ActorContext;
  let approver: ActorContext;
  let owner: ActorContext;
  let drawingTypeId: string;
  let traveller: { id: string };
  let jobId: string;

  beforeEach(() => {
    registerStorageDriver({
      name: "test",
      createUploadUrl: async (key) => ({ url: `https://test.invalid/put/${key}`, headers: { "content-type": "application/pdf" } }),
      createReadUrl: async (key) => `https://test.invalid/get/${key}`,
      storeVerified: async () => {},
      delete: async () => {},
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    registerStorageDriver(null);
  });

  beforeAll(async () => {
    await assertRlsEnforceable();
    clearCommands();
    clearQueries();
    clearHooks();
    clearScopeResolvers();
    clearTransitionGuards();
    clearContributions();
    registerDocumentCapability();

    await withTenant(tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: "Documents Test Works", timeZone: "Asia/Kolkata" } });
      await activateCapability(tx, tenantId, DOCUMENT_CAPABILITY);
      const organizationId = (await tx.organization.create({ data: { tenantId, name: "Works" } })).id;

      const grant = async (roleId: string, entities: string[], verbs: Array<"Read" | "Create" | "Edit" | "ActionExecute">) =>
        tx.permission.createMany({
          data: entities.flatMap((entity) => verbs.map((verb) => ({ tenantId, roleId, verb, entity, scope: "Tenant" as const }))),
        });
      const authoring = [ENTITY_DOCUMENT_TYPE, ENTITY_DOCUMENT, ENTITY_DOCUMENT_REVISION];

      const authorRole = await tx.role.create({ data: { tenantId, name: "Author" }, select: { id: true } });
      await grant(authorRole.id, authoring, ["Read", "Create", "Edit", "ActionExecute"]);
      const approverRole = await tx.role.create({ data: { tenantId, name: "Approver" }, select: { id: true } });
      await grant(approverRole.id, [ENTITY_DOCUMENT, ENTITY_DOCUMENT_REVISION], ["Read"]);
      await grant(approverRole.id, [ENTITY_DOCUMENT_RELEASE], ["ActionExecute"]);
      const ownerRole = await tx.role.create({ data: { tenantId, name: "Owner" }, select: { id: true } });
      await grant(ownerRole.id, authoring, ["Read", "Create", "Edit", "ActionExecute"]);
      await grant(ownerRole.id, [ENTITY_DOCUMENT_RELEASE, ENTITY_DOCUMENT_SELF_RELEASE], ["ActionExecute"]);

      const person = async (name: string, roleId: string): Promise<ActorContext> => {
        const identity = await provisionIdentity(tx, { organizationId, authUserId: randomUUID(), displayName: name });
        created.users.push(identity.userId);
        created.parties.push(identity.partyId);
        await tx.tenantMembership.update({ where: { id: identity.membershipId }, data: { roleId } });
        return { tenantId, userId: identity.userId, membershipId: identity.membershipId, organizationId, roleId };
      };
      author = await person("Asha Author", authorRole.id);
      approver = await person("Anil Approver", approverRole.id);
      owner = await person("Olivia Owner", ownerRole.id);

      jobId = (await tx.projectJob.create({ data: { tenantId, number: 1, title: "Magnet for lab", customerName: "Atomic Research Centre" } })).id;
    });
    await withTenant(otherTenantId, (tx) => tx.tenant.create({ data: { id: otherTenantId, name: "Other Works" } }));
    invalidateCapabilityCache();

    drawingTypeId = (
      await executeCommand(author, defineDocumentType, {
        key: "drg",
        label: "Drawing",
        pattern: "IN-{SEG:client}{SEG:division}-{TYPE}-{SEQ:3}",
        segments: SEGMENTS,
        validMonths: 12,
      })
    ).id;
    traveller = await executeCommand(author, defineDocumentType, {
      key: "trv",
      label: "Traveller",
      pattern: "{TYPE}-{YEAR}-{SEQ:4}",
      requiresApproval: false,
      validMonths: 6,
    });
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
      await admin.$executeRaw`DELETE FROM tenant WHERE id IN (${tenantId}::uuid, ${otherTenantId}::uuid)`;
      for (const id of created.users) await admin.$executeRaw`DELETE FROM "user" WHERE id = ${id}::uuid`;
      for (const id of created.parties) await admin.$executeRaw`DELETE FROM party WHERE id = ${id}::uuid`;
    } finally {
      await admin.$disconnect();
    }
    await prisma.$disconnect();
  });

  /** A file on the draft without going through storage, so lifecycle tests do not depend on a driver. */
  async function putFile(revisionId: string) {
    await withTenant(tenantId, async (tx) => {
      const file = await tx.storedFile.create({
        data: {
          tenantId, storageKey: `${tenantId}/${randomUUID()}/drawing.pdf`, fileName: "drawing.pdf", mimeType: "application/pdf",
          byteSize: 12, checksum: "abc", status: "Stored", confirmedAt: new Date(), entityKey: ENTITY_DOCUMENT_REVISION, entityId: revisionId,
        },
      });
      await tx.documentRevision.update({ where: { id: revisionId }, data: { fileId: file.id } });
    });
  }
  const drawing = (title: string, client = "A", division = "4") =>
    executeCommand(author, createDocument, { typeId: drawingTypeId, title, segments: { client, division } });
  const detail = async (documentId: string) =>
    (await executeQuery(author, documentDetail, { documentId })) as {
      revisions: Array<Record<string, unknown>>;
      currentRevisionId: string | null;
      links: Array<Record<string, unknown>>;
      access: { count: number };
    };

  it("numbers a document from its client and division, and each client counts on its own", async () => {
    const a1 = await drawing("Coil winding jig");
    const a2 = await drawing("Yoke drawing");
    const b1 = await drawing("Pole piece", "B");
    expect(a1.number).toBe("IN-A4-DRG-001");
    expect(a2.number).toBe("IN-A4-DRG-002");
    expect(b1.number).toBe("IN-B4-DRG-001");
    await expect(executeCommand(author, createDocument, { typeId: drawingTypeId, title: "No client", segments: { division: "4" } })).rejects.toThrow(/choose a client/);
  });

  it("gives parallel documents different numbers (advisory lock), with no gaps", async () => {
    const made = await Promise.all(Array.from({ length: 6 }, (_, i) => drawing(`Parallel ${i}`, "B", "3")));
    const numbers = made.map((m) => m.number).sort();
    expect(new Set(numbers).size).toBe(6);
    expect(numbers).toEqual(["IN-B3-DRG-001", "IN-B3-DRG-002", "IN-B3-DRG-003", "IN-B3-DRG-004", "IN-B3-DRG-005", "IN-B3-DRG-006"]);
  });

  it("takes a draft through review to release, supersedes the previous revision, and keeps exactly one released", async () => {
    const doc = await drawing("Lifecycle drawing", "A", "3");
    await expect(executeCommand(author, submitRevision, { revisionId: doc.revisionId })).rejects.toThrow(/attach the file/);
    await putFile(doc.revisionId);
    await executeCommand(author, submitRevision, { revisionId: doc.revisionId });

    await expect(executeCommand(approver, approveRevision, { revisionId: doc.revisionId, effectiveFrom: "2026-10-20" })).resolves.toMatchObject({ validUntil: "2027-10-20" });
    let d = await detail(doc.id);
    expect(d.revisions[0]).toMatchObject({ label: "R01", status: "released", approvedBy: "Anil Approver", effectiveFrom: "2026-10-20" });
    expect(d.currentRevisionId).toBe(doc.revisionId);

    // A second revision needs a reason; one open revision at a time.
    await expect(executeCommand(author, startRevision, { documentId: doc.id, changeReason: "" })).rejects.toThrow();
    const r2 = await executeCommand(author, startRevision, { documentId: doc.id, changeReason: "Pole gap corrected to 40 mm" });
    expect(r2.label).toBe("R02");
    await expect(executeCommand(author, startRevision, { documentId: doc.id, changeReason: "Another change" })).rejects.toThrow(/open revision/);
    await putFile(r2.id);
    await executeCommand(author, submitRevision, { revisionId: r2.id });
    await executeCommand(approver, approveRevision, { revisionId: r2.id });

    d = await detail(doc.id);
    expect(d.revisions.map((r) => [r.label, r.status])).toEqual([["R02", "released"], ["R01", "superseded"]]);
    expect(d.currentRevisionId).toBe(r2.id);
    expect(d.revisions.filter((r) => r.status === "released")).toHaveLength(1);
  });

  it("sends a revision back with a note, and lets the author fix and resubmit", async () => {
    const doc = await drawing("Rejected drawing", "A", "3");
    await putFile(doc.revisionId);
    await executeCommand(author, submitRevision, { revisionId: doc.revisionId });
    await expect(executeCommand(approver, rejectRevision, { revisionId: doc.revisionId, reviewNote: "x" })).rejects.toThrow();
    await executeCommand(approver, rejectRevision, { revisionId: doc.revisionId, reviewNote: "Dimension missing on the yoke" });
    const d = await detail(doc.id);
    expect(d.revisions[0]).toMatchObject({ status: "draft", reviewNote: "Dimension missing on the yoke" });
    await executeCommand(author, submitRevision, { revisionId: doc.revisionId });
  });

  it("separates authoring from release, and allows self-release only with the dedicated grant and a recorded reason", async () => {
    const doc = await drawing("Own work drawing", "A", "3");
    await putFile(doc.revisionId);
    await executeCommand(author, submitRevision, { revisionId: doc.revisionId });
    // An author's role holds no release permission at all.
    await expect(executeCommand(author, approveRevision, { revisionId: doc.revisionId })).rejects.toThrow();

    const own = await executeCommand(owner, createDocument, { typeId: drawingTypeId, title: "Owner's drawing", segments: { client: "A", division: "3" } });
    await putFile(own.revisionId);
    await executeCommand(owner, submitRevision, { revisionId: own.revisionId });
    await expect(executeCommand(owner, approveRevision, { revisionId: own.revisionId })).rejects.toThrow(/another person releases it/);
    await expect(executeCommand(owner, approveRevision, { revisionId: own.revisionId, selfApprovalReason: "short" })).rejects.toThrow();
    await executeCommand(owner, approveRevision, { revisionId: own.revisionId, selfApprovalReason: "Sole engineer on site; urgent release" });
    expect((await detail(own.id)).revisions[0]).toMatchObject({ status: "released", selfApprovalReason: "Sole engineer on site; urgent release" });
  });

  it("releases on submission when the type needs no approval, valid for its months", async () => {
    const trv = await executeCommand(author, createDocument, { typeId: traveller.id, title: "Traveller for lab magnet" });
    expect(trv.number).toMatch(/^TRV-\d{4}-0001$/);
    await putFile(trv.revisionId);
    const done = await executeCommand(author, submitRevision, { revisionId: trv.revisionId });
    expect(done.released).toBe(true);
    const d = await detail(trv.id);
    expect(d.revisions[0]).toMatchObject({ status: "released", expiry: "valid" });
  });

  it("marks a released revision expired once its valid-until date passes", async () => {
    const doc = await drawing("Short-lived drawing", "A", "3");
    await putFile(doc.revisionId);
    await executeCommand(author, submitRevision, { revisionId: doc.revisionId });
    await executeCommand(approver, approveRevision, { revisionId: doc.revisionId, effectiveFrom: "2020-01-01", validUntil: "2020-06-30" });
    expect((await detail(doc.id)).revisions[0]).toMatchObject({ expiry: "expired" });
    const rows = (await executeQuery(author, listDocuments, { q: "Short-lived" })) as Array<{ current: { expiry: string } | null }>;
    expect(rows[0]!.current!.expiry).toBe("expired");
    await expect(executeCommand(approver, approveRevision, { revisionId: doc.revisionId })).rejects.toThrow(/only a revision in review/);
  });

  it("withdraws the released revision with a reason, leaving the document with no current revision", async () => {
    const doc = await drawing("Withdrawn drawing", "A", "3");
    await putFile(doc.revisionId);
    await executeCommand(author, submitRevision, { revisionId: doc.revisionId });
    await executeCommand(approver, approveRevision, { revisionId: doc.revisionId });
    await executeCommand(approver, obsoleteRevision, { revisionId: doc.revisionId, reason: "Design withdrawn by the customer" });
    const d = await detail(doc.id);
    expect(d.revisions[0]).toMatchObject({ status: "obsolete", obsoleteReason: "Design withdrawn by the customer" });
    expect(d.currentRevisionId).toBeNull();
  });

  it("links the exact released revision to a job, and shows a newer release without moving the link", async () => {
    const doc = await drawing("Linked drawing", "A", "3");
    await expect(executeCommand(author, linkRevision, { revisionId: doc.revisionId, entityKey: "verity.project.job", entityId: jobId })).rejects.toThrow(/released revision/);
    await putFile(doc.revisionId);
    await executeCommand(author, submitRevision, { revisionId: doc.revisionId });
    await executeCommand(approver, approveRevision, { revisionId: doc.revisionId });
    await expect(executeCommand(author, linkRevision, { revisionId: doc.revisionId, entityKey: "verity.project.job", entityId: randomUUID() })).rejects.toThrow(/does not exist/);
    const first = await executeCommand(author, linkRevision, { revisionId: doc.revisionId, entityKey: "verity.project.job", entityId: jobId });
    const again = await executeCommand(author, linkRevision, { revisionId: doc.revisionId, entityKey: "verity.project.job", entityId: jobId });
    expect(again.id).toBe(first.id);

    const r2 = await executeCommand(author, startRevision, { documentId: doc.id, changeReason: "Tolerance tightened" });
    await putFile(r2.id);
    await executeCommand(author, submitRevision, { revisionId: r2.id });
    await executeCommand(approver, approveRevision, { revisionId: r2.id });

    const used = (await executeQuery(author, documentsFor, { entityKey: "verity.project.job", entityId: jobId })) as Array<Record<string, unknown>>;
    const mine = used.find((u) => u.number === doc.number)!;
    expect(mine).toMatchObject({ revisionLabel: "R01", revisionStatus: "superseded", currentLabel: "R02", newerReleaseExists: true });
  });

  it("logs every open and download, hands a superseded revision back with a banner, and hides another person's draft", async () => {
    const doc = await drawing("Audited drawing", "A", "3");
    await putFile(doc.revisionId);
    await expect(executeCommand(approver, openRevision, { revisionId: doc.revisionId, action: "open" })).rejects.toThrow(/still a draft/);
    await expect(executeCommand(author, openRevision, { revisionId: doc.revisionId, action: "open" })).resolves.toMatchObject({ banner: null });
    await executeCommand(author, submitRevision, { revisionId: doc.revisionId });
    await executeCommand(approver, approveRevision, { revisionId: doc.revisionId });
    const opened = await executeCommand(approver, openRevision, { revisionId: doc.revisionId, action: "download" });
    expect(opened.url).toMatch(/^https:\/\/test\.invalid\/get\//);
    expect(opened.banner).toBeNull();

    const r2 = await executeCommand(author, startRevision, { documentId: doc.id, changeReason: "New issue" });
    await putFile(r2.id);
    await executeCommand(author, submitRevision, { revisionId: r2.id });
    await executeCommand(approver, approveRevision, { revisionId: r2.id });
    expect(await executeCommand(approver, openRevision, { revisionId: doc.revisionId, action: "open" })).toMatchObject({ label: "R01", banner: "superseded" });
    expect((await detail(doc.id)).access.count).toBe(3);
  });

  it("attaches a file through the two-phase upload and refuses a mismatch", async () => {
    const doc = await drawing("Uploaded drawing", "A", "3");
    const bytes = Buffer.from("%PDF-1.4 demo drawing");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes)));
    const reserved = await executeCommand(author, reserveRevisionFile, { revisionId: doc.revisionId, fileName: "drawing.pdf", mimeType: "application/pdf", byteSize: bytes.byteLength });
    expect(reserved.uploadUrl).toContain("https://test.invalid/put/");
    expect(reserved.uploadHeaders).toBeTruthy();

    // A file reserved for another revision cannot be attached here.
    const other = await drawing("Other drawing", "A", "3");
    await expect(executeCommand(author, attachRevisionFile, { revisionId: other.revisionId, fileId: reserved.fileId, checksum: checksumOf(bytes), byteSize: bytes.byteLength })).rejects.toThrow(/not reserved for this revision/);

    const attached = await executeCommand(author, attachRevisionFile, { revisionId: doc.revisionId, fileId: reserved.fileId, checksum: checksumOf(bytes), byteSize: bytes.byteLength });
    expect(attached.status).toBe("Stored");
    await executeCommand(author, submitRevision, { revisionId: doc.revisionId });

    // The file is fixed once submitted.
    await expect(executeCommand(author, reserveRevisionFile, { revisionId: doc.revisionId, fileName: "again.pdf", mimeType: "application/pdf", byteSize: 10 })).rejects.toThrow(/draft revision/);
  });

  it("holds immutability in the database, not only in the commands", async () => {
    const doc = await drawing("Immutable drawing", "A", "3");
    await putFile(doc.revisionId);
    await executeCommand(author, submitRevision, { revisionId: doc.revisionId });
    // In review: the file is fixed.
    await expect(withTenant(tenantId, (tx) => tx.documentRevision.update({ where: { id: doc.revisionId }, data: { fileId: null } }))).rejects.toThrow(/fixed/);
    await executeCommand(approver, approveRevision, { revisionId: doc.revisionId });

    await expect(withTenant(tenantId, (tx) => tx.documentRevision.update({ where: { id: doc.revisionId }, data: { changeReason: "rewritten" } }))).rejects.toThrow(/immutable/);
    await expect(withTenant(tenantId, (tx) => tx.documentRevision.update({ where: { id: doc.revisionId }, data: { validUntil: new Date("2099-01-01") } }))).rejects.toThrow(/immutable/);
    await expect(withTenant(tenantId, (tx) => tx.documentRevision.update({ where: { id: doc.revisionId }, data: { status: "draft" } }))).rejects.toThrow(/cannot move/);
    await expect(withTenant(tenantId, (tx) => tx.documentRevision.delete({ where: { id: doc.revisionId } }))).rejects.toThrow(/never deleted/);
    await expect(withTenant(tenantId, (tx) => tx.document.update({ where: { id: doc.id }, data: { number: "IN-HACK-001" } }))).rejects.toThrow(/fixed once issued/);
    await expect(withTenant(tenantId, (tx) => tx.document.delete({ where: { id: doc.id } }))).rejects.toThrow(/never deleted/);

    // Skipping review is not possible either.
    const fresh = await drawing("Skip review", "A", "3");
    await putFile(fresh.revisionId);
    await expect(withTenant(tenantId, (tx) => tx.documentRevision.update({ where: { id: fresh.revisionId }, data: { status: "released", effectiveFrom: new Date(), releasedAt: new Date() } }))).rejects.toThrow(/cannot move/);

    // A link and the access log are append-only.
    const link = await executeCommand(author, linkRevision, { revisionId: doc.revisionId, entityKey: "verity.project.job", entityId: jobId });
    await expect(withTenant(tenantId, (tx) => tx.documentLink.delete({ where: { id: link.id } }))).rejects.toThrow(/append-only/);
    await executeCommand(approver, openRevision, { revisionId: doc.revisionId, action: "open" });
    const row = await withTenant(tenantId, (tx) => tx.documentAccessLog.findFirstOrThrow({ where: { documentId: doc.id } }));
    await expect(withTenant(tenantId, (tx) => tx.documentAccessLog.update({ where: { id: row.id }, data: { action: "download" } }))).rejects.toThrow(/append-only/);
    await expect(withTenant(tenantId, (tx) => tx.documentAccessLog.delete({ where: { id: row.id } }))).rejects.toThrow(/append-only/);
  });

  it("keeps another tenant's documents out of sight and out of reach", async () => {
    const doc = await drawing("Private drawing", "A", "3");
    expect(await withTenant(otherTenantId, (tx) => tx.document.findMany())).toEqual([]);
    expect(await withTenant(otherTenantId, (tx) => tx.documentRevision.findMany())).toEqual([]);
    expect(await withTenant(otherTenantId, (tx) => tx.documentAccessLog.findMany())).toEqual([]);
    await expect(
      withTenant(otherTenantId, (tx) =>
        tx.documentRevision.create({ data: { tenantId: otherTenantId, documentId: doc.id, revision: 9, label: "R09" } }),
      ),
    ).rejects.toThrow();
  });
});
