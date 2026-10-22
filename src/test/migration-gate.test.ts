import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/platform/db";
import { migrationsOnDisk, missingMigrations } from "../../scripts/assert-migrations-applied.mjs";

/**
 * Task 129 A2: a production build must not go live before its migrations.
 *
 * The pure half proves the comparison. The database half proves the function the build asks, through the runtime role:
 * it reports only finished, not rolled-back migrations; PUBLIC cannot execute it; and the runtime role still cannot read
 * public._prisma_migrations directly, so exposing the names widened nothing else.
 */
describe("missingMigrations", () => {
  it("is empty when every migration on disk is applied", () => {
    expect(missingMigrations(["a", "b"], ["b", "a", "c"])).toEqual([]);
  });

  it("names exactly what the database lacks, in order", () => {
    expect(missingMigrations(["20261022_c", "20261001_a", "20261010_b"], ["20261001_a"])).toEqual(["20261010_b", "20261022_c"]);
  });

  it("treats an empty database as missing everything", () => {
    expect(missingMigrations(["a", "b"], [])).toEqual(["a", "b"]);
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL && process.env.DIRECT_URL);
const describeDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  const message = "migration-gate.test.ts cannot run its database half: DATABASE_URL or DIRECT_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

describeDb("verity.applied_migration_names()", () => {
  const admin = hasDatabase ? new PrismaClient({ datasourceUrl: process.env.DIRECT_URL }) : null;
  const planted: string[] = [];

  afterAll(async () => {
    if (admin) {
      for (const name of planted) await admin.$executeRaw`DELETE FROM public._prisma_migrations WHERE migration_name = ${name}`;
      await admin.$disconnect();
    }
    await prisma.$disconnect();
  });

  const appliedThroughRuntime = async () => {
    const rows = await prisma.$queryRaw<Array<{ name: string }>>`SELECT verity.applied_migration_names() AS name`;
    return rows.map((row) => row.name);
  };

  it("lists every migration in this checkout on a fully migrated database", async () => {
    expect(missingMigrations(migrationsOnDisk(), await appliedThroughRuntime())).toEqual([]);
  });

  it("omits migrations that did not finish or were rolled back", async () => {
    const unfinished = `zz_gate_unfinished_${randomUUID().slice(0, 8)}`;
    const rolledBack = `zz_gate_rolled_back_${randomUUID().slice(0, 8)}`;
    const finished = `zz_gate_finished_${randomUUID().slice(0, 8)}`;
    planted.push(unfinished, rolledBack, finished);
    await admin!.$executeRaw`
      INSERT INTO public._prisma_migrations (id, checksum, migration_name, started_at, finished_at, rolled_back_at, applied_steps_count)
      VALUES (${randomUUID()}, 'x', ${unfinished}, now(), NULL, NULL, 0),
             (${randomUUID()}, 'x', ${rolledBack}, now(), now(), now(), 1),
             (${randomUUID()}, 'x', ${finished}, now(), now(), NULL, 1)`;
    const names = await appliedThroughRuntime();
    expect(names).toContain(finished);
    expect(names).not.toContain(unfinished);
    expect(names).not.toContain(rolledBack);
  });

  it("is not executable by PUBLIC, only by the runtime role", async () => {
    const [row] = await admin!.$queryRaw<Array<{ public_can: boolean; runtime_can: boolean }>>`
      SELECT has_function_privilege('public', 'verity.applied_migration_names()', 'EXECUTE') AS public_can,
             has_function_privilege('verity_app', 'verity.applied_migration_names()', 'EXECUTE') AS runtime_can`;
    expect(row).toEqual({ public_can: false, runtime_can: true });
  });

  it("does not widen the runtime role: the migrations table itself stays unreadable", async () => {
    await expect(prisma.$queryRaw`SELECT migration_name FROM public._prisma_migrations LIMIT 1`).rejects.toThrow();
  });

  it("lets the build script pass on a fully migrated production-shaped database", () => {
    const output = execFileSync(process.execPath, ["scripts/assert-migrations-applied.mjs"], {
      env: { ...process.env, VERCEL_ENV: "production" },
      encoding: "utf8",
    });
    expect(output).toContain("[migration-gate] ok");
  });

  it("makes the build script refuse when the database lacks a migration", async () => {
    const victim = (await admin!.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM public._prisma_migrations WHERE migration_name NOT LIKE 'zz_gate_%' ORDER BY migration_name DESC LIMIT 1`)[0]!
      .migration_name;
    await admin!.$executeRaw`UPDATE public._prisma_migrations SET rolled_back_at = now() WHERE migration_name = ${victim}`;
    try {
      let failure = "";
      try {
        execFileSync(process.execPath, ["scripts/assert-migrations-applied.mjs"], {
          env: { ...process.env, VERCEL_ENV: "production" },
          encoding: "utf8",
          stdio: "pipe",
        });
      } catch (error) {
        failure = String((error as { stderr?: string }).stderr);
      }
      expect(failure).toContain("is missing 1 migration");
      expect(failure).toContain(victim);
    } finally {
      await admin!.$executeRaw`UPDATE public._prisma_migrations SET rolled_back_at = NULL WHERE migration_name = ${victim}`;
    }
  });

  it("skips outside production builds", () => {
    const output = execFileSync(process.execPath, ["scripts/assert-migrations-applied.mjs"], {
      env: { ...process.env, VERCEL_ENV: "preview", DATABASE_URL: "" },
      encoding: "utf8",
    });
    expect(output).toContain("skipped");
  });
});
