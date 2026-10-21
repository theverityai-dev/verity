import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { ValidationError, type CommandContext, type CommandDefinition } from "@/server/platform/command";
import type { QueryDefinition } from "@/server/platform/query";
import { ConflictError } from "@/server/platform/entity";
import { recordActivity } from "@/server/platform/audit";
import { hasTenantPermission } from "@/server/platform/authorization";
import type { TenantScopedClient } from "@/server/platform/tenancy";
import { customFieldValues, getRecordObject, memberDirectory, withCustomFields, type FieldOption, type RecordObject } from "@/server/platform/views";
import {
  ENTITY_COMPANY,
  ENTITY_FOLLOW_UP,
  ENTITY_INTERACTION,
  ENTITY_NOTE,
  ENTITY_OPPORTUNITY,
  ENTITY_PERSON,
  ENTITY_STAGE,
  INTERACTION_KINDS,
  INTERACTION_LABEL,
  LOST_REASONS,
  OPPORTUNITY_SOURCES,
  SIZE_BANDS,
  opportunityRef,
  personName,
  type InteractionKind,
} from "./shared";
import { OPPORTUNITY_INCLUDE, decimal, instant, opportunityRow, userLabels, userRef, withMerged } from "./records";

/**
 * What happens around a record: notes, logged interactions and follow-ups, and the timeline that shows them with
 * every field change in one feed (Task 128). Also the record pages, search and the pipeline summary.
 *
 * Attachment rule: an item names a company, a person and/or an opportunity. Naming an opportunity or a person also
 * names its company, so a company's timeline shows everything that happened with its people and its deals.
 */

type ReadContext = { tx: TenantScopedClient; actor: { userId: string; tenantId: string; roleId?: string | null } };

const targetSchema = {
  companyId: z.string().uuid().optional(),
  personId: z.string().uuid().optional(),
  opportunityId: z.string().uuid().optional(),
};
type Target = { companyId?: string; personId?: string; opportunityId?: string };

async function resolveTarget(tx: TenantScopedClient, t: Target): Promise<{ companyId: string | null; personId: string | null; opportunityId: string | null }> {
  if (!t.companyId && !t.personId && !t.opportunityId) throw new ValidationError("E_VALIDATION: attach it to a company, a person or an opportunity");
  let companyId = t.companyId ?? null;
  if (t.opportunityId) {
    const opp = await tx.relationshipOpportunity.findUnique({ where: { id: t.opportunityId }, select: { companyId: true } });
    if (!opp) throw new ValidationError("E_VALIDATION: no such opportunity");
    companyId ??= opp.companyId;
  }
  if (t.personId) {
    const person = await tx.relationshipPerson.findUnique({ where: { id: t.personId }, select: { companyId: true } });
    if (!person) throw new ValidationError("E_VALIDATION: no such person");
    companyId ??= person.companyId;
  }
  if (t.companyId && !(await tx.relationshipCompany.findUnique({ where: { id: t.companyId }, select: { id: true } }))) {
    throw new ValidationError("E_VALIDATION: no such company");
  }
  return { companyId, personId: t.personId ?? null, opportunityId: t.opportunityId ?? null };
}

/** The record an item is "on", for its activity row: the most specific target. */
function primary(t: { companyId: string | null; personId: string | null; opportunityId: string | null }) {
  if (t.opportunityId) return { entityKey: ENTITY_OPPORTUNITY, entityId: t.opportunityId };
  if (t.personId) return { entityKey: ENTITY_PERSON, entityId: t.personId };
  return { entityKey: ENTITY_COMPANY, entityId: t.companyId! };
}

const instantInput = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/));
const parseInstant = (v: string) => {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new ValidationError("E_VALIDATION: a date and time");
  return d;
};

async function requireMember(tx: TenantScopedClient, userId: string | null | undefined) {
  if (!userId) return;
  if (!(await tx.tenantMembership.findFirst({ where: { userId, disabledAt: null }, select: { id: true } }))) {
    throw new ValidationError("E_VALIDATION: that person is not a member of this workspace");
  }
}

/* ================================ notes ================================ */

export const addNote: CommandDefinition<Target & { body: string }, { id: string }> = {
  key: "verity.relationship.add_note",
  entity: ENTITY_NOTE,
  verb: "Create",
  description: "Write a note on a company, person or opportunity.",
  input: z.object({ ...targetSchema, body: z.string().trim().min(1).max(20000) }),
  handler: async (ctx, input) => {
    const target = await resolveTarget(ctx.tx, input);
    const note = await ctx.tx.relationshipNote.create({
      data: { tenantId: ctx.actor.tenantId, ...target, body: input.body, authorUserId: ctx.actor.userId },
    });
    return { result: { id: note.id }, events: [{ name: "verity.relationship.note_added", entityId: note.id }] };
  },
};

export const editNote: CommandDefinition<{ id: string; body: string; version?: number }, { id: string; version: number }> = {
  key: "verity.relationship.edit_note",
  entity: ENTITY_NOTE,
  verb: "Edit",
  description: "Change the text of a note.",
  input: z.object({ id: z.string().uuid(), body: z.string().trim().min(1).max(20000), version: z.number().int().optional() }),
  handler: async (ctx, input) => {
    const note = await ctx.tx.relationshipNote.findUnique({ where: { id: input.id } });
    if (!note || note.archivedAt) throw new ValidationError("E_VALIDATION: no such note");
    if (input.version !== undefined && input.version !== note.version) throw new ConflictError("E_CONFLICT: this note was changed since you opened it");
    const saved = await ctx.tx.relationshipNote.update({ where: { id: note.id }, data: { body: input.body, version: { increment: 1 } } });
    await recordActivity(ctx, {
      ...primary(note), commandKey: "verity.relationship.edit_note",
      changes: [{ field: "note", oldValue: note.body.slice(0, 200), newValue: input.body.slice(0, 200) }],
    });
    return { result: { id: saved.id, version: saved.version } };
  },
};

