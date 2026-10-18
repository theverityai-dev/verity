import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Stage 1 findings D1 and D4, pinned as file checks (the behaviour itself was proven on a clean clone; see
 * clients/dsew/onprem-stage1-evidence.md). They fail if a refactor reintroduces either defect.
 */
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("D1: the tools image is never stale", () => {
  const common = read("deploy/scripts/_common.sh");

  it("build_images builds the application AND the profile-gated tools image", () => {
    const body = /build_images\(\) \{([\s\S]*?)\n\}/.exec(common)?.[1] ?? "";
    expect(body).toMatch(/compose build/);
    expect(body).toMatch(/compose --profile tools build tools/);
  });

  it("install and upgrade build images through it, before migrating", () => {
    for (const file of ["deploy/scripts/install.sh", "deploy/scripts/upgrade.sh"]) {
      const src = read(file);
      expect(src).toMatch(/^build_images$/m);
      expect(src).not.toMatch(/^compose build$/m);
      expect(src.indexOf("build_images")).toBeLessThan(src.indexOf("migrate.sh"));
    }
  });

  it("migrate.sh refuses a tools image whose migration count differs from the checkout", () => {
    const src = read("deploy/scripts/migrate.sh");
    expect(src).toMatch(/EXPECTED=/);
    expect(src).toMatch(/IN_IMAGE=/);
    expect(src.indexOf("tools image has")).toBeLessThan(src.lastIndexOf("prisma migrate deploy"));
  });
});

describe("D4: OpenSSL is present for Prisma", () => {
  it("the shared base stage installs openssl without recommends and cleans apt lists", () => {
    const dockerfile = read("Dockerfile");
    const base = dockerfile.slice(dockerfile.indexOf(" AS base"), dockerfile.indexOf("FROM base AS deps"));
    expect(base).toMatch(/apt-get install -y --no-install-recommends openssl/);
    expect(base).toMatch(/rm -rf \/var\/lib\/apt\/lists/);
  });

  it("the runtime image still runs as a non-root user", () => {
    expect(read("Dockerfile")).toMatch(/^USER nextjs$/m);
  });
});
