import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { ValidationError, type CommandContext, type CommandDefinition } from "@/server/platform/command";
import type { QueryDefinition } from "@/server/platform/query";
import { ConflictError } from "@/server/platform/entity";
import { diffFields, recordActivity } from "@/server/platform/audit";
import { notify } from "@/server/platform/notification";
import type { TenantScopedClient } from "@/server/platform/tenancy";
import {
  buildOrderBy,
  buildWhere,
  computeAggregates,
  customFieldValues,
  listInputSchema,
  memberDirectory,
  mergeCustomFields,
  withCustomFields,
  type ListResult,
  type ParsedListInput,
} from "@/server/platform/views";
import {
  DEFAULT_STAGES,
  ENTITY_COMPANY,
  ENTITY_OPPORTUNITY,
  ENTITY_PERSON,
  ENTITY_STAGE,
  LOST_REASONS,
  OPPORTUNITY_SOURCES,
  PERSONAL_EMAIL_DOMAINS,
  SIZE_BANDS,
  STAGE_CATEGORIES,
  emailDomain,
  normaliseDomain,
  opportunityRef,
  personName,
} from "./shared";
import { COMPANY_OBJECT, OPPORTUNITY_OBJECT, PERSON_OBJECT } from "./objects";

/**
 * Companies, people, opportunities and the pipeline's stages: the CRM's records (Task 128, ADR-050).
 *
 * Every write is a command. Edits are a `patch` of the fields the record table can change inline, so a cell, a
 * record page and a bulk action run the same code. A stale `version` is refused rather than overwritten.
 */

type ReadContext = { tx: TenantScopedClient; actor: { userId: string; tenantId: string } };

/* ================================ shared helpers ================================ */

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z.union([z.string().trim().max(max), z.null()]).transform((v) => (v === null || v === "" ? null : v));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date as YYYY-MM-DD");
const optionalDate = z.union([isoDate, z.null(), z.literal("")]).transform((v) => (v ? v : null));
const optionalUuid = z.union([z.string().uuid(), z.null(), z.literal("")]).transform((v) => (v ? v : null));
const values = (options: Array<{ value: string }>) => options.map((o) => o.value) as [string, ...string[]];
const optionalChoice = (options: Array<{ value: string }>) =>
  z.union([z.enum(values(options)), z.null(), z.literal("")]).transform((v) => (v ? v : null));
const amount = z.union([z.number(), z.string(), z.null()]).transform((v, ctx) => {
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s₹]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > 999_999_999_999) {
    ctx.addIssue({ code: "custom", message: "an amount of zero or more" });
    return z.NEVER;
  }
  return Math.round(n * 100) / 100;
});

/** A patch to a record's tenant custom fields (PLA-EXT-001); a null clears one. Validated by `mergeCustomFields`. */
const customFieldsPatch = z.record(z.string().max(80), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()])).optional();

/** Before and after values of the custom fields a patch touched, keyed by field name, for the change log. */
function customFieldChanges(names: string[], before: unknown, after: unknown): [Record<string, unknown>, Record<string, unknown>] {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const shown = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(v) ? v.slice(0, 10) : (v ?? null));
  return [Object.fromEntries(names.map((n) => [n, shown(b[n])])), Object.fromEntries(names.map((n) => [n, shown(a[n])]))];
}

const asDay = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00.000Z`) : null);
export const dayText = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
export const instant = (d: Date | null | undefined) => (d ? d.toISOString() : null);
export const decimal = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : Number(d));

/** A user id that must belong to this tenant. */
async function requireMember(tx: TenantScopedClient, userId: string | null): Promise<void> {
  if (!userId) return;
  const found = await tx.tenantMembership.findFirst({ where: { userId, disabledAt: null }, select: { id: true } });
  if (!found) throw new ValidationError("E_VALIDATION: that owner is not a member of this workspace");
}

export async function userLabels(tx: TenantScopedClient): Promise<Map<string, string>> {
  return new Map((await memberDirectory(tx)).map((m) => [m.userId, m.name]));
}

export const userRef = (labels: Map<string, string>, id: string | null) => (id ? { id, label: labels.get(id) ?? "Former member" } : null);

function checkVersion(current: number, expected: number | undefined, what: string) {
  if (expected !== undefined && expected !== current) {
    throw new ConflictError(`E_CONFLICT: this ${what} was changed by someone else since you opened it; reload to see the change`);
  }
}

/** Records one activity row per changed field, using the labels a person would read rather than ids. */
async function logChanges(
  ctx: CommandContext,
  entityKey: string,
  entityId: string,
  commandKey: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  const changes = diffFields(before, after);
  if (changes.length) await recordActivity(ctx, { entityKey, entityId, commandKey, changes });
}

async function logCreated(ctx: CommandContext, entityKey: string, entityId: string, commandKey: string, label: string) {
  await recordActivity(ctx, { entityKey, entityId, commandKey, changes: [{ field: "record", oldValue: null, newValue: `Created ${label}` }] });
}

/* ================================ stages ================================ */

export type StageRow = {
  id: string; key: string; label: string; category: string; position: number; probability: number; active: boolean;
  playbook: { followUps: Array<{ title: string; dueInDays: number }>; notifyOwner: boolean };
};

/** Writes the default pipeline the first time a tenant needs one. Called only from commands. */
async function ensureStages(ctx: CommandContext): Promise<void> {
  if ((await ctx.tx.relationshipStage.count()) > 0) return;
  await ctx.tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["relationship-stages", ctx.actor.tenantId])}, 0))`;
  if ((await ctx.tx.relationshipStage.count()) > 0) return;
  await ctx.tx.relationshipStage.createMany({
    data: DEFAULT_STAGES.map((s, i) => ({ tenantId: ctx.actor.tenantId, ...s, position: (i + 1) * 10 })),
  });
}

export const setupPipeline: CommandDefinition<Record<string, never>, { stages: number }> = {
  key: "verity.relationship.setup_pipeline",
  entity: ENTITY_STAGE,
  verb: "Create",
  description: "Create the starting sales pipeline: enquiry, qualified, technical quote, negotiation, won, lost.",
  input: z.object({}),
  handler: async (ctx) => {
    await ensureStages(ctx);
    return { result: { stages: await ctx.tx.relationshipStage.count() } };
  },
};

export const saveStage: CommandDefinition<
  { id?: string; label: string; category: (typeof STAGE_CATEGORIES)[number]; probability: number; active?: boolean },
  { id: string }