export const archiveNote: CommandDefinition<{ id: string }, { id: string }> = {
  key: "verity.relationship.archive_note",
  entity: ENTITY_NOTE,
  verb: "Edit",
  description: "Remove a note from the timeline. It is kept, archived.",
  input: z.object({ id: z.string().uuid() }),
  handler: async (ctx, input) => {
    const note = await ctx.tx.relationshipNote.findUnique({ where: { id: input.id } });
    if (!note) throw new ValidationError("E_VALIDATION: no such note");
    await ctx.tx.relationshipNote.update({ where: { id: note.id }, data: { archivedAt: new Date(), version: { increment: 1 } } });
    return { result: { id: note.id } };
  },
};

/* ================================ interactions ================================ */

export const logInteraction: CommandDefinition<
  Target & {
    kind: InteractionKind;
    subject: string;
    summary?: string;
    outcome?: string;
    occurredAt?: string;
    durationMinutes?: number;
    nextStep?: { title: string; dueAt?: string };
  },
  { id: string; followUpId: string | null }
> = {
  key: "verity.relationship.log_interaction",
  entity: ENTITY_INTERACTION,
  verb: "Create",
  description: "Record a call, meeting, visit, email or message, and optionally the next step that came out of it.",
  input: z.object({
    ...targetSchema,
    kind: z.enum(INTERACTION_KINDS),
    subject: z.string().trim().min(1).max(200),
    summary: z.string().trim().max(10000).optional(),
    outcome: z.string().trim().max(500).optional(),
    occurredAt: instantInput.optional(),
    durationMinutes: z.number().int().min(0).max(1440).optional(),
    nextStep: z.object({ title: z.string().trim().min(1).max(200), dueAt: instantInput.optional() }).optional(),
  }),
  handler: async (ctx, input) => {
    const target = await resolveTarget(ctx.tx, input);
    const occurredAt = input.occurredAt ? parseInstant(input.occurredAt) : new Date();
    if (occurredAt.getTime() > Date.now() + 5 * 60_000) throw new ValidationError("E_VALIDATION: an interaction is something that already happened; plan a follow-up instead");
    const interaction = await ctx.tx.relationshipInteraction.create({
      data: {
        tenantId: ctx.actor.tenantId, ...target, kind: input.kind, subject: input.subject,
        summary: input.summary || null, outcome: input.outcome || null, occurredAt,
        durationMinutes: input.durationMinutes ?? null, loggedById: ctx.actor.userId,
      },
    });
    let followUpId: string | null = null;
    if (input.nextStep) {
      const followUp = await ctx.tx.relationshipFollowUp.create({
        data: {
          tenantId: ctx.actor.tenantId, ...target, title: input.nextStep.title,
          dueAt: input.nextStep.dueAt ? parseInstant(input.nextStep.dueAt) : null,
          assigneeId: ctx.actor.userId, createdById: ctx.actor.userId,
        },
      });
      followUpId = followUp.id;
    }
    return { result: { id: interaction.id, followUpId }, events: [{ name: "verity.relationship.interaction_logged", entityId: interaction.id }] };
  },
};

export const archiveInteraction: CommandDefinition<{ id: string }, { id: string }> = {
  key: "verity.relationship.archive_interaction",
  entity: ENTITY_INTERACTION,
  verb: "Edit",
  description: "Remove a logged interaction from the timeline. It is kept, archived; it is never rewritten.",
  input: z.object({ id: z.string().uuid() }),
  handler: async (ctx, input) => {
    const found = await ctx.tx.relationshipInteraction.findUnique({ where: { id: input.id } });
    if (!found) throw new ValidationError("E_VALIDATION: no such interaction");
    await ctx.tx.relationshipInteraction.update({ where: { id: found.id }, data: { archivedAt: new Date() } });
    return { result: { id: found.id } };
  },
};

/* ================================ follow-ups ================================ */

export const addFollowUp: CommandDefinition<Target & { title: string; details?: string; dueAt?: string; assigneeId?: string | null }, { id: string }> = {
  key: "verity.relationship.add_follow_up",
  entity: ENTITY_FOLLOW_UP,
  verb: "Create",
  description: "Plan the next thing someone has to do for a company, person or opportunity.",
  input: z.object({
    ...targetSchema,
    title: z.string().trim().min(1).max(200),
    details: z.string().trim().max(4000).optional(),
    dueAt: instantInput.optional(),
    assigneeId: z.string().uuid().nullable().optional(),
  }),
  handler: async (ctx, input) => {
    const target = await resolveTarget(ctx.tx, input);
    const assigneeId = input.assigneeId === undefined ? ctx.actor.userId : input.assigneeId;
    await requireMember(ctx.tx, assigneeId);
    const followUp = await ctx.tx.relationshipFollowUp.create({
      data: {
        tenantId: ctx.actor.tenantId, ...target, title: input.title, details: input.details || null,
        dueAt: input.dueAt ? parseInstant(input.dueAt) : null, assigneeId, createdById: ctx.actor.userId,
      },
    });
    return { result: { id: followUp.id }, events: [{ name: "verity.relationship.follow_up_added", entityId: followUp.id }] };
  },
};

export const editFollowUp: CommandDefinition<
  { id: string; version?: number; patch: { title?: string; details?: string | null; dueAt?: string | null; assigneeId?: string | null } },
  { id: string; version: number }
