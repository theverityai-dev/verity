// Production build gate (Task 129 A2, decision D4).
//
// Vercel deploys every push to main. A commit that carries a migration the production database has not applied went live
// anyway on 2026-10-20 and every read of a whole membership row failed on a missing column. This runs inside
// `npm run build`; on a production build it fails when the database lacks any migration this commit carries, so the previous
// deployment stays live. It never applies anything: migrations stay a deliberate step run as the privileged role.
//
// Only production builds are gated (VERCEL_ENV=production). Preview and local builds pass through untouched.
//
// Emergency bypass: VERITY_SKIP_MIGRATION_GATE=1. It prints a loud warning and exists so a database outage cannot also block
// a rollback deploy. Do not leave it set.

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = new URL("../prisma/migrations/", import.meta.url);

/**
 * @param {string[]} onDisk migration directory names in this commit
 * @param {Iterable<string>} applied migration names the database reports as finished
 * @returns {string[]} the on-disk migrations the database has not applied, in order
 */
export function missingMigrations(onDisk, applied) {
  const have = new Set(applied);
  return [...onDisk].sort().filter((name) => !have.has(name));
}

// Directories only: prisma/migrations also holds migration_lock.toml. (An earlier version stat-ed "<name>/" for every entry, which
// Windows accepts for a file and Linux rejects with ENOTDIR, so the gate worked locally and failed every production build.)
export function migrationsOnDisk(dir = MIGRATIONS_DIR) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

async function main() {
  if (process.env.VERCEL_ENV !== "production") {
    console.log(`[migration-gate] skipped: VERCEL_ENV is "${process.env.VERCEL_ENV ?? ""}", only production builds are gated`);
    return;
  }
  if (process.env.VERITY_SKIP_MIGRATION_GATE === "1") {
    console.warn("[migration-gate] BYPASSED by VERITY_SKIP_MIGRATION_GATE=1: this build may go live before its migrations.");
    return;
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("[migration-gate] DATABASE_URL is not set for this production build, so migrations cannot be checked.");
  }

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  let applied;
  try {
    const rows = await prisma.$queryRaw`SELECT verity.applied_migration_names() AS name`;
    applied = rows.map((row) => row.name);
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n").filter(Boolean).pop() : String(error);
    throw new Error(
      "[migration-gate] could not read applied migrations. If the function verity.applied_migration_names() is missing, " +
        "apply 20261022200000_applied_migrations_gate to production first (npx prisma migrate deploy with DIRECT_URL). " +
        `Cause: ${reason}`,
    );
  } finally {
    await prisma.$disconnect();
  }

  const onDisk = migrationsOnDisk();
  const missing = missingMigrations(onDisk, applied);
  if (missing.length > 0) {
    throw new Error(
      `[migration-gate] production is missing ${missing.length} migration(s) this commit needs; the deploy is refused so the previous ` +
        `deployment stays live. Apply them, then redeploy:\n  ${missing.join("\n  ")}`,
    );
  }
  console.log(`[migration-gate] ok: all ${onDisk.length} migrations in this commit are applied`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