> = {
  key: "verity.relationship.save_stage",
  entity: ENTITY_STAGE,
  verb: "Edit",
  description: "Add a pipeline stage, or rename one and change its win probability.",
  input: z.object({
    id: z.string().uuid().optional(),
    label: text(60).min(1),
    category: z.enum(STAGE_CATEGORIES),
    probability: z.number().int().min(0).max(100),
    active: z.boolean().optional(),
  }),
  handler: async (ctx, input) => {
    await ensureStages(ctx);
    if (input.id) {
      const stage = await ctx.tx.relationshipStage.findUnique({ where: { id: input.id } });
      if (!stage) throw new ValidationError("E_VALIDATION: no such stage");
      if (input.active === false && stage.active) {
        const open = await ctx.tx.relationshipOpportunity.count({ where: { stageId: stage.id, archivedAt: null } });
        if (open > 0) throw new ValidationError(`E_VALIDATION: ${open} opportunit${open === 1 ? "y is" : "ies are"} in ${stage.label}; move them first`);
      }
      if (input.category !== stage.category && (await ctx.tx.relationshipOpportunity.count({ where: { stageId: stage.id } })) > 0) {
        throw new ValidationError(`E_VALIDATION: ${stage.label} already holds opportunities, so whether it means open, won or lost cannot change`);
      }
      await ctx.tx.relationshipStage.update({
        where: { id: stage.id },
        data: {
          label: input.label, category: input.category, probability: input.probability,
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
      });
      return { result: { id: stage.id } };
    }
    const base = input.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "stage";
    const key = /^[a-z]/.test(base) ? base : `s_${base}`;
    const taken = new Set((await ctx.tx.relationshipStage.findMany({ select: { key: true } })).map((s) => s.key));
    let unique = key;
    for (let n = 2; taken.has(unique); n++) unique = `${key}_${n}`;
    const top = await ctx.tx.relationshipStage.aggregate({ _max: { position: true } });
    const stage = await ctx.tx.relationshipStage.create({
      data: {
        tenantId: ctx.actor.tenantId, key: unique, label: input.label, category: input.category,
        probability: input.probability, position: (top._max.position ?? 0) + 10,
      },
    });
    return { result: { id: stage.id } };
  },
};

export const reorderStages: CommandDefinition<{ ids: string[] }, { count: number }> = {
  key: "verity.relationship.reorder_stages",
  entity: ENTITY_STAGE,
  verb: "Edit",
  description: "Put the pipeline's stages in a new order.",
  input: z.object({ ids: z.array(z.string().uuid()).min(1).max(40) }),
  handler: async (ctx, input) => {
    const stages = await ctx.tx.relationshipStage.findMany({ select: { id: true } });
    const known = new Set(stages.map((s) => s.id));
    if (input.ids.length !== known.size || new Set(input.ids).size !== input.ids.length || input.ids.some((id) => !known.has(id))) {
      throw new ValidationError("E_VALIDATION: list every stage exactly once");
    }
    for (const [i, id] of input.ids.entries()) await ctx.tx.relationshipStage.update({ where: { id }, data: { position: (i + 1) * 10 } });
    return { result: { count: input.ids.length } };
  },
};

export const listStages: QueryDefinition<Record<string, never>, StageRow[]> = {
  key: "verity.relationship.list_stages",
  entity: ENTITY_STAGE,
  description: "The pipeline's stages in order.",
  input: z.object({}),
  handler: async (ctx) =>
    (await ctx.tx.relationshipStage.findMany({ orderBy: { position: "asc" } })).map((s) => ({
      id: s.id, key: s.key, label: s.label, category: s.category, position: s.position, probability: s.probability, active: s.active,
      playbook: readPlaybook(s.config),
    })),
};

/* ================================ companies ================================ */

const companyPatchSchema = z
  .object({
    name: text(200).min(1),
    domain: optionalText(200),
    industry: optionalText(120),
    sizeBand: optionalChoice(SIZE_BANDS),
    phone: optionalText(40),
    email: z.union([z.string().trim().email().max(200), z.null(), z.literal("")]).transform((v) => (v ? v.toLowerCase() : null)),
    taxId: optionalText(40),
    city: optionalText(120),
    region: optionalText(120),
    country: optionalText(120),
    postalCode: optionalText(20),
    addressLine: optionalText(300),
    owner: optionalUuid,
    source: optionalChoice(OPPORTUNITY_SOURCES),
    customFields: customFieldsPatch,
  })
  .partial();
type CompanyPatch = z.infer<typeof companyPatchSchema>;

function companyData(patch: CompanyPatch): Prisma.RelationshipCompanyUncheckedUpdateInput {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || key === "customFields") continue;
    if (key === "owner") data.ownerUserId = value;
    else if (key === "domain") {
      const domain = normaliseDomain(value as string | null);
      if (value && !domain) throw new ValidationError("E_VALIDATION: a domain looks like acme.in");
      data.domain = domain;
    } else data[key] = value;
  }
  return data as Prisma.RelationshipCompanyUncheckedUpdateInput;
}

async function refuseDuplicateCompany(tx: TenantScopedClient, name: string | undefined, domain: string | null | undefined, exceptId?: string) {
  const or: Prisma.RelationshipCompanyWhereInput[] = [];
  if (domain) or.push({ domain });
  if (name) or.push({ name: { equals: name.trim(), mode: "insensitive" } });
  if (!or.length) return;
  const twin = await tx.relationshipCompany.findFirst({ where: { archivedAt: null, OR: or, ...(exceptId ? { NOT: { id: exceptId } } : {}) } });
  if (twin) throw new ValidationError(`E_VALIDATION: ${twin.name} already exists${twin.domain ? ` (${twin.domain})` : ""}; open it instead, or save anyway`);
}

export const createCompany: CommandDefinition<CompanyPatch & { name: string; allowDuplicate?: boolean }, { id: string }> = {
  key: "verity.relationship.create_company",
  entity: ENTITY_COMPANY,
  verb: "Create",
  description: "Add a company the business sells to or works with.",
  input: companyPatchSchema.extend({ name: text(200).min(1), allowDuplicate: z.boolean().optional() }),
  handler: async (ctx, input) => {
    const { allowDuplicate, ...patch } = input;
    const data = companyData(patch);
    if (!allowDuplicate) await refuseDuplicateCompany(ctx.tx, input.name, data.domain as string | null | undefined);
    const owner = patch.owner === undefined ? ctx.actor.userId : patch.owner;
    await requireMember(ctx.tx, owner);
    const customFields = await mergeCustomFields(ctx.tx, ENTITY_COMPANY, {}, patch.customFields ?? {});
    const company = await ctx.tx.relationshipCompany.create({
      data: {
        ...(data as Prisma.RelationshipCompanyUncheckedCreateInput),
        name: input.name, ownerUserId: owner, tenantId: ctx.actor.tenantId, createdById: ctx.actor.userId, customFields: customFields as object,
      },
    });
    await logCreated(ctx, ENTITY_COMPANY, company.id, "verity.relationship.create_company", company.name);
    return { result: { id: company.id }, events: [{ name: "verity.relationship.company_created", entityId: company.id }] };
  },
};

async function applyCompanyPatch(ctx: CommandContext, id: string, version: number | undefined, patch: CompanyPatch, commandKey: string) {
  const company = await ctx.tx.relationshipCompany.findUnique({ where: { id } });
  if (!company) throw new ValidationError("E_VALIDATION: no such company");
  checkVersion(company.version, version, "company");
  const data = companyData(patch);
  if (data.ownerUserId !== undefined) await requireMember(ctx.tx, data.ownerUserId as string | null);
  if (patch.name !== undefined || data.domain) await refuseDuplicateCompany(ctx.tx, patch.name, data.domain as string | null | undefined, id);
  if (patch.customFields) data.customFields = (await mergeCustomFields(ctx.tx, ENTITY_COMPANY, company.customFields, patch.customFields)) as object;
  const saved = await ctx.tx.relationshipCompany.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  const labels = data.ownerUserId !== undefined ? await userLabels(ctx.tx) : new Map<string, string>();
  const shown = (c: typeof company) => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(patch)) {
      if (key === "customFields") continue;
      out[key] = key === "owner" ? (c.ownerUserId ? (labels.get(c.ownerUserId) ?? null) : null) : (c as Record<string, unknown>)[key];
    }
    return out;
  };
  const [cfBefore, cfAfter] = customFieldChanges(Object.keys(patch.customFields ?? {}), company.customFields, saved.customFields);
  await logChanges(ctx, ENTITY_COMPANY, id, commandKey, { ...shown(company), ...cfBefore }, { ...shown(saved), ...cfAfter });
  return saved;
}

export const updateCompany: CommandDefinition<{ id: string; version?: number; patch: CompanyPatch }, { id: string; version: number }> = {
  key: "verity.relationship.update_company",
  entity: ENTITY_COMPANY,
  verb: "Edit",
  description: "Change a company's details.",
  input: z.object({ id: z.string().uuid(), version: z.number().int().optional(), patch: companyPatchSchema }),
  handler: async (ctx, input) => {
    const saved = await applyCompanyPatch(ctx, input.id, input.version, input.patch, "verity.relationship.update_company");
    return { result: { id: saved.id, version: saved.version } };
  },
};

/* ================================ people ================================ */

const listOf = (item: z.ZodType<string, string>) =>
  z
    .union([z.array(z.string()), z.string(), z.null()])
    .transform((v) => {
      const list = v === null ? [] : Array.isArray(v) ? v : String(v).split(/[,;\n]/);
      return [...new Set(list.map((x) => x.trim()).filter(Boolean))];
    })
    .pipe(z.array(item).max(10));

const personPatchSchema = z
  .object({
    givenName: text(100).min(1),
    familyName: optionalText(100),
    company: optionalUuid,
    jobTitle: optionalText(120),
    emails: listOf(z.string().email().max(200)).transform((l) => [...new Set(l.map((e) => e.toLowerCase()))]),
    phones: listOf(z.string().max(40)),
    city: optionalText(120),
    owner: optionalUuid,
    customFields: customFieldsPatch,
  })
  .partial();
type PersonPatch = z.infer<typeof personPatchSchema>;

function personData(patch: PersonPatch): Prisma.RelationshipPersonUncheckedUpdateInput {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || key === "customFields") continue;
    if (key === "owner") data.ownerUserId = value;
    else if (key === "company") data.companyId = value;
    else data[key] = value;
  }
  return data as Prisma.RelationshipPersonUncheckedUpdateInput;
}

export async function requireCompany(tx: TenantScopedClient, id: string | null | undefined) {
  if (!id) return null;
  const company = await tx.relationshipCompany.findUnique({ where: { id } });
  if (!company) throw new ValidationError("E_VALIDATION: no such company");
  return company;
}

