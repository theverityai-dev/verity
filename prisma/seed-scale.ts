/**
 * Generates a synthetic volume of "visit" history for scale, index and load work.
 *
 * Authority: taskplans/123_enterprise_readiness_evidence_program.md, Phase 1.
 *
 * WHAT IT WRITES
 * Per scale tenant, N `activity` rows (entity_key `scale.visit`, a status
 * change per visit) and N x EVIDENCE_PER_VISIT `evidence` rows (kind Photo,
 * attached to the visit). Those are the two platform tables a field-visit
 * workload grows fastest, and neither is tied to a capability.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * It writes by bulk SQL, not through `executeCommand`. So these rows have no
 * domain events, no security audit rows, no state transitions. That is the
 * only way to reach millions of rows in minutes, and it means these rows prove
 * READ and INDEX behaviour only. Write-path numbers must come from the load
 * harness driving the real command path (scripts/load). Never quote a write
 * figure measured from this seed.
 *
 * WHY THROUGH verity_app, ACROSS TENANTS
 * Every statement runs inside `withTenant`, as the application's own
 * NOSUPERUSER NOBYPASSRLS role, so the RLS policies are executed on every
 * insert and every later read. Rows are spread over TENANTS tenants because
 * per-tenant filtering under RLS is part of the cost being measured.
 *
 * SAFETY
 * Refuses to run against a Supabase host, and refuses unless
 * SCALE_CONFIRM_DISPOSABLE=1. The shared project is not a load-test target
 * (verity-shared-db-hygiene); this seed is also not removable row by row, so
 * use a throwaway database.
 *
 * DETERMINISTIC AND IDEMPOTENT. Every id is md5(seed-string)::uuid and every
 * insert is ON CONFLICT DO NOTHING, so a re-run neither duplicates nor drifts.
 * Timestamps are derived from a fixed anchor, not now().
 *
 * NO DEFAULT WORKLOAD. See scripts/scale/workload.ts.
 *
 * Run:
 *   SCALE_CONFIRM_DISPOSABLE=1 TENANTS=3 EVIDENCE_PER_VISIT=4 SCALE_VISITS=100000 \
 *     npm run seed:scale
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { withTenant } from "../src/server/platform/tenancy";
import { readWorkload } from "../scripts/scale/workload";

const ANCHOR = "2026-10-01T00:00:00Z";
const CHUNK = 50_000;

function tenantIdFor(n: number): string {
  const h = createHash("md5").update(`verity-scale-tenant-${n}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function refuseUnsafeTarget(): void {
  const url = process.env.DATABASE_URL ?? "";
  if (/supabase\.(com|co)/i.test(url)) {
    throw new Error(
      "DATABASE_URL points at Supabase. Scale seeding is for a disposable database only (verity-shared-db-hygiene).",
    );
  }
  if (process.env.SCALE_CONFIRM_DISPOSABLE !== "1") {
    throw new Error(
      "Set SCALE_CONFIRM_DISPOSABLE=1 to confirm DATABASE_URL is a throwaway database. These rows cannot be removed selectively.",
    );
  }
}

async function ensureTenant(tenantId: string, n: number): Promise<void> {
  // The tenant policy's WITH CHECK requires the row's own id to equal the
  // current scope, so a tenant is created inside its own scope
  // (see operator.ts createClient, seed-audit-tenant-b.ts).
  await withTenant(tenantId, async (tx) => {
    await tx.$executeRaw`
      INSERT INTO tenant (id, name, is_platform, created_at, updated_at)
      VALUES (${tenantId}::uuid, ${`Scale tenant ${n}`}, false, now(), now())
      ON CONFLICT (id) DO NOTHING`;
  });
}

async function seedChunk(
  tenantId: string,
  from: number,
  to: number,
  evidencePerVisit: number,
  retentionDays: number,
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    await tx.$executeRaw`
      INSERT INTO activity
        (id, tenant_id, entity_key, entity_id, field_changed, old_value, new_value, source, occurred_at)
      SELECT
        md5(${tenantId}::text || '-a-' || g::text)::uuid,
        ${tenantId}::uuid,
        'scale.visit',
        md5(${tenantId}::text || '-v-' || g::text)::uuid,
        'status', 'Assigned', 'Completed', 'job',
        ${ANCHOR}::timestamptz
          - ((g % ${retentionDays}::int) * interval '1 day')
          - (((g * 37) % 86400) * interval '1 second')
      FROM generate_series(${from}::bigint, ${to}::bigint) AS g
      ON CONFLICT DO NOTHING`;

    if (evidencePerVisit > 0) {
      await tx.$executeRaw`
        INSERT INTO evidence
          (id, tenant_id, entity_key, entity_id, kind, uri, captured_at, payload, recorded_at)
        SELECT
          md5(${tenantId}::text || '-e-' || g::text || '-' || e::text)::uuid,
          ${tenantId}::uuid,
          'scale.visit',
          md5(${tenantId}::text || '-v-' || g::text)::uuid,
          'Photo'::"EvidenceKind",
          -- evidence_artefact_present requires a file_id or uri for a Photo. The
          -- uri is a placeholder: no binary object exists or is generated here.
          'synthetic://scale/' || g::text || '/' || e::text,
          ${ANCHOR}::timestamp
            - ((g % ${retentionDays}::int) * interval '1 day')
            - (((g * 37) % 86400) * interval '1 second'),
          '{}'::jsonb,
          ${ANCHOR}::timestamp
        FROM generate_series(${from}::bigint, ${to}::bigint) AS g,
             generate_series(1, ${evidencePerVisit}::int) AS e
        ON CONFLICT DO NOTHING`;
    }
  });
}

async function report(tenantIds: string[]) {
  const perTenant: Record<
    string,
    { visits: number; activityRows: number; evidenceMetadataRows: number }
  > = {};
  for (const id of tenantIds) {
    perTenant[id] = await withTenant(id, async (tx) => {
      const a = await tx.$queryRaw<{ rows: bigint; visits: bigint }[]>`
        SELECT count(*) AS rows, count(DISTINCT entity_id) AS visits
        FROM activity WHERE entity_key = 'scale.visit'`;
      const e = await tx.$queryRaw<{ c: bigint }[]>`
        SELECT count(*) AS c FROM evidence WHERE entity_key = 'scale.visit'`;
      return {
        visits: Number(a[0].visits),
        activityRows: Number(a[0].rows),
        evidenceMetadataRows: Number(e[0].c),
      };
    });
  }
  // Whole-table sizes (every tenant, every entity_key), split into heap and
  // index bytes. Object-storage bytes are not here: no binary evidence object
  // is generated by this seed.
  const sizes = await withTenant(tenantIds[0], async (tx) =>
    tx.$queryRaw<{ rel: string; tableBytes: bigint; indexBytes: bigint }[]>`
      SELECT 'activity' AS rel,
             pg_table_size('activity') AS "tableBytes",
             pg_indexes_size('activity') AS "indexBytes"
      UNION ALL
      SELECT 'evidence', pg_table_size('evidence'), pg_indexes_size('evidence')`,
  );
  return {
    perTenant,
    wholeTableBytes: Object.fromEntries(
      sizes.map((s) => [s.rel, { table: Number(s.tableBytes), index: Number(s.indexBytes) }]),
    ),
    objectStorageBytes: 0,
  };
}

async function main() {
  refuseUnsafeTarget();
  const workload = readWorkload();
  const startedAt = Date.now();

  const tenantIds = Array.from({ length: workload.tenants }, (_, i) => tenantIdFor(i + 1));
  const base = Math.floor(workload.visits / workload.tenants);
  const remainder = workload.visits % workload.tenants;

  for (let t = 0; t < tenantIds.length; t++) {
    const tenantId = tenantIds[t];
    const count = base + (t < remainder ? 1 : 0);
    await ensureTenant(tenantId, t + 1);
    for (let from = 1; from <= count; from += CHUNK) {
      const to = Math.min(from + CHUNK - 1, count);
      await seedChunk(tenantId, from, to, workload.evidencePerVisit, workload.retentionDays);
    }
    console.log(`tenant ${t + 1}/${tenantIds.length}: ${count} visits`);
  }

  const summary = {
    kind: "verity-scale-seed",
    anchor: ANCHOR,
    workload,
    seconds: Math.round((Date.now() - startedAt) / 1000),
    ...(await report(tenantIds)),
    note: "Bulk SQL: no domain events, audit rows or state transitions. Valid for read/index measurement only.",
  };

  const dir = path.resolve(__dirname, "../docs/enterprise-readiness/runs");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `seed-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`report: ${file}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
