import "server-only";
import { prisma } from "./db";
import { runtimeConfig } from "./config";
import { assertRlsEnforceable } from "./tenancy";
import { discoverProviderMetadata } from "./oidc";
import { probeS3Storage } from "@/server/storage/s3";

export type ReadinessCheck = { status: "ok" | "skipped" | "error"; code?: string };

const PROBE_TIMEOUT_MS = 3_000;
// The frequent cadence runs from a GitHub Actions schedule on the Hobby plan
// (`.github/workflows/scheduled-work.yml`): nominally every 5 minutes, but
// GitHub delays scheduled runs under load. A 3-minute window flapped to
// "stale" between healthy ticks; 15 minutes tolerates two missed ticks and
// still catches a scheduler that has genuinely stopped.
const SCHEDULER_FRESH_MS = 15 * 60_000;

async function bounded<T>(label: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${label} probe timed out`)), PROBE_TIMEOUT_MS);
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function probeDatabase(): Promise<void> {
  await bounded("database", async () => {
    await prisma.$queryRaw`SELECT 1`;
  });
}

export async function probeSchema(): Promise<void> {
  const [row] = await prisma.$queryRaw<Array<{ present: boolean; incompatible: bigint }>>`
    SELECT to_regclass('public.scheduler_run') IS NOT NULL
       AND to_regclass('public.deployment_state') IS NOT NULL AS present,
       verity.incompatible_capability_activation_count() AS incompatible
  `;
  if (!row?.present) throw new Error("required schema revision is not deployed");
  if (Number(row.incompatible) !== 0) throw new Error("one or more capability pins are incompatible");
}

export async function probeRls(): Promise<void> {
  await assertRlsEnforceable();
}

export async function probeIdentity(): Promise<ReadinessCheck> {
  if (runtimeConfig.auth.provider === "oidc") {
    await bounded("identity", (signal) => discoverProviderMetadata(runtimeConfig.auth.oidc!.issuer, fetch, signal));
    return { status: "ok" };
  }

  const url = runtimeConfig.auth.supabaseUrl;
  const key = runtimeConfig.auth.supabaseAnonKey;
  if (!url || !key) throw new Error("Supabase identity configuration is incomplete");
  await bounded("identity", async (signal) => {
    const response = await fetch(`${url.replace(/\/$/, "")}/auth/v1/settings`, {
      headers: { apikey: key },
      signal,
    });
    if (!response.ok) throw new Error(`identity provider returned ${response.status}`);
  });
  return { status: "ok" };
}

export async function probeStorage(): Promise<ReadinessCheck> {
  const storage = runtimeConfig.storage;
  if (storage.driver === "s3") {
    if (!storage.s3) return { status: "skipped", code: "storage_not_configured" };
    await bounded("storage", (signal) => probeS3Storage(storage.s3!, signal));
    return { status: "ok" };
  }

  const { supabaseUrl, serviceRoleKey, bucket } = storage;
  if (!supabaseUrl || !serviceRoleKey || !bucket) {
    return { status: "skipped", code: "storage_not_configured" };
  }
  await bounded("storage", async (signal) => {
    const response = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/storage/v1/bucket/${encodeURIComponent(bucket)}`,
      { headers: { authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey }, signal },
    );
    if (!response.ok) throw new Error(`storage provider returned ${response.status}`);
  });
  return { status: "ok" };
}

export async function probeScheduler(): Promise<void> {
  const latest = await prisma.schedulerRun.findFirst({
    where: { cadence: "frequent", status: "Succeeded" },
    orderBy: { finishedAt: "desc" },
    select: { finishedAt: true },
  });
  if (!latest?.finishedAt) throw new Error("scheduler has no successful frequent run");
  if (Date.now() - latest.finishedAt.getTime() > SCHEDULER_FRESH_MS) {
    throw new Error("scheduler frequent cadence is stale");
  }
}

export async function probeRestoreState(): Promise<void> {
  const state = await prisma.deploymentState.findUnique({
    where: { key: "restore" },
    select: { status: true },
  });
  if (!state || state.status !== "normal") throw new Error("deployment is in restore quarantine");
}

export function probeRuntimePrivileges(): void {
  if (runtimeConfig.database.directUrl) {
    throw new Error("privileged migration URL is present in the web runtime");
  }
  if (!runtimeConfig.auth.jwtSecret || runtimeConfig.auth.jwtSecret.length < 32) {
    throw new Error("session signing secret is too short");
  }
}
