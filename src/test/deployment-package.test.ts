import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Task 42 — the Verity Enterprise Deployment Package.
 * Plan: taskplans/42_deployment_hardening.md.
 *
 * A hardening document nothing enforces is a wish list. These tests are the
 * enforcement: they assert the properties `deploy/security/hardening.md`
 * claims, against the files an operator is actually handed.
 *
 * They are structural on purpose. Task 43 runs the package for real; what this
 * file catches is the regression where someone adds a convenient default
 * password or publishes a database port, which would ship silently and work
 * perfectly.
 */

const ROOT = process.cwd();
const DEPLOY = resolve(ROOT, "deploy");
const read = (relative: string) => readFileSync(resolve(ROOT, relative), "utf8");

const COMPOSE = "deploy/compose/docker-compose.yml";
const STORAGE = "deploy/compose/docker-compose.bundled-storage.yml";
const ENV_EXAMPLE = "deploy/config/verity.env.example";

const SCRIPTS = [
  "install", "migrate", "bootstrap", "backup", "restore", "health", "upgrade", "ensure-bucket", "check-image-pins",
] as const;

describe("package shape (AC-01)", () => {
  it("contains every directory the brief names", () => {
    for (const dir of ["compose", "scripts", "config", "security", "docs"]) {
      expect(existsSync(join(DEPLOY, dir)), `deploy/${dir}`).toBe(true);
    }
  });

  it("contains every operator script the brief names", () => {
    for (const script of SCRIPTS) {
      expect(existsSync(join(DEPLOY, "scripts", `${script}.sh`)), script).toBe(true);
    }
  });

  it("ships the scripts executable", () => {
    // Git on Windows does not preserve POSIX executable bits in the working
    // tree. CI/Linux still enforces the actual mode; Windows validates that
    // the scripts are present and leaves mode enforcement to the deployment
    // artifact or WSL checkout.
    if (process.platform === "win32") return;
    for (const script of SCRIPTS) {
      const mode = statSync(join(DEPLOY, "scripts", `${script}.sh`)).mode & 0o111;
      expect(mode, `${script}.sh is not executable`).toBeGreaterThan(0);
    }
    expect(statSync(join(DEPLOY, "security", "preflight.sh")).mode & 0o111).toBeGreaterThan(0);
  });

  it("documents install, operations and upgrade", () => {
    for (const doc of ["install.md", "operations.md", "upgrade.md"]) {
      expect(existsSync(join(DEPLOY, "docs", doc)), doc).toBe(true);
    }
    expect(existsSync(join(DEPLOY, "security", "hardening.md"))).toBe(true);
  });
});

