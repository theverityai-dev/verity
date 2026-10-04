import type { PermissionScope, PermissionVerb } from "@prisma/client";
import {
  ForbiddenError,
  type ResolvedPermission,
  fieldGrantKey,
  hasPermission,
  reachableLocations,
  reachableOrganizations,
  resolvePermissions,
} from "./authorization";
import type { ActorContext } from "./command";
import type { TenantScopedClient } from "./tenancy";

/**
 * The authorization decision point.
 *
 * Authority: taskplans/archive/37_enterprise_rbac_policy.md; Spec PLA-AUT-001→005,
 * MET-ACT-002; ADR-005 (Organization is a nested hierarchy inside a Tenant);
 * PRN-001 (explainable automation).
 *
 * ```text
 * Principal → Organization → Role → Permission → Resource → Scope
 * ```
 *
 * WHAT THIS IS NOT
 * It is not a second authorization engine. Every rule still lives in
 * `authorization.ts` and every check still runs there; this module composes
 * those checks into one entry point and one answer. A decision point that
 * reimplemented the layers would be a second model to keep in sync with the
 * first, and the two would diverge on the day someone fixed a bug in only one.
 *
 * WHY IT EXISTS
 * Before this, `executeCommand` called Layer 1, `executeQuery` called Layers 2
 * and 3, and a server action called whichever its author remembered. Each was
 * correct; none was *the* answer. An AI agent added in Phase 9 would have
 * become a fourth caller with a fourth set of habits, which is how an
 * authorization model rots — not by being wrong, but by being asked in four
 * different ways.
 *
 * A DENIAL IS AN ANSWER
 * `evaluatePolicy` returns rather than throws, so a denial can be logged,
 * explained and asserted on. `enforcePolicy` is the gate and throws, preserving
 * the MET-ACT-002 property that forgetting to branch on a result cannot permit
 * the operation.
 *
 * THE CHANNEL IS RECORDED, NEVER CONSULTED
 * The dangerous reading of "AI, API, UI and human actions share one model" is a
 * system that quietly trusts a service account more than a person. `channel`
 * therefore travels in the decision, for audit, and is read by nothing in the
 * evaluation. `policy-engine.test.ts` asserts both halves: identical verdicts
 * across all four channels, and no branch on `channel` in this file.
 */

/**
 * Who is asking. Metadata for the audit trail (Task 38's `source`), never an
 * input to the decision.
 */
export type PolicyChannel = "human" | "api" | "job" | "agent";

/** The resource a decision is about, when it is about a particular record. */
export type PolicyResource = {
  organizationId?: string | null;
  locationId?: string | null;
};

export type PolicyRequest = {
  verb: PermissionVerb;
  /** Free string, never an enum — a capability adds entities without touching this. */
  entity: string;
  /** Omit for a type-level question ("may they read Work at all?"). */
  resource?: PolicyResource;
  /** Field-level question (Layer 3), e.g. `billingRate`. */
  field?: string;
  channel?: PolicyChannel;
};

/** Which layer produced the verdict. Null when the actor has no role at all. */
export type PolicyLayer = 1 | 2 | 3 | null;

export type PolicyDecision = {
  allowed: boolean;
  code: "ALLOW" | "E_FORBIDDEN";
  layer: PolicyLayer;
  /** Human-readable, safe to log and to show an operator (PRN-001). */
  reason: string;
  /** The grants considered. Empty on a deny-by-default path. */
  grants: ResolvedPermission[];
  channel: PolicyChannel;
  verb: PermissionVerb;
  entity: string;
};

function deny(
  layer: PolicyLayer,
  reason: string,
  request: PolicyRequest,
  grants: ResolvedPermission[] = [],
): PolicyDecision {
  return {
    allowed: false,
    code: "E_FORBIDDEN",
    layer,
    reason,
    grants,
    channel: request.channel ?? "human",
    verb: request.verb,
    entity: request.entity,
  };
}

function allow(
  layer: PolicyLayer,
  reason: string,
  request: PolicyRequest,
  grants: ResolvedPermission[],
): PolicyDecision {
  return {
    allowed: true,
    code: "ALLOW",
    layer,
    reason,
    grants,
    channel: request.channel ?? "human",
    verb: request.verb,
    entity: request.entity,
  };
}

