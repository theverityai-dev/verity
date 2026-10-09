import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "./db";
import { getAuthUser, resolveActor, setActiveMembership } from "./auth";
import { recordSecurityEvent } from "./audit";
import { withTenant } from "./tenancy";
import { ForbiddenError } from "./authorization";
import type { ActorContext } from "./command";
import {
  applyPlannedPackOperation,
  planPackOperation,
  previewPack,
  removePackInstance,
  rollbackPackOperation,
  type PackPreviewDiff,
} from "./pack";
import { applyCapabilityUpgrade, planCapabilityUpgrade } from "./capability-upgrade";

/**
 * Global HQ operator authority.
 *
 * Authority: ADR-013 — Option D with identity Shape 1.
 *
 * THE SHAPE, IN ONE PARAGRAPH
 * An operator is not a new kind of principal. They are an ordinary Party and
 * User holding an ordinary `TenantMembership` in one tenant that happens to be
 * marked `isPlatform`, with an ordinary role granting an ordinary
 * `ActionExecute` permission. Everything about authentication, membership
 * switching, permission resolution and audit therefore works unchanged, which
 * is the entire reason this shape was chosen over an authority flag orthogonal
 * to tenancy: that would have been a second authorization model to keep in sync
 * with the first, and this codebase has already refused one of those.
 *
 * WHAT IS AND IS NOT CROSS-TENANT
 * Reads that span tenants go through exactly three read-only projections, each
 * a `SECURITY DEFINER` function with a pinned `search_path`, gated on
 * `verity.is_platform_operator`, returning metadata and counts — never a client
 * business row. They are listed in ADR-013 and adding a fourth is a deliberate
 * act, not a convenience.
 *
 * There is NO cross-tenant write. Entering a client sets the tenant scope to
 * that one client and then everything proceeds under the ordinary policies. A
 * mutation happens inside exactly one tenant or it does not happen.
 */

/** Permission key that makes a platform-tenant membership an operator one. */
export const OPERATOR_ENTITY = "verity.platform.operator";

export type OperatorContext = {
  authUserId: string;
  userId: string;
  /** The platform tenant. Never a client. */
  platformTenantId: string;
  membershipId: string;
  organizationId: string;
  roleId: string | null;
};

/**
 * The operator behind this request, or null.
 *
 * Two conditions, deliberately separate. `is_platform_operator` answers "does
 * this principal hold operator authority anywhere" — a question that crosses
 * tenants and therefore lives in the database. The second answers "are they
 * currently operating as one", by reading `is_platform` for the ACTIVE tenant
 * under that tenant's own scope, so the read is an ordinary policy-filtered
 * one.
 *
 * Requiring both is what stops operator authority from being ambient. An
 * operator who has switched into a client is, for that request, acting inside
 * the client — and HQ correctly refuses them until they switch back.
 */
export async function resolveOperator(): Promise<OperatorContext | null> {
  const [authUser, actor] = await Promise.all([getAuthUser(), resolveActor()]);
  if (!authUser || !actor) return null;

  const [granted] = await prisma.$queryRaw<{ ok: boolean }[]>`
    SELECT verity.is_platform_operator(${authUser.id}::uuid) AS ok`;
  if (!granted?.ok) return null;

  const activeIsPlatform = await withTenant(actor.tenantId, async (tx) => {
    const [row] = await tx.$queryRaw<{ is_platform: boolean }[]>`
      SELECT is_platform FROM tenant WHERE id = ${actor.tenantId}::uuid`;
    return row?.is_platform === true;
  });
  if (!activeIsPlatform) return null;

  return {
    authUserId: authUser.id,
    userId: actor.userId,
    platformTenantId: actor.tenantId,
    membershipId: actor.membershipId,
    organizationId: actor.organizationId,
    roleId: actor.roleId,
  };
}