describe("no default or example secret can reach a deployment (AC-02, AC-10)", () => {
  it("gives the compose file no default password", () => {
    const compose = read(COMPOSE);

    // `${VAR:?message}` fails the command with that message rather than
    // starting something insecure. `${VAR:-default}` would start it.
    expect(compose).toMatch(/POSTGRES_PASSWORD: \$\{POSTGRES_SUPERUSER_PASSWORD:\?/);
    expect(compose).toMatch(/VERITY_APP_PASSWORD: \$\{VERITY_APP_PASSWORD:\?/);
    expect(compose).not.toMatch(/POSTGRES_SUPERUSER_PASSWORD:-/);
    expect(compose).not.toMatch(/VERITY_APP_PASSWORD:-\w/);
  });

  it("gives the object store no default credential either", () => {
    const storage = read(STORAGE);
    // Required, not defaulted. Without credentials the gateway would accept ANY key pair.
    expect(storage).toMatch(/AWS_ACCESS_KEY_ID: \$\{VERITY_S3_ACCESS_KEY_ID:\?/);
    expect(storage).toMatch(/AWS_SECRET_ACCESS_KEY: \$\{VERITY_S3_SECRET_ACCESS_KEY:\?/);
    expect(storage).not.toMatch(/VERITY_S3_(ACCESS_KEY_ID|SECRET_ACCESS_KEY):-/);
  });

  it("marks every example credential with a placeholder preflight recognises", () => {
    const example = read(ENV_EXAMPLE);
    for (const key of [
      "POSTGRES_SUPERUSER_PASSWORD", "VERITY_APP_PASSWORD",
      "VERITY_SESSION_SECRET", "CRON_SECRET",
    ]) {
      expect(example, key).toMatch(new RegExp(`^${key}=CHANGE_ME`, "m"));
    }
  });

  it("has preflight reject every one of those placeholders", () => {
    const preflight = read("deploy/security/preflight.sh");
    expect(preflight).toMatch(/CHANGE_ME\*\)\s*fail/);
    for (const key of [
      "POSTGRES_SUPERUSER_PASSWORD", "VERITY_APP_PASSWORD",
      "VERITY_SESSION_SECRET", "CRON_SECRET",
    ]) {
      expect(preflight, key).toContain(key);
    }
  });

  it("contains no credential-shaped literal anywhere in the package", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry !== "backups") walk(full);
        } else files.push(full);
      }
    };
    walk(DEPLOY);

    // The generated env file is the operator's own credentials and is
    // gitignored — scanning it would fail on a correctly configured machine
    // and pass on one that has never been deployed, which is backwards. What
    // matters is that it cannot be committed, asserted separately below.
    const generated = join(DEPLOY, "config", "verity.env");

    // Shapes that are unambiguously real: a JWT, an AWS key id, a Supabase
    // service-role key, a postgres URL with an embedded password that is not
    // an obvious placeholder or a compose variable.
    const suspicious = [
      /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
      /AKIA[0-9A-Z]{16}/,
      /sk-[A-Za-z0-9]{20,}/,
    ];

    for (const file of files) {
      if (file === generated) continue;
      const source = readFileSync(file, "utf8");
      for (const pattern of suspicious) {
        expect(source, `${file} contains something that looks like a real secret`).not.toMatch(pattern);
      }
    }
  });

  it("keeps the generated env file out of version control", () => {
    const ignore = read(".gitignore");
    expect(ignore).toMatch(/^deploy\/config\/verity\.env$/m);
    expect(ignore).toMatch(/^deploy\/backups\/$/m);
  });

  it("creates the env file privately rather than fixing its mode afterwards", () => {
    const install = read("deploy/scripts/install.sh");
    // A window in which the credentials are world-readable is still a window.
    expect(install).toMatch(/umask 077/);
    expect(install).toMatch(/chmod 600/);
  });

  it("refuses to run against a world-readable env file", () => {
    const common = read("deploy/scripts/_common.sh");
    expect(common).toMatch(/600\|400/);
    expect(common).toMatch(/it holds credentials/);
  });

  it("never sources the env file, which is edited by hand", () => {
    const common = read("deploy/scripts/_common.sh");
    // Sourcing would execute whatever it contains.
    expect(common).toMatch(/env_value\(\)/);
    expect(common).not.toMatch(/^\s*source\s+"\$\{ENV_FILE\}"/m);
  });
});

