import type { PermissionVerb } from "@prisma/client";
import {
  ForbiddenError,
  reachableOrganizations,
} from "@/server/platform/authorization";
import type { ActorContext } from "@/server/platform/command";
import type { TenantScopedClient } from "@/server/platform/tenancy";

/**
 * Godown-level row scoping for the plywood capability.
 *
 * Authority: taskplans/archive/45_plywood_workflow_program.md §6 and §10;
 * PLYWOOD_TARGET_WORKFLOW_GAP_AUDIT.md **P0-01**, the audit's first finding;
 * Spec PLA-AUT-004, PLA-ORG-002, PLA-ORG-003.
 *
 * THE DEFECT THIS CLOSES
 * `query.ts` has always exposed `ctx.scope()` and `authorization.ts` has always
 * had `assertRowInScope`. No plywood handler called either. So a role limited
 * to the Noida godown could read tenant-wide stock, orders, invoices and
 * totals, and — holding the entity action — could mutate a record in Okhla
 * given only its id. Layer 1 was enforced and Layer 2 was not, which is the
 * worst combination: it looks authorized.
 *
 * WHY A GODOWN AND NOT AN ORGANIZATION
 * The platform scopes rows by organization (PLA-AUT-004). A plywood record is
 * anchored to a **godown**, which is a `Location`, which belongs to exactly one
 * organization. So the resolution is one hop: reachable organizations →
 * locations in them. A warehouse role is granted at `Organization` scope on the
 * node its godown hangs from, and PLA-ORG-002's downward visibility does the
 * rest.
 *
 * A TENANT-SCOPED GRANT IS NOT A SPECIAL CASE
 * `reachableOrganizations` already returns every organization in the tenant for
 * a `Tenant`-scoped grant, so an owner's reachable godown set is simply "all of
 * them". There is no `null means everything` branch here, because that branch
 * is where a scoping bug hides — the code that runs for the restricted user
 * must be the same code that runs for the owner.
 */

/**
 * The godowns this actor may see for `verb` on `entity`.
 *
 * Empty means **nothing**, and callers must treat it that way. A role that
 * reaches no godown reads no stock; it does not read all stock.
 */
export async function reachableGodownIds(
  tx: TenantScopedClient,
  actor: ActorContext,
  entity: string,
  verb: PermissionVerb = "Read",
): Promise<string[]> {
  const { organizationIds } = await reachableOrganizations(
    tx,
    actor,
    verb,
    entity,
  );
  if (organizationIds.length === 0) return [];

  const locations = await tx.location.findMany({
    where: { organizationId: { in: organizationIds } },
    select: { id: true },
  });
  return locations.map((location) => location.id);
}

/**
 * A Prisma filter restricting a query to the actor's godowns.
 *
 * Applied *in addition to* RLS, never instead of it: RLS stops another
 * tenant's rows, this stops rows inside the tenant that belong to a godown
 * this actor has no business seeing.
 */
export async function godownFilter(
  tx: TenantScopedClient,
  actor: ActorContext,
  entity: string,
  verb: PermissionVerb = "Read",
): Promise<{ locationId: { in: string[] } }> {
  return {
    locationId: { in: await reachableGodownIds(tx, actor, entity, verb) },
  };
}

/**
 * Refuses an action against a godown outside the actor's scope.
 *
 * Throws rather than returning false, for the reason `authorize()` does: a
 * caller who forgets to branch on a boolean has silently permitted the action,
 * and this is the check standing between a warehouse operator and another
 * branch's stock.
 */
export async function assertGodownInScope(
  tx: TenantScopedClient,
  actor: ActorContext,
  entity: string,
  verb: PermissionVerb,
  locationId: string,
): Promise<void> {
  const reachable = await reachableGodownIds(tx, actor, entity, verb);
  if (!reachable.includes(locationId)) {
    // The message names the godown, not the permission: an operator reading a
    // support ticket needs to know which site was refused.
    throw new ForbiddenError(
      `E_FORBIDDEN: godown ${locationId} is outside this actor's scope for ${verb} ${entity}`,
    );
  }
}
