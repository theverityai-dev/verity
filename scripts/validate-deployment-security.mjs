import { readFile } from "node:fs/promises";
import { parse } from "yaml";

const root = new URL("../", import.meta.url);
const [composeSource, storageComposeSource, dockerfile, nextConfig, packageSource, restoreScript, backupScript] = await Promise.all([
  readFile(new URL("deploy/compose/docker-compose.yml", root), "utf8"),
  readFile(new URL("deploy/compose/docker-compose.bundled-storage.yml", root), "utf8"),
  readFile(new URL("Dockerfile", root), "utf8"),
  readFile(new URL("next.config.ts", root), "utf8"),
  readFile(new URL("package.json", root), "utf8"),
  readFile(new URL("deploy/scripts/restore.sh", root), "utf8"),
  readFile(new URL("deploy/scripts/backup.sh", root), "utf8"),
]);

const compose = parse(composeSource);
const webEnvironment = compose?.services?.web?.environment ?? {};
const toolsEnvironment = compose?.services?.tools?.environment ?? {};
const schedulerEnvironment = compose?.services?.scheduler?.environment ?? {};
const packageJson = JSON.parse(packageSource);
const failures = [];

if (Object.hasOwn(webEnvironment, "DIRECT_URL")) {
  failures.push("web service must not receive DIRECT_URL");
}
if (!Object.hasOwn(toolsEnvironment, "DIRECT_URL")) {
  failures.push("tools service must retain the migration-only DIRECT_URL");
}
if (!String(webEnvironment.DATABASE_URL ?? "").includes("verity_app")) {
  failures.push("web DATABASE_URL must use the non-bypass runtime role");
}
if (!compose?.services?.scheduler) {
  failures.push("on-prem compose must package the scheduler service");
}
if (!Object.hasOwn(schedulerEnvironment, "CRON_SECRET")) {
  failures.push("scheduler must receive its dedicated trigger secret");
}
for (const forbidden of ["DATABASE_URL", "DIRECT_URL", "VERITY_SESSION_SECRET", "SUPABASE_SERVICE_ROLE_KEY", "VERITY_S3_SECRET_ACCESS_KEY"]) {
  if (Object.hasOwn(schedulerEnvironment, forbidden)) {
    failures.push(`scheduler must not receive ${forbidden}`);
  }
}
if (!dockerfile.startsWith("# Verity") || !/FROM node:22-bookworm-slim@sha256:[a-f0-9]{64} AS base/.test(dockerfile)) {
  failures.push("all container stages must inherit the digest-pinned Node 22 base line");
}
if (!/image:\s+postgres:16-alpine@sha256:[a-f0-9]{64}/.test(composeSource)) {
  failures.push("PostgreSQL image must be digest-pinned");
}
// The bundled object store is whichever image the overlay names, in any registry, but it must be a
// version tag AND an exact digest: the digest is what is trusted, `latest` is not a version.
const storageImage = /^\s*image:\s+(\S+?):([^\s@]+)@sha256:[a-f0-9]{64}\s*$/m.exec(storageComposeSource);
if (!storageImage) {
  failures.push("the bundled object-store image must be pinned as <image>:<version>@sha256:<digest>");
} else if (storageImage[2] === "latest") {
  failures.push("the bundled object-store image must not use the latest tag");
}
if (packageJson.engines?.node !== "22.x") {
  failures.push("package.json must declare the Node 22 runtime line");
}
if (nextConfig.includes("hostname: '*.supabase.co'")) {
  failures.push("Next image optimization must not trust every Supabase tenant");
}
if (!restoreScript.includes("--exit-on-error") || restoreScript.includes('|| warn "pg_restore')) {
  failures.push("restore must fail closed on every pg_restore error");
}
if (!restoreScript.includes("compose stop web scheduler")) {
  failures.push("restore must quarantine both web and scheduler before destructive work");
}
if (!backupScript.includes("sha256sum") || !restoreScript.includes("database_sha256")) {
  failures.push("backup and restore must bind the archive to a SHA-256 manifest");
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else {
  console.log("deployment security invariants are present");
}