export const createPerson: CommandDefinition<PersonPatch & { givenName: string; allowDuplicate?: boolean }, { id: string; companyId: string | null }> = {
  key: "verity.relationship.create_person",
  entity: ENTITY_PERSON,
  verb: "Create",
  description: "Add a person, usually a contact at a company.",
  input: personPatchSchema.extend({ givenName: text(100).min(1), allowDuplicate: z.boolean().optional() }),
  handler: async (ctx, input) => {
    const { allowDuplicate, ...patch } = input;
    const data = personData(patch);
    const emails = (patch.emails ?? []) as string[];
    if (!allowDuplicate && emails.length) {
      const twin = await ctx.tx.relationshipPerson.findFirst({ where: { archivedAt: null, emails: { hasSome: emails } } });
      if (twin) {
        throw new ValidationError(`E_VALIDATION: ${personName(twin)} already has ${emails.find((e) => twin.emails.includes(e))}; open them instead, or save anyway`);
      }
    }
    await requireCompany(ctx.tx, data.companyId as string | null | undefined);
    // A work email names the company when none was chosen, but only when exactly one company has that domain:
    // two candidates is a question for the person, not a guess for the system.
    if (data.companyId === undefined && emails.length) {
      const domain = emailDomain(emails[0]!);
      if (domain && !PERSONAL_EMAIL_DOMAINS.has(domain)) {
        const matches = await ctx.tx.relationshipCompany.findMany({ where: { domain, archivedAt: null }, select: { id: true }, take: 2 });
        if (matches.length === 1) data.companyId = matches[0]!.id;
      }
    }
    const owner = patch.owner === undefined ? ctx.actor.userId : patch.owner;
    await requireMember(ctx.tx, owner);
    const customFields = await mergeCustomFields(ctx.tx, ENTITY_PERSON, {}, patch.customFields ?? {});
    const person = await ctx.tx.relationshipPerson.create({
      data: {
        ...(data as Prisma.RelationshipPersonUncheckedCreateInput),
        givenName: input.givenName, ownerUserId: owner, tenantId: ctx.actor.tenantId, createdById: ctx.actor.userId, customFields: customFields as object,
      },
    });
    await logCreated(ctx, ENTITY_PERSON, person.id, "verity.relationship.create_person", personName(person));
    return { result: { id: person.id, companyId: person.companyId }, events: [{ name: "verity.relationship.person_created", entityId: person.id }] };
  },
};

async function applyPersonPatch(ctx: CommandContext, id: string, version: number | undefined, patch: PersonPatch, commandKey: string) {
  const person = await ctx.tx.relationshipPerson.findUnique({ where: { id }, include: { company: true } });
  if (!person) throw new ValidationError("E_VALIDATION: no such person");
  checkVersion(person.version, version, "person");
  const data = personData(patch);
  const company = data.companyId !== undefined ? await requireCompany(ctx.tx, data.companyId as string | null) : person.company;
  if (data.ownerUserId !== undefined) await requireMember(ctx.tx, data.ownerUserId as string | null);
  if (patch.customFields) data.customFields = (await mergeCustomFields(ctx.tx, ENTITY_PERSON, person.customFields, patch.customFields)) as object;
  const saved = await ctx.tx.relationshipPerson.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  const labels = data.ownerUserId !== undefined ? await userLabels(ctx.tx) : new Map<string, string>();
  const shown = (p: Record<string, unknown> & { ownerUserId: string | null }, companyName: string | null) => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(patch)) {
      if (key === "customFields") continue;
      if (key === "owner") out.owner = p.ownerUserId ? (labels.get(p.ownerUserId) ?? null) : null;
      else if (key === "company") out.company = companyName;
      else {
        const v = p[key];
        out[key] = Array.isArray(v) ? v.join(", ") : v;
      }
    }
    return out;
  };
  const [cfBefore, cfAfter] = customFieldChanges(Object.keys(patch.customFields ?? {}), person.customFields, saved.customFields);
  await logChanges(
    ctx, ENTITY_PERSON, id, commandKey,
    { ...shown(person, person.company?.name ?? null), ...cfBefore },
    { ...shown(saved, company?.name ?? null), ...cfAfter },
  );
  return saved;
}

export const updatePerson: CommandDefinition<{ id: string; version?: number; patch: PersonPatch }, { id: string; version: number }> = {
  key: "verity.relationship.update_person",
  entity: ENTITY_PERSON,
  verb: "Edit",
  description: "Change a person's details or the company they are at.",
  input: z.object({ id: z.string().uuid(), version: z.number().int().optional(), patch: personPatchSchema }),
  handler: async (ctx, input) => {
    const saved = await applyPersonPatch(ctx, input.id, input.version, input.patch, "verity.relationship.update_person");
    return { result: { id: saved.id, version: saved.version } };
  },
};

/* ================================ opportunities ================================ */

const opportunityPatchSchema = z
  .object({
    name: text(200).min(1),
    company: optionalUuid,
    contact: optionalUuid,
    stage: z.string().uuid(),
    amount,
    currency: z.string().regex(/^[A-Z]{3}$/),
    expectedCloseOn: optionalDate,
    submissionDueOn: optionalDate,
    source: optionalChoice(OPPORTUNITY_SOURCES),
    owner: optionalUuid,
    lostReason: optionalChoice(LOST_REASONS),
    lostNote: optionalText(1000),
    customFields: customFieldsPatch,
  })
  .partial();
type OpportunityPatch = z.infer<typeof opportunityPatchSchema>;

/* ================================ stage playbooks (Task 128 stage 4) ================================ */

/** What a stage does when a deal enters it: follow-ups to plan, and whether to tell the deal's owner. */
export const playbookSchema = z.object({
  followUps: z.array(z.object({ title: z.string().trim().min(1).max(200), dueInDays: z.number().int().min(0).max(365) })).max(10).default([]),
  notifyOwner: z.boolean().default(false),
});
export type Playbook = z.infer<typeof playbookSchema>;

export function readPlaybook(config: unknown): Playbook {
  const parsed = playbookSchema.safeParse(config ?? {});
  return parsed.success ? parsed.data : { followUps: [], notifyOwner: false };
}

/**
 * Runs a stage's playbook for a deal that just entered it, inside the command that moved it, so the follow-ups and
 * the notice exist exactly when the move does and roll back with it. Each follow-up is for the deal's owner (or the
 * person who moved it when it has none); the notice names the deal and the stage, nothing the owner cannot read.
 */
async function runPlaybook(
  ctx: CommandContext,
  stage: { id: string; label: string; config: unknown },
  opp: { id: string; number: number; name: string; companyId: string | null; contactId: string | null; ownerUserId: string | null },
) {
  const playbook = readPlaybook(stage.config);
  const assignee = opp.ownerUserId ?? ctx.actor.userId;
  for (const step of playbook.followUps) {
    const due = new Date(Date.now() + step.dueInDays * 86_400_000);
    due.setUTCHours(6, 30, 0, 0); // 12:00 IST: due in the working day it names
    await ctx.tx.relationshipFollowUp.create({
      data: {
        tenantId: ctx.actor.tenantId, opportunityId: opp.id, companyId: opp.companyId, personId: opp.contactId,
        title: step.title, dueAt: due, assigneeId: assignee, createdById: ctx.actor.userId,
      },
    });
  }
  if (playbook.notifyOwner && opp.ownerUserId && opp.ownerUserId !== ctx.actor.userId) {
    await notify(ctx.tx, {
      tenantId: ctx.actor.tenantId,
      recipientIds: [opp.ownerUserId],
      key: "verity.relationship.opportunity_entered_stage",
      entityKey: ENTITY_OPPORTUNITY,
      entityId: opp.id,
      variables: { ref: opportunityRef(opp.number), stage: stage.label },
      fallback: { subject: `${opportunityRef(opp.number)} moved to ${stage.label}`, body: opp.name },
    });
  }
}

export const setStagePlaybook: CommandDefinition<{ id: string; playbook: z.input<typeof playbookSchema> }, { id: string }> = {
  key: "verity.relationship.set_stage_playbook",
  entity: ENTITY_STAGE,
  verb: "Edit",
  description: "Set what happens when a deal enters a stage: follow-ups to plan and whether to tell its owner.",
  input: z.object({ id: z.string().uuid(), playbook: playbookSchema }),
  handler: async (ctx, input) => {
    const stage = await ctx.tx.relationshipStage.findUnique({ where: { id: input.id } });
    if (!stage) throw new ValidationError("E_VALIDATION: no such stage");
    const playbook = playbookSchema.parse(input.playbook);
    await ctx.tx.relationshipStage.update({ where: { id: stage.id }, data: { config: playbook as object } });
    return { result: { id: stage.id } };
  },
};

