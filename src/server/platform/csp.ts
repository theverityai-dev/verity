/**
 * The browser talks to object storage directly (signed uploads, signed photo links). Supabase storage is covered by
 * its wildcard; a self-hosted S3-compatible server (a client's own machine) is allowed by its configured origin only.
 */
export function storageOriginFromEnv(): string | null {
  const endpoint = process.env.VERITY_S3_ENDPOINT;
  if (!endpoint) return null;
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** Next extracts the nonce from the request CSP and stamps its bootstrap scripts. */
export function contentSecurityPolicy(nonce: string, development: boolean, storageOrigin: string | null = storageOriginFromEnv()): string {
  const storage = storageOrigin ? ` ${storageOrigin}` : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    // The design system uses style attributes for tenant accents and charts.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://*.supabase.co${storage}`,
    "font-src 'self'",
    `connect-src 'self' https://*.supabase.co${storage} https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io${development ? " ws: wss:" : ""}`,
    "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}