> = {
  key: "verity.relationship.edit_follow_up",
  entity: ENTITY_FOLLOW_UP,
  verb: "Edit",
  description: "Change a follow-up's title, due time or who it is for.",
  input: z.object({
    id: z.string().uuid(),
    version: z.number().int().optional(),
    patch: z
      .object({
        title: z.string().trim().min(1).max(200),
        details: z.string().trim().max(4000).nullable(),
        dueAt: instantInput.nullable(),
        assigneeId: z.string().uuid().nullable(),
      })
      .partial(),
  }),
  handler: async (ctx, input) => {
    const found = await ctx.tx.relationshipFollowUp.findUnique({ where: { id: input.id } });
    if (!found || found.archivedAt) throw new ValidationError("E_VALIDATION: no such follow-up");
    if (input.version !== undefined && input.version !== found.version) throw new ConflictError("E_CONFLICT: this follow-up was changed since you opened it");
    if (input.patch.assigneeId !== undefined) await requireMember(ctx.tx, input.patch.assigneeId);
    const data: Prisma.RelationshipFollowUpUncheckedUpdateInput = { version: { increment: 1 } };
    if (input.patch.title !== undefined) data.title = input.patch.title;
    if (input.patch.details !== undefined) data.details = input.patch.details || null;
    if (input.patch.assigneeId !== undefined) data.assigneeId = input.patch.assigneeId;
    if (input.patch.dueAt !== undefined) {
      data.dueAt = input.patch.dueAt ? parseInstant(input.patch.dueAt) : null;
      data.remindedOn = null; // a new due time earns a new reminder
    }
    const saved = await ctx.tx.relationshipFollowUp.update({ where: { id: found.id }, data });
    return { result: { id: saved.id, version: saved.version } };
  },
};

function followUpStatusCommand(done: boolean): CommandDefinition<{ id: string }, { id: string }> {
  const key = done ? "verity.relationship.complete_follow_up" : "verity.relationship.reopen_follow_up";
  const command: CommandDefinition<{ id: string }, { id: string }> = {
    key,
    entity: ENTITY_FOLLOW_UP,
    verb: "Edit",
    description: done ? "Mark a follow-up as done." : "Reopen a follow-up that was marked done.",
    input: z.object({ id: z.string().uuid() }),
    handler: async (ctx, input) => {
      const found = await ctx.tx.relationshipFollowUp.findUnique({ where: { id: input.id } });
      if (!found || found.archivedAt) throw new ValidationError("E_VALIDATION: no such follow-up");
      if ((found.status === "done") === done) return { result: { id: found.id } };
      await ctx.tx.relationshipFollowUp.update({
        where: { id: found.id },
        data: done
          ? { status: "done", doneAt: new Date(), doneById: ctx.actor.userId, version: { increment: 1 } }
          : { status: "open", doneAt: null, doneById: null, remindedOn: null, version: { increment: 1 } },
      });
      await recordActivity(ctx, {
        ...primary(found), commandKey: key,
        changes: [{ field: "follow-up", oldValue: found.title, newValue: done ? `Done: ${found.title}` : `Reopened: ${found.title}` }],
      });
      return { result: { id: found.id }, events: [{ name: done ? "verity.relationship.follow_up_done" : "verity.relationship.follow_up_reopened", entityId: found.id }] };
    },
  };
  return command;
}

export const completeFollowUp = followUpStatusCommand(true);
export const reopenFollowUp = followUpStatusCommand(false);

export const archiveFollowUp: CommandDefinition<{ id: string }, { id: string }> = {
  key: "verity.relationship.archive_follow_up",
  entity: ENTITY_FOLLOW_UP,
  verb: "Edit",
  description: "Cancel a follow-up that is no longer needed. It is kept, archived.",
  input: z.object({ id: z.string().uuid() }),
  handler: async (ctx, input) => {
    const found = await ctx.tx.relationshipFollowUp.findUnique({ where: { id: input.id } });
    if (!found) throw new ValidationError("E_VALIDATION: no such follow-up");
    await ctx.tx.relationshipFollowUp.update({ where: { id: found.id }, data: { archivedAt: new Date(), version: { increment: 1 } } });
    return { result: { id: found.id } };
  },
};

/* ================================ reading: labels ================================ */

type TargetRef = { kind: "company" | "person" | "opportunity"; id: string; label: string; href: string };

async function targetLabels(
  tx: TenantScopedClient,
  ids: { company: Set<string>; person: Set<string>; opportunity: Set<string> },
): Promise<Map<string, TargetRef>> {
  const [companies, people, opps] = await Promise.all([
    ids.company.size ? tx.relationshipCompany.findMany({ where: { id: { in: [...ids.company] } }, select: { id: true, name: true } }) : [],
    ids.person.size ? tx.relationshipPerson.findMany({ where: { id: { in: [...ids.person] } }, select: { id: true, givenName: true, familyName: true } }) : [],
    ids.opportunity.size ? tx.relationshipOpportunity.findMany({ where: { id: { in: [...ids.opportunity] } }, select: { id: true, number: true, name: true } }) : [],
  ]);
  const out = new Map<string, TargetRef>();
  for (const c of companies) out.set(c.id, { kind: "company", id: c.id, label: c.name, href: `/crm/companies/${c.id}` });
  for (const p of people) out.set(p.id, { kind: "person", id: p.id, label: personName(p), href: `/crm/people/${p.id}` });
  for (const o of opps) out.set(o.id, { kind: "opportunity", id: o.id, label: `${opportunityRef(o.number)} ${o.name}`, href: `/crm/opportunities/${o.id}` });
  return out;
}

const TARGET_KIND: Record<string, "company" | "person" | "opportunity"> = {
  [ENTITY_COMPANY]: "company",
  [ENTITY_PERSON]: "person",
  [ENTITY_OPPORTUNITY]: "opportunity",
};

/* ================================ timeline ================================ */

export type TimelineEntry = {
  id: string;
  kind: "note" | "interaction" | "follow_up" | "change" | "created";
  at: string;
  actor: { id: string; label: string } | null;
  title: string;
  body: string | null;
  meta: Record<string, unknown>;
  on: TargetRef[];
};

