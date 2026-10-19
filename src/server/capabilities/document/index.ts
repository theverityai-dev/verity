import { z } from "zod";
import { registerCommand, ValidationError, type CommandContext, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { registerContribution } from "@/server/platform/contribution";
import { transition } from "@/server/platform/state";
import { diffFields, recordActivity } from "@/server/platform/audit";
import { hasTenantPermission } from "@/server/platform/authorization";
import { StorageUnavailableError, confirmUpload, readUrlFor, reserveUpload } from "@/server/platform/files";
import {
  DOCUMENT_CAPABILITY,
  ENTITY_DOCUMENT,
  ENTITY_DOCUMENT_RELEASE,
  ENTITY_DOCUMENT_REVISION,
  ENTITY_DOCUMENT_SELF_RELEASE,
  ENTITY_DOCUMENT_TYPE,
  LINKABLE_ENTITIES,
  revisionLabel,
} from "./shared";
import {
  allocateDocumentNumber,
  chooseSegments,
  fillNumber,
  numberPrefix,
  parsePattern,
  readSegments,
  segmentsSchema,
  yearIn,
} from "./numbering";

/**
 * CAPABILITY: Document (controlled engineering documents) — `verity.capability.document`.
 *
 * Authority: ADR-048 (PROPOSED; built on the product owner's 2026-10-19 instruction, see clients/dsew/decisions.md),
 * clients/dsew/phase1-design.md 3.2. A document is numbered once, revised through draft, review, release and
 * supersession, linked to the exact revision a job or order relied on, and every open or download is logged.
 *
 *  - Number: built from the type's pattern and the codes chosen for its segments; never re-used or edited.
 *  - Revision lifecycle through the state runtime: draft, in_review, released, superseded, obsolete. A revision's
 *    file is fixed when it is submitted; a released revision is immutable; a change is a new revision with a reason.
 *    Releasing one supersedes the previous in the same transaction. Immutability also holds in the database.
 *  - Release is its own permission (`verity.document.release`). An author releasing their own revision needs the
 *    dedicated `verity.document.self_release` grant AND a recorded reason; both are in the audit trail.
 *  - Evidence is not reused: a captured photograph is a fact, a controlled document is a managed artefact.
 *
 * NOT BUILT (ADR-048 defers them): CAD integration, drawing viewers, OCR and full-text search, transmittals,
 * e-signatures.
 */

export * from "./shared";
export { parsePattern, numberPrefix, fillNumber, chooseSegments, readSegments, segmentsSchema } from "./numbering";

/* --------------------------------- helpers -------------------------------- */

const DOCUMENT_FILE_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date as YYYY-MM-DD");

function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** `iso` plus whole months, keeping the day of month (clamped to the end of a shorter month). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

const asDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const dayText = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

async function timeZoneOf(ctx: CommandContext): Promise<string> {
  // The platform's temporal rule: a zone is resolved or explicitly UTC, never guessed.
  return (await ctx.tx.tenant.findUniqueOrThrow({ where: { id: ctx.actor.tenantId }, select: { timeZone: true } })).timeZone ?? "UTC";
}

async function loadRevision(ctx: CommandContext, revisionId: string) {
  const revision = await ctx.tx.documentRevision.findUnique({ where: { id: revisionId }, include: { document: { include: { type: true } } } });
  if (!revision) throw new ValidationError("E_VALIDATION: no such document revision");
  return revision;
}
type RevisionRow = Awaited<ReturnType<typeof loadRevision>>;

async function move(ctx: CommandContext, revision: { id: string; status: string }, toKey: string, commandKey: string, data: Record<string, unknown> = {}) {
  const moved = await transition(ctx, { entityKey: ENTITY_DOCUMENT_REVISION, entityId: revision.id, fromKey: revision.status, toKey });
  await ctx.tx.documentRevision.update({ where: { id: revision.id }, data: { status: toKey, ...data } });
  await recordActivity(ctx, {
    entityKey: ENTITY_DOCUMENT_REVISION,
    entityId: revision.id,
    commandKey,
    changes: diffFields({ status: revision.status }, { status: toKey }),
  });
  return moved.event;
}

/** Releases a revision that is in review: supersedes the current one and makes this the current, in one transaction. */
async function release(
  ctx: CommandContext,
  revision: RevisionRow,
  input: { effectiveFrom?: string; validUntil?: string; selfApprovalReason?: string },
  commandKey: string,
) {
  if (revision.status !== "in_review") throw new ValidationError("E_VALIDATION: only a revision in review can be released");
  if (!revision.fileId) throw new ValidationError("E_VALIDATION: attach the file before releasing");

  const tz = await timeZoneOf(ctx);
  const effectiveFrom = input.effectiveFrom ?? todayIn(tz);
  const validUntil = input.validUntil ?? (revision.document.type.validMonths ? addMonths(effectiveFrom, revision.document.type.validMonths) : null);
  if (validUntil && validUntil < effectiveFrom) throw new ValidationError("E_VALIDATION: valid until is before the effective date");

  const events = [];
  const previous = await ctx.tx.documentRevision.findFirst({ where: { documentId: revision.documentId, status: "released" } });
  if (previous) events.push(await move(ctx, previous, "superseded", commandKey));
  events.push(
    await move(ctx, revision, "released", commandKey, {
      effectiveFrom: asDate(effectiveFrom),
      validUntil: validUntil ? asDate(validUntil) : null,
      approvedById: ctx.actor.userId,
      selfApprovalReason: input.selfApprovalReason ?? null,
      releasedAt: new Date(),
    }),
  );
  await ctx.tx.document.update({ where: { id: revision.documentId }, data: { currentRevisionId: revision.id } });
  return { events, superseded: previous?.id ?? null, validUntil };
}

/* ------------------------------ document types ----------------------------- */

export const defineDocumentType: CommandDefinition<
  {
    key: string;
    label: string;
    pattern: string;
    segments?: z.infer<typeof segmentsSchema>;
    requiresApproval?: boolean;
    validMonths?: number;
  },
  { id: string }
> = {
  key: "verity.document.define_type",
  entity: ENTITY_DOCUMENT_TYPE,
  verb: "Create",
  input: z.object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,29}$/, "lowercase letters, digits and underscores"),
    label: z.string().trim().min(1).max(80),
    pattern: z.string().min(1).max(120),
    segments: segmentsSchema.optional(),
    requiresApproval: z.boolean().optional(),
    validMonths: z.number().int().min(1).max(600).optional(),
  }),
  handler: async (ctx, input) => {
    parsePattern(input.pattern, input.segments ?? []);
    if (await ctx.tx.documentType.findFirst({ where: { key: input.key } })) {
      throw new ValidationError(`E_VALIDATION: a document type "${input.key}" already exists`);
    }
    const type = await ctx.tx.documentType.create({
      data: {
        tenantId: ctx.actor.tenantId,
        key: input.key,
        label: input.label,
        pattern: input.pattern,
        segments: (input.segments ?? []) as never,
        requiresApproval: input.requiresApproval ?? true,
        validMonths: input.validMonths ?? null,
      },
    });
    return { result: { id: type.id }, events: [] };
  },
};

