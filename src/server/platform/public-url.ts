import "server-only";
import { runtimeConfig } from "./config";

/**
 * Absolute URLs Verity sends to a browser (ADR-032).
 *
 * The origin is configured (`VERITY_PUBLIC_URL`), never read from the request:
 * `Host`, `X-Forwarded-*` and `request.url` are attacker-influenced or reflect
 * the container's bind address (`HOSTNAME=0.0.0.0`), not what a browser uses.
 */

/** The origin to build from, or a refusal. Outside production an unset value falls back to localhost on the listen port. */
export function publicOrigin(config: Pick<typeof runtimeConfig, "publicUrl" | "nodeEnv" | "port"> = runtimeConfig): string {
  if (config.publicUrl) return config.publicUrl;
  if (config.nodeEnv === "production") {
    throw new Error("E_CONFIG_INVALID: VERITY_PUBLIC_URL is not configured");
  }
  return `http://localhost:${config.port}`;
}

/**
 * `path` joined to `origin`. Refused unless it is a local path: it must start
 * with a single `/` (so `//evil.example` and `https://evil.example` are out),
 * hold no backslash or control character, and resolve onto the same origin.
 */
export function buildPublicUrl(origin: string, path: string): URL {
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(path)) {
    throw new Error("E_PUBLIC_URL_PATH: not a local path");
  }
  const url = new URL(path, origin);
  if (url.origin !== origin) throw new Error("E_PUBLIC_URL_PATH: leaves the public origin");
  return url;
}

export function publicUrl(path: string): URL {
  return buildPublicUrl(publicOrigin(), path);
}
