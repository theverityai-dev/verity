import { describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * Effective runtime-role privileges.
 *
 * A migration that says "GRANT SELECT" proves what someone intended, not what
 * the runtime role can do: `ALTER DEFAULT PRIVILEGES` (20260826000000) gives
 * the runtime role full DML on every table created afterwards, and a later
 * GRANT cannot subtract from that. `deployment_state` was meant to be
 * read-only for the runtime and was not. These checks read the live catalogue
 * and attempt the writes, so they describe the database as it is.
 *
 * To make a table read-only for the runtime, REVOKE the write privileges in a
 * migration and list the table here with its reason.
 */

/** Tables the runtime role may read and must not write. */
const RUNTIME_READ_ONLY: Record<string, string> = {
  deployment_state:
    "restore-quarantine flag; written only by deploy/scripts/restore.sh as the privileged role (readiness.ts only reads it)",
};

/** Tables the runtime role must not touch at all (function-only or migration-only access). */
const RUNTIME_NO_ACCESS: Record<string, string> = {
  _prisma_migrations: "migration bookkeeping, migration role only (20260907000000)",
  request_quota: "reached only through verity.consume_request_quota (20260908000000)",
};

/**
 * Tables with no `tenant_id` that the runtime role may write, with the reason
 * (Task 124, decided 2026-10-09: discovery first). Tenant RLS is the boundary for
 * every other table; these have no tenant boundary, so each one is named here and
 * a NEW one fails the discovery test until someone chooses its access on purpose.
 * The six catalogue tables are held read-only only by the absence of a write
 * policy; revoking their writes outright is the next step once a run shows no
 * runtime path writes them.
 */
const RUNTIME_GLOBAL_WRITABLE: Record<string, string> = {
  oidc_login_transaction: "login state, created and consumed by the runtime",
  scheduler_lease: "the scheduler's lease, taken and released by the runtime",
  scheduler_run: "scheduler run history, appended by the runtime",
  capability_definition: "catalogue; written by migrations, no runtime write policy",
  entity_definition: "catalogue; written by migrations, no runtime write policy",
  field_permission: "catalogue; written by migrations, no runtime write policy",
  pack_release: "catalogue; written by migrations, no runtime write policy",
  state_definition: "catalogue; written by migrations, no runtime write policy",
  transition_definition: "catalogue; written by migrations, no runtime write policy",
  tenant: "identity root; written under scoped policies by provisioning",
  party: "identity; written under scoped policies by provisioning",
  user: "identity; written under scoped policies by provisioning",
};

const hasDatabase = Boolean(process.env.DATABASE_URL && process.env.DIRECT_URL);
const describeDb = hasDatabase ? describe : describe.skip;

class Rollback extends Error {}

describeDb("conformance: effective runtime privileges", () => {
  async function runtimeRole(app: PrismaClient): Promise<string> {
    const [row] = await app.$queryRaw<{ role: string }[]>`SELECT current_user::text AS role`;
    return row!.role;
  }

  async function privilege(admin: PrismaClient, role: string, table: string, priv: string): Promise<boolean> {
    const [row] = await admin.$queryRawUnsafe<{ ok: boolean }[]>(
      `SELECT has_table_privilege($1, $2, $3) AS ok`,
      role,
      `public.${table}`,
      priv,
    );
    return row!.ok;
  }

  /** Runs a statement as the runtime role and always rolls it back, so a gap cannot change data. */
  async function attempt(app: PrismaClient, sql: string): Promise<void> {
    await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(sql);
      throw new Rollback("rolled back");
    });
  }

  it("lets the runtime role read, and not write, the read-only tables", async () => {
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    const app = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    try {
      const role = await runtimeRole(app);
      for (const table of Object.keys(RUNTIME_READ_ONLY)) {
        expect(await privilege(admin, role, table, "SELECT"), `${role} SELECT ${table}`).toBe(true);
        for (const priv of ["INSERT", "UPDATE", "DELETE"]) {
          expect(await privilege(admin, role, table, priv), `${role} ${priv} ${table}`).toBe(false);
        }
      }
    } finally {
      await admin.$disconnect();
      await app.$disconnect();
    }
  });

  it("refuses a real write to a read-only table, and still allows the read", async () => {
    const app = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    try {
      for (const table of Object.keys(RUNTIME_READ_ONLY)) {
        await expect(app.$queryRawUnsafe(`SELECT 1 FROM public.${table} LIMIT 1`)).resolves.toBeDefined();
      }
      // Each write is attempted inside a transaction that is always rolled back,
      // so if a gap exists the test fails without having changed anything.
      await expect(
        attempt(app, `INSERT INTO public.deployment_state (key, status) VALUES ('privilege-probe', 'x')`),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        attempt(app, `UPDATE public.deployment_state SET status = 'quarantined' WHERE key = 'restore'`),
      ).rejects.toThrow(/permission denied/i);
      await expect(attempt(app, `DELETE FROM public.deployment_state WHERE key = 'restore'`)).rejects.toThrow(
        /permission denied/i,
      );
    } finally {
      await app.$disconnect();
    }
  });

  it("keeps the privileged operational role able to read and write the read-only tables", async () => {
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      // The statement shape restore.sh uses, as a no-op so the test leaves the row as it found it.
      const changed = await admin.$executeRawUnsafe(
        `UPDATE public.deployment_state SET status = status WHERE key = 'restore'`,
      );
      expect(changed).toBe(1);
      const rows = await admin.$queryRawUnsafe<{ status: string }[]>(
        `SELECT status FROM public.deployment_state WHERE key = 'restore'`,
      );
      expect(rows).toHaveLength(1);
    } finally {
      await admin.$disconnect();
    }
  });

  it("accounts for every table that has no tenant_id (Task 124 discovery)", async () => {
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      const rows = await admin.$queryRawUnsafe<{ relname: string }[]>(
        `SELECT c.relname
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
            AND NOT EXISTS (
              SELECT 1 FROM information_schema.columns k
               WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'tenant_id')
          ORDER BY 1`,
      );
      const actual = rows.map((r) => r.relname);
      const declared = new Set([
        ...Object.keys(RUNTIME_READ_ONLY),
        ...Object.keys(RUNTIME_NO_ACCESS),
        ...Object.keys(RUNTIME_GLOBAL_WRITABLE),
      ]);
      // A new global table must be listed in one of the three maps with its intended access.
      expect(actual.filter((t) => !declared.has(t)), "global tables with no declared runtime access").toEqual([]);
      // And a listed table that no longer exists is a stale entry to remove.
      expect([...declared].filter((t) => !actual.includes(t)), "declared tables that do not exist").toEqual([]);
    } finally {
      await admin.$disconnect();
    }
  });

  it("gives the runtime role no access to the no-access tables", async () => {
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    const app = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    try {
      const role = await runtimeRole(app);
      for (const table of Object.keys(RUNTIME_NO_ACCESS)) {
        for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
          expect(await privilege(admin, role, table, priv), `${role} ${priv} ${table}`).toBe(false);
        }
      }
    } finally {
      await admin.$disconnect();
      await app.$disconnect();
    }
  });
});