/**
 * Resolves an operator or refuses.
 *
 * Throws rather than returning false, for the same reason `authorize()` does:
 * forgetting to branch on a boolean permits the action, and a permission check
 * that fails open is worse than none because it looks like one that works.
 *
 * A tenant user who reaches an HQ route is a security event, not merely a 403 —
 * D18 requires the boundary be observable, and Workflow D asserts it.
 */
export async function requireOperator(): Promise<OperatorContext> {
  const operator = await resolveOperator();
  if (operator) return operator;

  const actor = await resolveActor();
  if (actor) {
    // Recorded in the actor's OWN tenant, which is the only scope they have.
    await withTenant(actor.tenantId, (tx) =>
      recordSecurityEvent(tx, {
        tenantId: actor.tenantId,
        eventType: "AuthorizationDenied",
        actorUserId: actor.userId,
        payload: { reason: "operator_required", surface: "hq" },
      }),
    );
  }

  throw new ForbiddenError("E_FORBIDDEN: HQ requires platform operator authority");
}

/* ------------------------------------------------------------------------- *
 * The three cross-tenant projections. Read-only, enumerated, ADR-013.
 * ------------------------------------------------------------------------- */

export type ClientSummary = {
  tenantId: string;
  name: string;
  timeZone: string | null;
  createdAt: Date;
  memberCount: number;
  organizationCount: number;
  status: ClientStatus;
  statusReason: string | null;
};

export const CLIENT_STATUSES = ["onboarding", "active", "suspended"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

/** Projection 1 — client metadata and counts. Never client business rows. */
export async function clientDirectory(operator: OperatorContext): Promise<ClientSummary[]> {
  const rows = await prisma.$queryRaw<
    {
      tenant_id: string; name: string; time_zone: string | null;
      created_at: Date; member_count: bigint; org_count: bigint;
      status: string; status_reason: string | null;
    }[]
  >`SELECT * FROM verity.operator_client_directory(${operator.authUserId}::uuid)`;

  return rows.map((r) => ({
    tenantId: r.tenant_id,
    name: r.name,
    timeZone: r.time_zone,
    createdAt: r.created_at,
    memberCount: Number(r.member_count),
    organizationCount: Number(r.org_count),
    status: r.status as ClientStatus,
    statusReason: r.status_reason,
  }));
}

export type ClientActivity = {
  tenantId: string;
  name: string;
  activity30d: number;
  securityEvents30d: number;
  lastActivityAt: Date | null;
  /** ADR-034 health counts. */
  undeliveredEvents: number;
  syncExceptions: number;
  slaBreached: number;
  peopleInvited: number;
};

/** Projection 2 — per-client counts for the operational view. */
export async function platformActivity(operator: OperatorContext): Promise<ClientActivity[]> {
  const rows = await prisma.$queryRaw<
    {
      tenant_id: string; name: string; activity_30d: bigint;
      security_events_30d: bigint; last_activity_at: Date | null;
      undelivered_events: bigint; sync_exceptions: bigint; sla_breached: bigint; people_invited: bigint;
    }[]
  >`SELECT * FROM verity.operator_platform_activity(${operator.authUserId}::uuid)`;

  return rows.map((r) => ({
    tenantId: r.tenant_id,
    name: r.name,
    activity30d: Number(r.activity_30d),
    securityEvents30d: Number(r.security_events_30d),
    lastActivityAt: r.last_activity_at,
    undeliveredEvents: Number(r.undelivered_events),
    syncExceptions: Number(r.sync_exceptions),
    slaBreached: Number(r.sla_breached),
    peopleInvited: Number(r.people_invited),
  }));
}

export type CommandFailureTotal = {
  tenantId: string;
  name: string;
  commandKey: string;
  errorCode: string;
  /** Validation and permission refusals: the system working as designed (ADR-036). */
  expected: boolean;
  failures: number;
  /** The most failures any one person had on this command. A number, never who. */
  worstUser: number;
  lastAt: Date;
};

/**
 * Failed-command totals per client, command and error code (ADR-036). Counts and
 * the latest time only: no row id, no user id, no payload, no message text. An
 * operator who needs one failure's detail enters the client (ADR-035).
 */
export async function commandFailureTotals(operator: OperatorContext, days = 7): Promise<CommandFailureTotal[]> {
  const rows = await prisma.$queryRaw<
    {
      tenant_id: string; name: string; command_key: string; error_code: string;
      expected: boolean; failures: bigint; worst_user: bigint; last_at: Date;
    }[]
  >`SELECT * FROM verity.operator_command_failures(${operator.authUserId}::uuid, ${days}::int)`;
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    name: r.name,
    commandKey: r.command_key,
    errorCode: r.error_code,
    expected: r.expected,
    failures: Number(r.failures),
    worstUser: Number(r.worst_user),
    lastAt: r.last_at,
  }));
}

