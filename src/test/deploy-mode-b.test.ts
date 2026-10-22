import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * Task 129 B1-B4: the Mode B (private network) package keeps the properties that were proven in the rehearsal.
 *
 * File-level checks, no shell and no Docker, so they run everywhere including Windows. The live behaviour (a Keycloak sign-in
 * through the proxy, a browser upload, a destroy-and-restore) was exercised on a rehearsal stack and is recorded in
 * taskplans/129_architecture_honesty_demo_readiness_and_dsew_onprem.md; each assertion here pins a defect that rehearsal found.
 */
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");

const keycloak = parse(read("deploy/compose/docker-compose.keycloak.yml"));
const proxy = parse(read("deploy/compose/docker-compose.proxy.yml"));
const caddyfile = read("deploy/proxy/Caddyfile");
const backup = read("deploy/scripts/backup.sh");
const restore = read("deploy/scripts/restore.sh");
const common = read("deploy/scripts/_common.sh");
const install = read("deploy/scripts/install.sh");
const preflight = read("deploy/security/preflight.sh");
const realm = JSON.parse(read("deploy/keycloak/realm-dsew.json.tmpl")) as {
  sslRequired: string;
  registrationAllowed: boolean;
  bruteForceProtected: boolean;
  clients: Array<{
    clientId: string;
    publicClient: boolean;
    implicitFlowEnabled: boolean;
    directAccessGrantsEnabled: boolean;
    serviceAccountsEnabled: boolean;
    redirectUris: string[];
    attributes: Record<string, string>;
  }>;
};

describe("Mode B identity (Keycloak)", () => {
  it("runs in production mode with its own database, and publishes nothing", () => {
    expect(keycloak.services.keycloak.command[0]).toBe("start");
    expect(keycloak.services.keycloak.ports).toBeUndefined();
    expect(keycloak.services["keycloak-db"].ports).toBeUndefined();
    expect(keycloak.services.keycloak.environment.KC_DB_URL).toContain("keycloak-db");
  });

  it("never receives Verity's database credentials", () => {
    const env = Object.keys(keycloak.services.keycloak.environment);
    for (const forbidden of ["DATABASE_URL", "DIRECT_URL", "POSTGRES_SUPERUSER_PASSWORD", "VERITY_APP_PASSWORD"]) {
      expect(env).not.toContain(forbidden);
    }
  });

  it("configures a confidential PKCE client with exact redirect URIs and no weaker flows", () => {
    const client = realm.clients.find((c) => c.clientId === "verity-web")!;
    expect(client.publicClient).toBe(false);
    expect(client.attributes["pkce.code.challenge.method"]).toBe("S256");
    expect(client.implicitFlowEnabled).toBe(false);
    expect(client.directAccessGrantsEnabled).toBe(false);
    expect(client.serviceAccountsEnabled).toBe(false);
    expect(client.redirectUris).toEqual(["@@APP_ORIGIN@@/api/auth/oidc/callback"]);
    expect(client.redirectUris.join()).not.toContain("*");
    expect(realm.registrationAllowed).toBe(false);
    expect(realm.bruteForceProtected).toBe(true);
    expect(realm.sslRequired).toBe("external");
  });
});

describe("Mode B proxy", () => {
  it("uses the same port number inside and outside, so the issuer is reachable from containers", () => {
    expect(proxy.services.proxy.ports).toEqual(["${VERITY_HTTPS_BIND:-0.0.0.0}:${VERITY_HTTPS_PORT:-443}:${VERITY_HTTPS_PORT:-443}"]);
  });

  it("aliases all three names to the proxy and trusts the internal CA in web and tools", () => {
    const aliases = proxy.services.proxy.networks.default.aliases;
    expect(aliases).toEqual(["${VERITY_APP_HOST}", "${VERITY_IDP_HOST}", "${VERITY_FILES_HOST}"]);
    expect(proxy.services.web.environment.NODE_EXTRA_CA_CERTS).toBe("/tls/root.crt");
    expect(proxy.services.tools.environment.NODE_EXTRA_CA_CERTS).toBe("/tls/root.crt");
  });

  it("needs the key readable without running as the file owner (rehearsal: permission denied at start)", () => {
    expect(proxy.services.proxy.cap_add).toContain("DAC_READ_SEARCH");
    expect(proxy.services.proxy.cap_drop).toEqual(["ALL"]);
  });

  it("leaves no container with a route out: the default network is internal and only the proxy joins the edge (B5)", () => {
    expect(proxy.networks.default.internal).toBe(true);
    expect(Object.keys(proxy.services.proxy.networks)).toContain("edge");
    for (const [name, service] of Object.entries(proxy.services) as Array<[string, { networks?: object }]>) {
      if (name !== "proxy") expect(service.networks, `${name} must stay on the internal default network only`).toBeUndefined();
    }
  });

  it("does not wait for web, so the proxy can start before migrations", () => {
    expect(Object.keys(proxy.services.proxy.depends_on)).not.toContain("web");
  });

  it("supplies certificates itself and keeps the Keycloak admin console off the LAN", () => {
    expect(caddyfile).toContain("auto_https off");
    expect(caddyfile).toContain("admin off");
    expect(caddyfile).toMatch(/@admin path \/admin \/admin\/\* \/realms\/master \/realms\/master\/\*\n\s+respond @admin 404/);
  });

  it("replaces the object store's CORS headers instead of adding to them (rehearsal: duplicate Allow-Origin broke uploads)", () => {
    const files = caddyfile.slice(caddyfile.indexOf("{$VERITY_FILES_HOST}"));
    expect(files).toContain("header_down Access-Control-Allow-Origin");
    expect(files).not.toMatch(/\n\t\theader Access-Control-Allow-Origin[^\n]*\n\t\theader Access-Control-Expose/);
  });
});