/** Everything that happened on a record, newest first: changes, notes, interactions and follow-ups. */
export const timeline: QueryDefinition<{ kind: "company" | "person" | "opportunity"; id: string; limit?: number }, TimelineEntry[]> = {
  key: "verity.relationship.timeline",
  entity: ENTITY_COMPANY,
  description: "The timeline of a company, person or opportunity.",
  input: z.object({ kind: z.enum(["company", "person", "opportunity"]), id: z.string().uuid(), limit: z.number().int().min(1).max(500).optional() }),
  handler: async (ctx, input) => {
    const limit = input.limit ?? 200;
    const column = input.kind === "company" ? "companyId" : input.kind === "person" ? "personId" : "opportunityId";
    const mergedIds = input.kind === "opportunity" ? [input.id] : await withMerged(ctx.tx, input.kind, input.id);
    const itemWhere = { [column]: { in: mergedIds }, archivedAt: null };

    // Whose field changes belong here: the record itself, and for a company also its people and deals.
    const entities: Array<{ entityKey: string; entityId: { in: string[] } }> = [];
    const selfKey = input.kind === "company" ? ENTITY_COMPANY : input.kind === "person" ? ENTITY_PERSON : ENTITY_OPPORTUNITY;
    entities.push({ entityKey: selfKey, entityId: { in: mergedIds } });
    if (input.kind === "company") {
      const [people, opps] = await Promise.all([
        ctx.tx.relationshipPerson.findMany({ where: { companyId: input.id }, select: { id: true } }),
        ctx.tx.relationshipOpportunity.findMany({ where: { companyId: input.id }, select: { id: true } }),
      ]);
      if (people.length) entities.push({ entityKey: ENTITY_PERSON, entityId: { in: people.map((p) => p.id) } });
      if (opps.length) entities.push({ entityKey: ENTITY_OPPORTUNITY, entityId: { in: opps.map((o) => o.id) } });
    }

    const [notes, interactions, followUps, changes, labels] = await Promise.all([
      ctx.tx.relationshipNote.findMany({ where: itemWhere, orderBy: { createdAt: "desc" }, take: limit }),
      ctx.tx.relationshipInteraction.findMany({ where: itemWhere, orderBy: { occurredAt: "desc" }, take: limit }),
      ctx.tx.relationshipFollowUp.findMany({ where: itemWhere, orderBy: { createdAt: "desc" }, take: limit }),
      ctx.tx.activity.findMany({ where: { OR: entities }, orderBy: { occurredAt: "desc" }, take: limit * 3 }),
      userLabels(ctx.tx),
    ]);

    const ids = { company: new Set<string>(), person: new Set<string>(), opportunity: new Set<string>() };
    for (const item of [...notes, ...interactions, ...followUps]) {
      if (item.companyId) ids.company.add(item.companyId);
      if (item.personId) ids.person.add(item.personId);
      if (item.opportunityId) ids.opportunity.add(item.opportunityId);
    }
    for (const c of changes) {
      const kind = TARGET_KIND[c.entityKey];
      if (kind) ids[kind].add(c.entityId);
    }
    const refs = await targetLabels(ctx.tx, ids);
    const on = (item: { companyId: string | null; personId: string | null; opportunityId: string | null }) =>
      [item.opportunityId, item.personId, item.companyId]
        .filter((id): id is string => Boolean(id) && id !== input.id)
        .map((id) => refs.get(id))
        .filter((r): r is TargetRef => Boolean(r));

    const entries: TimelineEntry[] = [];
    for (const n of notes) {
      entries.push({ id: `note:${n.id}`, kind: "note", at: n.createdAt.toISOString(), actor: userRef(labels, n.authorUserId), title: "Note", body: n.body, meta: { noteId: n.id, version: n.version, edited: n.updatedAt.getTime() - n.createdAt.getTime() > 1000 }, on: on(n) });
    }
    for (const i of interactions) {
      entries.push({
        id: `interaction:${i.id}`, kind: "interaction", at: i.occurredAt.toISOString(), actor: userRef(labels, i.loggedById),
        title: `${INTERACTION_LABEL[i.kind as InteractionKind] ?? i.kind}: ${i.subject}`, body: i.summary,
        meta: { interactionId: i.id, interactionKind: i.kind, outcome: i.outcome, durationMinutes: i.durationMinutes }, on: on(i),
      });
    }
    for (const f of followUps) {
      entries.push({
        id: `follow_up:${f.id}`, kind: "follow_up", at: f.createdAt.toISOString(), actor: userRef(labels, f.createdById),
        title: f.title, body: f.details,
        meta: { followUpId: f.id, status: f.status, dueAt: instant(f.dueAt), doneAt: instant(f.doneAt), assignee: userRef(labels, f.assigneeId), version: f.version },
        on: on(f),
      });
    }
    // One entry per command run on one record, so "stage, owner and amount changed" reads as one event.
    const grouped = new Map<string, typeof changes>();
    for (const c of changes) {
      if (c.fieldChanged === "follow-up" || c.fieldChanged === "note") continue;
      const key = `${c.correlationId ?? c.id}:${c.entityId}`;
      grouped.set(key, [...(grouped.get(key) ?? []), c]);
    }
    for (const [key, rows] of grouped) {
      const first = rows[0]!;
      const created = rows.find((r) => r.fieldChanged === "record" && r.oldValue === null);
      const ref = first.entityId !== input.id ? refs.get(first.entityId) : undefined;
      entries.push({
        id: `change:${key}`,
        kind: created ? "created" : "change",
        at: first.occurredAt.toISOString(),
        actor: userRef(labels, first.actorUserId),
        title: created ? (created.newValue ?? "Created") : rows.length === 1 && first.fieldChanged === "record" ? (first.newValue ?? "Changed") : "Updated",
        body: null,
        meta: {
          changes: created ? [] : rows.filter((r) => r.fieldChanged !== "record").map((r) => ({ field: r.fieldChanged, from: r.oldValue, to: r.newValue })),
          source: first.source,
        },
        on: ref ? [ref] : [],
      });
    }
    return entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
  },
};