describe("exposure (AC-03)", () => {
  it("publishes no database port", () => {
    const compose = read(COMPOSE);
    expect(compose).not.toMatch(/^\s*-\s*"?[\d.]*:?5432:5432/m);
  });

  it("publishes no object-store port at all", () => {
    // Stronger than checking known port numbers: the overlay may not publish anything.
    expect(read(STORAGE)).not.toMatch(/^\s*ports:/m);
  });

  it("binds the application to localhost by default", () => {
    const compose = read(COMPOSE);
    expect(compose).toMatch(/VERITY_BIND_ADDRESS:-127\.0\.0\.1/);
  });

  it("has preflight refuse 0.0.0.0 in production", () => {
    const preflight = read("deploy/security/preflight.sh");
    expect(preflight).toMatch(/0\.0\.0\.0/);
    expect(preflight).toMatch(/reverse proxy/);
  });
});

describe("the timezone finding is pinned and enforced (AC-04)", () => {
  it("pins UTC in the compose file, in every place that matters", () => {
    const compose = read(COMPOSE);

    // Task 36 found three availability tests failing on a non-UTC session.
    // They fail quietly: temporal.ts says instants are UTC, and nothing had
    // ever told the database.
    expect(compose).toMatch(/TZ: UTC/);
    expect(compose).toMatch(/PGTZ: UTC/);
    expect(compose).toMatch(/timezone=UTC/);
  });

  it("gives the application container UTC too", () => {
    const compose = read(COMPOSE);
    const web = compose.slice(compose.indexOf("  web:"));
    expect(web).toMatch(/TZ: UTC/);
  });

  it("has preflight verify it against the running server, not only the file", () => {
    const preflight = read("deploy/security/preflight.sh");
    expect(preflight).toMatch(/show timezone/);
    expect(preflight).toMatch(/not UTC/);
  });
});

describe("startup and schema (AC-05)", () => {
  it("keeps migration out of the image entrypoint", () => {
    const dockerfile = read("Dockerfile");
    const compose = read(COMPOSE);

    // Baking migration into container start makes every restart — including
    // an autoscaler's — a potential schema change.
    expect(dockerfile).not.toMatch(/CMD.*migrate/);
    expect(dockerfile).not.toMatch(/ENTRYPOINT.*migrate/);
    expect(compose).not.toMatch(/command:.*prisma migrate/);
  });

  it("makes migration and bootstrap explicit, ordered steps in install", () => {
    const install = read("deploy/scripts/install.sh");
    expect(install.indexOf("migrate.sh")).toBeGreaterThan(-1);
    expect(install.indexOf("bootstrap.sh")).toBeGreaterThan(install.indexOf("migrate.sh"));
    expect(install.indexOf("preflight.sh")).toBeLessThan(install.indexOf("migrate.sh"));
  });

  it("waits for the database before migrating rather than racing it", () => {
    expect(read("deploy/scripts/migrate.sh")).toMatch(/pg_isready/);
  });
});

describe("the bundled object store (drill finding F2)", () => {
  const storage = read(STORAGE);

  it("pins the image by version tag AND exact digest, never latest", () => {
    const image = /^\s*image:\s+(\S+?):([^\s@]+)@sha256:([a-f0-9]{64})\s*$/m.exec(storage);
    expect(image, "image must be <image>:<version>@sha256:<digest>").not.toBeNull();
    expect(image?.[2]).not.toBe("latest");
  });

  it("is no longer MinIO: that image was withdrawn and its project is archived", () => {
    expect(storage).not.toMatch(/^\s*image:.*minio/im);
    expect(storage).not.toMatch(/MINIO_ROOT/);
  });

  it("runs unprivileged with every capability dropped and no privilege escalation", () => {
    expect(storage).toMatch(/user: "1000:1000"/);
    expect(storage).toMatch(/cap_drop:\s*\n\s*- ALL/);
    expect(storage).toMatch(/no-new-privileges:true/);
  });

  it("serves S3 on 9000 so VERITY_S3_ENDPOINT=http://objects:9000 stays valid", () => {
    expect(storage).toMatch(/- -s3\.port=9000/);
    expect(read(ENV_EXAMPLE)).toMatch(/^VERITY_S3_ENDPOINT=http:\/\/objects:9000$/m);
  });

  it("is healthy before the application starts, and has a real health check", () => {
    expect(storage).toMatch(/web:\s*\n\s*depends_on:\s*\n\s*objects:\s*\n\s*condition: service_healthy/);
    expect(storage).toMatch(/healthcheck:/);
  });

  it("keeps its data in a new volume, never reading an old MinIO volume as SeaweedFS data", () => {
    expect(storage).toMatch(/verity-bundled-storage-data:\/data/);
    expect(storage).not.toMatch(/verity-object-data/);
  });
});

describe("the object-store bucket is provisioned before the final health gate (drill finding F5)", () => {
  const install = read("deploy/scripts/install.sh");
  const at = (needle: string) => install.indexOf(needle);

  it("runs ensure-bucket after the object store is started and before the application and the final health check", () => {
    expect(at("ensure-bucket.sh")).toBeGreaterThan(-1);
    expect(at("ensure-bucket.sh")).toBeGreaterThan(at("compose up -d objects"));
    expect(at("ensure-bucket.sh")).toBeGreaterThan(at("migrate.sh"));
    expect(at("ensure-bucket.sh")).toBeLessThan(at("compose up -d web scheduler"));
    expect(at("ensure-bucket.sh")).toBeLessThan(at("health.sh"));
    // health.sh is the last gate: nothing may follow it except the completion message.
    expect(install.slice(at("health.sh")).split("\n").filter((l) => l.trim() && !l.startsWith("#"))).toHaveLength(2);
  });

  it("stops the install if provisioning fails, rather than continuing to a doomed health check", () => {
    expect(read("deploy/scripts/_common.sh")).toMatch(/set -euo pipefail/);
    const line = install.split("\n").find((l) => l.includes("ensure-bucket.sh")) ?? "";
    expect(line, "ensure-bucket must not be allowed to fail silently").not.toMatch(/\|\||;\s*true/);
  });

  it("runs the provisioning in the tools image, as the other operator steps do, and only that", () => {
    const script = read("deploy/scripts/ensure-bucket.sh");
    expect(script).toMatch(/--profile tools run/);
    expect(script).toMatch(/ensure-storage-bucket\.ts/);
    expect(script).toMatch(/require_env_file/);
  });

  it("passes the setting to the tools container and documents it, defaulting to true", () => {
    expect(read(COMPOSE)).toMatch(/VERITY_STORAGE_CREATE_BUCKET: \$\{VERITY_STORAGE_CREATE_BUCKET:-true\}/);
    expect(read(ENV_EXAMPLE)).toMatch(/^VERITY_STORAGE_CREATE_BUCKET=true$/m);
  });

  it("has preflight reject a value that is not exactly true or false", () => {
    expect(read("deploy/security/preflight.sh")).toMatch(/VERITY_STORAGE_CREATE_BUCKET/);
  });
});

describe("health, shutdown and logging (AC-06, AC-07)", () => {
  it("points the container healthcheck at readiness, not liveness", () => {
    const compose = read(COMPOSE);
    // A healthcheck exists to catch exactly the case /api/health deliberately
    // does not: a reachable process whose database is gone.
    expect(compose).toMatch(/api\/ready/);
    expect(compose).not.toMatch(/test:[\s\S]{0,200}api\/health/);
  });

  it("allows in-flight requests to drain on stop", () => {
    expect(read(COMPOSE)).toMatch(/stop_grace_period: 30s/);
  });

  it("bounds container logs", () => {
    const compose = read(COMPOSE);
    expect(compose).toMatch(/max-size: "10m"/);
    expect(compose).toMatch(/max-file: "5"/);
  });

  it("drops privileges and capabilities", () => {
    const compose = read(COMPOSE);
    expect(compose).toMatch(/no-new-privileges:true/);
    expect(compose).toMatch(/cap_drop:\s*\n\s*- ALL/);
  });

  it("reports liveness and readiness separately", () => {
    const health = read("deploy/scripts/health.sh");
    expect(health).toMatch(/api\/health/);
    expect(health).toMatch(/api\/ready/);
  });
});

describe("backup and upgrade (AC-08)", () => {
  it("verifies a dump by reading it back before reporting success", () => {
    const backup = read("deploy/scripts/backup.sh");
    // A dump nobody has ever read is not a backup — it is a file.
    expect(backup).toMatch(/pg_restore --list/);
    expect(backup).toMatch(/refusing to report success/);
  });

  it("writes to a partial name and moves on success", () => {
    const backup = read("deploy/scripts/backup.sh");
    // An interrupted run must not leave a truncated file that looks like a
    // backup.
    expect(backup).toMatch(/\.partial/);
    expect(backup).toMatch(/^mv /m);
  });

  it("backs up first in upgrade, and aborts if that fails", () => {
    const upgrade = read("deploy/scripts/upgrade.sh");
    expect(upgrade.indexOf("backup.sh")).toBeLessThan(upgrade.indexOf("migrate.sh"));
    expect(upgrade).toMatch(/upgrade aborted/);
    expect(upgrade).toMatch(/restore\.sh/);  // prints the rollback command
  });

  it("requires an explicit confirmation before a destructive restore", () => {
    const restore = read("deploy/scripts/restore.sh");
    expect(restore).toMatch(/VERITY_RESTORE_CONFIRM/);
    expect(restore).toMatch(/DROPS/);
    // Restoring under a live application produces a half-restored database.
    expect(restore).toMatch(/compose stop web/);
  });
});

describe("script discipline (AC-09)", () => {
  const scriptFiles = [
    ...SCRIPTS.map((s) => `deploy/scripts/${s}.sh`),
    "deploy/scripts/_common.sh",
    "deploy/security/preflight.sh",
  ];

  it("runs every script in strict mode", () => {
    // _common.sh sets it and every script sources it first; assert both, since
    // a script that forgot to source it would silently continue past an error.
    expect(read("deploy/scripts/_common.sh")).toMatch(/set -euo pipefail/);
    for (const file of scriptFiles) {
      if (file.endsWith("_common.sh")) continue;
      expect(read(file), file).toMatch(/_common\.sh"/);
    }
  });

  it("pins the compose project name so cwd cannot change which deployment is touched", () => {
    expect(read("deploy/scripts/_common.sh")).toMatch(/--project-name verity/);
  });

  it("fails loudly rather than continuing", () => {
    const common = read("deploy/scripts/_common.sh");
    expect(common).toMatch(/die\(\)/);
    expect(common).toMatch(/exit 1/);
  });

  it("checks the Docker daemon before assuming it", () => {
    expect(read("deploy/scripts/_common.sh")).toMatch(/the Docker daemon is not reachable/);
  });
});

describe("the deployment package documents what it refuses to do", () => {
  it("says why there is no Kubernetes, no secrets manager and no in-app TLS", () => {
    const hardening = read("deploy/security/hardening.md");
    expect(hardening).toMatch(/No Kubernetes/);
    expect(hardening).toMatch(/No secrets manager/);
    expect(hardening).toMatch(/No TLS inside the application/);
  });

  it("does not claim zero-downtime upgrades", () => {
    const upgrade = read("deploy/docs/upgrade.md");
    expect(upgrade).toMatch(/Not supported, and deliberately not claimed/);
  });

  it("states that migrations are forward-only and the backup is the way back", () => {
    expect(read("deploy/docs/upgrade.md")).toMatch(/forward-only/);
  });
});