/**
 * SCOPE AXES — recorded here so the next reader does not re-open a closed
 * question.
 *
 * `PermissionScope` is `Global | Tenant | Organization | Location`
 * (PLA-AUT-002). The wider vocabulary an enterprise brings maps onto it:
 *
 *   Business Unit, Department  → `Organization` nodes. ADR-005 makes
 *       Organization a nested hierarchy inside a Tenant, and a business unit
 *       and a department are levels of that hierarchy, not new axes. Enum
 *       values for them would put a customer's org-chart vocabulary into the
 *       platform ontology — the coupling the foundation exists to prevent.
 *   Project, team, resource   → axes, served by a registered `ScopeResolver`.
 *       No platform change is required and none is made here.
 *   Record ("own")            → actor-relative, in neither Bible nor Spec.
 *       CLAUDE.md requires an ADR before it is added. NOT added.
 *   Global                    → defined but never granted;
 *       `verity.resolve_permissions` filters it out, because honouring it means
 *       bypassing the RLS that enforces INV-001. Still open, still needs an ADR.
 */

/**
 * Decides a request. Never throws for a denial.
 *
 * Layers run in order and stop at the first refusal, and the decision records
 * which layer refused — "this role may not touch Work" and "this Work is in
 * another branch" are different operational problems with different fixes.
 */
export async function evaluatePolicy(
  tx: TenantScopedClient,
  actor: ActorContext,
  request: PolicyRequest,
): Promise<PolicyDecision> {
  // Deny-by-default #1: a membership with no role grants nothing. Checked
  // first because everything below would otherwise query on a null role.
  if (!actor.roleId) {
    return deny(null, "the actor's membership carries no role", request);
  }

  const grants = (await resolvePermissions(tx, actor.roleId)).filter(
    (g) => g.entity === request.entity && g.verb === request.verb,
  );

  // Layer 1 (PLA-AUT-003): may this role touch this entity type at all?
  if (grants.length === 0) {
    return deny(
      1,
      `role holds no ${request.verb} grant on ${request.entity}`,
      request,
    );
  }

  // Layer 2 (PLA-AUT-004): is this particular record inside the actor's scope?
  // Skipped for a type-level question, which is what a command's pre-execution
  // check asks and what a navigation entry asks.
  if (request.resource) {
    const decision = await evaluateResourceScope(tx, actor, request, grants);
    if (!decision.allowed) return decision;
  }

  // Layer 3 (PLA-AUT-005): may they see this field?
  if (request.field) {
    const key = fieldGrantKey(request.entity, request.field);
    const restricted = await tx.fieldPermission.findFirst({
      where: { entityKey: request.entity, fieldName: request.field },
    });

    // An unrestricted field needs no grant; only declared-restricted fields do.
    if (restricted && !(await hasPermission(tx, actor.roleId, "Read", key))) {
      return deny(
        3,
        `field ${request.field} of ${request.entity} is restricted and the role holds no Read grant on ${key}`,
        request,
        grants,
      );
    }
  }

  return allow(
    request.field ? 3 : request.resource ? 2 : 1,
    `role holds ${request.verb} on ${request.entity} at scope ${grants
      .map((g) => g.scope)
      .sort()
      .join("|")}`,
    request,
    grants,
  );
}

/**
 * Layer 2 for one record.
 *
 * Mirrors `assertRowInScope` exactly — deliberately, since that function is the
 * tested definition of the rule — but returns a decision instead of throwing so
 * the reason survives. The two must not drift; if the rule changes it changes
 * in `authorization.ts` and this reads the result.
 */
