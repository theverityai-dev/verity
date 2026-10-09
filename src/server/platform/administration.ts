import "server-only";
import { z } from "zod";
import { registerCommand, type CommandDefinition } from "./command";
import { registerQuery, type QueryDefinition } from "./query";
import { diffFields, recordActivity, recordSecurityEvent } from "./audit";
import { provisionIdentity } from "./identity";
import { resolvePermissions, assertGrantCeiling } from "./authorization";
import { activateCapability, suspendCapability, setConfig } from "./capability";
import { ValidationError } from "./command";
import { OPERATOR_ROLE_NAME } from "./operator";
import type { TenantScopedClient } from "./tenancy";
import { entityLabel } from "./label";
import { mintApiKey } from "./external-tools";

/**
 * Platform administration — the write and read contracts HQ operates through.
 *
 * WHY THESE ARE COMMANDS AND QUERIES RATHER THAN FUNCTIONS
 * D20 requires the Verity team to administer a client without opening the
 * codebase or touching SQL. That is a UI requirement, and the tempting shape is
 * a set of helper functions the pages call directly. It was not taken, because
 * a second write path is a second place for authorization, audit and validation
 * to be forgotten — and MET-ACT-001..004 already say the command registry is the
 * exclusive mechanism for mutating an entity.
 *
 * So administration goes through `executeCommand` and `executeQuery` like
 * everything else. Every mutation below therefore gets, without asking:
 *
 *   input validation      (MET-ACT-001)
 *   authorization         (MET-ACT-002 — throws E_FORBIDDEN, never returns false)
 *   preconditions         (MET-ACT-003 — failure rolls the transaction back)
 *   one tenant scope      RLS applies; the operator has no bypass
 *   events + audit        appended inside the transaction
 *
 * WHAT THESE ARE NOT
 * Not a capability. The five capabilities in `src/server/capabilities/` model
 * business behaviour; these administer the platform's own primitives — tenants,
 * organizations, memberships, roles, permissions, capability activation and
 * configuration. Registering them as a capability would put platform
 * administration behind a capability activation switch, which is backwards: HQ
 * is how you turn capabilities on.
 *
 * AUTHORIZATION IS UNCHANGED
 * The entity keys below are exactly those in `OPERATOR_GRANTS` (operator.ts).
 * An operator holds them inside a client through an ordinary role, so these
 * commands are refused for anyone else by the ordinary resolver. There is no
 * `if (isOperator)` anywhere in this file, deliberately — that would be the
 * second authorization model ADR-013 exists to avoid.
 */

export const ENTITY_TENANT = "verity.platform.tenant";
export const ENTITY_ORGANIZATION = "verity.platform.organization";
export const ENTITY_MEMBERSHIP = "verity.platform.membership";
export const ENTITY_ROLE = "verity.platform.role";

/* ============================== organizations ============================== */

export const createOrganization: CommandDefinition<
  { name: string; parentId?: string | null },
  { id: string }
> = {
  key: "verity.platform.create_organization",
  entity: ENTITY_ORGANIZATION,
  verb: "Create",
  impact: "destructive",
  input: z.object({
    name: z.string().min(1).max(200),
    parentId: z.string().uuid().nullable().optional(),
  }),
  preconditions: async (ctx, input) => {
    if (!input.parentId) return;
    const parent = await ctx.tx.organization.findUnique({ where: { id: input.parentId } });
    // The composite foreign key would catch a cross-tenant parent, but a named
    // precondition is a better error than a constraint violation.
    if (!parent) throw new ValidationError("E_VALIDATION: parent organization not found in this client");
  },
  handler: async (ctx, input) => {
    const organization = await ctx.tx.organization.create({
      data: {
        tenantId: ctx.actor.tenantId,
        name: input.name,
        parentId: input.parentId ?? null,
      },
    });

    await recordActivity(ctx, {
      entityKey: ENTITY_ORGANIZATION,
      entityId: organization.id,
      commandKey: "verity.platform.create_organization",
      changes: diffFields({}, { name: organization.name, parentId: organization.parentId }),
    });

    return {
      result: { id: organization.id },
      events: [{ name: "verity.platform.organization_created", entityId: organization.id }],
    };
  },
};

export const updateOrganization: CommandDefinition<
  { organizationId: string; name?: string; parentId?: string | null },
  { id: string }