export const setDocumentTypeActive: CommandDefinition<{ typeId: string; active: boolean }, { id: string }> = {
  key: "verity.document.set_type_active",
  entity: ENTITY_DOCUMENT_TYPE,
  verb: "Edit",
  input: z.object({ typeId: z.string().uuid(), active: z.boolean() }),
  handler: async (ctx, input) => {
    await ctx.tx.documentType.update({ where: { id: input.typeId }, data: { active: input.active } });
    return { result: { id: input.typeId }, events: [] };
  },
};

/* -------------------------------- documents -------------------------------- */

export const createDocument: CommandDefinition<
  { typeId: string; title: string; classification?: "internal" | "customer"; segments?: Record<string, string> },
  { id: string; number: string; revisionId: string }
> = {
  key: "verity.document.create",
  entity: ENTITY_DOCUMENT,
  verb: "Create",
  input: z.object({
    typeId: z.string().uuid(),
    title: z.string().trim().min(3).max(200),
    classification: z.enum(["internal", "customer"]).optional(),
    segments: z.record(z.string(), z.string()).optional(),
  }),
  handler: async (ctx, input) => {
    const type = await ctx.tx.documentType.findUnique({ where: { id: input.typeId } });
    if (!type || !type.active) throw new ValidationError("E_VALIDATION: choose an active document type");
    const segments = readSegments(type.segments);
    const tokens = parsePattern(type.pattern, segments);
    const chosen = chooseSegments(segments, input.segments);
    const prefix = numberPrefix(tokens, { typeKey: type.key, year: yearIn(await timeZoneOf(ctx)), chosen });
    const sequence = await allocateDocumentNumber(ctx.tx, ctx.actor.tenantId, prefix);
    const number = fillNumber(prefix, tokens, sequence);

    const document = await ctx.tx.document.create({
      data: {
        tenantId: ctx.actor.tenantId,
        number,
        typeId: type.id,
        title: input.title,
        classification: input.classification ?? "internal",
        segments: chosen as never,
        createdById: ctx.actor.userId,
      },
    });
    const revision = await ctx.tx.documentRevision.create({
      data: { tenantId: ctx.actor.tenantId, documentId: document.id, revision: 1, label: revisionLabel(1), authoredById: ctx.actor.userId },
    });
    await recordActivity(ctx, {
      entityKey: ENTITY_DOCUMENT,
      entityId: document.id,
      commandKey: "verity.document.create",
      changes: diffFields({ number: "" }, { number }),
    });
    return {
      result: { id: document.id, number, revisionId: revision.id },
      events: [{ name: "verity.document.created", entityId: document.id, payload: { number, type: type.key } }],
    };
  },
};