async function evaluateResourceScope(
  tx: TenantScopedClient,
  actor: ActorContext,
  request: PolicyRequest,
  grants: ResolvedPermission[],
): Promise<PolicyDecision> {
  const resource = request.resource!;
  if (grants.some((g) => g.scope === "Tenant")) return allow(2, "tenant-scoped grant", request, grants);
  const { organizationIds, unresolvedScopes } = await reachableOrganizations(
    tx,
    actor,
    request.verb,
    request.entity,
  );

  // A Location-scoped grant admits the record on its own axis (PLA-AUT-004
  // scopes on organization_id *or* location_id), so it is checked first.
  if (resource.locationId) {
    const locations = await reachableLocations(tx, actor, request.verb, request.entity);
    if (locations.includes(resource.locationId)) {
      return allow(2, `record is in a location the role reaches`, request, grants);
    }
  }

  if (!resource.organizationId) {
    // Deny-by-default: an unscoped record must not become universally visible
    // by omission. It is treated as tenant-wide and needs a Tenant grant.
    const tenantWide = grants.some((g) => g.scope === "Tenant");
    return tenantWide
      ? allow(2, "record is unscoped and the role holds a Tenant-scoped grant", request, grants)
      : deny(
          2,
          `record carries no organization and the role holds no Tenant-scoped ${request.verb} grant on ${request.entity}`,
          request,
          grants,
        );
  }

  if (organizationIds.includes(resource.organizationId)) {
    return allow(2, "record is inside the actor's organization subtree", request, grants);
  }

  // Deny-by-default: a grant whose axis nothing can resolve reaches nothing
  // rather than widening. Named separately so an operator can tell a
  // misconfiguration from a legitimate refusal.
  const unresolved = unresolvedScopes.length > 0 ? unresolvedScopes : null;
  return deny(
    2,
    unresolved
      ? `record is outside the actor's scope; ${unresolved.join(", ")}-scoped grants cannot be evaluated (no resolver registered)`
      : `record is in organization ${resource.organizationId}, outside the actor's scope`,
    request,
    grants,
  );
}

/**
 * The gate. Throws `ForbiddenError` when the decision denies.
 *
 * Returns the decision on success so a caller that wants to record *why* it was
 * permitted — Task 38's audit trail — does not have to ask twice.
 */
export async function enforcePolicy(
  tx: TenantScopedClient,
  actor: ActorContext,
  request: PolicyRequest,
): Promise<PolicyDecision> {
  const decision = await evaluatePolicy(tx, actor, request);
  if (!decision.allowed) {
    throw new ForbiddenError(`E_FORBIDDEN: ${decision.reason}`);
  }
  return decision;
}

/** A one-line rendering of a decision, for logs and operator-facing surfaces. */
export function explainDecision(decision: PolicyDecision): string {
  const verdict = decision.allowed ? "ALLOW" : "DENY";
  const layer = decision.layer === null ? "no-role" : `layer ${decision.layer}`;
  return `${verdict} ${decision.verb} ${decision.entity} [${layer}, via ${decision.channel}] — ${decision.reason}`;
}

/**
 * Which verbs this actor holds on an entity.
 *
 * For rendering only: a navigation item, a disabled button, a hidden column.
 * It is advisory by construction — it reads the same grants the gate reads, and
 * every mutation still passes `enforcePolicy` on the server. The UI reflecting
 * authorization is a courtesy; the UI constituting authorization would be a
 * vulnerability, and `policy-engine.test.ts` proves the distinction by showing
 * a command still refuses an actor the UI was told could act.
 */
export async function permittedVerbs(
  tx: TenantScopedClient,
  actor: ActorContext,
  entity: string,
): Promise<PermissionVerb[]> {
  if (!actor.roleId) return [];
  const grants = await resolvePermissions(tx, actor.roleId);
  return [...new Set(grants.filter((g) => g.entity === entity).map((g) => g.verb))].sort();
}

/**
 * The scopes at which the actor holds a verb on an entity.
 *
 * Exposed for diagnostics and for an operator answering "why can this person
 * see that?", which PRN-001 makes a product requirement rather than a
 * debugging convenience.
 */
export async function grantedScopes(
  tx: TenantScopedClient,
  actor: ActorContext,
  verb: PermissionVerb,
  entity: string,
): Promise<PermissionScope[]> {
  if (!actor.roleId) return [];
  const grants = await resolvePermissions(tx, actor.roleId);
  return [
    ...new Set(grants.filter((g) => g.entity === entity && g.verb === verb).map((g) => g.scope)),
  ].sort();
}