> = {
  key: "verity.platform.update_organization",
  entity: ENTITY_ORGANIZATION,
  verb: "Edit",
  impact: "destructive",
  input: z.object({
    organizationId: z.string().uuid(),
    name: z.string().min(1).max(200).optional(),
    parentId: z.string().uuid().nullable().optional(),
  }),
  preconditions: async (ctx, input) => {
    if (input.parentId === undefined) return;
    if (input.parentId === input.organizationId) {
      throw new ValidationError("E_VALIDATION: an organization cannot be its own parent");
    }
    if (input.parentId === null) return;

    // Re-parenting into your own subtree detaches the subtree from the tree and
    // makes downward visibility (PLA-ORG-002) non-terminating. Walk up from the
    // proposed parent; meeting yourself means the move would create a cycle.
    let cursor: string | null = input.parentId;
    for (let depth = 0; cursor && depth < 64; depth += 1) {
      if (cursor === input.organizationId) {
        throw new ValidationError("E_VALIDATION: that move would put the organization inside itself");
      }
      const node: { parentId: string | null } | null = await ctx.tx.organization.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      if (!node) throw new ValidationError("E_VALIDATION: parent organization not found in this client");
      cursor = node.parentId;
    }
  },
  handler: async (ctx, input) => {
    const before = await ctx.tx.organization.findUniqueOrThrow({
      where: { id: input.organizationId },
    });

    const after = await ctx.tx.organization.update({
      where: { id: input.organizationId },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
        version: { increment: 1 },
      },
    });

    await recordActivity(ctx, {
      entityKey: ENTITY_ORGANIZATION,
      entityId: after.id,
      commandKey: "verity.platform.update_organization",
      changes: diffFields(
        { name: before.name, parentId: before.parentId },
        { name: after.name, parentId: after.parentId },
      ),
    });

    return {
      result: { id: after.id },
      events: [{ name: "verity.platform.organization_updated", entityId: after.id }],
    };
  },
};

export const listOrganizations: QueryDefinition<
  Record<string, never>,
  Array<{ id: string; name: string; parentId: string | null; memberCount: number }>
> = {
  key: "verity.platform.list_organizations",
  entity: ENTITY_ORGANIZATION,
  input: z.object({}),
  handler: async (ctx) => {
    const rows = await ctx.tx.organization.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        parentId: true,
        _count: { select: { memberships: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      parentId: row.parentId,
      memberCount: row._count.memberships,
    }));
  },
};

/* ================================= people ================================== */

/**
 * Invites a person and gives them access to one organization.
 *
 * Goes through `provisionIdentity`, which calls `verity.provision_identity` and
 * writes Party, User and the first membership atomically. Not a direct INSERT:
 * RLS refuses those by design, because Postgres applies SELECT policies to
 * `INSERT ... RETURNING` and a just-created identity is unreachable.
 *
 * ADR-007 governs what this does NOT do — it never looks across tenants for a
 * matching person. Identity is linked when someone verifies a contact channel,
 * not when two records happen to share an email.
 */
export const invitePerson: CommandDefinition<
  {
    displayName: string;
    email?: string;
    phone?: string;
    organizationId: string;
    roleId?: string | null;
    authUserId?: string;
  },
  { userId: string; membershipId: string }
> = {
  key: "verity.platform.invite_person",
  entity: ENTITY_MEMBERSHIP,
  verb: "Create",
  impact: "destructive",
  input: z.object({
    displayName: z.string().min(1).max(200),
    email: z.string().email().optional(),
    phone: z.string().min(3).max(40).optional(),
    organizationId: z.string().uuid(),
    roleId: z.string().uuid().nullable().optional(),
    // Supplied when the person already has a Supabase account. Absent means the
    // identity is provisioned ahead of them ever signing in, which is what
    // "Invited" means in Bible V2's lifecycle.
    authUserId: z.string().uuid().optional(),
  }),
  preconditions: async (ctx, input) => {
    const organization = await ctx.tx.organization.findUnique({
      where: { id: input.organizationId },
    });
    if (!organization) throw new ValidationError("E_VALIDATION: organization not found in this client");

    if (input.roleId) {
      const role = await ctx.tx.role.findUnique({ where: { id: input.roleId } });
      if (!role) throw new ValidationError("E_VALIDATION: role not found in this client");
      await assertGrantCeiling(ctx.tx, ctx.actor, await resolvePermissions(ctx.tx, input.roleId));
    }
  },
  handler: async (ctx, input) => {
    const identity = await provisionIdentity(ctx.tx, {
      organizationId: input.organizationId,
      // A person with no Supabase account yet still needs a stable auth id to
      // link to later. Generating it here rather than at first sign-in keeps
      // the Party the single record for that person from the start.
      authUserId: input.authUserId ?? crypto.randomUUID(),
      displayName: input.displayName,
      email: input.email ?? null,
      phone: input.phone ?? null,
    });

    if (input.roleId) {
      await ctx.tx.tenantMembership.update({
        where: { id: identity.membershipId },
        data: { roleId: input.roleId },
      });
      await recordSecurityEvent(ctx.tx, {
        tenantId: ctx.actor.tenantId,
        eventType: "RoleAssigned",
        actorUserId: ctx.actor.userId,
        payload: { membershipId: identity.membershipId, roleId: input.roleId },
      });
    }

    await recordActivity(ctx, {
      entityKey: ENTITY_MEMBERSHIP,
      entityId: identity.membershipId,
      commandKey: "verity.platform.invite_person",
      changes: diffFields(
        {},
        { displayName: input.displayName, organizationId: input.organizationId, roleId: input.roleId ?? null },
      ),
    });

    return {
      result: { userId: identity.userId, membershipId: identity.membershipId },
      events: [{ name: "verity.platform.person_invited", entityId: identity.membershipId }],
    };
  },
};

/**
 * Issues a machine credential for a membership (ADR-029, Task 120).
 *
 * The same authority as assigning that membership's role: the entity, the verb
 * and the grant ceiling are `assignRole`'s own, so nobody can hand a machine
 * more than they could hand a person. The full key is returned exactly once, in
 * this result, and is never stored (only its hash is). `destructive` keeps it
 * off the external tool surface and out of the agent's reach: a key cannot mint
 * keys.
 */