export const startRevision: CommandDefinition<{ documentId: string; changeReason: string }, { id: string; label: string }> = {
  key: "verity.document.start_revision",
  entity: ENTITY_DOCUMENT_REVISION,
  verb: "Create",
  input: z.object({ documentId: z.string().uuid(), changeReason: z.string().trim().min(3).max(500) }),
  handler: async (ctx, input) => {
    const revisions = await ctx.tx.documentRevision.findMany({ where: { documentId: input.documentId }, orderBy: { revision: "desc" } });
    if (revisions.length === 0) throw new ValidationError("E_VALIDATION: no such document");
    if (revisions.some((r) => r.status === "draft" || r.status === "in_review")) {
      throw new ValidationError("E_VALIDATION: finish or reject the open revision before starting another");
    }
    const next = revisions[0]!.revision + 1;
    const created = await ctx.tx.documentRevision.create({
      data: {
        tenantId: ctx.actor.tenantId,
        documentId: input.documentId,
        revision: next,
        label: revisionLabel(next),
        changeReason: input.changeReason,
        authoredById: ctx.actor.userId,
      },
    });
    await recordActivity(ctx, {
      entityKey: ENTITY_DOCUMENT_REVISION,
      entityId: created.id,
      commandKey: "verity.document.start_revision",
      changes: diffFields({ revision: "" }, { revision: created.label }),
    });
    return { result: { id: created.id, label: created.label }, events: [{ name: "verity.document.revision_started", entityId: created.id }] };
  },
};

/** Phase one of attaching a file to a draft revision: reserves an unreadable record and an upload URL. */
export const reserveRevisionFile: CommandDefinition<
  { revisionId: string; fileName: string; mimeType: string; byteSize: number },
  { fileId: string; uploadUrl?: string; uploadHeaders?: Record<string, string> }
