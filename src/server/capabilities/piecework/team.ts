import { z } from "zod";
import { registerCommand, ValidationError, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { assertGrantCeiling, hasTenantPermission } from "@/server/platform/authorization";
import { recordSecurityEvent } from "@/server/platform/audit";
import { ENTITY_MEMBERSHIP, ENTITY_MEMBERSHIP_ACCESS, ENTITY_ROLE } from "@/server/platform/administration";
import { ENTITY_PIECEWORK_SETTING } from "./floor";
import { LEDGER_SELECT, activeStages, asDate, toLedger, type Tx } from "./shared";
import { ROLE_PRESETS, presetNamed, presetPermissions } from "./role-presets";
import { WORKER_KINDS } from "./ledger";

/**
 * Team management for the factory: who works here, in which role, at which stages, looking after which karigars; and the role
 * presets a new workspace installs once. Sign-in accounts are created by the `createTeamLogin` action (the identity provider is
 * outside the database); this file holds the parts that are the workspace's own data.
 */

// Defined in `index.ts` as well; repeated here because `index.ts` imports this file.
const ENTITY_WORKER = "verity.piecework.worker";
const STAGE_ENTITY = "verity.piecework.stage";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

/** A supervisor must be someone who can still sign in to this workspace. */
export async function assertActiveMember(tx: Tx, userId: string): Promise<void> {
  if (!(await tx.tenantMembership.findFirst({ where: { userId, disabledAt: null }, select: { id: true } }))) {
    throw new ValidationError("E_VALIDATION: that supervisor is not an active member of this workspace");
  }
}

/* ============================== role presets =============================== */

export const installRolePresets: CommandDefinition<{ names?: string[] }, { created: string[]; existing: string[] }> = {
  key: "verity.piecework.install_role_presets",
  entity: ENTITY_PIECEWORK_SETTING,
  verb: "Edit",
  // Creating roles grants authority; `destructive` keeps it off the external tool surface and out of the assistant's reach.
  impact: "destructive",
  input: z.object({ names: z.array(z.string().min(1).max(120)).max(20).optional() }),
  preconditions: async (ctx, input) => {
    const wanted = input.names ?? ROLE_PRESETS.map((p) => p.name);
    for (const name of wanted) {
      const preset = presetNamed(name);
      if (!preset) throw new ValidationError(`E_VALIDATION: there is no preset called ${name}`);
      // No escalation: a person can install only roles whose every grant they hold themselves.
      await assertGrantCeiling(ctx.tx, ctx.actor, presetPermissions(preset));
    }
  },
  handler: async (ctx, input) => {
    const created: string[] = [];
    const existing: string[] = [];
    const roleIds: string[] = [];
    for (const name of input.names ?? ROLE_PRESETS.map((p) => p.name)) {
      const preset = presetNamed(name)!;
      if (await ctx.tx.role.findFirst({ where: { name: preset.name }, select: { id: true } })) { existing.push(name); continue; }
      const role = await ctx.tx.role.create({ data: { tenantId: ctx.actor.tenantId, name: preset.name } });
      const grants = presetPermissions(preset);
      await ctx.tx.permission.createMany({ data: grants.map((g) => ({ tenantId: ctx.actor.tenantId, roleId: role.id, verb: g.verb, entity: g.entity, scope: g.scope })) });
      await recordSecurityEvent(ctx.tx, { tenantId: ctx.actor.tenantId, eventType: "PermissionEscalated", actorUserId: ctx.actor.userId, payload: { roleId: role.id, preset: preset.name, grants: grants.length } });
      created.push(name);
      roleIds.push(role.id);
    }
    return { result: { created, existing }, events: roleIds.map((id) => ({ name: "verity.piecework.role_preset_installed", entityId: id })) };
  },
};

/* =============================== karigar profile ============================ */

export type WorkerProfileInput = {
  workerId: string; name?: string; mobile?: string | null; kind?: (typeof WORKER_KINDS)[number]; address?: string | null;
  joinedOn?: string | null; idNote?: string | null; emergencyContact?: string | null; supervisorUserId?: string | null;
};

export const updateWorker: CommandDefinition<WorkerProfileInput, { id: string }> = {
  key: "verity.piecework.update_worker",
  entity: ENTITY_WORKER,
  verb: "Edit",
  input: z.object({
    workerId: uuid,
    name: z.string().trim().min(1).max(120).optional(),
    mobile: z.string().trim().regex(/^[0-9 +()-]{6,20}$/, "enter a phone number").nullable().optional(),
    kind: z.enum(WORKER_KINDS).optional(),
    address: z.string().trim().max(300).nullable().optional(),
    joinedOn: isoDate.nullable().optional(),
    idNote: z.string().trim().max(300).nullable().optional(),
    emergencyContact: z.string().trim().max(300).nullable().optional(),
    supervisorUserId: uuid.nullable().optional(),
  }),
  preconditions: async (ctx, input) => {
    const worker = await ctx.tx.pieceworkWorker.findUnique({ where: { id: input.workerId } });
    if (!worker) throw new ValidationError("E_VALIDATION: worker not found in this tenant");
    if (input.name && input.name !== worker.name && (await ctx.tx.pieceworkWorker.findFirst({ where: { name: input.name } }))) {
      throw new ValidationError("E_VALIDATION: a worker with that name already exists");
    }
    if (input.supervisorUserId) await assertActiveMember(ctx.tx, input.supervisorUserId);
  },
  handler: async (ctx, input) => {
    const { workerId, joinedOn, ...rest } = input;
    await ctx.tx.pieceworkWorker.update({
      where: { id: workerId },
      data: { ...rest, ...(joinedOn === undefined ? {} : { joinedOn: joinedOn === null ? null : asDate(joinedOn) }), version: { increment: 1 } },
    });
    return { result: { id: workerId }, events: [{ name: "verity.piecework.worker_updated", entityId: workerId }] };
  },
};

/* ================================= directory ================================ */

export type TeamPerson = {
  membershipId: string; userId: string; name: string; email: string | null; phone: string | null;
  roleId: string | null; roleName: string | null; disabled: boolean; isYou: boolean;
  /** Works at every stage (no assignment needed). */
  allStages: boolean; stageIds: string[];
  /** Karigars this person is set as supervisor of, and the pieces those karigars hold right now. */
  karigars: Array<{ id: string; name: string }>; piecesHeld: number;
};

export type TeamDirectory = {
  organizationId: string | null;
  people: TeamPerson[];
  /** `allStages`: a person in this role works at every stage, so no stage needs assigning to them. */
  roles: Array<{ id: string; name: string; summary: string | null; allStages: boolean }>;
  /** Presets not yet installed as a role in this workspace. */
  missingPresets: Array<{ name: string; summary: string }>;
  stages: Array<{ id: string; label: string }>;
  can: { addPerson: boolean; changeRole: boolean; switchAccess: boolean; installRoles: boolean; assignStages: boolean };
};

export const teamDirectory: QueryDefinition<Record<string, never>, TeamDirectory> = {
  key: "verity.piecework.team_directory",
  entity: ENTITY_PIECEWORK_SETTING,
  input: z.object({}),
  handler: async (ctx) => {
    const [memberships, roles, stages, assigns, workers, entries, org, addPerson, changeRole, switchAccess, installRoles, assignStages] = await Promise.all([
      ctx.tx.tenantMembership.findMany({ include: { role: { select: { id: true, name: true } }, user: { select: { id: true, party: { select: { displayName: true, email: true, phone: true } } } } }, orderBy: { createdAt: "asc" } }),
      ctx.tx.role.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      activeStages(ctx.tx),
      ctx.tx.pieceworkStageAssignment.findMany(),
      ctx.tx.pieceworkWorker.findMany({ where: { active: true }, select: { id: true, name: true, supervisorUserId: true } }),
      ctx.tx.pieceworkEntry.findMany({ select: LEDGER_SELECT }),
      ctx.tx.organization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } }),
      hasTenantPermission(ctx.tx, ctx.actor.roleId, "Create", ENTITY_MEMBERSHIP),
      hasTenantPermission(ctx.tx, ctx.actor.roleId, "Edit", ENTITY_MEMBERSHIP),
      hasTenantPermission(ctx.tx, ctx.actor.roleId, "ActionExecute", ENTITY_MEMBERSHIP_ACCESS),
      hasTenantPermission(ctx.tx, ctx.actor.roleId, "Create", ENTITY_ROLE),
      hasTenantPermission(ctx.tx, ctx.actor.roleId, "Edit", ENTITY_PIECEWORK_SETTING),
    ]);

    const heldBy = new Map<string, number>();
    for (const e of entries.map((r) => toLedger(r))) heldBy.set(e.workerId, (heldBy.get(e.workerId) ?? 0) + (e.reversesId ? -1 : 1) * (e.kind === "issue" ? e.pieces : -e.pieces));

    const people: TeamPerson[] = [];
    for (const m of memberships) {
      const mine = workers.filter((w) => w.supervisorUserId === m.userId);
      people.push({
        membershipId: m.id, userId: m.userId, name: m.user.party.displayName, email: m.user.party.email, phone: m.user.party.phone,
        roleId: m.role?.id ?? null, roleName: m.role?.name ?? null, disabled: m.disabledAt !== null, isYou: m.userId === ctx.actor.userId,
        allStages: await hasTenantPermission(ctx.tx, m.roleId, "ActionExecute", STAGE_ENTITY),
        stageIds: assigns.filter((a) => a.userId === m.userId).map((a) => a.stageId),
        karigars: mine.map((w) => ({ id: w.id, name: w.name })),
        piecesHeld: mine.reduce((s, w) => s + Math.max(0, heldBy.get(w.id) ?? 0), 0),
      });
    }

    const have = new Set(roles.map((r) => r.name));
    return {
      organizationId: org?.id ?? null,
      people: people.sort((a, b) => Number(a.disabled) - Number(b.disabled) || a.name.localeCompare(b.name)),
      roles: await Promise.all(roles.map(async (r) => ({ id: r.id, name: r.name, summary: presetNamed(r.name)?.summary ?? null, allStages: await hasTenantPermission(ctx.tx, r.id, "ActionExecute", STAGE_ENTITY) }))),
      missingPresets: ROLE_PRESETS.filter((p) => !have.has(p.name)).map((p) => ({ name: p.name, summary: p.summary })),
      stages: stages.map((s) => ({ id: s.id, label: s.label })),
      can: { addPerson, changeRole, switchAccess, installRoles, assignStages },
    };
  },
};

/** Supervisors a karigar can be given to: active members, with their role name, for the picker on the karigar's profile. */
export const supervisorChoices: QueryDefinition<Record<string, never>, Array<{ userId: string; name: string; roleName: string | null }>> = {
  key: "verity.piecework.supervisor_choices",
  entity: ENTITY_WORKER,
  input: z.object({}),
  handler: async (ctx) => {
    const rows = await ctx.tx.tenantMembership.findMany({ where: { disabledAt: null }, include: { role: { select: { name: true } }, user: { select: { id: true, party: { select: { displayName: true } } } } } });
    return rows.map((m) => ({ userId: m.userId, name: m.user.party.displayName, roleName: m.role?.name ?? null })).sort((a, b) => a.name.localeCompare(b.name));
  },
};

export function registerTeam(): void {
  registerCommand(installRolePresets);
  registerCommand(updateWorker);
  registerQuery(teamDirectory);
  registerQuery(supervisorChoices);
}
