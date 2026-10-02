/**
 * ADR-032 / drill finding F6: browser redirects use the configured public origin, never the request.
 * Pure lane: no database. The routes are run against a mocked config so each case controls the origin.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildPublicUrl, publicOrigin } from "@/server/platform/public-url";

const ROOT = join(__dirname, "..", "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("buildPublicUrl", () => {
  const origin = "https://example.com";

  it("joins a local path to the configured origin with exactly one slash", () => {
    expect(buildPublicUrl(origin, "/sign-in").toString()).toBe("https://example.com/sign-in");
    expect(buildPublicUrl(origin, "/").toString()).toBe("https://example.com/");
    expect(buildPublicUrl(origin, "/sign-in?error=oidc").toString()).toBe("https://example.com/sign-in?error=oidc");
  });

  it("refuses anything that is not a local path", () => {
    for (const bad of ["//evil.example", "https://evil.example/", "sign-in", "", "/\\evil.example", "/a\nb", "javascript:alert(1)"]) {
      expect(() => buildPublicUrl(origin, bad), JSON.stringify(bad)).toThrow(/E_PUBLIC_URL_PATH/);
    }
  });
});

describe("publicOrigin", () => {
  it("uses the configured origin, whatever else is set", () => {
    expect(publicOrigin({ publicUrl: "https://example.com", nodeEnv: "production", port: 3000 })).toBe("https://example.com");
  });

  it("falls back to localhost on the listen port outside production, never to HOSTNAME", () => {
    expect(publicOrigin({ publicUrl: undefined, nodeEnv: "development", port: 3100 })).toBe("http://localhost:3100");
    expect(publicOrigin({ publicUrl: undefined, nodeEnv: "test", port: 3000 })).toBe("http://localhost:3000");
  });

  it("refuses in production when no origin is configured", () => {
    expect(() => publicOrigin({ publicUrl: undefined, nodeEnv: "production", port: 3000 })).toThrow(/VERITY_PUBLIC_URL/);
  });
});

describe("OIDC routes with a spoofed request origin", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/server/platform/config");
  });

  async function load(publicUrl: string | undefined, provider: "oidc" | "supabase" = "oidc") {
    vi.resetModules();
    vi.doMock("@/server/platform/config", () => ({
      runtimeConfig: {
        nodeEnv: "production",
        environment: "production",
        port: 3000,
        publicUrl,
        auth: {
          provider,
          jwtSecret: "x".repeat(32),
          oidc: provider === "oidc"
            ? { issuer: "https://idp.example.com", clientId: "verity-web", redirectUri: `${publicUrl}/api/auth/oidc/callback` }
            : undefined,
        },
      },
    }));
    vi.doMock("@/server/platform/db", () => ({ prisma: {} }));
    vi.doMock("@/server/platform/audit", () => ({ recordSecurityEvent: vi.fn() }));
    vi.doMock("@/server/platform/tenancy", () => ({ withTenant: vi.fn() }));
    vi.doMock("@/server/platform/observability", () => ({ captureError: vi.fn(), increment: vi.fn(), log: vi.fn() }));
    const callback = await import("@/app/api/auth/oidc/callback/route");
    const start = await import("@/app/api/auth/oidc/start/route");
    return { callback, start };
  }

  const hostile = {
    host: "attacker.example",
    "x-forwarded-host": "attacker.example",
    "x-forwarded-proto": "http",
    forwarded: "host=attacker.example;proto=http",
  };

  it("callback failure redirect stays on the configured origin", async () => {
    const { callback } = await load("https://example.com");
    // request.url itself is the bind address and the attacker's host, as seen inside the container.
    const request = new NextRequest("http://0.0.0.0:3000/api/auth/oidc/callback?error=access_denied", { headers: hostile });
    const response = await callback.GET(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.com/sign-in?error=oidc");
  });

  it("a missing transaction also redirects to the configured origin", async () => {
    const { callback } = await load("https://example.com");
    const response = await callback.GET(new NextRequest("http://attacker.example/api/auth/oidc/callback", { headers: hostile }));
    expect(response.headers.get("location")).toBe("https://example.com/sign-in?error=oidc");
  });

  it("start with a non-OIDC provider redirects to the configured origin", async () => {
    const { start } = await load("https://example.com", "supabase");
    const response = await start.GET(new NextRequest("http://0.0.0.0:3000/api/auth/oidc/start", { headers: hostile }));
    expect(response.headers.get("location")).toBe("https://example.com/sign-in");
  });

  it("with no configured origin in production it refuses and redirects nowhere", async () => {
    const { callback } = await load(undefined);
    const response = await callback.GET(new NextRequest("http://attacker.example/api/auth/oidc/callback?error=x", { headers: hostile }));
    expect(response.status).toBe(500);
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("static guards (ADR-032 constraints 1 and 2)", () => {
  const authFiles = [
    ...walk(join(ROOT, "src", "app", "api", "auth")).filter((f) => /\.tsx?$/.test(f)),
    ...["oidc.ts", "oidc-browser.ts", "public-url.ts"].map((f) => join(ROOT, "src", "server", "platform", f)),
  ];
  // Strip comments so the explanation of what is forbidden does not trip the guard.
  const code = (file: string) => readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("no authentication code reads Host or forwarded headers", () => {
    for (const file of authFiles) {
      expect(code(file), file).not.toMatch(/x-forwarded|["'`]host["'`]|["'`]forwarded["'`]|headers\(\)|\.headers\.get\(/i);
    }
  });

  it("no authentication route builds a URL from request.url", () => {
    for (const file of authFiles.filter((f) => f.endsWith("route.ts"))) {
      expect(code(file), file).not.toMatch(/request\.url|req\.url/);
    }
  });

  it("the OIDC routes build browser redirects through publicUrl()", () => {
    for (const name of ["callback", "start", "logout"]) {
      expect(code(join(ROOT, "src", "app", "api", "auth", "oidc", name, "route.ts")), name).toMatch(/publicUrl\(/);
    }
  });
});
