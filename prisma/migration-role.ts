import type { PrismaClient } from "@prisma/client";

/**
 * Runs `fn` in one transaction on the migration-role client with `verity.tenant_id` set.
 *
 * This is NOT tenant isolation. The client passed here connects through `DIRECT_URL` as
 * `postgres`, which has BYPASSRLS, so the GUC filters nothing: every query sees every tenant.
 * It exists for seeds, which must create a tenant, its roles and its first membership before
 * any RLS-scoped connection could see them, and which set the GUC so defaults and triggers that
 * read it still get a value. Scope every read inside `fn` by explicit ids.
 *
 * Application code uses `withTenant()` from `src/server/platform/tenancy.ts`, which refuses a
 * bypassing role. Never copy this helper into `src/`.
 */
export async function asMigrationRoleInTenant<T>(
  admin: PrismaClient,
  tenantId: string,
  fn: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  return admin.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('verity.tenant_id', ${tenantId}, true)`;
    return fn(tx as PrismaClient);
  });
}
