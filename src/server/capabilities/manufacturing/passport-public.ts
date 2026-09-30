import { Prisma } from "@prisma/client";
import { prisma } from "@/server/platform/db";
import { hashPassportToken, isPassportToken, passportSnapshotSchema, type PassportSnapshot } from "./passport";

/**
 * The ONLY read the unauthenticated passport page performs (ADR-030 constraint 4).
 *
 * It calls one SECURITY DEFINER function with the token's hash and gets back the
 * frozen snapshot of an active passport, or nothing. There is no tenant context
 * and no other table is reachable from here: row-level security stays fully in
 * force everywhere else. A malformed, unknown, revoked or expired token all
 * produce the same `null`, so the page cannot be used to tell them apart.
 */
export async function loadPassport(token: string): Promise<PassportSnapshot | null> {
  if (!isPassportToken(token)) return null;
  const rows = await prisma.$queryRaw<Array<{ snapshot: unknown }>>(
    Prisma.sql`SELECT verity.passport_lookup(${hashPassportToken(token)}) AS snapshot`,
  );
  const parsed = passportSnapshotSchema.safeParse(rows[0]?.snapshot);
  return parsed.success ? parsed.data : null;
}