/* ================================ follow-up list ================================ */

export type FollowUpRow = {
  id: string; version: number; title: string; details: string | null; status: string;
  dueAt: string | null; doneAt: string | null; overdue: boolean;
  assignee: { id: string; label: string } | null; on: TargetRef[];
};

export const listFollowUps: QueryDefinition<
  { scope?: "mine" | "all"; status?: "open" | "done"; due?: "overdue" | "today" | "week" | "any"; target?: Target },
  FollowUpRow[]
> = {
  key: "verity.relationship.list_follow_ups",
  entity: ENTITY_FOLLOW_UP,
  description: "Follow-ups to do: mine or everyone's, open or done, by when they are due.",
  input: z.object({
    scope: z.enum(["mine", "all"]).optional(),
    status: z.enum(["open", "done"]).optional(),
    due: z.enum(["overdue", "today", "week", "any"]).optional(),
    target: z.object(targetSchema).optional(),
  }),
  handler: async (ctx, input) => {
    const now = new Date();
    const endOfToday = new Date(now);
    endOfToday.setUTCHours(23, 59, 59, 999);
    const due =
      input.due === "overdue" ? { dueAt: { lt: now } }
      : input.due === "today" ? { dueAt: { lte: endOfToday } }
      : input.due === "week" ? { dueAt: { lte: new Date(now.getTime() + 7 * 86_400_000) } }
      : {};
    const status = input.status ?? "open";
    const rows = await ctx.tx.relationshipFollowUp.findMany({
      where: {
        archivedAt: null,
        status,
        ...(input.scope === "mine" ? { assigneeId: ctx.actor.userId } : {}),
        ...(input.target?.companyId ? { companyId: input.target.companyId } : {}),
        ...(input.target?.personId ? { personId: input.target.personId } : {}),
        ...(input.target?.opportunityId ? { opportunityId: input.target.opportunityId } : {}),
        ...due,
      },
      orderBy: status === "done" ? [{ doneAt: "desc" }] : [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      take: 300,
    });
    const ids = { company: new Set<string>(), person: new Set<string>(), opportunity: new Set<string>() };
    for (const f of rows) {
      if (f.companyId) ids.company.add(f.companyId);
      if (f.personId) ids.person.add(f.personId);
      if (f.opportunityId) ids.opportunity.add(f.opportunityId);
    }
    const [refs, labels] = await Promise.all([targetLabels(ctx.tx, ids), userLabels(ctx.tx)]);
    return rows.map((f) => ({
      id: f.id, version: f.version, title: f.title, details: f.details, status: f.status,
      dueAt: instant(f.dueAt), doneAt: instant(f.doneAt), overdue: f.status === "open" && f.dueAt !== null && f.dueAt < now,
      assignee: userRef(labels, f.assigneeId),
      on: [f.opportunityId, f.personId, f.companyId].filter((id): id is string => Boolean(id)).map((id) => refs.get(id)).filter((r): r is TargetRef => Boolean(r)),
    }));
  },
};

/* ================================ record pages ================================ */

export const companyDetail: QueryDefinition<{ id: string }, Record<string, unknown> | null> = {
  key: "verity.relationship.company_detail",
  entity: ENTITY_COMPANY,
  description: "One company with its people, opportunities and totals.",
  input: z.object({ id: z.string().uuid() }),
  handler: async (ctx, input) => {
    const c = await ctx.tx.relationshipCompany.findUnique({ where: { id: input.id }, include: { mergedInto: { select: { id: true, name: true } } } });
    if (!c) return null;
    const [people, opps, labels, openFollowUps] = await Promise.all([
      ctx.tx.relationshipPerson.findMany({ where: { companyId: c.id, archivedAt: null }, orderBy: [{ givenName: "asc" }] }),
      ctx.tx.relationshipOpportunity.findMany({ where: { companyId: c.id, archivedAt: null }, include: OPPORTUNITY_INCLUDE, orderBy: { createdAt: "desc" } }),
      userLabels(ctx.tx),
      ctx.tx.relationshipFollowUp.count({ where: { companyId: c.id, archivedAt: null, status: "open" } }),
    ]);
    const sum = (list: typeof opps) => list.reduce((s, o) => s + (decimal(o.amount) ?? 0), 0);
    const open = opps.filter((o) => o.stage.category === "Active");
    const won = opps.filter((o) => o.stage.category === "Completed");
    return {
      id: c.id, version: c.version, archived: c.archivedAt !== null,
      name: c.name, domain: c.domain, industry: c.industry, sizeBand: c.sizeBand, phone: c.phone, email: c.email, taxId: c.taxId,
      addressLine: c.addressLine, city: c.city, region: c.region, country: c.country, postalCode: c.postalCode, source: c.source,
      owner: userRef(labels, c.ownerUserId), createdAt: instant(c.createdAt), updatedAt: instant(c.updatedAt),
      ...customFieldValues(c.customFields),
      mergedInto: c.mergedInto ? { id: c.mergedInto.id, label: c.mergedInto.name } : null,
      people: people.map((p) => ({ id: p.id, name: personName(p), jobTitle: p.jobTitle, email: p.emails[0] ?? null, phone: p.phones[0] ?? null })),
      opportunities: opps.map((o) => opportunityRow(o, labels)),
      stats: { openCount: open.length, openValue: sum(open), wonCount: won.length, wonValue: sum(won), openFollowUps },
    };
  },
};

export const personDetail: QueryDefinition<{ id: string }, Record<string, unknown> | null> = {
  key: "verity.relationship.person_detail",
  entity: ENTITY_PERSON,
  description: "One person with their company and the opportunities they are the contact for.",
  input: z.object({ id: z.string().uuid() }),
  handler: async (ctx, input) => {
    const p = await ctx.tx.relationshipPerson.findUnique({ where: { id: input.id }, include: { company: true, mergedInto: { select: { id: true, givenName: true, familyName: true } } } });
    if (!p) return null;
    const [opps, labels, colleagues] = await Promise.all([
      ctx.tx.relationshipOpportunity.findMany({ where: { contactId: p.id, archivedAt: null }, include: OPPORTUNITY_INCLUDE, orderBy: { createdAt: "desc" } }),
      userLabels(ctx.tx),
      p.companyId
        ? ctx.tx.relationshipPerson.findMany({ where: { companyId: p.companyId, archivedAt: null, NOT: { id: p.id } }, take: 12, orderBy: { givenName: "asc" } })
        : Promise.resolve([]),
    ]);
    return {
      id: p.id, version: p.version, archived: p.archivedAt !== null,
      name: personName(p), givenName: p.givenName, familyName: p.familyName, jobTitle: p.jobTitle,
      emails: p.emails, phones: p.phones, city: p.city,
      company: p.company ? { id: p.company.id, label: p.company.name } : null,
      owner: userRef(labels, p.ownerUserId), createdAt: instant(p.createdAt), updatedAt: instant(p.updatedAt),
      ...customFieldValues(p.customFields),
      mergedInto: p.mergedInto ? { id: p.mergedInto.id, label: personName(p.mergedInto) } : null,
      opportunities: opps.map((o) => opportunityRow(o, labels)),
      colleagues: colleagues.map((c) => ({ id: c.id, name: personName(c), jobTitle: c.jobTitle })),
    };
  },
};

export const opportunityDetail: QueryDefinition<{ id: string }, Record<string, unknown> | null> = {
  key: "verity.relationship.opportunity_detail",
  entity: ENTITY_OPPORTUNITY,
  description: "One opportunity with its stage history and the pipeline it moves through.",
  input: z.object({ id: z.string().uuid() }),
  handler: async (ctx, input) => {
    const o = await ctx.tx.relationshipOpportunity.findUnique({ where: { id: input.id }, include: OPPORTUNITY_INCLUDE });
    if (!o) return null;
    const [labels, stages, moves] = await Promise.all([
      userLabels(ctx.tx),
      ctx.tx.relationshipStage.findMany({ where: { OR: [{ active: true }, { id: o.stageId }] }, orderBy: { position: "asc" } }),
      ctx.tx.activity.findMany({ where: { entityKey: ENTITY_OPPORTUNITY, entityId: o.id, fieldChanged: "stage" }, orderBy: { occurredAt: "asc" } }),
    ]);
    return {
      ...opportunityRow(o, labels),
      updatedAt: instant(o.updatedAt),
      stages: stages.map((s) => ({ id: s.id, label: s.label, category: s.category, probability: s.probability })),
      stageHistory: [
        { label: moves[0]?.oldValue ?? o.stage.label, at: o.createdAt.toISOString() },
        ...moves.map((m) => ({ label: m.newValue ?? "", at: m.occurredAt.toISOString() })),
      ],
    };
  },
};

/* ================================ search, summary, describe ================================ */

export type SearchHit = { kind: "company" | "person" | "opportunity"; id: string; label: string; sub: string | null; href: string };

/** The command menu's search across companies, people and opportunities. */
export const searchRecords: QueryDefinition<{ term: string }, SearchHit[]> = {
  key: "verity.relationship.search",
  entity: ENTITY_COMPANY,
  description: "Search companies, people and opportunities by name, email or reference.",
  input: z.object({ term: z.string().trim().min(1).max(100) }),
  handler: async (ctx, input) => {
    const term = input.term;
    const ref = /^opp-?(\d+)$/i.exec(term);
    const contains = { contains: term, mode: "insensitive" as const };
    const [companies, people, opps] = await Promise.all([
      ctx.tx.relationshipCompany.findMany({ where: { archivedAt: null, OR: [{ name: contains }, { domain: contains }] }, take: 6, orderBy: { name: "asc" } }),
      ctx.tx.relationshipPerson.findMany({
        where: { archivedAt: null, OR: [{ givenName: contains }, { familyName: contains }, { emails: { has: term.toLowerCase() } }, { jobTitle: contains }] },
        include: { company: { select: { name: true } } },
        take: 6,
      }),
      ctx.tx.relationshipOpportunity.findMany({
        where: { archivedAt: null, OR: [{ name: contains }, ...(ref ? [{ number: Number(ref[1]) }] : [])] },
        include: { company: { select: { name: true } }, stage: { select: { label: true } } },
        take: 6,
        orderBy: { updatedAt: "desc" },
      }),
    ]);
    return [
      ...companies.map((c) => ({ kind: "company" as const, id: c.id, label: c.name, sub: c.domain ?? c.city, href: `/crm/companies/${c.id}` })),
      ...people.map((p) => ({ kind: "person" as const, id: p.id, label: personName(p), sub: [p.jobTitle, p.company?.name].filter(Boolean).join(" · ") || null, href: `/crm/people/${p.id}` })),
      ...opps.map((o) => ({ kind: "opportunity" as const, id: o.id, label: `${opportunityRef(o.number)} ${o.name}`, sub: [o.company?.name, o.stage.label].filter(Boolean).join(" · "), href: `/crm/opportunities/${o.id}` })),
    ];
  },
};

export type PipelineSummary = {
  stages: Array<{ id: string; label: string; category: string; probability: number; count: number; value: number }>;
  openCount: number;
  openValue: number;
  weightedValue: number;
  wonThisMonth: { count: number; value: number };
  lostThisMonth: number;
  winRate90: number | null;
  followUpsOverdue: number;
  followUpsMine: number;
  closingThisMonth: number;
};

/** The pipeline's headline numbers: what is open, what it is worth weighted by stage, and what closed recently. */
export const pipelineSummary: QueryDefinition<Record<string, never>, PipelineSummary> = {
  key: "verity.relationship.pipeline_summary",
  entity: ENTITY_OPPORTUNITY,
  description: "Open pipeline by stage, the weighted forecast, and what was won or lost recently.",
  input: z.object({}),
  handler: async (ctx: ReadContext) => {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const since90 = new Date(now.getTime() - 90 * 86_400_000);
    const [stages, byStage, wonMonth, lostMonth, closed90, overdue, mine, closing] = await Promise.all([
      ctx.tx.relationshipStage.findMany({ orderBy: { position: "asc" } }),
      ctx.tx.relationshipOpportunity.groupBy({ by: ["stageId"], where: { archivedAt: null }, _count: { _all: true }, _sum: { amount: true } }),
      ctx.tx.relationshipOpportunity.aggregate({
        where: { archivedAt: null, stage: { category: "Completed" }, closedAt: { gte: monthStart } }, _count: { _all: true }, _sum: { amount: true },
      }),
      ctx.tx.relationshipOpportunity.count({ where: { archivedAt: null, stage: { category: "Cancelled" }, closedAt: { gte: monthStart } } }),
      ctx.tx.relationshipOpportunity.groupBy({
        by: ["stageId"], where: { archivedAt: null, closedAt: { gte: since90 }, stage: { category: { in: ["Completed", "Cancelled"] } } }, _count: { _all: true },
      }),
      ctx.tx.relationshipFollowUp.count({ where: { archivedAt: null, status: "open", dueAt: { lt: now } } }),
      ctx.tx.relationshipFollowUp.count({ where: { archivedAt: null, status: "open", assigneeId: ctx.actor.userId } }),
      ctx.tx.relationshipOpportunity.count({
        where: { archivedAt: null, stage: { category: "Active" }, expectedCloseOn: { gte: monthStart, lt: nextMonth } },
      }),
    ]);
    const by = new Map(byStage.map((s) => [s.stageId, s]));
    const rows = stages
      .filter((s) => s.active || by.has(s.id))
      .map((s) => ({
        id: s.id, label: s.label, category: s.category, probability: s.probability,
        count: by.get(s.id)?._count._all ?? 0, value: decimal(by.get(s.id)?._sum.amount) ?? 0,
      }));
    const open = rows.filter((s) => s.category === "Active");
    const category = new Map(stages.map((s) => [s.id, s.category]));
    const won90 = closed90.filter((c) => category.get(c.stageId) === "Completed").reduce((n, c) => n + c._count._all, 0);
    const all90 = closed90.reduce((n, c) => n + c._count._all, 0);
    return {
      stages: rows,
      openCount: open.reduce((n, s) => n + s.count, 0),
      openValue: open.reduce((n, s) => n + s.value, 0),
      weightedValue: Math.round(open.reduce((n, s) => n + (s.value * s.probability) / 100, 0)),
      wonThisMonth: { count: wonMonth._count._all, value: decimal(wonMonth._sum.amount) ?? 0 },
      lostThisMonth: lostMonth,
      winRate90: all90 ? Math.round((won90 / all90) * 100) : null,
      followUpsOverdue: overdue,
      followUpsMine: mine,
      closingThisMonth: closing,
    };
  },
};

export type PipelineInsights = {
  funnel: Array<{ label: string; entered: number }>;
  lostReasons: Array<{ reason: string; count: number; value: number }>;
  months: Array<{ month: string; wonCount: number; wonValue: number; lostCount: number }>;
  forecast: Array<{ month: string; value: number; weighted: number; count: number }>;
  ageing: Array<{ bucket: string; count: number; value: number }>;
  avgDaysToWin: number | null;
};

const monthKey = (d: Date) => d.toISOString().slice(0, 7);

/**
 * How the pipeline is really doing (Task 128 stage 4). Every figure comes from the deals and their logged stage
 * changes: a funnel of how many deals ever reached each open stage, why deals were lost, won and lost by month, the
 * open value expected to close in each coming month (raw and weighted by stage probability), and how old open deals are.
 */
export const pipelineInsights: QueryDefinition<Record<string, never>, PipelineInsights> = {
  key: "verity.relationship.pipeline_insights",
  entity: ENTITY_OPPORTUNITY,
  description: "Funnel, lost reasons, won and lost by month, forecast by expected close, and ageing of open deals.",
  input: z.object({}),
  handler: async (ctx) => {
    const now = new Date();
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
    const [stages, opps, moves] = await Promise.all([
      ctx.tx.relationshipStage.findMany({ orderBy: { position: "asc" } }),
      ctx.tx.relationshipOpportunity.findMany({ where: { archivedAt: null }, include: { stage: true } }),
      ctx.tx.activity.findMany({ where: { entityKey: ENTITY_OPPORTUNITY, fieldChanged: "stage" }, select: { entityId: true, oldValue: true, newValue: true } }),
    ]);
    const value = (o: { amount: unknown }) => decimal(o.amount as never) ?? 0;

    // Funnel: a deal "entered" every stage it was ever in, the first one included.
    const reached = new Map<string, Set<string>>();
    const reach = (id: string, label: string | null) => {
      if (!label) return;
      const s = reached.get(label) ?? new Set<string>();
      s.add(id);
      reached.set(label, s);
    };
    const live = new Set(opps.map((o) => o.id));
    for (const m of moves) if (live.has(m.entityId)) { reach(m.entityId, m.oldValue); reach(m.entityId, m.newValue); }
    for (const o of opps) reach(o.id, o.stage.label);
    const funnel = stages.filter((s) => s.category !== "Cancelled").map((s) => ({ label: s.label, entered: reached.get(s.label)?.size ?? 0 }));

    const closedSince = opps.filter((o) => o.closedAt && o.closedAt >= since);
    const lost = closedSince.filter((o) => o.stage.category === "Cancelled");
    const byReason = new Map<string, { count: number; value: number }>();
    for (const o of lost) {
      const r = LOST_REASONS.find((x) => x.value === o.lostReason)?.label ?? "Not given";
      const cur = byReason.get(r) ?? { count: 0, value: 0 };
      byReason.set(r, { count: cur.count + 1, value: cur.value + value(o) });
    }

    const months: PipelineInsights["months"] = [];
    for (let i = 5; i >= 0; i--) {
      const key = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)));
      const inMonth = closedSince.filter((o) => monthKey(o.closedAt!) === key);
      const won = inMonth.filter((o) => o.stage.category === "Completed");
      months.push({ month: key, wonCount: won.length, wonValue: won.reduce((s, o) => s + value(o), 0), lostCount: inMonth.filter((o) => o.stage.category === "Cancelled").length });
    }

    const open = opps.filter((o) => o.stage.category === "Active");
    const forecast: PipelineInsights["forecast"] = [];
    for (let i = 0; i < 6; i++) {
      const key = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1)));
      // Deals already past their expected close count in the current month: they are still expected, just late.
      const due = open.filter((o) => o.expectedCloseOn && (i === 0 ? monthKey(o.expectedCloseOn) <= key : monthKey(o.expectedCloseOn) === key));
      forecast.push({
        month: key,
        count: due.length,
        value: due.reduce((s, o) => s + value(o), 0),
        weighted: Math.round(due.reduce((s, o) => s + (value(o) * o.stage.probability) / 100, 0)),
      });
    }

    const buckets = [
      { bucket: "Under 30 days", max: 30 },
      { bucket: "30 to 60 days", max: 60 },
      { bucket: "60 to 90 days", max: 90 },
      { bucket: "Over 90 days", max: Infinity },
    ];
    const ageing = buckets.map((b, i) => {
      const min = i === 0 ? 0 : buckets[i - 1]!.max;
      const inBucket = open.filter((o) => {
        const days = (now.getTime() - o.createdAt.getTime()) / 86_400_000;
        return days >= min && days < b.max;
      });
      return { bucket: b.bucket, count: inBucket.length, value: inBucket.reduce((s, o) => s + value(o), 0) };
    });

    const wonAll = opps.filter((o) => o.stage.category === "Completed" && o.closedAt);
    const avgDaysToWin = wonAll.length
      ? Math.round(wonAll.reduce((s, o) => s + (o.closedAt!.getTime() - o.createdAt.getTime()) / 86_400_000, 0) / wonAll.length)
      : null;

    return {
      funnel,
      lostReasons: [...byReason.entries()].map(([reason, v]) => ({ reason, ...v })).sort((a, b) => b.count - a.count),
      months,
      forecast,
      ageing,
      avgDaysToWin,
    };
  },
};