export type PlatformAuditRow = {
  occurredAt: Date;
  tenantId: string;
  tenantName: string;
  entityKey: string;
  entityId: string;
  commandKey: string | null;
  fieldChanged: string;
  actorUserId: string | null;
  /** True when the actor holds platform-tenant membership — ADR-013 answer 12. */
  isOperator: boolean;
};

/** Projection 3 — audit metadata across tenants. No payload bodies. */
export async function platformAudit(
  operator: OperatorContext,
  limit = 100,
): Promise<PlatformAuditRow[]> {
  const rows = await prisma.$queryRaw<
    {
      occurred_at: Date; tenant_id: string; tenant_name: string; entity_key: string;
      entity_id: string; command_key: string | null; field_changed: string;
      actor_user_id: string | null; is_operator: boolean;
    }[]
  >`SELECT * FROM verity.operator_platform_audit(${operator.authUserId}::uuid, ${limit}::int)`;

  return rows.map((r) => ({
    occurredAt: r.occurred_at,
    tenantId: r.tenant_id,
    tenantName: r.tenant_name,
    entityKey: r.entity_key,
    entityId: r.entity_id,
    commandKey: r.command_key,
    fieldChanged: r.field_changed,
    actorUserId: r.actor_user_id,
    isOperator: r.is_operator,
  }));
}

/* ------------------------------------------------------------------------- *
 * Scheduled jobs — installation-wide (A6)
 * ------------------------------------------------------------------------- */

export type SchedulerRunSummary = {
  cadence: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  tenantCount: number | null;
  workCount: number | null;
};

/**
 * The latest run of each scheduler cadence. `scheduler_run` holds no tenant
 * data (a cadence, a status, counts), so this is not a cross-tenant read; it is
 * still operator-only because it describes the installation.
 */
export async function schedulerRunSummary(operator: OperatorContext): Promise<SchedulerRunSummary[]> {
  void operator; // the parameter is the proof of authority, as for the projections
  const rows = await prisma.$queryRaw<
    {
      cadence: string; status: string; started_at: Date; finished_at: Date | null;
      duration_ms: number | null; tenant_count: number | null; work_count: number | null;
    }[]
  >`SELECT DISTINCT ON (cadence) cadence, status, started_at, finished_at, duration_ms, tenant_count, work_count
     FROM scheduler_run ORDER BY cadence, started_at DESC`;
  return rows.map((r) => ({
    cadence: r.cadence,
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    durationMs: r.duration_ms,
    tenantCount: r.tenant_count,
    workCount: r.work_count,
  }));
}

/* ------------------------------------------------------------------------- *
 * Platform settings — the operator's own tenant
 * ------------------------------------------------------------------------- */

export type PlatformSettings = {
  tenantName: string;
  timeZone: string | null;
  operators: Array<{ displayName: string; email: string | null; roleName: string | null }>;
  installedCapabilities: Array<{ id: string; name: string; version: string }>;
};