async function nextOpportunityNumber(ctx: CommandContext): Promise<number> {
  await ctx.tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["relationship-opportunity-number", ctx.actor.tenantId])}, 0))`;
  const top = await ctx.tx.relationshipOpportunity.aggregate({ _max: { number: true } });
  return (top._max.number ?? 0) + 1;
}

async function requireStage(tx: TenantScopedClient, id: string) {
  const stage = await tx.relationshipStage.findUnique({ where: { id } });
  if (!stage) throw new ValidationError("E_VALIDATION: no such stage");
  if (!stage.active) throw new ValidationError(`E_VALIDATION: ${stage.label} is retired; choose another stage`);
  return stage;
}

/** What entering a stage does to the record: closing dates, and a lost reason only while lost. */
function stageEffects(
  from: { category: string } | null,
  to: { category: string; label: string },
  lostReason: string | null | undefined,
  current: { lostReason: string | null; closedAt: Date | null },
): { lostReason: string | null; lostNote?: null; closedAt: Date | null } {
  let reason: string | null = null;
  if (to.category === "Cancelled") {
    reason = lostReason ?? current.lostReason;
    if (!reason) throw new ValidationError(`E_VALIDATION: say why it was lost before moving it to ${to.label}`);
  }
  const closedAt = to.category === "Active" ? null : !from || from.category === "Active" || !current.closedAt ? new Date() : current.closedAt;
  return to.category === "Cancelled" ? { lostReason: reason, closedAt } : { lostReason: null, lostNote: null, closedAt };
}

function stageEvent(to: { category: string }, id: string) {
  if (to.category === "Completed") return { name: "verity.relationship.opportunity_won", entityId: id };
  if (to.category === "Cancelled") return { name: "verity.relationship.opportunity_lost", entityId: id };
  return { name: "verity.relationship.opportunity_stage_changed", entityId: id };
}

export const createOpportunity: CommandDefinition<OpportunityPatch & { name: string }, { id: string; number: number }> = {
  key: "verity.relationship.create_opportunity",
  entity: ENTITY_OPPORTUNITY,
  verb: "Create",
  description: "Open a new opportunity in the pipeline.",
  input: opportunityPatchSchema.extend({ name: text(200).min(1) }),
  handler: async (ctx, input) => {
    await ensureStages(ctx);
    const stage = input.stage
      ? await requireStage(ctx.tx, input.stage)
      : await ctx.tx.relationshipStage.findFirstOrThrow({ where: { active: true, category: "Active" }, orderBy: { position: "asc" } });
    const contact = input.contact ? await ctx.tx.relationshipPerson.findUnique({ where: { id: input.contact } }) : null;
    if (input.contact && !contact) throw new ValidationError("E_VALIDATION: no such person");
    const companyId = input.company !== undefined ? input.company : (contact?.companyId ?? null);
    await requireCompany(ctx.tx, companyId);
    const owner = input.owner === undefined ? ctx.actor.userId : input.owner;
    await requireMember(ctx.tx, owner);
    const effects = stageEffects(null, stage, input.lostReason, { lostReason: null, closedAt: null });
    const number = await nextOpportunityNumber(ctx);
    const top = await ctx.tx.relationshipOpportunity.aggregate({ where: { stageId: stage.id }, _min: { position: true } });
    const customFields = await mergeCustomFields(ctx.tx, ENTITY_OPPORTUNITY, {}, input.customFields ?? {});
    const opportunity = await ctx.tx.relationshipOpportunity.create({
      data: {
        tenantId: ctx.actor.tenantId,
        number,
        name: input.name,
        companyId,
        contactId: input.contact ?? null,
        ownerUserId: owner,
        amount: input.amount ?? null,
        currency: input.currency ?? "INR",
        stageId: stage.id,
        // New cards go to the top of their column.
        position: (top._min.position ?? 1000) - 1,
        expectedCloseOn: asDay(input.expectedCloseOn ?? null),
        submissionDueOn: asDay(input.submissionDueOn ?? null),
        source: input.source ?? null,
        lostReason: effects.lostReason,
        lostNote: stage.category === "Cancelled" ? (input.lostNote ?? null) : null,
        closedAt: effects.closedAt,
        createdById: ctx.actor.userId,
        customFields: customFields as object,
      },
    });
    await logCreated(ctx, ENTITY_OPPORTUNITY, opportunity.id, "verity.relationship.create_opportunity", `${opportunityRef(number)} in ${stage.label}`);
    await runPlaybook(ctx, stage, opportunity);
    return { result: { id: opportunity.id, number }, events: [{ name: "verity.relationship.opportunity_created", entityId: opportunity.id }] };
  },
};

async function applyOpportunityPatch(
  ctx: CommandContext,
  id: string,
  version: number | undefined,
  patch: OpportunityPatch,
  commandKey: string,
  position?: number,
) {
  const opp = await ctx.tx.relationshipOpportunity.findUnique({ where: { id }, include: { stage: true, company: true, contact: true } });
  if (!opp) throw new ValidationError("E_VALIDATION: no such opportunity");
  checkVersion(opp.version, version, "opportunity");

  const data: Record<string, unknown> = {};
  let stage = opp.stage;
  let company = opp.company;
  let contact = opp.contact;
  const stageChanges = patch.stage !== undefined && patch.stage !== opp.stageId;
  if (stageChanges) {
    stage = await requireStage(ctx.tx, patch.stage!);
    data.stageId = stage.id;
    Object.assign(data, stageEffects(opp.stage, stage, patch.lostReason, opp));
    if (stage.category === "Cancelled" && patch.lostNote !== undefined) data.lostNote = patch.lostNote;
  } else if (patch.lostReason !== undefined || patch.lostNote !== undefined) {
    if (opp.stage.category !== "Cancelled") throw new ValidationError("E_VALIDATION: a lost reason belongs only to a lost opportunity");
    if (patch.lostReason === null) throw new ValidationError("E_VALIDATION: a lost opportunity keeps its reason");
    if (patch.lostReason) data.lostReason = patch.lostReason;
    if (patch.lostNote !== undefined) data.lostNote = patch.lostNote;
  }
  if (patch.contact !== undefined) {
    contact = patch.contact ? await ctx.tx.relationshipPerson.findUnique({ where: { id: patch.contact } }) : null;
    if (patch.contact && !contact) throw new ValidationError("E_VALIDATION: no such person");
    data.contactId = patch.contact;
  }
  if (patch.company !== undefined) {
    company = await requireCompany(ctx.tx, patch.company);
    data.companyId = patch.company;
  }
  if (patch.owner !== undefined) {
    await requireMember(ctx.tx, patch.owner);
    data.ownerUserId = patch.owner;
  }
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.amount !== undefined) data.amount = patch.amount;
  if (patch.currency !== undefined) data.currency = patch.currency;
  if (patch.expectedCloseOn !== undefined) data.expectedCloseOn = asDay(patch.expectedCloseOn);
  if (patch.submissionDueOn !== undefined) data.submissionDueOn = asDay(patch.submissionDueOn);
  if (patch.source !== undefined) data.source = patch.source;
  if (position !== undefined) data.position = position;
  if (patch.customFields) data.customFields = (await mergeCustomFields(ctx.tx, ENTITY_OPPORTUNITY, opp.customFields, patch.customFields)) as object;

  const saved = await ctx.tx.relationshipOpportunity.update({
    where: { id },
    data: { ...(data as Prisma.RelationshipOpportunityUncheckedUpdateInput), version: { increment: 1 } },
  });

  const labels = patch.owner !== undefined ? await userLabels(ctx.tx) : new Map<string, string>();
  const reason = (v: string | null) => LOST_REASONS.find((r) => r.value === v)?.label ?? v;
  const view = (o: typeof saved, names: { stage: string; company: string | null; contact: string | null }) => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(patch)) {
      if (key === "customFields") continue;
      if (key === "stage") out.stage = names.stage;
      else if (key === "company") out.company = names.company;
      else if (key === "contact") out.contact = names.contact;
      else if (key === "owner") out.owner = o.ownerUserId ? (labels.get(o.ownerUserId) ?? null) : null;
      else if (key === "amount") out.amount = decimal(o.amount);
      else if (key === "expectedCloseOn" || key === "submissionDueOn") out[key] = dayText(o[key]);
      else if (key === "lostReason") out.lostReason = reason(o.lostReason);
      else out[key] = (o as Record<string, unknown>)[key];
    }
    if (stageChanges) out.lostReason = reason(o.lostReason);
    return out;
  };
  const [cfBefore, cfAfter] = customFieldChanges(Object.keys(patch.customFields ?? {}), opp.customFields, saved.customFields);
  await logChanges(
    ctx, ENTITY_OPPORTUNITY, id, commandKey,
    { ...view(opp, { stage: opp.stage.label, company: opp.company?.name ?? null, contact: opp.contact ? personName(opp.contact) : null }), ...cfBefore },
    { ...view(saved, { stage: stage.label, company: company?.name ?? null, contact: contact ? personName(contact) : null }), ...cfAfter },
  );
  if (stageChanges) await runPlaybook(ctx, stage, saved);
  return { saved, events: stageChanges ? [stageEvent(stage, id)] : [] };
}

export const updateOpportunity: CommandDefinition<{ id: string; version?: number; patch: OpportunityPatch }, { id: string; version: number }> = {
  key: "verity.relationship.update_opportunity",
  entity: ENTITY_OPPORTUNITY,
  verb: "Edit",
  description: "Change an opportunity's details or move it to another stage.",
  input: z.object({ id: z.string().uuid(), version: z.number().int().optional(), patch: opportunityPatchSchema }),
  handler: async (ctx, input) => {
    const { saved, events } = await applyOpportunityPatch(ctx, input.id, input.version, input.patch, "verity.relationship.update_opportunity");
    return { result: { id: saved.id, version: saved.version }, events };
  },
};

export const moveOpportunity: CommandDefinition<
  { id: string; stageId: string; position: number; version?: number; lostReason?: string | null; lostNote?: string | null },
  { id: string; version: number }
> = {
  key: "verity.relationship.move_opportunity",
  entity: ENTITY_OPPORTUNITY,
  verb: "Edit",
  description: "Move an opportunity on the pipeline board: to another stage, or up and down within one.",
  input: z.object({
    id: z.string().uuid(),
    stageId: z.string().uuid(),
    position: z.number().finite(),
    version: z.number().int().optional(),
    lostReason: optionalChoice(LOST_REASONS).optional(),
    lostNote: optionalText(1000).optional(),
  }),
  handler: async (ctx, input) => {
    const patch: OpportunityPatch = { stage: input.stageId };
    if (input.lostReason !== undefined) patch.lostReason = input.lostReason;
    if (input.lostNote !== undefined) patch.lostNote = input.lostNote;
    const { saved, events } = await applyOpportunityPatch(ctx, input.id, input.version, patch, "verity.relationship.move_opportunity", input.position);
    return { result: { id: saved.id, version: saved.version }, events };
  },
};

/* ================================ archive, restore, bulk ================================ */

type RecordKind = "company" | "person" | "opportunity";
const ENTITY_FOR: Record<RecordKind, string> = { company: ENTITY_COMPANY, person: ENTITY_PERSON, opportunity: ENTITY_OPPORTUNITY };
const PLURAL: Record<RecordKind, string> = { company: "companies", person: "people", opportunity: "opportunities" };

async function setArchived(ctx: CommandContext, kind: RecordKind, ids: string[], archived: boolean, commandKey: string): Promise<number> {
  const where = { id: { in: ids }, archivedAt: archived ? null : { not: null } };
  const found =
    kind === "company"
      ? await ctx.tx.relationshipCompany.findMany({ where, select: { id: true } })
      : kind === "person"
        ? await ctx.tx.relationshipPerson.findMany({ where, select: { id: true } })
        : await ctx.tx.relationshipOpportunity.findMany({ where, select: { id: true } });
  const targets = found.map((f) => f.id);
  if (!targets.length) return 0;
  const data = { archivedAt: archived ? new Date() : null, version: { increment: 1 } };
  if (kind === "company") await ctx.tx.relationshipCompany.updateMany({ where: { id: { in: targets } }, data });
  else if (kind === "person") await ctx.tx.relationshipPerson.updateMany({ where: { id: { in: targets } }, data });
  else await ctx.tx.relationshipOpportunity.updateMany({ where: { id: { in: targets } }, data });
  for (const id of targets) {
    await recordActivity(ctx, {
      entityKey: ENTITY_FOR[kind], entityId: id, commandKey,
      changes: [{ field: "record", oldValue: archived ? "Active" : "Archived", newValue: archived ? "Archived" : "Restored" }],
    });
  }
  return targets.length;
}

function archiveCommand(kind: RecordKind, archived: boolean): CommandDefinition<{ ids: string[] }, { count: number }> {
  const key = `verity.relationship.${archived ? "archive" : "restore"}_${PLURAL[kind]}`;
  const command: CommandDefinition<{ ids: string[] }, { count: number }> = {
    key,
    entity: ENTITY_FOR[kind],
    verb: "Edit",
    description: `${archived ? "Archive" : "Restore"} ${PLURAL[kind]}. Archived records leave lists but keep their history.`,
    input: z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }),
    handler: async (ctx, input) => ({ result: { count: await setArchived(ctx, kind, input.ids, archived, key) } }),
  };
  return command;
}

export const archiveCompanies = archiveCommand("company", true);
export const restoreCompanies = archiveCommand("company", false);
export const archivePeople = archiveCommand("person", true);
export const restorePeople = archiveCommand("person", false);
export const archiveOpportunities = archiveCommand("opportunity", true);
export const restoreOpportunities = archiveCommand("opportunity", false);

const bulkCompanySchema = companyPatchSchema.pick({ owner: true, source: true, industry: true, sizeBand: true });
const bulkPersonSchema = personPatchSchema.pick({ owner: true, company: true, city: true });
const bulkOpportunitySchema = opportunityPatchSchema.pick({ owner: true, stage: true, source: true, lostReason: true });

function requireSomething(patch: Record<string, unknown>) {
  if (!Object.values(patch).some((v) => v !== undefined)) throw new ValidationError("E_VALIDATION: choose what to change");
}

/** One change applied to many records: the bulk bar's owner, source and stage. Each record is logged on its own. */
export const bulkUpdateCompanies: CommandDefinition<{ ids: string[]; patch: z.infer<typeof bulkCompanySchema> }, { count: number }> = {
  key: "verity.relationship.bulk_update_companies",
  entity: ENTITY_COMPANY,
  verb: "Edit",
  description: "Change the same field on several companies at once.",
  input: z.object({ ids: z.array(z.string().uuid()).min(1).max(200), patch: bulkCompanySchema }),
  handler: async (ctx, input) => {
    requireSomething(input.patch);
    for (const id of input.ids) await applyCompanyPatch(ctx, id, undefined, input.patch, "verity.relationship.bulk_update_companies");
    return { result: { count: input.ids.length } };
  },
};

export const bulkUpdatePeople: CommandDefinition<{ ids: string[]; patch: z.infer<typeof bulkPersonSchema> }, { count: number }> = {
  key: "verity.relationship.bulk_update_people",
  entity: ENTITY_PERSON,
  verb: "Edit",
  description: "Change the same field on several people at once.",
  input: z.object({ ids: z.array(z.string().uuid()).min(1).max(200), patch: bulkPersonSchema }),
  handler: async (ctx, input) => {
    requireSomething(input.patch);
    for (const id of input.ids) await applyPersonPatch(ctx, id, undefined, input.patch, "verity.relationship.bulk_update_people");
    return { result: { count: input.ids.length } };
  },
};

export const bulkUpdateOpportunities: CommandDefinition<{ ids: string[]; patch: z.infer<typeof bulkOpportunitySchema> }, { count: number }> = {
  key: "verity.relationship.bulk_update_opportunities",
  entity: ENTITY_OPPORTUNITY,
  verb: "Edit",
  description: "Change the same field on several opportunities at once.",
  input: z.object({ ids: z.array(z.string().uuid()).min(1).max(200), patch: bulkOpportunitySchema }),
  handler: async (ctx, input) => {
    requireSomething(input.patch);
    const events = [];
    for (const id of input.ids) events.push(...(await applyOpportunityPatch(ctx, id, undefined, input.patch, "verity.relationship.bulk_update_opportunities")).events);
    return { result: { count: input.ids.length }, events };
  },
};

/* ================================ duplicates and merging (Task 128 stage 3) ================================ */

export type DuplicateGroup = { reason: string; records: Array<{ id: string; label: string; sub: string | null; createdAt: string }> };

/** Companies sharing a name or domain, and people sharing an email or the same name at the same company. */
export const findDuplicates: QueryDefinition<{ object: "company" | "person" }, DuplicateGroup[]> = {
  key: "verity.relationship.find_duplicates",
  entity: ENTITY_COMPANY,
  description: "Records that look like the same company or person entered twice.",
  input: z.object({ object: z.enum(["company", "person"]) }),
  handler: async (ctx, input) => {
    const groups = new Map<string, DuplicateGroup>();
    const add = (key: string, reason: string, r: DuplicateGroup["records"][number]) => {
      const g = groups.get(key) ?? { reason, records: [] };
      if (!g.records.some((x) => x.id === r.id)) g.records.push(r);
      groups.set(key, g);
    };
    if (input.object === "company") {
      const rows = await ctx.tx.relationshipCompany.findMany({ where: { archivedAt: null }, orderBy: { createdAt: "asc" } });
      for (const c of rows) {
        const r = { id: c.id, label: c.name, sub: c.domain ?? c.city, createdAt: c.createdAt.toISOString() };
        add(`n:${c.name.trim().toLowerCase().replace(/\s+/g, " ")}`, `Same name: ${c.name}`, r);
        if (c.domain) add(`d:${c.domain}`, `Same domain: ${c.domain}`, r);
      }
    } else {
      const rows = await ctx.tx.relationshipPerson.findMany({ where: { archivedAt: null }, orderBy: { createdAt: "asc" }, include: { company: { select: { name: true } } } });
      for (const p of rows) {
        const r = { id: p.id, label: personName(p), sub: [p.jobTitle, p.company?.name].filter(Boolean).join(" · ") || null, createdAt: p.createdAt.toISOString() };
        for (const e of p.emails) add(`e:${e}`, `Same email: ${e}`, r);
        add(`n:${personName(p).toLowerCase()}|${p.companyId ?? ""}`, `Same name${p.company ? ` at ${p.company.name}` : ""}: ${personName(p)}`, r);
      }
    }
    // One group per set of records, whichever rule found it first.
    const seen = new Set<string>();
    const out: DuplicateGroup[] = [];
    for (const g of groups.values()) {
      if (g.records.length < 2) continue;
      const sig = g.records.map((r) => r.id).sort().join(",");
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push(g);
    }
    return out.slice(0, 50);
  },
};

const FILLABLE_COMPANY = ["domain", "industry", "sizeBand", "phone", "email", "taxId", "addressLine", "city", "region", "country", "postalCode", "ownerUserId", "source"] as const;
const FILLABLE_PERSON = ["familyName", "jobTitle", "city", "companyId", "ownerUserId"] as const;

/** Survivor values win; an empty survivor field takes the duplicate's. Custom fields merge the same way. */
function fillFrom<T extends Record<string, unknown>>(survivor: T, duplicate: T, keys: readonly string[]): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const k of keys) if ((survivor[k] === null || survivor[k] === undefined || survivor[k] === "") && duplicate[k]) data[k] = duplicate[k];
  const sc = (survivor.customFields ?? {}) as Record<string, unknown>;
  const dc = (duplicate.customFields ?? {}) as Record<string, unknown>;
  if (Object.keys(dc).some((k) => !(k in sc))) data.customFields = { ...dc, ...sc };
  return data;
}

async function loadPair<T extends { id: string; mergedIntoId: string | null }>(
  find: (id: string) => Promise<T | null>,
  survivorId: string,
  duplicateId: string,
  what: string,
): Promise<[T, T]> {
  if (survivorId === duplicateId) throw new ValidationError(`E_VALIDATION: choose two different ${what}`);
  const [survivor, duplicate] = await Promise.all([find(survivorId), find(duplicateId)]);
  if (!survivor || !duplicate) throw new ValidationError(`E_VALIDATION: no such ${what}`);
  if (duplicate.mergedIntoId || survivor.mergedIntoId) throw new ValidationError(`E_VALIDATION: one of these was already merged`);
  return [survivor, duplicate];
}

export const mergeCompanies: CommandDefinition<{ survivorId: string; duplicateId: string }, { id: string }> = {
  key: "verity.relationship.merge_companies",
  entity: ENTITY_COMPANY,
  verb: "Edit",
  impact: "destructive",
  description: "Merge a duplicate company into another: its people, deals, notes and follow-ups move across and it is archived.",
  input: z.object({ survivorId: z.string().uuid(), duplicateId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const [survivor, duplicate] = await loadPair((id) => ctx.tx.relationshipCompany.findUnique({ where: { id } }), input.survivorId, input.duplicateId, "companies");
    const move = { where: { companyId: duplicate.id }, data: { companyId: survivor.id } };
    const moved = await Promise.all([
      ctx.tx.relationshipPerson.updateMany(move),
      ctx.tx.relationshipOpportunity.updateMany(move),
      ctx.tx.relationshipNote.updateMany(move),
      ctx.tx.relationshipFollowUp.updateMany(move),
    ]);
    // Anything merged into the duplicate earlier now points at the survivor, so chains never form.
    await ctx.tx.relationshipCompany.updateMany({ where: { mergedIntoId: duplicate.id }, data: { mergedIntoId: survivor.id } });
    await ctx.tx.relationshipCompany.update({
      where: { id: survivor.id },
      data: { ...(fillFrom(survivor, duplicate, FILLABLE_COMPANY) as Prisma.RelationshipCompanyUncheckedUpdateInput), version: { increment: 1 } },
    });
    await ctx.tx.relationshipCompany.update({
      where: { id: duplicate.id },
      data: { mergedIntoId: survivor.id, archivedAt: duplicate.archivedAt ?? new Date(), version: { increment: 1 } },
    });
    const counts = `${moved[0].count} people, ${moved[1].count} deals`;
    await recordActivity(ctx, { entityKey: ENTITY_COMPANY, entityId: survivor.id, commandKey: "verity.relationship.merge_companies", changes: [{ field: "record", oldValue: duplicate.name, newValue: `Merged in ${duplicate.name} (${counts})` }] });
    await recordActivity(ctx, { entityKey: ENTITY_COMPANY, entityId: duplicate.id, commandKey: "verity.relationship.merge_companies", changes: [{ field: "record", oldValue: "Active", newValue: `Merged into ${survivor.name}` }] });
    return { result: { id: survivor.id }, events: [{ name: "verity.relationship.companies_merged", entityId: survivor.id, payload: { duplicateId: duplicate.id } }] };
  },
};

export const mergePeople: CommandDefinition<{ survivorId: string; duplicateId: string }, { id: string }> = {
  key: "verity.relationship.merge_people",
  entity: ENTITY_PERSON,
  verb: "Edit",
  impact: "destructive",
  description: "Merge a duplicate person into another: their emails, phones, deals, notes and follow-ups move across and they are archived.",
  input: z.object({ survivorId: z.string().uuid(), duplicateId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const [survivor, duplicate] = await loadPair((id) => ctx.tx.relationshipPerson.findUnique({ where: { id } }), input.survivorId, input.duplicateId, "people");
    await ctx.tx.relationshipOpportunity.updateMany({ where: { contactId: duplicate.id }, data: { contactId: survivor.id } });
    await ctx.tx.relationshipNote.updateMany({ where: { personId: duplicate.id }, data: { personId: survivor.id } });
    await ctx.tx.relationshipFollowUp.updateMany({ where: { personId: duplicate.id }, data: { personId: survivor.id } });
    await ctx.tx.relationshipPerson.updateMany({ where: { mergedIntoId: duplicate.id }, data: { mergedIntoId: survivor.id } });
    await ctx.tx.relationshipPerson.update({
      where: { id: survivor.id },
      data: {
        ...(fillFrom(survivor, duplicate, FILLABLE_PERSON) as Prisma.RelationshipPersonUncheckedUpdateInput),
        emails: [...new Set([...survivor.emails, ...duplicate.emails])].slice(0, 10),
        phones: [...new Set([...survivor.phones, ...duplicate.phones])].slice(0, 10),
        version: { increment: 1 },
      },
    });
    await ctx.tx.relationshipPerson.update({
      where: { id: duplicate.id },
      data: { mergedIntoId: survivor.id, archivedAt: duplicate.archivedAt ?? new Date(), version: { increment: 1 } },
    });
    await recordActivity(ctx, { entityKey: ENTITY_PERSON, entityId: survivor.id, commandKey: "verity.relationship.merge_people", changes: [{ field: "record", oldValue: personName(duplicate), newValue: `Merged in ${personName(duplicate)}` }] });
    await recordActivity(ctx, { entityKey: ENTITY_PERSON, entityId: duplicate.id, commandKey: "verity.relationship.merge_people", changes: [{ field: "record", oldValue: "Active", newValue: `Merged into ${personName(survivor)}` }] });
    return { result: { id: survivor.id }, events: [{ name: "verity.relationship.people_merged", entityId: survivor.id, payload: { duplicateId: duplicate.id } }] };
  },
};

/** The record and everything merged into it, for timelines that must show the duplicates' history too. */
export async function withMerged(tx: TenantScopedClient, kind: "company" | "person", id: string): Promise<string[]> {
  const rows =
    kind === "company"
      ? await tx.relationshipCompany.findMany({ where: { mergedIntoId: id }, select: { id: true } })
      : await tx.relationshipPerson.findMany({ where: { mergedIntoId: id }, select: { id: true } });
  return [id, ...rows.map((r) => r.id)];
}

/* ================================ import ================================ */

export type ImportRowResult = { row: number; status: "created" | "would_create" | "duplicate" | "error"; label: string; message?: string };

const companyImportRow = z.object({
  name: text(200).min(1, "a name"),
  domain: z.string().optional(),
  industry: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  country: z.string().optional(),
  taxId: z.string().optional(),
});
const personImportRow = z.object({
  givenName: text(100).min(1, "a first name"),
  familyName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  jobTitle: z.string().optional(),
  company: z.string().optional(),
  city: z.string().optional(),
});
const blank = (v: string | undefined) => (v?.trim() ? v.trim() : null);

/**
 * Imports companies or people from mapped spreadsheet rows. A dry run reports what would happen row by row and
 * writes nothing; the real run creates through the same rules as the create commands and skips duplicates.
 */
export const importRecords: CommandDefinition<
  { object: "company" | "person"; rows: Array<Record<string, string>>; dryRun: boolean },
  { results: ImportRowResult[]; created: number }
> = {
  key: "verity.relationship.import_records",
  entity: ENTITY_COMPANY,
  verb: "Create",
  description: "Import companies or people from a spreadsheet, checking every row first.",
  input: z.object({
    object: z.enum(["company", "person"]),
    rows: z.array(z.record(z.string(), z.string().max(2000))).min(1).max(2000),
    dryRun: z.boolean(),
  }),
  handler: async (ctx, input) => {
    const results: ImportRowResult[] = [];
    let created = 0;
    const isEmail = (e: string) => z.string().email().safeParse(e).success;
    if (input.object === "company") {
      const existing = await ctx.tx.relationshipCompany.findMany({ where: { archivedAt: null }, select: { name: true, domain: true } });
      const names = new Set(existing.map((c) => c.name.toLowerCase()));
      const domains = new Set(existing.map((c) => c.domain).filter((d): d is string => Boolean(d)));
      for (const [i, raw] of input.rows.entries()) {
        const parsed = companyImportRow.safeParse(raw);
        if (!parsed.success) {
          results.push({ row: i + 1, status: "error", label: raw.name ?? "", message: `needs ${parsed.error.issues[0]?.message ?? "a valid row"}` });
          continue;
        }
        const r = parsed.data;
        const domain = normaliseDomain(r.domain);
        if (names.has(r.name.toLowerCase()) || (domain && domains.has(domain))) {
          results.push({ row: i + 1, status: "duplicate", label: r.name, message: "already in the CRM" });
          continue;
        }
        const email = blank(r.email)?.toLowerCase() ?? null;
        if (email && !isEmail(email)) {
          results.push({ row: i + 1, status: "error", label: r.name, message: `${email} is not an email address` });
          continue;
        }
        names.add(r.name.toLowerCase());
        if (domain) domains.add(domain);
        if (!input.dryRun) {
          const company = await ctx.tx.relationshipCompany.create({
            data: {
              tenantId: ctx.actor.tenantId, name: r.name, domain, industry: blank(r.industry), phone: blank(r.phone), email,
              city: blank(r.city), region: blank(r.region), country: blank(r.country), taxId: blank(r.taxId),
              ownerUserId: ctx.actor.userId, createdById: ctx.actor.userId,
            },
          });
          await logCreated(ctx, ENTITY_COMPANY, company.id, "verity.relationship.import_records", `${company.name} by import`);
          created++;
        }
        results.push({ row: i + 1, status: input.dryRun ? "would_create" : "created", label: r.name });
      }
    } else {
      const people = await ctx.tx.relationshipPerson.findMany({ where: { archivedAt: null }, select: { emails: true } });
      const emails = new Set(people.flatMap((p) => p.emails));
      const companies = await ctx.tx.relationshipCompany.findMany({ where: { archivedAt: null }, select: { id: true, name: true, domain: true } });
      const byName = new Map(companies.map((c) => [c.name.toLowerCase(), c.id]));
      // A domain held by two companies matches neither (see createPerson).
      const domainCount = new Map<string, number>();
      for (const c of companies) if (c.domain) domainCount.set(c.domain, (domainCount.get(c.domain) ?? 0) + 1);
      const byDomain = new Map(companies.filter((c) => c.domain && domainCount.get(c.domain) === 1).map((c) => [c.domain!, c.id]));
      for (const [i, raw] of input.rows.entries()) {
        const parsed = personImportRow.safeParse(raw);
        if (!parsed.success) {
          results.push({ row: i + 1, status: "error", label: raw.givenName ?? "", message: `needs ${parsed.error.issues[0]?.message ?? "a valid row"}` });
          continue;
        }
        const r = parsed.data;
        const label = [r.givenName, blank(r.familyName)].filter(Boolean).join(" ");
        const email = blank(r.email)?.toLowerCase() ?? null;
        if (email && !isEmail(email)) {
          results.push({ row: i + 1, status: "error", label, message: `${email} is not an email address` });
          continue;
        }
        if (email && emails.has(email)) {
          results.push({ row: i + 1, status: "duplicate", label, message: `${email} is already in the CRM` });
          continue;
        }
        const companyName = blank(r.company);
        const domain = email ? emailDomain(email) : null;
        const companyId =
          (companyName ? byName.get(companyName.toLowerCase()) : undefined) ??
          (domain && !PERSONAL_EMAIL_DOMAINS.has(domain) ? byDomain.get(domain) : undefined) ??
          null;
        if (companyName && !companyId) {
          results.push({ row: i + 1, status: "error", label, message: `no company called ${companyName}; import companies first` });
          continue;
        }
        if (email) emails.add(email);
        if (!input.dryRun) {
          const person = await ctx.tx.relationshipPerson.create({
            data: {
              tenantId: ctx.actor.tenantId, givenName: r.givenName, familyName: blank(r.familyName), companyId,
              jobTitle: blank(r.jobTitle), emails: email ? [email] : [], phones: blank(r.phone) ? [blank(r.phone)!] : [],
              city: blank(r.city), ownerUserId: ctx.actor.userId, createdById: ctx.actor.userId,
            },
          });
          await logCreated(ctx, ENTITY_PERSON, person.id, "verity.relationship.import_records", `${label} by import`);
          created++;
        }
        results.push({ row: i + 1, status: input.dryRun ? "would_create" : "created", label });
      }
    }
    return {
      result: { results, created },
      events: created ? [{ name: "verity.relationship.records_imported", payload: { object: input.object, created } }] : [],
    };
  },
};

/* ================================ lists ================================ */

const archivedFilter = (input: ParsedListInput) => (input.includeArchived ? {} : { archivedAt: null });

async function lastActivityBy(tx: TenantScopedClient, column: "companyId" | "personId", ids: string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (!ids.length) return out;
  const take = (id: string | null, at: Date | null | undefined) => {
    if (!id || !at) return;
    const seen = out.get(id);
    if (!seen || at > seen) out.set(id, at);
  };
  if (column === "companyId") {
    const [interactions, notes] = await Promise.all([
      tx.relationshipInteraction.groupBy({ by: ["companyId"], where: { companyId: { in: ids }, archivedAt: null }, _max: { occurredAt: true } }),
      tx.relationshipNote.groupBy({ by: ["companyId"], where: { companyId: { in: ids }, archivedAt: null }, _max: { createdAt: true } }),
    ]);
    for (const r of interactions) take(r.companyId, r._max.occurredAt);
    for (const r of notes) take(r.companyId, r._max.createdAt);
  } else {
    const [interactions, notes] = await Promise.all([
      tx.relationshipInteraction.groupBy({ by: ["personId"], where: { personId: { in: ids }, archivedAt: null }, _max: { occurredAt: true } }),
      tx.relationshipNote.groupBy({ by: ["personId"], where: { personId: { in: ids }, archivedAt: null }, _max: { createdAt: true } }),
    ]);
    for (const r of interactions) take(r.personId, r._max.occurredAt);
    for (const r of notes) take(r.personId, r._max.createdAt);
  }
  return out;
}

export const listCompanies: QueryDefinition<z.input<typeof listInputSchema>, ListResult> = {
  key: "verity.relationship.list_companies",
  entity: ENTITY_COMPANY,
  description: "List companies through a view's filters, sorts and search.",
  input: listInputSchema,
  handler: async (ctx: ReadContext, raw) => {
    const input = listInputSchema.parse(raw);
    const where = { AND: [archivedFilter(input), buildWhere(await withCustomFields(ctx.tx, COMPANY_OBJECT), input, { userId: ctx.actor.userId })] } as Prisma.RelationshipCompanyWhereInput;
    const [total, rows, labels] = await Promise.all([
      ctx.tx.relationshipCompany.count({ where }),
      ctx.tx.relationshipCompany.findMany({
        where,
        orderBy: buildOrderBy(COMPANY_OBJECT, input.sorts) as Prisma.RelationshipCompanyOrderByWithRelationInput[],
        take: input.limit,
        skip: input.offset,
        include: { _count: { select: { people: { where: { archivedAt: null } } } } },
      }),
      userLabels(ctx.tx),
    ]);
    const ids = rows.map((r) => r.id);
    const [open, last] = await Promise.all([
      ids.length
        ? ctx.tx.relationshipOpportunity.groupBy({
            by: ["companyId"],
            where: { companyId: { in: ids }, archivedAt: null, stage: { category: "Active" } },
            _count: { _all: true },
            _sum: { amount: true },
          })
        : Promise.resolve([]),
      lastActivityBy(ctx.tx, "companyId", ids),
    ]);
    const openBy = new Map(open.map((o) => [o.companyId, o]));
    const aggregates = await computeAggregates(COMPANY_OBJECT, ctx.tx.relationshipCompany as never, where as never, input.aggregates, total);
    return {
      total,
      aggregates,
      rows: rows.map((c) => ({
        id: c.id, version: c.version, archived: c.archivedAt !== null,
        name: c.name, domain: c.domain, industry: c.industry, sizeBand: c.sizeBand, phone: c.phone, email: c.email, taxId: c.taxId,
        city: c.city, region: c.region, country: c.country, source: c.source,
        owner: userRef(labels, c.ownerUserId),
        people: c._count.people,
        openOpportunities: openBy.get(c.id)?._count._all ?? 0,
        pipelineValue: decimal(openBy.get(c.id)?._sum.amount) ?? 0,
        lastActivity: instant(last.get(c.id)),
        createdAt: instant(c.createdAt), updatedAt: instant(c.updatedAt),
        ...customFieldValues(c.customFields),
      })),
    };
  },
};

export const listPeople: QueryDefinition<z.input<typeof listInputSchema>, ListResult> = {
  key: "verity.relationship.list_people",
  entity: ENTITY_PERSON,
  description: "List people through a view's filters, sorts and search.",
  input: listInputSchema,
  handler: async (ctx: ReadContext, raw) => {
    const input = listInputSchema.parse(raw);
    const where = { AND: [archivedFilter(input), buildWhere(await withCustomFields(ctx.tx, PERSON_OBJECT), input, { userId: ctx.actor.userId })] } as Prisma.RelationshipPersonWhereInput;
    const [total, rows, labels] = await Promise.all([
      ctx.tx.relationshipPerson.count({ where }),
      ctx.tx.relationshipPerson.findMany({
        where,
        orderBy: buildOrderBy(PERSON_OBJECT, input.sorts) as Prisma.RelationshipPersonOrderByWithRelationInput[],
        take: input.limit,
        skip: input.offset,
        include: { company: { select: { id: true, name: true } } },
      }),
      userLabels(ctx.tx),
    ]);
    const last = await lastActivityBy(ctx.tx, "personId", rows.map((r) => r.id));
    const aggregates = await computeAggregates(PERSON_OBJECT, ctx.tx.relationshipPerson as never, where as never, input.aggregates, total);
    return {
      total,
      aggregates,
      rows: rows.map((p) => ({
        id: p.id, version: p.version, archived: p.archivedAt !== null,
        name: personName(p), givenName: p.givenName, familyName: p.familyName,
        company: p.company ? { id: p.company.id, label: p.company.name } : null,
        jobTitle: p.jobTitle, emails: p.emails, phones: p.phones, city: p.city,
        owner: userRef(labels, p.ownerUserId),
        lastActivity: instant(last.get(p.id)),
        createdAt: instant(p.createdAt),
        ...customFieldValues(p.customFields),
      })),
    };
  },
};

type OpportunityWithRefs = Prisma.RelationshipOpportunityGetPayload<{
  include: { stage: true; company: { select: { id: true; name: true } }; contact: { select: { id: true; givenName: true; familyName: true } } };
}>;

export const OPPORTUNITY_INCLUDE = {
  stage: true,
  company: { select: { id: true, name: true } },
  contact: { select: { id: true, givenName: true, familyName: true } },
} as const;

export function opportunityRow(o: OpportunityWithRefs, labels: Map<string, string>) {
  return {
    id: o.id, version: o.version, archived: o.archivedAt !== null,
    number: o.number, ref: opportunityRef(o.number), name: o.name,
    company: o.company ? { id: o.company.id, label: o.company.name } : null,
    contact: o.contact ? { id: o.contact.id, label: personName(o.contact) } : null,
    stage: o.stageId, stageLabel: o.stage.label, stageCategory: o.stage.category,
    amount: decimal(o.amount), currency: o.currency, probability: o.stage.probability,
    expectedCloseOn: dayText(o.expectedCloseOn), submissionDueOn: dayText(o.submissionDueOn),
    source: o.source, owner: userRef(labels, o.ownerUserId), lostReason: o.lostReason, lostNote: o.lostNote,
    position: o.position, createdAt: instant(o.createdAt), closedAt: instant(o.closedAt),
    ...customFieldValues(o.customFields),
  };
}

export const listOpportunities: QueryDefinition<z.input<typeof listInputSchema>, ListResult> = {
  key: "verity.relationship.list_opportunities",
  entity: ENTITY_OPPORTUNITY,
  description: "List opportunities through a view's filters, sorts and search; the board groups them by stage.",
  input: listInputSchema,
  handler: async (ctx: ReadContext, raw) => {
    const input = listInputSchema.parse(raw);
    const where = { AND: [archivedFilter(input), buildWhere(await withCustomFields(ctx.tx, OPPORTUNITY_OBJECT), input, { userId: ctx.actor.userId })] } as Prisma.RelationshipOpportunityWhereInput;
    const [total, rows, labels] = await Promise.all([
      ctx.tx.relationshipOpportunity.count({ where }),
      ctx.tx.relationshipOpportunity.findMany({
        where,
        orderBy: buildOrderBy(OPPORTUNITY_OBJECT, input.sorts) as Prisma.RelationshipOpportunityOrderByWithRelationInput[],
        take: input.limit,
        skip: input.offset,
        include: OPPORTUNITY_INCLUDE,
      }),
      userLabels(ctx.tx),
    ]);
    const aggregates = await computeAggregates(OPPORTUNITY_OBJECT, ctx.tx.relationshipOpportunity as never, where as never, input.aggregates, total);
    return { total, aggregates, rows: rows.map((o) => opportunityRow(o, labels)) };
  },
};

/** Records a relation picker can offer: companies or people matching what was typed. */
export const lookupRecords: QueryDefinition<
  { object: string; search?: string; companyId?: string },
  Array<{ id: string; label: string; sub: string | null }>
> = {
  key: "verity.relationship.lookup",
  entity: ENTITY_COMPANY,
  description: "Find companies or people by name for a picker.",
  input: z.object({
    object: z.enum([ENTITY_COMPANY, ENTITY_PERSON]),
    search: z.string().max(100).optional(),
    companyId: z.string().uuid().optional(),
  }),
  handler: async (ctx, input) => {
    const term = input.search?.trim();
    if (input.object === ENTITY_COMPANY) {
      const rows = await ctx.tx.relationshipCompany.findMany({
        where: {
          archivedAt: null,
          ...(term ? { OR: [{ name: { contains: term, mode: "insensitive" } }, { domain: { contains: term, mode: "insensitive" } }] } : {}),
        },
        orderBy: { name: "asc" },
        take: 20,
      });
      return rows.map((c) => ({ id: c.id, label: c.name, sub: c.domain ?? c.city }));
    }
    const rows = await ctx.tx.relationshipPerson.findMany({
      where: {
        archivedAt: null,
        ...(input.companyId ? { companyId: input.companyId } : {}),
        ...(term ? { OR: [{ givenName: { contains: term, mode: "insensitive" } }, { familyName: { contains: term, mode: "insensitive" } }] } : {}),
      },
      include: { company: { select: { name: true } } },
      orderBy: [{ givenName: "asc" }, { familyName: "asc" }],
      take: 20,
    });
    return rows.map((p) => ({ id: p.id, label: personName(p), sub: [p.jobTitle, p.company?.name].filter(Boolean).join(" · ") || null }));
  },
};