export const createApiKey: CommandDefinition<
  { membershipId: string; name: string; expiresInDays: number },
  { keyId: string; key: string; expiresAt: string }
> = {
  key: "verity.platform.create_api_key",
  entity: ENTITY_MEMBERSHIP,
  verb: "Edit",
  impact: "destructive",
  input: z.object({
    membershipId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    // Bounded on purpose: a key with no expiry is a credential nobody reviews.
    expiresInDays: z.number().int().min(1).max(365),
  }),
  preconditions: async (ctx, input) => {
    const membership = await ctx.tx.tenantMembership.findUnique({ where: { id: input.membershipId } });
    if (!membership) throw new ValidationError("E_VALIDATION: membership not found in this client");
    if (!membership.roleId) {
      throw new ValidationError("E_VALIDATION: this membership has no role, so a key would grant nothing");
    }
    await assertGrantCeiling(ctx.tx, ctx.actor, await resolvePermissions(ctx.tx, membership.roleId));
  },
  handler: async (ctx, input) => {
    const minted = mintApiKey();
    const expiresAt = new Date(Date.now() + input.expiresInDays * 86_400_000);
    await ctx.tx.externalApiKey.create({
      data: {
        tenantId: ctx.actor.tenantId,
        membershipId: input.membershipId,
        keyId: minted.id,
        secretHash: minted.secretHash,
        name: input.name,
        expiresAt,
        createdById: ctx.actor.userId,
      },
    });
    await recordSecurityEvent(ctx.tx, {
      tenantId: ctx.actor.tenantId,
      eventType: "ApiKeyGenerated",
      actorUserId: ctx.actor.userId,
      // The key id and who it stands for. Never the key, and never its hash.
      payload: { keyId: minted.id, membershipId: input.membershipId, name: input.name, expiresAt: expiresAt.toISOString() },
    });
    return {
      result: { keyId: minted.id, key: minted.key, expiresAt: expiresAt.toISOString() },
      events: [{ name: "verity.platform.api_key_created", entityId: input.membershipId }],
    };
  },
};

/** Ends a machine credential. The identity and its role are untouched. */
export const revokeApiKey: CommandDefinition<{ keyId: string }, { keyId: string }> = {
  key: "verity.platform.revoke_api_key",
  entity: ENTITY_MEMBERSHIP,
  verb: "Edit",
  impact: "destructive",
  input: z.object({ keyId: z.string().regex(/^[0-9a-f]{16}$/) }),
  handler: async (ctx, input) => {
    const key = await ctx.tx.externalApiKey.findUnique({ where: { keyId: input.keyId } });
    if (!key) throw new ValidationError("E_VALIDATION: key not found in this client");
    if (!key.revokedAt) {
      await ctx.tx.externalApiKey.update({ where: { keyId: input.keyId }, data: { revokedAt: new Date() } });
      await recordSecurityEvent(ctx.tx, {
        tenantId: ctx.actor.tenantId,
        eventType: "PermissionRevoked",
        actorUserId: ctx.actor.userId,
        payload: { keyId: input.keyId, membershipId: key.membershipId },
      });
    }
    return {
      result: { keyId: input.keyId },
      events: [{ name: "verity.platform.api_key_revoked", entityId: key.membershipId }],
    };
  },
};

export const assignRole: CommandDefinition<
  { membershipId: string; roleId: string | null },
  { membershipId: string }
> = {
  key: "verity.platform.assign_role",
  entity: ENTITY_MEMBERSHIP,
  verb: "Edit",
  impact: "destructive",
  input: z.object({
    membershipId: z.string().uuid(),
    // Null is a real choice, not a missing value: a membership with no role
    // grants nothing, which is how access is removed without removing the
    // person.
    roleId: z.string().uuid().nullable(),
  }),
  preconditions: async (ctx, input) => {
    if (input.membershipId === ctx.actor.membershipId) {
      throw new ValidationError("E_VALIDATION: ask another administrator to change your role");
    }
    if (!input.roleId) return;
    const role = await ctx.tx.role.findUnique({ where: { id: input.roleId } });
    if (!role) throw new ValidationError("E_VALIDATION: role not found in this client");
    await assertGrantCeiling(ctx.tx, ctx.actor, await resolvePermissions(ctx.tx, input.roleId));
  },
  handler: async (ctx, input) => {
    const before = await ctx.tx.tenantMembership.findUniqueOrThrow({
      where: { id: input.membershipId },
    });
    const after = await ctx.tx.tenantMembership.update({
      where: { id: input.membershipId },
      data: { roleId: input.roleId, version: { increment: 1 } },
    });

    await recordActivity(ctx, {
      entityKey: ENTITY_MEMBERSHIP,
      entityId: after.id,
      commandKey: "verity.platform.assign_role",
      changes: diffFields({ roleId: before.roleId }, { roleId: after.roleId }),
    });

    await recordSecurityEvent(ctx.tx, {
      tenantId: ctx.actor.tenantId,
      // Removing a role is a revocation, not an assignment. Recording both as
      // RoleAssigned would make the security stream unable to answer "when did
      // this person lose access", which is the question it exists for.
      eventType: input.roleId ? "RoleAssigned" : "PermissionRevoked",
      actorUserId: ctx.actor.userId,
      payload: { membershipId: after.id, roleId: input.roleId, previousRoleId: before.roleId },
    });

    return {
      result: { membershipId: after.id },
      events: [{ name: "verity.platform.role_assigned", entityId: after.id }],
    };
  },
};