export type DescribedObject = RecordObject & {
  canCreate: boolean;
  canEdit: boolean;
  canShareViews: boolean;
  canDefineFields: boolean;
  members: Array<{ id: string; label: string }>;
};

const TONE_FOR_CATEGORY: Record<string, FieldOption["tone"]> = { Active: "info", Completed: "success", Cancelled: "danger" };

/**
 * A record object as a screen needs it: the static descriptor with its tenant-data options filled in (the
 * pipeline's stages, the workspace's members) and what this person may do.
 */
export const describeObject: QueryDefinition<{ objectKey: string }, DescribedObject> = {
  key: "verity.relationship.describe",
  entity: ENTITY_COMPANY,
  description: "The fields, options and permissions a CRM list screen is drawn from.",
  input: z.object({ objectKey: z.enum([ENTITY_COMPANY, ENTITY_PERSON, ENTITY_OPPORTUNITY]) }),
  handler: async (ctx: ReadContext, input) => {
    const base = getRecordObject(input.objectKey);
    if (!base) throw new ValidationError("E_VALIDATION: no such record object");
    const object = await withCustomFields(ctx.tx, base);
    const roleId = ctx.actor.roleId ?? null;
    const [members, stages, canCreate, canEdit, canShareViews, canDefineFields] = await Promise.all([
      memberDirectory(ctx.tx),
      input.objectKey === ENTITY_OPPORTUNITY ? ctx.tx.relationshipStage.findMany({ orderBy: { position: "asc" } }) : Promise.resolve([]),
      hasTenantPermission(ctx.tx, roleId, "Create", object.entity),
      hasTenantPermission(ctx.tx, roleId, "Edit", object.entity),
      hasTenantPermission(ctx.tx, roleId, "Edit", "verity.platform.saved_view"),
      hasTenantPermission(ctx.tx, roleId, "Edit", "verity.platform.custom_field"),
    ]);
    const fields = object.fields.map((f) =>
      f.key === "stage"
        ? { ...f, options: stages.filter((s) => s.active).map((s) => ({ value: s.id, label: s.label, tone: TONE_FOR_CATEGORY[s.category] ?? "neutral" })) }
        : f.relation
          ? { ...f, relationHref: getRecordObject(f.relation)?.recordHref }
          : f,
    );
    return {
      ...object,
      fields,
      canCreate,
      canEdit,
      canShareViews,
      canDefineFields,
      members: members.map((m) => ({ id: m.userId, label: m.name })),
    };
  },
};

export const OPTION_LISTS = { sources: OPPORTUNITY_SOURCES, lostReasons: LOST_REASONS, sizeBands: SIZE_BANDS, stageEntity: ENTITY_STAGE };

/** Overdue follow-ups for one tenant, for the daily reminder. Exported for the schedule in index.ts. */
export async function dueFollowUps(tx: TenantScopedClient, now: Date) {
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const endOfToday = new Date(today.getTime() + 86_400_000);
  return tx.relationshipFollowUp.findMany({
    where: {
      archivedAt: null, status: "open", assigneeId: { not: null }, dueAt: { lt: endOfToday },
      OR: [{ remindedOn: null }, { remindedOn: { lt: today } }],
    },
    take: 500,
  });
}

export type { CommandContext };
