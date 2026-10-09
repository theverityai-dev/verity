import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/platform/db";
import { withTenant } from "@/server/platform/tenancy";
import type { ActorContext } from "@/server/platform/command";
import { hashToken, isToken, mintToken } from "./selforder";

/**
 * The only two ways the unauthenticated self-order routes touch the database (ADR-042 items 2-4).
 *
 * Each calls one SECURITY DEFINER function with a HASH and gets back the least that lets the
 * route act; neither takes a tenant id from the request. Row-level security stays in force for
 * everything else. A wrong, expired, closed or disabled token, a disabled outlet and a table
 * that is not seated all produce the same `null`, so the routes cannot be used to tell them apart
 * (the ADR-030 pattern).
 */

/** Opens a visit from a sticker's link token. Returns the new session token, or `null`. */
export async function openGuestSession(linkToken: string): Promise<string | null> {
  if (!isToken(linkToken)) return null;
  const sessionToken = mintToken();
  const rows = await prisma.$queryRaw<Array<{ id: string | null }>>(
    Prisma.sql`SELECT verity.self_order_open_session(${hashToken(linkToken)}, ${hashToken(sessionToken)}) AS id`,
  );
  return rows[0]?.id ? sessionToken : null;
}

export type GuestSession = {
  /** The outlet's provisioned ordering identity (ADR-017): the same shape a browser session produces. */
  actor: ActorContext;
  sessionId: string;
  locationId: string;
  tableId: string | null;
  kind: "table" | "pickup";
};

type ResolvedRow = {
  o_tenant_id: string;
  o_session_id: string;
  o_location_id: string;
  o_table_id: string | null;
  o_kind: string;
  o_ordering_user_id: string;
};

/** The visit a session token belongs to, as the actor to run its commands with; counts as activity. */
export async function resolveGuestSession(token: string): Promise<GuestSession | null> {
  if (!isToken(token)) return null;
  const rows = await prisma.$queryRaw<ResolvedRow[]>(Prisma.sql`SELECT * FROM verity.self_order_resolve(${hashToken(token)})`);
  const row = rows[0];
  if (!row) return null;

  const identity = await withTenant(row.o_tenant_id, async (tx) => {
    // ADR-034: a suspended client's guests stop with its users.
    const tenant = await tx.tenant.findUnique({ where: { id: row.o_tenant_id }, select: { status: true } });
    if (!tenant || tenant.status === "suspended") return null;
    return tx.tenantMembership.findFirst({ where: { userId: row.o_ordering_user_id } });
  });
  if (!identity?.roleId) return null;

  return {
    actor: {
      tenantId: row.o_tenant_id,
      userId: row.o_ordering_user_id,
      membershipId: identity.id,
      organizationId: identity.organizationId,
      roleId: identity.roleId,
    },
    sessionId: row.o_session_id,
    locationId: row.o_location_id,
    tableId: row.o_table_id,
    kind: row.o_kind === "table" ? "table" : "pickup",
  };
}