> = {
  key: "verity.document.reserve_file",
  entity: ENTITY_DOCUMENT_REVISION,
  verb: "Edit",
  input: z.object({
    revisionId: z.string().uuid(),
    fileName: z.string().min(1).max(200),
    mimeType: z.enum(DOCUMENT_FILE_TYPES),
    byteSize: z.number().int().positive(),
  }),
  handler: async (ctx, input) => {
    const revision = await loadRevision(ctx, input.revisionId);
    if (revision.status !== "draft") throw new ValidationError("E_VALIDATION: a file can only be attached to a draft revision");
    const reserved = await reserveUpload(ctx.tx, {
      tenantId: ctx.actor.tenantId,
      uploadedById: (await ctx.tx.user.findUniqueOrThrow({ where: { id: ctx.actor.userId } })).partyId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      entityKey: ENTITY_DOCUMENT_REVISION,
      entityId: revision.id,
    });
    return { result: { fileId: reserved.fileId, uploadUrl: reserved.uploadUrl, uploadHeaders: reserved.uploadHeaders }, events: [] };
  },
};

/** Phase two: confirm the bytes arrived and match, then attach the sealed file to the draft. */
export const attachRevisionFile: CommandDefinition<
  { revisionId: string; fileId: string; checksum: string; byteSize: number },
  { id: string; status: "Stored" | "Quarantined" }
> = {
  key: "verity.document.attach_file",
  entity: ENTITY_DOCUMENT_REVISION,
  verb: "Edit",
  input: z.object({
    revisionId: z.string().uuid(),
    fileId: z.string().uuid(),
    checksum: z.string().min(1),
    byteSize: z.number().int().positive(),
  }),
  handler: async (ctx, input) => {
    const revision = await loadRevision(ctx, input.revisionId);
    if (revision.status !== "draft") throw new ValidationError("E_VALIDATION: a file can only be attached to a draft revision");
    const file = await ctx.tx.storedFile.findUnique({ where: { id: input.fileId } });
    if (!file || file.entityKey !== ENTITY_DOCUMENT_REVISION || file.entityId !== revision.id) {
      throw new ValidationError("E_VALIDATION: that upload was not reserved for this revision");
    }
    const confirmed = await confirmUpload(ctx.tx, { fileId: input.fileId, checksum: input.checksum, byteSize: input.byteSize });
    if (!confirmed.ok) return { result: { id: revision.id, status: "Quarantined" }, events: [] };
    await ctx.tx.documentRevision.update({ where: { id: revision.id }, data: { fileId: input.fileId } });
    await recordActivity(ctx, {
      entityKey: ENTITY_DOCUMENT_REVISION,
      entityId: revision.id,
      commandKey: "verity.document.attach_file",
      changes: diffFields({ file: revision.fileId ?? "" }, { file: file.fileName }),
    });
    return { result: { id: revision.id, status: "Stored" }, events: [] };
  },
};