/**
 * Ends a person's access to this client.
 *
 * Deletes the MEMBERSHIP, never the identity. `CLAUDE.md` is explicit that the
 * identity lifecycle ends at `Archived` and there is deliberately no deprovision
 * path — the same person may hold memberships in other clients, and INV-003
 * requires exactly one Party for them.
 */
export const revokeMembership: CommandDefinition<
  { membershipId: string },
  { membershipId: string }
> = {
  key: "verity.platform.revoke_membership",
  entity: ENTITY_MEMBERSHIP,
  verb: "Delete",
  impact: "destructive",
  input: z.object({ membershipId: z.string().uuid() }),
  preconditions: async (ctx, input) => {
    if (input.membershipId === ctx.actor.membershipId) {
      // Removing your own access mid-session leaves the client with one fewer
      // administrator and the operator unable to undo it from here.
      throw new ValidationError("E_VALIDATION: you cannot revoke your own membership");
    }
  },
  handler: async (ctx, input) => {
    const before = await ctx.tx.tenantMembership.findUniqueOrThrow({
      where: { id: input.membershipId },
      include: { user: { select: { partyId: true } } },
    });

    await ctx.tx.tenantMembership.delete({ where: { id: input.membershipId } });

    await recordActivity(ctx, {
      entityKey: ENTITY_MEMBERSHIP,
      entityId: input.membershipId,
      commandKey: "verity.platform.revoke_membership",
      changes: diffFields({ roleId: before.roleId, organizationId: before.organizationId }, {}),
    });

    await recordSecurityEvent(ctx.tx, {
      tenantId: ctx.actor.tenantId,
      eventType: "PermissionRevoked",
      actorUserId: ctx.actor.userId,
      payload: { membershipId: input.membershipId, reason: "membership_revoked" },
    });

    return {
      result: { membershipId: input.membershipId },
      events: [{ name: "verity.platform.membership_revoked", entityId: input.membershipId }],
    };
  },
};

/**
 * Suspends or restores a person.
 *
 * Party state, not membership: the person keeps their place in the organization
 * and their history, and gets it back on restore. Bible V2 Primitive 2 §3 ends
 * the lifecycle at `Archived`, so this offers `Suspended` and `Active` only —
 * archiving is not reversible and is not a button.
 */
export const setPersonState: CommandDefinition<
  { membershipId: string; state: "Active" | "Suspended" },
  { partyId: string; state: string }
> = {
  key: "verity.platform.set_person_state",
  entity: ENTITY_MEMBERSHIP,
  verb: "Edit",
  impact: "destructive",
  input: z.object({
    membershipId: z.string().uuid(),
    state: z.enum(["Active", "Suspended"]),
  }),
  handler: async (ctx, input) => {
    const membership = await ctx.tx.tenantMembership.findUniqueOrThrow({
      where: { id: input.membershipId },
      include: { user: { select: { partyId: true, party: { select: { state: true } } } } },
    });

    const partyId = membership.user.partyId;
    const before = membership.user.party.state;

    await ctx.tx.party.update({
      where: { id: partyId },
      data: { state: input.state, version: { increment: 1 } },
    });

    await recordActivity(ctx, {
      entityKey: ENTITY_MEMBERSHIP,
      entityId: input.membershipId,
      commandKey: "verity.platform.set_person_state",
      changes: diffFields({ state: before }, { state: input.state }),
    });

    return {
      result: { partyId, state: input.state },
      events: [{ name: "verity.platform.person_state_changed", entityId: input.membershipId }],
    };
  },
};

export type PersonRow = {
  membershipId: string;
  userId: string;
  displayName: string;
  email: string | null;
  state: string;
  organizationId: string;
  organizationName: string;
  roleId: string | null;
  roleName: string | null;
};