describe("Mode B recovery set", () => {
  it("finds the object-store volume from this project's container, never by name search (rehearsal: snapshotted the wrong volume)", () => {
    for (const script of [backup, restore]) {
      expect(script).not.toMatch(/docker volume ls[^\n]*filter name=/);
      expect(script).toContain('{{if eq .Destination "/data"}}{{.Name}}');
    }
  });

  it("streams the object archive so the backup user owns it (rehearsal: root-owned file could not be chmodded)", () => {
    expect(backup).toContain('czf - -C /data . > "${OBJ_TARGET}.partial"');
    expect(backup).not.toMatch(/-v "\$\{BACKUP_DIR\}:\/out"/);
  });

  it("binds every companion file to the manifest by checksum and keeps the env file and CA key out", () => {
    for (const key of ["keycloak_sha256", "object_store_sha256", "config_sha256", "database_sha256"]) {
      expect(backup).toContain(key);
    }
    expect(backup).toContain("--exclude='tls/root.key'");
    expect(backup).toContain("env_file=excluded_keep_the_sealed_copy");
  });

  it("verifies the whole set before changing anything, and refuses a partial restore", () => {
    const firstDestructive = restore.indexOf('DROP DATABASE IF EXISTS \\"${DB}\\"');
    expect(firstDestructive).toBeGreaterThan(0);
    for (const guard of ["backup checksum mismatch", "recovery set is incomplete", "gzip -t", "refusing a partial restore", "VERITY_RESTORE_CONFIRM"]) {
      const at = restore.indexOf(guard);
      expect(at, guard).toBeGreaterThan(0);
      expect(at, `${guard} must come before the first DROP`).toBeLessThan(firstDestructive);
    }
  });

  it("waits for the databases on a rebuilt host (rehearsal: the first restore raced the database start)", () => {
    expect(restore).toContain("wait_ready db postgres");
    expect(restore).toContain("wait_ready keycloak-db keycloak");
  });

  it("compares restored object files to the manifest before the store starts, and does not flag the offline CA key as drift", () => {
    expect(restore).toContain("object-store file count mismatch after restore");
    expect(restore).toContain("diff -rq -x root.key");
  });
});

describe("Mode B install and preflight", () => {
  it("reads the mode from the env file, so upgrade, backup and restore see the same stack", () => {
    expect(common).toContain('[ "$(env_value VERITY_DEPLOYMENT_MODE)" = "B" ]');
    expect(common).toContain("docker-compose.keycloak.yml");
    expect(common).toContain("docker-compose.proxy.yml");
    expect(common).toContain('--project-name "${VERITY_COMPOSE_PROJECT:-verity}"');
  });

  it("creates the certificate and realm before preflight, and starts identity and the proxy before the bucket is ensured", () => {
    expect(install.indexOf("make-internal-ca.sh")).toBeLessThan(install.indexOf("preflight.sh"));
    expect(install.indexOf("render-keycloak-realm.sh")).toBeLessThan(install.indexOf("preflight.sh"));
    expect(install.indexOf("compose up -d keycloak-db keycloak proxy")).toBeLessThan(install.indexOf("ensure-bucket.sh"));
  });

  it("refuses an internal object-store endpoint, a default Keycloak account and a certificate that omits a name", () => {
    expect(preflight).toContain("an internal name such as http://objects:9000 cannot be reached by a phone");
    expect(preflight).toContain("KEYCLOAK_ADMIN is empty, a default account name");
    expect(preflight).toContain("the server certificate does not list");
    expect(preflight).toContain("the server certificate expires within 30 days");
  });
});