/**
 * What the platform itself is configured with.
 *
 * Read inside the PLATFORM tenant's own scope — an operator is an ordinary
 * member of it, so this needs no projection and no elevation. That it works
 * through the same RLS as everything else is the point: the platform tenant is
 * a tenant, and HQ reading its own roster is just a member reading their own
 * tenant.
 *
 * Read-only, because nothing here has a write path that exists. Global-scope
 * configuration is deliberately not tenant-writable, operator membership is
 * granted by `prisma/bootstrap-operator.ts` under a human's hand, and capability
 * definitions are installed by migration. Offering buttons for any of that would
 * be offering controls that lie.
 */
export async function platformSettings(): Promise<PlatformSettings> {
  const operator = await requireOperator();

  return withTenant(operator.platformTenantId, async (tx) => {
    const [tenant, memberships, capabilities] = await Promise.all([
      tx.tenant.findUniqueOrThrow({
        where: { id: operator.platformTenantId },
        select: { name: true, timeZone: true },
      }),
      tx.tenantMembership.findMany({
        include: {
          user: { include: { party: { select: { displayName: true, email: true } } } },
          role: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      tx.capabilityDefinition.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, version: true },
      }),
    ]);

    return {
      tenantName: tenant.name,
      timeZone: tenant.timeZone,
      operators: memberships.map((membership) => ({
        displayName: membership.user.party.displayName,
        email: membership.user.party.email,
        roleName: membership.role?.name ?? null,
      })),
      installedCapabilities: capabilities,
    };
  });
}

/* ------------------------------------------------------------------------- *
 * Scope elevation — entering a client
 * ------------------------------------------------------------------------- */

/**
 * Creates a client: tenant, root organization, and the operator's own membership.
 *
 * Not routed through `executeCommand`, and the reason is structural rather than
 * a shortcut. `executeCommand` runs inside the ACTOR's tenant scope, and the
 * tenant policy's `WITH CHECK` requires the row's own id to equal the current
 * scope — so a command running in the platform tenant cannot insert a row for a
 * different tenant, by design. Provisioning sets the scope to the id being
 * created, which is the mechanism the init migration documented for exactly this
 * case. Authorization, audit and fail-closed behaviour are all still present;
 * only the pipeline differs, because the pipeline is tenant-shaped and this one
 * act creates the tenant.
 */
export async function createClient(input: {
  name: string;
  timeZone?: string | null;
}): Promise<{ tenantId: string; organizationId: string }> {
  const operator = await requireOperator();

  const name = input.name.trim();
  if (!name) throw new Error("E_VALIDATION: a client needs a name");

  const tenantId = randomUUID();

  const organizationId = await withTenant(tenantId, async (tx) => {
    await tx.tenant.create({
      data: { id: tenantId, name, timeZone: input.timeZone ?? null, isPlatform: false, status: "onboarding" },
    });
    const organization = await tx.organization.create({
      data: { tenantId, name, parentId: null },
      select: { id: true },
    });

    const roleId = await operatorRoleFor(tx, tenantId);
    await tx.tenantMembership.create({
      data: { tenantId, userId: operator.userId, organizationId: organization.id, roleId },
    });

    await recordSecurityEvent(tx, {
      tenantId,
      eventType: "PermissionEscalated",
      actorUserId: operator.userId,
      payload: { reason: "client_created_by_operator", operator: true },
    });

    return organization.id;
  });

  return { tenantId, organizationId };
}

/**
 * Gives the operator a membership in one client and makes it the active one.
 *
 * This is the "authority to enter" of ADR-013, executed rather than asserted.
 * It is a WRITE, and it is deliberately not a cross-tenant one: the scope is set
 * to the single client being entered, and every statement below runs under that
 * client's own policies. What makes it privileged is not a bypass — there is
 * none — but the authorization check in front of it.
 *
 * Idempotent. An operator who has entered a client before re-enters through the
 * same membership rather than accumulating one per visit.
 */
