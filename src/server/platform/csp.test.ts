import { afterEach, describe, expect, it } from "vitest";
import { contentSecurityPolicy, storageOriginFromEnv } from "./csp";

describe("storage origin in the content security policy", () => {
  const original = process.env.VERITY_S3_ENDPOINT;
  afterEach(() => {
    if (original === undefined) delete process.env.VERITY_S3_ENDPOINT;
    else process.env.VERITY_S3_ENDPOINT = original;
  });

  it("adds only the configured self-hosted storage origin to images and connections", () => {
    const csp = contentSecurityPolicy("n", false, "http://10.0.0.5:8333");
    expect(csp).toContain("img-src 'self' data: blob: https://*.supabase.co http://10.0.0.5:8333;");
    expect(csp).toContain("connect-src 'self' https://*.supabase.co http://10.0.0.5:8333 ");
  });

  it("is unchanged when no storage endpoint is configured", () => {
    expect(contentSecurityPolicy("n", false, null)).toContain("img-src 'self' data: blob: https://*.supabase.co;");
  });

  it("reduces the endpoint to its origin and ignores anything that is not an http(s) URL", () => {
    process.env.VERITY_S3_ENDPOINT = "http://storage.lan:8333/bucket/path?x=1";
    expect(storageOriginFromEnv()).toBe("http://storage.lan:8333");
    process.env.VERITY_S3_ENDPOINT = "javascript:alert(1)";
    expect(storageOriginFromEnv()).toBeNull();
    process.env.VERITY_S3_ENDPOINT = "not a url";
    expect(storageOriginFromEnv()).toBeNull();
  });
});
