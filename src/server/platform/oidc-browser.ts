import "server-only";
import { createHash, randomBytes } from "node:crypto";
import {
  SignJWT,
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
} from "jose";
import { safeReturnPath } from "@/lib/return-path";
import type { Principal } from "./authProvider";
import {
  discoverProviderMetadata,
  verifyIdToken,
  type OidcProviderMetadata,
  type OidcSettings,
} from "./oidc";

export const OIDC_TRANSACTION_COOKIE = "verity_oidc_transaction";
export const OIDC_SESSION_COOKIE = "verity_oidc_session";
const TRANSACTION_ISSUER = "verity:oidc-transaction";
const SESSION_ISSUER = "verity:oidc-session";

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

function randomUrlSafe(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}


export type OidcTransaction = {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
};

export async function createOidcAuthorization(
  settings: OidcSettings,
  secret: string,
  returnTo: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<{
  url: string;
  transaction: OidcTransaction;
  transactionCookie: string;
  metadata: OidcProviderMetadata;
}> {
  if (!settings.redirectUri) throw new Error("E_OIDC_CONFIG: VERITY_OIDC_REDIRECT_URI is required");
  const metadata = await discoverProviderMetadata(settings.issuer, fetchImpl);
  const transaction: OidcTransaction = {
    state: randomUrlSafe(),
    nonce: randomUrlSafe(),
    verifier: randomUrlSafe(48),
    returnTo: safeReturnPath(returnTo),
  };
  const challenge = createHash("sha256").update(transaction.verifier).digest("base64url");
  const transactionCookie = await new SignJWT(transaction as unknown as JWTPayload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(TRANSACTION_ISSUER)
    .setAudience(settings.clientId)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(key(secret));

  const url = new URL(metadata.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", settings.clientId);
  url.searchParams.set("redirect_uri", settings.redirectUri);
  url.searchParams.set("scope", settings.scopes ?? "openid profile email");
  url.searchParams.set("state", transaction.state);
  url.searchParams.set("nonce", transaction.nonce);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  return { url: url.toString(), transaction, transactionCookie, metadata };
}

export function oidcStateHash(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export async function readOidcTransaction(
  token: string,
  settings: OidcSettings,
  secret: string,
): Promise<OidcTransaction> {
  const { payload } = await jwtVerify(token, key(secret), {
    issuer: TRANSACTION_ISSUER,
    audience: settings.clientId,
    algorithms: ["HS256"],
  });
  if (
    typeof payload.state !== "string" ||
    typeof payload.nonce !== "string" ||
    typeof payload.verifier !== "string" ||
    typeof payload.returnTo !== "string"
  ) {
    throw new Error("E_OIDC_TRANSACTION: login transaction is incomplete");
  }
  return {
    state: payload.state,
    nonce: payload.nonce,
    verifier: payload.verifier,
    returnTo: safeReturnPath(payload.returnTo),
  };
}

export async function exchangeOidcCode(args: {
  code: string;
  transaction: OidcTransaction;
  settings: OidcSettings;
  metadata: OidcProviderMetadata;
  fetchImpl?: typeof fetch;
}): Promise<Principal> {
  const fetchImpl = args.fetchImpl ?? fetch;
  if (!args.settings.redirectUri) throw new Error("E_OIDC_CONFIG: redirect URI is required");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    client_id: args.settings.clientId,
    redirect_uri: args.settings.redirectUri,
    code_verifier: args.transaction.verifier,
  });
  if (args.settings.clientSecret) body.set("client_secret", args.settings.clientSecret);

  const response = await fetchImpl(args.metadata.tokenEndpoint, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`E_OIDC_TOKEN_EXCHANGE: provider returned HTTP ${response.status}`);
  const tokenSet = (await response.json()) as { id_token?: unknown };
  if (typeof tokenSet.id_token !== "string") {
    throw new Error("E_OIDC_TOKEN_EXCHANGE: provider returned no id_token");
  }
  const keys = createRemoteJWKSet(new URL(args.metadata.jwksUri));
  return verifyIdToken(tokenSet.id_token, args.settings, keys, {
    expectedNonce: args.transaction.nonce,
  });
}

export async function createOidcSession(
  principal: Principal,
  settings: OidcSettings,
  secret: string,
): Promise<string> {
  const startedAt = Math.floor(Date.now() / 1000);
  const idle = Math.min(settings.sessionIdleSeconds ?? 3_600, settings.sessionMaxAgeSeconds ?? 28_800);
  return new SignJWT({ subject: principal.id, email: principal.email, sessionStartedAt: startedAt })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(SESSION_ISSUER)
    .setAudience(settings.clientId)
    .setIssuedAt()
    .setExpirationTime(startedAt + idle)
    .sign(key(secret));
}

export async function renewOidcSessionIfNeeded(
  token: string,
  settings: OidcSettings,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ token: string; maxAge: number } | null> {
  const { payload } = await jwtVerify(token, key(secret), {
    issuer: SESSION_ISSUER,
    audience: settings.clientId,
    algorithms: ["HS256"],
  });
  if (
    typeof payload.subject !== "string" ||
    typeof payload.sessionStartedAt !== "number" ||
    typeof payload.exp !== "number"
  ) throw new Error("E_OIDC_SESSION: renewal claims are missing");

  const idle = settings.sessionIdleSeconds ?? 3_600;
  const absolute = settings.sessionMaxAgeSeconds ?? 28_800;
  const absoluteExpiry = payload.sessionStartedAt + absolute;
  if (nowSeconds >= absoluteExpiry) throw new Error("E_OIDC_SESSION: absolute lifetime expired");
  if (payload.exp - nowSeconds > Math.floor(idle / 2)) return null;

  const expiresAt = Math.min(nowSeconds + idle, absoluteExpiry);
  const renewed = await new SignJWT({
    subject: payload.subject,
    email: typeof payload.email === "string" ? payload.email : null,
    sessionStartedAt: payload.sessionStartedAt,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(SESSION_ISSUER)
    .setAudience(settings.clientId)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(expiresAt)
    .sign(key(secret));
  return { token: renewed, maxAge: expiresAt - nowSeconds };
}

export async function readOidcSession(
  token: string,
  settings: OidcSettings,
  secret: string,
): Promise<Principal> {
  const { payload } = await jwtVerify(token, key(secret), {
    issuer: SESSION_ISSUER,
    audience: settings.clientId,
    algorithms: ["HS256"],
  });
  if (typeof payload.subject !== "string") throw new Error("E_OIDC_SESSION: subject is missing");
  return {
    id: payload.subject,
    email: typeof payload.email === "string" ? payload.email : null,
  };
}