export async function enterClient(tenantId: string, reason: string): Promise<string> {
  const operator = await requireOperator();
  // ADR-034 item 4: a support session states why. The reason goes into the
  // client's own security trail, which the client can read.
  const why = reason.trim();
  if (why.length < 5) throw new Error("E_VALIDATION: say why you are entering this client (at least 5 characters)");
  if (why.length > 300) throw new Error("E_VALIDATION: keep the reason under 300 characters");

  const membershipId = await withTenant(tenantId, async (tx) => {
    const [tenant] = await tx.$queryRaw<{ id: string; is_platform: boolean }[]>`
      SELECT id, is_platform FROM tenant WHERE id = ${tenantId}::uuid`;
    if (!tenant) throw new ForbiddenError("E_FORBIDDEN: no such client");
    // Entering the platform tenant "as a client" would blur exactly the
    // distinction D18 requires be kept.
    if (tenant.is_platform) throw new ForbiddenError("E_FORBIDDEN: the platform tenant is not a client");

    const existing = await tx.tenantMembership.findFirst({
      where: { tenantId, userId: operator.userId },
      select: { id: true },
    });
    if (existing) {
      // Every entry is recorded, not only the first.
      await recordSecurityEvent(tx, {
        tenantId,
        eventType: "PermissionEscalated",
        actorUserId: operator.userId,
        payload: { reason: "operator_entered_client", operator: true, statedReason: why },
      });
      return existing.id;
    }

    const organization = await tx.organization.findFirst({
      where: { tenantId, parentId: null },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (!organization) throw new ForbiddenError("E_FORBIDDEN: client has no root organization");

    const role = await operatorRoleFor(tx, tenantId);

    const created = await tx.tenantMembership.create({
      data: { tenantId, userId: operator.userId, organizationId: organization.id, roleId: role },
      select: { id: true },
    });

    // The client's own audit trail records the visit, per QO-3: a privileged
    // action a client cannot see is one they cannot question.
    await recordSecurityEvent(tx, {
      tenantId,
      eventType: "PermissionEscalated",
      actorUserId: operator.userId,
      payload: { reason: "operator_entered_client", operator: true, statedReason: why },
    });

    return created.id;
  });

  await setActiveMembership(membershipId);
  return membershipId;
}

/**
 * Moves a client through its lifecycle (ADR-034 item 2): onboarding, active,
 * suspended. Operator-only by construction: this is a platform action, not a
 * registered command, so nothing a client's own administrator can grant
 * reaches it. The database trigger on `tenant.status` refuses the write unless
 * this function's transaction-local flag is set. Suspension changes no client
 * data; it stops the client's users resolving to a membership.
 */
export async function setClientStatus(tenantId: string, status: ClientStatus, reason: string): Promise<void> {
  const operator = await requireOperator();
  if (!CLIENT_STATUSES.includes(status)) throw new Error("E_VALIDATION: unknown client status");
  const why = reason.trim();
  if (why.length < 5) throw new Error("E_VALIDATION: give a reason (at least 5 characters)");
  if (why.length > 300) throw new Error("E_VALIDATION: keep the reason under 300 characters");

  await withTenant(tenantId, async (tx) => {
    const [tenant] = await tx.$queryRaw<{ id: string; is_platform: boolean; status: string }[]>`
      SELECT id, is_platform, status FROM tenant WHERE id = ${tenantId}::uuid`;
    if (!tenant) throw new ForbiddenError("E_FORBIDDEN: no such client");
    if (tenant.is_platform) throw new ForbiddenError("E_FORBIDDEN: the platform tenant has no lifecycle");
    if (tenant.status === status) throw new Error(`E_VALIDATION: the client is already ${status}`);

    await tx.$executeRaw`SELECT set_config('verity.client_status_change', 'on', true)`;
    await tx.tenant.update({
      where: { id: tenantId },
      data: { status, statusReason: why, statusChangedAt: new Date() },
    });
    await recordSecurityEvent(tx, {
      tenantId,
      eventType: "ConfigurationChanged",
      actorUserId: operator.userId,
      payload: { reason: "client_status_changed", operator: true, from: tenant.status, to: status, statedReason: why },
    });
  });
}

/**
 * The operator role inside a client tenant, created on first entry.
 *
 * Full authority inside the client (ADR-035, 2026-10-06, superseding the
 * earlier "deliberately narrow" role): every verb on every entity registered on
 * the platform, every entity any role in this client already uses, and the
 * platform entities in `OPERATOR_GRANTS`. How authority is obtained does not
 * change: an operator has nothing in a client until they enter it, entering
 * needs a stated reason in the client's own trail (ADR-034), and every action
 * still passes `enforcePolicy()` as this ordinary membership.
 */
export async function operatorRoleFor(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: string,
): Promise<string> {
  const existing = await tx.role.findFirst({
    where: { tenantId, name: OPERATOR_ROLE_NAME },
    select: { id: true },
  });

  const roleId =
    existing?.id ??
    (
      await tx.role.create({
        data: { tenantId, name: OPERATOR_ROLE_NAME },
        select: { id: true },
      })
    ).id;

  // Reconciled on every entry, not only at creation. A client onboarded before
  // an HQ surface existed would otherwise carry a role missing the grant that
  // surface needs, and the failure would appear as an unexplained E_FORBIDDEN
  // in one client and not another. `skipDuplicates` makes this idempotent
  // rather than merely repeatable.
  const held = await tx.permission.findMany({
    where: { roleId },
    select: { verb: true, entity: true },
  });
  const has = new Set(held.map((p) => `${p.verb}:${p.entity}`));

  const [registered, usedHere] = await Promise.all([
    tx.entityDefinition.findMany({ select: { key: true } }),
    tx.permission.findMany({ distinct: ["entity"], select: { entity: true } }),
  ]);
  const entities = new Set<string>([
    ...registered.map((e) => e.key),
    ...usedHere.map((p) => p.entity),
    ...OPERATOR_GRANTS.map((g) => g.entity),
  ]);
  const desired = [...entities].flatMap((entity) => OPERATOR_VERBS.map((verb) => ({ verb, entity })));
  const missing = desired.filter((g) => !has.has(`${g.verb}:${g.entity}`));
  if (missing.length > 0) {
    await tx.permission.createMany({
      data: missing.map((grant) => ({
        tenantId,
        roleId,
        verb: grant.verb,
        entity: grant.entity,
        scope: "Tenant" as const,
      })),
      skipDuplicates: true,
    });
  }

  return roleId;
}

/**
 * An ActorContext for the operator INSIDE one client.
 *
 * This is ADR-013 answers 3 and 4 in code: the operator selects a client, the
 * selection is re-verified server-side against their platform authority, and
 * only then does an actor exist for that tenant. Everything downstream —
 * `executeCommand`, `executeQuery`, RLS, audit — then behaves exactly as it does
 * for an ordinary user of that client, because it IS an ordinary membership.
 *
 * Deliberately does NOT switch the operator's active membership cookie the way
 * `enterClient` does. Administering a client from HQ and working inside it as a
 * tenant user are different acts, and conflating them would mean every visit to
 * an HQ page silently changed which tenant the operator's other tabs belong to.
 */
export async function operatorActorFor(tenantId: string): Promise<ActorContext> {
  const operator = await requireOperator();

  return withTenant(tenantId, async (tx) => {
    const [tenant] = await tx.$queryRaw<{ id: string; is_platform: boolean }[]>`
      SELECT id, is_platform FROM tenant WHERE id = ${tenantId}::uuid`;
    if (!tenant) throw new ForbiddenError("E_FORBIDDEN: no such client");
    if (tenant.is_platform) {
      throw new ForbiddenError("E_FORBIDDEN: the platform tenant is not administered as a client");
    }

    const existing = await tx.tenantMembership.findFirst({
      where: { tenantId, userId: operator.userId },
      select: { id: true, organizationId: true, roleId: true },
    });

    const roleId = await operatorRoleFor(tx, tenantId);

    if (existing) {
      // An operator membership that lost its role, or never had one, grants
      // nothing — a membership with a null role fails closed by design. Restore
      // it rather than returning an actor who will be refused everywhere.
      if (existing.roleId !== roleId) {
        await tx.tenantMembership.update({ where: { id: existing.id }, data: { roleId } });
      }
      return {
        tenantId,
        userId: operator.userId,
        membershipId: existing.id,
        organizationId: existing.organizationId,
        roleId,
      };
    }

    const organization = await tx.organization.findFirst({
      where: { tenantId, parentId: null },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (!organization) throw new ForbiddenError("E_FORBIDDEN: client has no root organization");

    const created = await tx.tenantMembership.create({
      data: { tenantId, userId: operator.userId, organizationId: organization.id, roleId },
      select: { id: true },
    });

    // QO-3: the client's own trail records that an operator took authority
    // inside it. A privileged action a client cannot see is one they cannot
    // question.
    await recordSecurityEvent(tx, {
      tenantId,
      eventType: "PermissionEscalated",
      actorUserId: operator.userId,
      payload: { reason: "operator_administration", operator: true },
    });

    return {
      tenantId,
      userId: operator.userId,
      membershipId: created.id,
      organizationId: organization.id,
      roleId,
    };
  });
}

export const OPERATOR_ROLE_NAME = "Verity Operator";

/** Every permission verb (Spec PLA-AUT-003). ADR-035: the operator holds all of them. */
export const OPERATOR_VERBS = ["Read", "Create", "Edit", "Delete", "ActionExecute"] as const;

/**
 * What an operator may do inside a client.
 *
 * Read across the administrative entities, write on the ones HQ administers.
 * Not `ActionExecute` on capability entities: operating a client's business is
 * the client's job, and an operator who could close their work orders would be
 * a support incident waiting to happen.
 */
export const OPERATOR_GRANTS = [
  { verb: "Read" as const, entity: "verity.platform.tenant" },
  { verb: "Read" as const, entity: "verity.platform.organization" },
  { verb: "Create" as const, entity: "verity.platform.organization" },
  { verb: "Edit" as const, entity: "verity.platform.organization" },
  { verb: "Read" as const, entity: "verity.platform.membership" },
  { verb: "Create" as const, entity: "verity.platform.membership" },
  { verb: "Edit" as const, entity: "verity.platform.membership" },
  { verb: "Delete" as const, entity: "verity.platform.membership" },
  { verb: "Read" as const, entity: "verity.platform.role" },
  { verb: "Read" as const, entity: "verity.platform.activity" },
  { verb: "Read" as const, entity: "verity.platform.security_event" },
  { verb: "Read" as const, entity: "verity.platform.command_failure" },
  { verb: "Read" as const, entity: "verity.platform.overview" },
  { verb: "Read" as const, entity: "verity.platform.capability" },

  { verb: "Create" as const, entity: "verity.platform.role" },
  { verb: "Edit" as const, entity: "verity.platform.role" },
  // Module enablement and tenant configuration. ActionExecute rather than Edit
  // because turning a capability on is an action with consequences, not a field
  // change — and the verb an operator holds should read like what they are
  // doing (PLA-AUT-003).
  { verb: "ActionExecute" as const, entity: "verity.platform.tenant" },
  { verb: "Edit" as const, entity: "verity.platform.tenant" },
  // Industry Packs and capability pins (HQ audit B1, B2; ADR-021, ADR-022).
  { verb: "Read" as const, entity: "verity.platform.pack" },
  { verb: "ActionExecute" as const, entity: "verity.platform.pack" },
  { verb: "ActionExecute" as const, entity: "verity.platform.capability_upgrade" },
];

/* ------------------------------------------------------------------------- *
 * Industry Packs and capability upgrades for one client (HQ audit B1, B2)
 *
 * Every function goes through `operatorActorFor`, so the operator acts inside
 * the client with an ordinary membership and the pack/upgrade modules enforce
 * their own policy exactly as for anyone else. Nothing here reads across
 * tenants: releases are global platform metadata readable in any tenant scope,
 * and instances are the client's own rows.
 * ------------------------------------------------------------------------- */

export type PackReleaseView = {
  releaseId: string;
  key: string;
  version: string;
  name: string;
  publisher: string;
  importedAt: Date;
  diff: PackPreviewDiff | null;
  previewError: string | null;
  /** What applying this release would be for this client. */
  kind: "Apply" | "Upgrade" | "Reapply";
};

export type PackInstanceView = {
  instanceId: string;
  packKey: string;
  state: string;
  appliedVersion: string | null;
};

export async function clientPacks(tenantId: string): Promise<{ releases: PackReleaseView[]; instances: PackInstanceView[] }> {
  await operatorActorFor(tenantId); // proof of operator authority for this client
  return withTenant(tenantId, async (tx) => {
    const [releases, instances] = await Promise.all([
      tx.packRelease.findMany({ orderBy: [{ key: "asc" }, { importedAt: "desc" }] }),
      tx.packInstance.findMany({ include: { appliedRelease: { select: { version: true } } }, orderBy: { packKey: "asc" } }),
    ]);
    const instanceByKey = new Map(instances.map((i) => [i.packKey, i]));

    const views: PackReleaseView[] = [];
    for (const release of releases) {
      const manifest = release.manifest as { name?: string };
      let diff: PackPreviewDiff | null = null;
      let previewError: string | null = null;
      try {
        diff = (await previewPack(tx, tenantId, release.id)).diff;
      } catch (error) {
        previewError = error instanceof Error ? error.message : "Preview failed";
      }
      const instance = instanceByKey.get(release.key);
      const kind: PackReleaseView["kind"] =
        instance?.state === "Active" && instance.appliedReleaseId === release.id
          ? "Reapply"
          : instance?.state === "Active"
            ? "Upgrade"
            : "Apply";
      views.push({
        releaseId: release.id,
        key: release.key,
        version: release.version,
        name: manifest.name ?? release.key,
        publisher: release.publisher,
        importedAt: release.importedAt,
        diff,
        previewError,
        kind,
      });
    }

    return {
      releases: views,
      instances: instances.map((i) => ({
        instanceId: i.id,
        packKey: i.packKey,
        state: i.state,
        appliedVersion: i.appliedRelease?.version ?? null,
      })),
    };
  });
}

/**
 * Plan then apply in one transaction. The plan recomputes the diff on the
 * server and apply checks the hash of the plan it just made, so what is applied
 * is the diff re-derived here, never one trusted from the browser.
 */
export async function applyPackRelease(tenantId: string, releaseId: string, kind: PackReleaseView["kind"]): Promise<void> {
  const actor = await operatorActorFor(tenantId);
  await withTenant(tenantId, async (tx) => {
    const planned = await planPackOperation(tx, actor, releaseId, kind);
    await applyPlannedPackOperation(tx, actor, planned.operation.id, planned.planHash);
  });
}

export async function rollbackPack(tenantId: string, instanceId: string): Promise<void> {
  const actor = await operatorActorFor(tenantId);
  await withTenant(tenantId, (tx) => rollbackPackOperation(tx, actor, instanceId));
}

export async function removePack(tenantId: string, instanceId: string): Promise<void> {
  const actor = await operatorActorFor(tenantId);
  await withTenant(tenantId, (tx) => removePackInstance(tx, actor, instanceId));
}

/** Moves one capability's pin to the installed version (ADR-021), reversibly. */
export async function upgradeCapability(tenantId: string, capabilityId: string): Promise<string> {
  const actor = await operatorActorFor(tenantId);
  return withTenant(tenantId, async (tx) => {
    const planned = await planCapabilityUpgrade(tx, actor, capabilityId, { reversible: true });
    const applied = await applyCapabilityUpgrade(tx, actor, planned.operationId);
    return applied.pinnedVersion;
  });
}