export const listPeople: QueryDefinition<{ search?: string }, PersonRow[]> = {
  key: "verity.platform.list_people",
  entity: ENTITY_MEMBERSHIP,
  input: z.object({ search: z.string().optional() }),
  handler: async (ctx, input) => {
    const rows = await ctx.tx.tenantMembership.findMany({
      include: {
        user: { include: { party: true } },
        organization: { select: { id: true, name: true } },
        role: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const term = input.search?.trim().toLowerCase();
    return rows
      .map((row) => ({
        membershipId: row.id,
        userId: row.userId,
        displayName: row.user.party.displayName,
        email: row.user.party.email,
        state: row.user.party.state,
        organizationId: row.organization.id,
        organizationName: row.organization.name,
        roleId: row.role?.id ?? null,
        roleName: row.role?.name ?? null,
      }))
      .filter((row) =>
        !term
          ? true
          : row.displayName.toLowerCase().includes(term) ||
            (row.email ?? "").toLowerCase().includes(term) ||
            (row.roleName ?? "").toLowerCase().includes(term),
      );
  },
};

/* =========================== roles and permissions ========================== */

export const createRole: CommandDefinition<{ name: string }, { id: string }> = {
  key: "verity.platform.create_role",
  entity: ENTITY_ROLE,
  verb: "Create",
  impact: "destructive",
  input: z.object({ name: z.string().min(1).max(120) }),
  preconditions: async (ctx, input) => {
    const clash = await ctx.tx.role.findFirst({ where: { name: input.name } });
    if (clash) throw new ValidationError("E_VALIDATION: a role with that name already exists here");
  },
  handler: async (ctx, input) => {
    const role = await ctx.tx.role.create({
      data: { tenantId: ctx.actor.tenantId, name: input.name },
    });
    await recordActivity(ctx, {
      entityKey: ENTITY_ROLE,
      entityId: role.id,
      commandKey: "verity.platform.create_role",
      changes: diffFields({}, { name: role.name }),
    });
    return {
      result: { id: role.id },
      events: [{ name: "verity.platform.role_created", entityId: role.id }],
    };
  },
};

/**
 * Grants one Verb + Entity + Scope to a role.
 *
 * `Global` is rejected here rather than stored and ignored. `resolve_permissions`
 * already filters it out, so a stored Global row would be a grant that looks
 * effective in the UI and does nothing — the worst of both, and the reason
 * CLAUDE.md records it as an open decision rather than an implemented scope.
 */
export const grantPermission: CommandDefinition<
  { roleId: string; verb: string; entity: string; scope: string },
  { id: string }
> = {
  key: "verity.platform.grant_permission",
  entity: ENTITY_ROLE,
  verb: "Edit",
  impact: "destructive",
  input: z.object({
    roleId: z.string().uuid(),
    verb: z.enum(["Read", "Create", "Edit", "Delete", "ActionExecute"]),
    entity: z.string().min(1).max(200),
    scope: z.enum(["Tenant", "Organization", "Location"]),
  }),
  preconditions: async (ctx, input) => {
    const role = await ctx.tx.role.findUnique({ where: { id: input.roleId } });
    if (!role) throw new ValidationError("E_VALIDATION: role not found in this client");
    await assertGrantCeiling(ctx.tx, ctx.actor, [input]);

    const existing = await ctx.tx.permission.findFirst({
      where: { roleId: input.roleId, verb: input.verb as never, entity: input.entity },
    });
    if (existing) throw new ValidationError("E_VALIDATION: that grant already exists on this role");
  },
  handler: async (ctx, input) => {
    const permission = await ctx.tx.permission.create({
      data: {
        tenantId: ctx.actor.tenantId,
        roleId: input.roleId,
        verb: input.verb as never,
        entity: input.entity,
        scope: input.scope as never,
      },
    });

    await recordActivity(ctx, {
      entityKey: ENTITY_ROLE,
      entityId: input.roleId,
      commandKey: "verity.platform.grant_permission",
      changes: diffFields({}, { grant: `${input.verb} ${input.entity} @ ${input.scope}` }),
    });

    await recordSecurityEvent(ctx.tx, {
      tenantId: ctx.actor.tenantId,
      eventType: "PermissionEscalated",
      actorUserId: ctx.actor.userId,
      payload: { roleId: input.roleId, verb: input.verb, entity: input.entity, scope: input.scope },
    });

    return {
      result: { id: permission.id },
      events: [{ name: "verity.platform.permission_granted", entityId: input.roleId }],
    };
  },
};

export const revokePermission: CommandDefinition<
  { permissionId: string },
  { permissionId: string }
> = {
  key: "verity.platform.revoke_permission",
  entity: ENTITY_ROLE,
  verb: "Edit",
  impact: "destructive",
  input: z.object({ permissionId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const before = await ctx.tx.permission.findUniqueOrThrow({ where: { id: input.permissionId } });
    await ctx.tx.permission.delete({ where: { id: input.permissionId } });

    await recordActivity(ctx, {
      entityKey: ENTITY_ROLE,
      entityId: before.roleId,
      commandKey: "verity.platform.revoke_permission",
      changes: diffFields({ grant: `${before.verb} ${before.entity} @ ${before.scope}` }, {}),
    });

    await recordSecurityEvent(ctx.tx, {
      tenantId: ctx.actor.tenantId,
      eventType: "PermissionRevoked",
      actorUserId: ctx.actor.userId,
      payload: { roleId: before.roleId, verb: before.verb, entity: before.entity },
    });

    return {
      result: { permissionId: input.permissionId },
      events: [{ name: "verity.platform.permission_revoked", entityId: before.roleId }],
    };
  },
};

/**
 * Composes one role into another: the parent inherits the child's permissions
 * (PLA-AUT-001).
 *
 * Cycles are refused by a database trigger, not by a check here. That is
 * deliberate and worth not "improving": resolution runs on every permission
 * check, so a cycle would make it non-terminating, and a guarantee that lives in
 * the database cannot be bypassed by a future write path that forgets it.
 */
export const composeRole: CommandDefinition<
  { parentRoleId: string; childRoleId: string; attach: boolean },
  { parentRoleId: string }
> = {
  key: "verity.platform.compose_role",
  entity: ENTITY_ROLE,
  verb: "Edit",
  impact: "destructive",
  input: z.object({
    parentRoleId: z.string().uuid(),
    childRoleId: z.string().uuid(),
    attach: z.boolean(),
  }),
  preconditions: async (ctx, input) => {
    if (input.attach) await assertGrantCeiling(ctx.tx, ctx.actor, await resolvePermissions(ctx.tx, input.childRoleId));
    if (input.parentRoleId === input.childRoleId) {
      throw new ValidationError("E_VALIDATION: a role cannot inherit from itself");
    }
  },
  handler: async (ctx, input) => {
    if (input.attach) {
      await ctx.tx.roleComposition.create({
        data: {
          tenantId: ctx.actor.tenantId,
          parentRoleId: input.parentRoleId,
          childRoleId: input.childRoleId,
        },
      });
    } else {
      await ctx.tx.roleComposition.deleteMany({
        where: { parentRoleId: input.parentRoleId, childRoleId: input.childRoleId },
      });
    }

    await recordActivity(ctx, {
      entityKey: ENTITY_ROLE,
      entityId: input.parentRoleId,
      commandKey: "verity.platform.compose_role",
      changes: diffFields(
        { composedWith: input.attach ? null : input.childRoleId },
        { composedWith: input.attach ? input.childRoleId : null },
      ),
    });

    return {
      result: { parentRoleId: input.parentRoleId },
      events: [{ name: "verity.platform.role_composed", entityId: input.parentRoleId }],
    };
  },
};

export type RoleRow = {
  id: string;
  name: string;
  memberCount: number;
  directGrants: Array<{ id: string; verb: string; entity: string; scope: string }>;
  /** Flattened through composition, as `verity.resolve_permissions` computes it. */
  resolvedGrants: Array<{ verb: string; entity: string; scope: string }>;
  composedFrom: Array<{ id: string; name: string }>;
};

export const listRoles: QueryDefinition<Record<string, never>, RoleRow[]> = {
  key: "verity.platform.list_roles",
  entity: ENTITY_ROLE,
  input: z.object({}),
  handler: async (ctx) => {
    const roles = await ctx.tx.role.findMany({
      orderBy: { name: "asc" },
      include: {
        permissions: { orderBy: [{ entity: "asc" }, { verb: "asc" }] },
        _count: { select: { memberships: true } },
        parentOf: { include: { childRole: { select: { id: true, name: true } } } },
      },
    });

    const out: RoleRow[] = [];
    for (const role of roles) {
      // The RESOLVED set is read from the database function rather than
      // recomputed here. An operator granting access needs to see what the
      // checker will actually see, and a second implementation of inheritance
      // would eventually disagree with the first.
      const resolved = await resolvePermissions(ctx.tx, role.id);
      out.push({
        id: role.id,
        name: role.name,
        memberCount: role._count.memberships,
        directGrants: role.permissions.map((p) => ({
          id: p.id,
          verb: p.verb,
          entity: p.entity,
          scope: p.scope,
        })),
        resolvedGrants: resolved.map((p) => ({ verb: p.verb, entity: p.entity, scope: p.scope })),
        composedFrom: role.parentOf.map((c) => ({
          id: c.childRole.id,
          name: c.childRole.name,
        })),
      });
    }
    return out;
  },
};

/* ================================= modules ================================= */

export const setCapabilityState: CommandDefinition<
  { capabilityId: string; enabled: boolean },
  { capabilityId: string; enabled: boolean }
> = {
  key: "verity.platform.set_capability_state",
  entity: ENTITY_TENANT,
  verb: "ActionExecute",
  impact: "destructive",
  input: z.object({ capabilityId: z.string().min(1), enabled: z.boolean() }),
  handler: async (ctx, input) => {
    if (input.enabled) {
      await activateCapability(ctx.tx, ctx.actor.tenantId, input.capabilityId);
      await syncOperatorReadOnActivation(
        ctx.tx,
        ctx.actor.tenantId,
        ctx.actor.roleId,
        input.capabilityId,
      );
    } else {
      // A dependency trigger refuses this when another active capability still
      // needs it. The error surfaces rather than being swallowed: "disable
      // failed because Scheduling depends on it" is the useful outcome.
      await suspendCapability(ctx.tx, ctx.actor.tenantId, input.capabilityId);
    }

    await recordActivity(ctx, {
      entityKey: ENTITY_TENANT,
      entityId: ctx.actor.tenantId,
      commandKey: "verity.platform.set_capability_state",
      changes: diffFields(
        { capability: input.capabilityId, active: !input.enabled },
        { capability: input.capabilityId, active: input.enabled },
      ),
    });

    await recordSecurityEvent(ctx.tx, {
      tenantId: ctx.actor.tenantId,
      eventType: "ConfigurationChanged",
      actorUserId: ctx.actor.userId,
      payload: { capabilityId: input.capabilityId, enabled: input.enabled },
    });

    return {
      result: { capabilityId: input.capabilityId, enabled: input.enabled },
      events: [
        {
          name: input.enabled
            ? "verity.platform.capability_enabled"
            : "verity.platform.capability_disabled",
          entityId: ctx.actor.tenantId,
        },
      ],
    };
  },
};

/**
 * Grants Read on a newly-activated capability's entities to the acting
 * operator's own role, so the nav item they just turned on is visible to them
 * immediately.
 *
 * Deliberately narrow (Issue 3 decision, 2026-08-28): activation alone does not
 * know which role is "the client's admin" — no such marker exists on `Role`,
 * and inventing one is a platform-primitive decision, not a bug fix. The one
 * unambiguous target is the well-known `OPERATOR_ROLE_NAME` role this same
 * actor is acting through when they toggle a module from HQ. A client's own
 * admin role still needs a manual grant — surfaced as a prompt in the Roles UI
 * (Issue 4/5 follow-up), not guessed here.
 */
async function syncOperatorReadOnActivation(
  tx: TenantScopedClient,
  tenantId: string,
  roleId: string | null,
  capabilityId: string,
): Promise<void> {
  if (!roleId) return;

  const role = await tx.role.findUnique({ where: { id: roleId }, select: { name: true } });
  if (role?.name !== OPERATOR_ROLE_NAME) return;

  const entities = await tx.entityDefinition.findMany({
    where: { capability: capabilityId },
    select: { key: true },
  });
  if (entities.length === 0) return;

  await tx.permission.createMany({
    data: entities.map((e) => ({
      tenantId,
      roleId,
      verb: "Read" as const,
      entity: e.key,
      scope: "Tenant" as const,
    })),
    skipDuplicates: true,
  });
}

export type GrantableEntity = { key: string; label: string };
export type GrantableGroup = { group: string; entities: GrantableEntity[] };

/**
 * The fixed platform ontology's own entities — never rows in
 * `EntityDefinition`, because that table is for capability-owned entities
 * (MET-ENT-004) and these four are the platform's, not a capability's
 * (PLA-AUT-002/003). Hardcoding this one closed set is not the same mistake as
 * Issue 3's "which role is the admin": there, no fixed answer exists; here,
 * the platform administration entities are enumerated in code already
 * (`ENTITY_TENANT` etc., just above) and do not change per capability.
 */
const PLATFORM_ADMIN_ENTITIES = [ENTITY_TENANT, ENTITY_ORGANIZATION, ENTITY_MEMBERSHIP, ENTITY_ROLE, "verity.platform.activity", "verity.platform.security_event", "verity.platform.command_failure", "verity.platform.overview", "verity.platform.capability"];

/**
 * Entities a role's permissions can target, grouped by owning capability —
 * the catalog the Roles checkbox matrix renders (Issue 4). Limited to
 * ACTIVE capabilities: granting access to an inactive one's entities would
 * offer a control for something `requireCapabilityActive` blocks anyway.
 */
export const listGrantableEntities: QueryDefinition<Record<string, never>, GrantableGroup[]> = {
  key: "verity.platform.list_grantable_entities",
  entity: ENTITY_ROLE,
  input: z.object({}),
  handler: async (ctx) => {
    const activations = await ctx.tx.tenantActivation.findMany({
      where: { status: "Active" },
      include: { capability: true },
    });

    const capabilityIds = activations.map((a) => a.capabilityId);
    const entities = capabilityIds.length
      ? await ctx.tx.entityDefinition.findMany({
          where: { capability: { in: capabilityIds } },
          orderBy: { key: "asc" },
        })
      : [];

    const capabilityName = new Map(activations.map((a) => [a.capabilityId, a.capability.name]));
    const byGroup = new Map<string, GrantableEntity[]>();
    for (const e of entities) {
      const group = capabilityName.get(e.capability) ?? e.capability;
      const list = byGroup.get(group) ?? [];
      list.push({ key: e.key, label: entityLabel(e.key) });
      byGroup.set(group, list);
    }

    const groups: GrantableGroup[] = [
      {
        group: "Platform Administration",
        entities: PLATFORM_ADMIN_ENTITIES.map((key) => ({ key, label: entityLabel(key) })),
      },
      ...[...byGroup.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([group, list]) => ({ group, entities: list })),
    ];

    return groups;
  },
};

export type ModuleRow = {
  capabilityId: string;
  name: string;
  version: string;
  dependencies: string[];
  status: "Active" | "Suspended" | "Not enabled";
  pinnedVersion: string | null;
};

export const listModules: QueryDefinition<Record<string, never>, ModuleRow[]> = {
  key: "verity.platform.list_modules",
  entity: ENTITY_TENANT,
  input: z.object({}),
  handler: async (ctx) => {
    const [definitions, activations] = await Promise.all([
      ctx.tx.capabilityDefinition.findMany({ orderBy: { name: "asc" } }),
      ctx.tx.tenantActivation.findMany(),
    ]);

    const byId = new Map(activations.map((a) => [a.capabilityId, a]));
    return definitions.map((definition) => {
      const activation = byId.get(definition.id);
      return {
        capabilityId: definition.id,
        name: definition.name,
        version: definition.version,
        dependencies: definition.dependencies,
        status: (activation?.status ?? "Not enabled") as ModuleRow["status"],
        pinnedVersion: activation?.pinnedVersion ?? null,
      };
    });
  },
};

/* ============================== configuration ============================== */

export const setTenantConfiguration: CommandDefinition<
  { key: string; value: string | null },
  { key: string }
> = {
  key: "verity.platform.set_configuration",
  entity: ENTITY_TENANT,
  verb: "Edit",
  impact: "destructive",
  input: z.object({
    key: z.string().min(1).max(120),
    // Null clears the setting. An absent value must be distinguishable from an
    // empty one — `temporal.ts` treats an unset zone as UTC by decision, and an
    // empty string would be neither.
    value: z.string().max(2000).nullable(),
  }),
  handler: async (ctx, input) => {
    const before = await ctx.tx.configParameter.findFirst({
      where: { key: input.key, scope: "Tenant", scopeId: null },
    });

    if (input.value === null) {
      await ctx.tx.configParameter.deleteMany({
        where: { key: input.key, scope: "Tenant", scopeId: null },
      });
    } else {
      await setConfig(ctx.tx, ctx.actor.tenantId, input.key, input.value, "Tenant");
    }

    await recordActivity(ctx, {
      entityKey: ENTITY_TENANT,
      entityId: ctx.actor.tenantId,
      commandKey: "verity.platform.set_configuration",
      changes: diffFields({ [input.key]: before?.value ?? null }, { [input.key]: input.value }),
    });

    await recordSecurityEvent(ctx.tx, {
      tenantId: ctx.actor.tenantId,
      eventType: "ConfigurationChanged",
      actorUserId: ctx.actor.userId,
      payload: { key: input.key, cleared: input.value === null },
    });

    return {
      result: { key: input.key },
      events: [{ name: "verity.platform.configuration_changed", entityId: ctx.actor.tenantId }],
    };
  },
};

export const listConfiguration: QueryDefinition<
  Record<string, never>,
  Array<{ key: string; value: unknown; scope: string }>
> = {
  key: "verity.platform.list_configuration",
  entity: ENTITY_TENANT,
  input: z.object({}),
  handler: async (ctx) => {
    const rows = await ctx.tx.configParameter.findMany({ orderBy: { key: "asc" } });
    return rows.map((row) => ({ key: row.key, value: row.value, scope: row.scope }));
  },
};

/* ================================ operations =============================== */

export type OperationsSnapshot = {
  recentActivity: Array<{
    occurredAt: Date;
    entityKey: string;
    fieldChanged: string;
    commandKey: string | null;
  }>;
  securityEvents: Array<{ occurredAt: Date; eventType: string; actorUserId: string | null }>;
  pendingOutbox: number;
  runningClocks: number;
  breachedClocks: number;
  suppressedNotifications: number;
  syncExceptions: number;
};

/**
 * What is happening and what is failing inside one client.
 *
 * Counts of real rows, and nothing invented. There is no "health score" because
 * nothing defines one, and a green tick computed from an arbitrary formula is
 * worse than no tick at all.
 */
export const operationsSnapshot: QueryDefinition<Record<string, never>, OperationsSnapshot> = {
  key: "verity.platform.operations_snapshot",
  entity: ENTITY_TENANT,
  input: z.object({}),
  handler: async (ctx) => {
    const [
      recentActivity,
      securityEvents,
      pendingOutbox,
      runningClocks,
      breachedClocks,
      suppressedNotifications,
      syncExceptions,
    ] = await Promise.all([
      ctx.tx.activity.findMany({
        orderBy: { occurredAt: "desc" },
        take: 20,
        select: { occurredAt: true, entityKey: true, fieldChanged: true, commandKey: true },
      }),
      ctx.tx.securityAuditEvent.findMany({
        orderBy: { occurredAt: "desc" },
        take: 20,
        select: { occurredAt: true, eventType: true, actorUserId: true },
      }),
      ctx.tx.domainEvent.count({ where: { deliveredAt: null } }),
      ctx.tx.slaClock.count({ where: { status: "Running" } }),
      ctx.tx.slaClock.count({ where: { status: "Breached" } }),
      ctx.tx.notification.count({ where: { status: "Suppressed" } }),
      ctx.tx.syncException.count({ where: { resolvedAt: null } }),
    ]);

    return {
      recentActivity,
      securityEvents,
      pendingOutbox,
      runningClocks,
      breachedClocks,
      suppressedNotifications,
      syncExceptions,
    };
  },
};

/* ============================== registration =============================== */

let installed = false;

/**
 * Installs the administration contracts.
 *
 * Guarded the same way `installCapabilities` is, and for the same reason: Next
 * may evaluate a module more than once per process, which is not a defect, while
 * a genuine duplicate key still throws.
 */
export function installAdministration(): void {
  if (installed) return;
  installed = true;

  registerCommand(createOrganization);
  registerCommand(updateOrganization);
  registerCommand(invitePerson);
  registerCommand(assignRole);
  registerCommand(createApiKey);
  registerCommand(revokeApiKey);
  registerCommand(revokeMembership);
  registerCommand(setPersonState);
  registerCommand(createRole);
  registerCommand(grantPermission);
  registerCommand(revokePermission);
  registerCommand(composeRole);
  registerCommand(setCapabilityState);
  registerCommand(setTenantConfiguration);

  registerQuery(listOrganizations);
  registerQuery(listPeople);
  registerQuery(listRoles);
  registerQuery(listGrantableEntities);
  registerQuery(listModules);
  registerQuery(listConfiguration);
  registerQuery(operationsSnapshot);
}

/** Test seam: allows a suite to re-install after clearing the registries. */
export function resetAdministrationInstall(): void {
  installed = false;
}
