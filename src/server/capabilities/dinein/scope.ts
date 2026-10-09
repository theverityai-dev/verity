import type { PermissionVerb } from "@prisma/client";
import { ForbiddenError, reachableOrganizations } from "@/server/platform/authorization";
import type { ActorContext } from "@/server/platform/command";
import type { TenantScopedClient } from "@/server/platform/tenancy";

/**
 * Outlet-level row scoping for the dinein capability (Colonel Kebabz
 * multi-outlet). Mirrors `trading/scope.ts`'s godown scoping exactly: a
 * dinein record is anchored to a `Location` (an outlet), which belongs to
 * exactly one organization, so the resolution is the same one hop —
 * reachable organizations -> locations in them.
 *
 * Layer 1 (`authorize()`) decides whether the role may touch `DiningTable` /
 * `DiningOrder` / `Bill` at all. This is Layer 2: which outlet's rows.
 * Skipping it is the defect `trading/scope.ts` documents fixing — an actor
 * scoped to Defence Colony must not read or mutate Gurugram's floor by id.
 */

export async function reachableOutletIds(
  tx: TenantScopedClient,
  actor: ActorContext,
  entity: string,
  verb: PermissionVerb = "Read",
): Promise<string[]> {
  const { organizationIds } = await reachableOrganizations(tx, actor, verb, entity);
  if (organizationIds.length === 0) return [];

  const locations = await tx.location.findMany({
    where: { organizationId: { in: organizationIds } },
    select: { id: true },
  });
  return locations.map((location) => location.id);
}

/**
 * The outlet ids a query should read: the requested one, narrowed to scope
 * (empty if outside it), or every outlet the actor can reach when none is
 * requested. Shared by every location-scoped dinein query so "ask for an
 * outlet you cannot reach" behaves identically everywhere: an empty result,
 * not a thrown error, because these are polled dashboards and reports.
 */
export async function scopedLocationIds(
  tx: TenantScopedClient,
  actor: ActorContext,
  entity: string,
  requested: string | undefined,
): Promise<string[]> {
  const reachable = await reachableOutletIds(tx, actor, entity, "Read");
  return requested ? reachable.filter((id) => id === requested) : reachable;
}

export async function outletFilter(
  tx: TenantScopedClient,
  actor: ActorContext,
  entity: string,
  verb: PermissionVerb = "Read",
): Promise<{ locationId: { in: string[] } }> {
  return { locationId: { in: await reachableOutletIds(tx, actor, entity, verb) } };
}

export async function assertOutletInScope(
  tx: TenantScopedClient,
  actor: ActorContext,
  entity: string,
  verb: PermissionVerb,
  locationId: string,
): Promise<void> {
  const reachable = await reachableOutletIds(tx, actor, entity, verb);
  if (!reachable.includes(locationId)) {
    throw new ForbiddenError(
      `E_FORBIDDEN: outlet ${locationId} is outside this actor's scope for ${verb} ${entity}`,
    );
  }
}