export const submitRevision: CommandDefinition<{ revisionId: string }, { id: string; released: boolean }> = {
  key: "verity.document.submit",
  entity: ENTITY_DOCUMENT_REVISION,
  verb: "ActionExecute",
  input: z.object({ revisionId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const revision = await loadRevision(ctx, input.revisionId);
    if (revision.status !== "draft") throw new ValidationError("E_VALIDATION: only a draft can be submitted");
    if (!revision.fileId) throw new ValidationError("E_VALIDATION: attach the file before submitting");
    const events = [
      await move(ctx, revision, "in_review", "verity.document.submit", { submittedAt: new Date(), submittedById: ctx.actor.userId }),
    ];
    // A type that does not need approval is released by its author on submission.
    let released = false;
    if (!revision.document.type.requiresApproval) {
      const inReview = await loadRevision(ctx, revision.id);
      events.push(...(await release(ctx, inReview, {}, "verity.document.submit")).events);
      released = true;
    }
    return { result: { id: revision.id, released }, events };
  },
};

export const approveRevision: CommandDefinition<
  { revisionId: string; effectiveFrom?: string; validUntil?: string; selfApprovalReason?: string },
  { id: string; superseded: string | null; validUntil: string | null }
> = {
  key: "verity.document.approve",
  entity: ENTITY_DOCUMENT_RELEASE,
  verb: "ActionExecute",
  input: z.object({
    revisionId: z.string().uuid(),
    effectiveFrom: isoDate.optional(),
    validUntil: isoDate.optional(),
    selfApprovalReason: z.string().trim().min(10).max(500).optional(),
  }),
  handler: async (ctx, input) => {
    const revision = await loadRevision(ctx, input.revisionId);
    const isOwnWork = revision.authoredById === ctx.actor.userId || revision.submittedById === ctx.actor.userId;
    if (isOwnWork) {
      if (!input.selfApprovalReason) {
        throw new ValidationError("E_VALIDATION: you wrote or submitted this revision; another person releases it, or give the recorded reason for releasing your own");
      }
      if (!(await hasTenantPermission(ctx.tx, ctx.actor.roleId, "ActionExecute", ENTITY_DOCUMENT_SELF_RELEASE))) {
        throw new ValidationError("E_VALIDATION: your role may not release a revision you wrote; ask another approver");
      }
    }
    const done = await release(ctx, revision, { ...input, selfApprovalReason: isOwnWork ? input.selfApprovalReason : undefined }, "verity.document.approve");
    return {
      result: { id: revision.id, superseded: done.superseded, validUntil: done.validUntil },
      events: [...done.events, { name: "verity.document.released", entityId: revision.id, payload: { number: revision.document.number, label: revision.label, selfApproved: isOwnWork } }],
    };
  },
};

export const rejectRevision: CommandDefinition<{ revisionId: string; reviewNote: string }, { id: string }> = {
  key: "verity.document.reject",
  entity: ENTITY_DOCUMENT_RELEASE,
  verb: "ActionExecute",
  input: z.object({ revisionId: z.string().uuid(), reviewNote: z.string().trim().min(3).max(500) }),
  handler: async (ctx, input) => {
    const revision = await loadRevision(ctx, input.revisionId);
    if (revision.status !== "in_review") throw new ValidationError("E_VALIDATION: only a revision in review can be sent back");
    const event = await move(ctx, revision, "draft", "verity.document.reject", { reviewNote: input.reviewNote, submittedAt: null, submittedById: null });
    return { result: { id: revision.id }, events: [event, { name: "verity.document.rejected", entityId: revision.id }] };
  },
};

export const obsoleteRevision: CommandDefinition<{ revisionId: string; reason: string }, { id: string }> = {
  key: "verity.document.obsolete",
  entity: ENTITY_DOCUMENT_RELEASE,
  verb: "ActionExecute",
  input: z.object({ revisionId: z.string().uuid(), reason: z.string().trim().min(3).max(500) }),
  handler: async (ctx, input) => {
    const revision = await loadRevision(ctx, input.revisionId);
    if (revision.status !== "released") throw new ValidationError("E_VALIDATION: only the released revision can be withdrawn");
    const event = await move(ctx, revision, "obsolete", "verity.document.obsolete", { obsoleteReason: input.reason });
    await ctx.tx.document.update({ where: { id: revision.documentId }, data: { currentRevisionId: null } });
    return { result: { id: revision.id }, events: [event, { name: "verity.document.obsoleted", entityId: revision.id }] };
  },
};

/** Records that a job, order or BOM relied on this exact released revision. */
export const linkRevision: CommandDefinition<
  { revisionId: string; entityKey: (typeof LINKABLE_ENTITIES)[number]; entityId: string },
  { id: string }
> = {
  key: "verity.document.link",
  entity: ENTITY_DOCUMENT,
  verb: "Create",
  input: z.object({ revisionId: z.string().uuid(), entityKey: z.enum(LINKABLE_ENTITIES), entityId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const revision = await loadRevision(ctx, input.revisionId);
    if (revision.status !== "released") throw new ValidationError("E_VALIDATION: link the released revision, the one being relied on");
    const exists =
      input.entityKey === "verity.project.job"
        ? await ctx.tx.projectJob.findUnique({ where: { id: input.entityId }, select: { id: true } })
        : input.entityKey === "verity.manufacturing.order"
          ? await ctx.tx.manufacturingOrder.findUnique({ where: { id: input.entityId }, select: { id: true } })
          : await ctx.tx.manufacturingBom.findUnique({ where: { id: input.entityId }, select: { id: true } });
    if (!exists) throw new ValidationError("E_VALIDATION: that record does not exist");

    const already = await ctx.tx.documentLink.findFirst({ where: { revisionId: revision.id, entityKey: input.entityKey, entityId: input.entityId } });
    if (already) return { result: { id: already.id }, events: [] };
    const link = await ctx.tx.documentLink.create({
      data: {
        tenantId: ctx.actor.tenantId,
        documentId: revision.documentId,
        revisionId: revision.id,
        entityKey: input.entityKey,
        entityId: input.entityId,
        linkedById: ctx.actor.userId,
      },
    });
    await recordActivity(ctx, {
      entityKey: ENTITY_DOCUMENT,
      entityId: revision.documentId,
      commandKey: "verity.document.link",
      changes: diffFields({ link: "" }, { link: `${revision.document.number} ${revision.label} -> ${input.entityKey}` }),
    });
    return { result: { id: link.id }, events: [{ name: "verity.document.linked", entityId: revision.documentId }] };
  },
};

/**
 * Opening or downloading a revision writes an append-only access row, then hands back a short-lived link. A
 * superseded or obsolete revision is still readable (history is kept) and comes back with a `banner` so it is never
 * mistaken for the current one. A draft is readable only by the person who wrote it.
 */
export const openRevision: CommandDefinition<
  { revisionId: string; action: "open" | "download" },
  { url: string | null; label: string; fileName: string | null; banner: "superseded" | "obsolete" | "expired" | null }
> = {
  key: "verity.document.open",
  entity: ENTITY_DOCUMENT_REVISION,
  verb: "Read",
  input: z.object({ revisionId: z.string().uuid(), action: z.enum(["open", "download"]) }),
  handler: async (ctx, input) => {
    const revision = await loadRevision(ctx, input.revisionId);
    if (revision.status === "draft" && revision.authoredById !== ctx.actor.userId) {
      throw new ValidationError("E_VALIDATION: this revision is still a draft");
    }
    if (!revision.fileId) throw new ValidationError("E_VALIDATION: no file is attached to this revision");
    await ctx.tx.documentAccessLog.create({
      data: { tenantId: ctx.actor.tenantId, documentId: revision.documentId, revisionId: revision.id, actorUserId: ctx.actor.userId, action: input.action },
    });
    const file = await ctx.tx.storedFile.findUnique({ where: { id: revision.fileId }, select: { fileName: true } });
    let url: string | null = null;
    try {
      url = await readUrlFor(ctx.tx, revision.fileId, 300);
    } catch (error) {
      if (!(error instanceof StorageUnavailableError)) throw error;
    }
    const today = todayIn(await timeZoneOf(ctx));
    const expired = revision.status === "released" && revision.validUntil !== null && dayText(revision.validUntil)! < today;
    return {
      result: {
        url,
        label: revision.label,
        fileName: file?.fileName ?? null,
        banner: revision.status === "superseded" ? "superseded" : revision.status === "obsolete" ? "obsolete" : expired ? "expired" : null,
      },
      events: [],
    };
  },
};

/* --------------------------------- queries --------------------------------- */

type Expiry = "none" | "valid" | "soon" | "expired";

function expiryOf(validUntil: Date | null, today: string): Expiry {
  if (!validUntil) return "none";
  const until = dayText(validUntil)!;
  if (until < today) return "expired";
  return until <= addMonths(today, 1) ? "soon" : "valid";
}

async function todayFor(ctx: { tx: CommandContext["tx"]; actor: { tenantId: string } }): Promise<string> {
  return todayIn((await ctx.tx.tenant.findUniqueOrThrow({ where: { id: ctx.actor.tenantId }, select: { timeZone: true } })).timeZone ?? "UTC");
}

export const listDocumentTypes: QueryDefinition<Record<string, never>, Array<Record<string, unknown>>> = {
  key: "verity.document.list_types",
  entity: ENTITY_DOCUMENT_TYPE,
  input: z.object({}),
  handler: async (ctx) => {
    const types = await ctx.tx.documentType.findMany({ orderBy: { label: "asc" } });
    return types.map((t) => ({
      id: t.id,
      key: t.key,
      label: t.label,
      pattern: t.pattern,
      segments: readSegments(t.segments),
      requiresApproval: t.requiresApproval,
      validMonths: t.validMonths,
      active: t.active,
    }));
  },
};

export const listDocuments: QueryDefinition<{ q?: string; typeId?: string }, Array<Record<string, unknown>>> = {
  key: "verity.document.list",
  entity: ENTITY_DOCUMENT,
  input: z.object({ q: z.string().trim().max(100).optional(), typeId: z.string().uuid().optional() }),
  handler: async (ctx, input) => {
    const today = await todayFor(ctx);
    const documents = await ctx.tx.document.findMany({
      where: {
        ...(input.typeId ? { typeId: input.typeId } : {}),
        ...(input.q ? { OR: [{ number: { contains: input.q, mode: "insensitive" } }, { title: { contains: input.q, mode: "insensitive" } }] } : {}),
      },
      include: { type: true, revisions: { orderBy: { revision: "desc" } } },
      orderBy: { number: "asc" },
      take: 500,
    });
    return documents.map((d) => {
      const current = d.revisions.find((r) => r.status === "released") ?? null;
      const latest = d.revisions[0]!;
      return {
        id: d.id,
        number: d.number,
        title: d.title,
        typeKey: d.type.key,
        typeLabel: d.type.label,
        classification: d.classification,
        current: current ? { id: current.id, label: current.label, validUntil: dayText(current.validUntil), expiry: expiryOf(current.validUntil, today) } : null,
        latest: { id: latest.id, label: latest.label, status: latest.status },
        openDraft: d.revisions.some((r) => r.status === "draft" || r.status === "in_review"),
        createdAt: d.createdAt,
      };
    });
  },
};

export const documentDetail: QueryDefinition<{ documentId: string }, Record<string, unknown> | null> = {
  key: "verity.document.detail",
  entity: ENTITY_DOCUMENT,
  input: z.object({ documentId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const document = await ctx.tx.document.findUnique({
      where: { id: input.documentId },
      include: { type: true, revisions: { orderBy: { revision: "desc" } }, links: { orderBy: { linkedAt: "desc" } } },
    });
    if (!document) return null;
    const today = await todayFor(ctx);

    const userIds = document.revisions.flatMap((r) => [r.authoredById, r.submittedById, r.approvedById]).filter((v): v is string => v !== null);
    const accessRows = await ctx.tx.documentAccessLog.findMany({ where: { documentId: document.id }, orderBy: { at: "desc" }, take: 30 });
    const accessCount = await ctx.tx.documentAccessLog.count({ where: { documentId: document.id } });
    const actorIds = accessRows.map((a) => a.actorUserId).filter((v): v is string => v !== null);
    const users = await ctx.tx.user.findMany({ where: { id: { in: [...new Set([...userIds, ...actorIds])] } }, select: { id: true, party: { select: { displayName: true } } } });
    const name = (id: string | null) => (id ? (users.find((u) => u.id === id)?.party.displayName ?? "Unknown") : null);
    const fileIds = document.revisions.map((r) => r.fileId).filter((v): v is string => v !== null);
    const files = fileIds.length > 0 ? await ctx.tx.storedFile.findMany({ where: { id: { in: fileIds } }, select: { id: true, fileName: true, byteSize: true } }) : [];
    const label = (revisionId: string) => document.revisions.find((r) => r.id === revisionId)?.label ?? "";
    const current = document.revisions.find((r) => r.status === "released") ?? null;

    return {
      id: document.id,
      number: document.number,
      title: document.title,
      classification: document.classification,
      segments: document.segments,
      type: { id: document.type.id, key: document.type.key, label: document.type.label, requiresApproval: document.type.requiresApproval, validMonths: document.type.validMonths },
      currentRevisionId: current?.id ?? null,
      revisions: document.revisions.map((r) => {
        const file = r.fileId ? files.find((f) => f.id === r.fileId) : undefined;
        return {
          id: r.id,
          revision: r.revision,
          label: r.label,
          status: r.status,
          changeReason: r.changeReason,
          reviewNote: r.reviewNote,
          obsoleteReason: r.obsoleteReason,
          effectiveFrom: dayText(r.effectiveFrom),
          validUntil: dayText(r.validUntil),
          expiry: r.status === "released" ? expiryOf(r.validUntil, today) : "none",
          selfApprovalReason: r.selfApprovalReason,
          /** The signed-in person wrote or submitted this revision, so releasing it is the audited exception. */
          mine: r.authoredById === ctx.actor.userId || r.submittedById === ctx.actor.userId,
          author: name(r.authoredById),
          submittedBy: name(r.submittedById),
          approvedBy: name(r.approvedById),
          submittedAt: r.submittedAt,
          releasedAt: r.releasedAt,
          createdAt: r.createdAt,
          file: file ? { name: file.fileName, size: file.byteSize } : null,
        };
      }),
      links: document.links.map((l) => ({
        id: l.id,
        entityKey: l.entityKey,
        entityId: l.entityId,
        revisionId: l.revisionId,
        revisionLabel: label(l.revisionId),
        newerReleaseExists: current !== null && current.id !== l.revisionId,
        linkedAt: l.linkedAt,
      })),
      access: {
        count: accessCount,
        recent: accessRows.map((a) => ({ id: a.id, action: a.action, at: a.at, actor: name(a.actorUserId), revisionLabel: label(a.revisionId) })),
      },
    };
  },
};

/** The controlled documents a job, order or BOM relied on, each with the revision it relied on. */
export const documentsFor: QueryDefinition<{ entityKey: (typeof LINKABLE_ENTITIES)[number]; entityId: string }, Array<Record<string, unknown>>> = {
  key: "verity.document.for_entity",
  entity: ENTITY_DOCUMENT,
  input: z.object({ entityKey: z.enum(LINKABLE_ENTITIES), entityId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const today = await todayFor(ctx);
    const links = await ctx.tx.documentLink.findMany({
      where: { entityKey: input.entityKey, entityId: input.entityId },
      include: { document: { include: { type: true } }, revision: true },
      orderBy: { linkedAt: "asc" },
    });
    const currents = await ctx.tx.documentRevision.findMany({ where: { documentId: { in: links.map((l) => l.documentId) }, status: "released" } });
    return links.map((l) => {
      const current = currents.find((c) => c.documentId === l.documentId) ?? null;
      return {
        linkId: l.id,
        documentId: l.documentId,
        number: l.document.number,
        title: l.document.title,
        typeLabel: l.document.type.label,
        revisionId: l.revisionId,
        revisionLabel: l.revision.label,
        revisionStatus: l.revision.status,
        validUntil: dayText(l.revision.validUntil),
        expiry: expiryOf(l.revision.validUntil, today),
        currentLabel: current?.label ?? null,
        newerReleaseExists: current !== null && current.id !== l.revisionId,
        linkedAt: l.linkedAt,
      };
    });
  },
};

export function registerDocumentCapability(): void {
  registerContribution({
    capabilityId: DOCUMENT_CAPABILITY,
    navigation: [
      { href: "/documents", label: "Documents", group: "Production", order: 45, icon: "revision", requiresEntity: ENTITY_DOCUMENT, shells: ["platform", "operations"] },
    ],
  });
  for (const command of [
    defineDocumentType,
    setDocumentTypeActive,
    createDocument,
    startRevision,
    reserveRevisionFile,
    attachRevisionFile,
    submitRevision,
    approveRevision,
    rejectRevision,
    obsoleteRevision,
    linkRevision,
    openRevision,
  ]) {
    registerCommand(command as never);
  }
  for (const query of [listDocumentTypes, listDocuments, documentDetail, documentsFor]) registerQuery(query as never);
}
