// Signs in through the real OIDC authorization-code + PKCE flow, over plain
// HTTP, and writes the resulting Verity session Cookie header to a file.
//
// Authority: taskplans/123_enterprise_readiness_evidence_program.md, Phase 3.
//
// WHY NOT A BROWSER
// The load harness needs a session cookie, not a rendered page. Following the
// redirects by hand exercises the same server-side path a browser does
// (start -> IdP login form -> IdP approval -> callback -> session cookie) with
// no browser dependency, so it can run on a headless load host.
//
// It drives a username/password login form plus an optional consent screen,
// which covers Keycloak and Dex. It is a lab helper, not a general OIDC client.
//
// NOTE: the Dex lab in deploy/lab cannot sign a user in to Verity. Dex's `sub`
// is base64url(protobuf{user_id, conn_id}), not the static userID, and ADR-020
// requires the principal claim to be a UUID, so the callback refuses it as
// `unprovisionable_subject`. Use an IdP whose `sub` is a UUID (Keycloak).
//
// All inputs are required, no defaults:
//   BASE_URL            Verity origin, e.g. http://localhost:3000
//   OIDC_LOGIN_EMAIL    the IdP user (must be a pre-provisioned Verity identity)
//   OIDC_LOGIN_PASSWORD the IdP password (read from the environment only)
//   IDP_USER_FIELD      the login form's user field name ("username" or "login")
//   COOKIE_OUT          file to write the Cookie header into (never stdout)
//
// Dex is addressed by the host the issuer URL uses. When the issuer host is
// only resolvable inside a container network, set IDP_HOST_REWRITE=from=to
// (e.g. dex:5556=127.0.0.1:5556) so the redirects stay reachable from here.

import { writeFileSync } from "node:fs";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required (no default).`);
  return value;
}

const BASE_URL = required("BASE_URL").replace(/\/$/, "");
const EMAIL = required("OIDC_LOGIN_EMAIL");
const PASSWORD = required("OIDC_LOGIN_PASSWORD");
const COOKIE_OUT = required("COOKIE_OUT");
// The IdP login form's user field: "username" for Keycloak, "login" for Dex.
const USER_FIELD = required("IDP_USER_FIELD");
const REWRITE = process.env.IDP_HOST_REWRITE
  ? process.env.IDP_HOST_REWRITE.split("=")
  : null;

// One cookie jar per origin: Verity and the IdP set cookies for different hosts.
const jars = new Map();

function jarFor(url) {
  const key = new URL(url).host;
  if (!jars.has(key)) jars.set(key, new Map());
  return jars.get(key);
}

function cookieHeader(url) {
  return [...jarFor(url)].map(([k, v]) => `${k}=${v}`).join("; ");
}

function remember(url, response) {
  for (const line of response.headers.getSetCookie()) {
    const [pair, ...attrs] = line.split(";");
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a));
    if (expired || value === "") jarFor(url).delete(name);
    else jarFor(url).set(name, value);
  }
}

function fix(url) {
  if (!REWRITE) return url;
  return url.replace(REWRITE[0], REWRITE[1]);
}

async function request(url, init = {}) {
  const target = fix(url);
  const headers = { ...(init.headers ?? {}) };
  const cookies = cookieHeader(target);
  if (cookies) headers.cookie = cookies;
  const response = await fetch(target, { ...init, headers, redirect: "manual" });
  remember(target, response);
  return { response, url: target };
}

// Follows redirects until a non-redirect response. Returns it with its URL.
async function follow(url, init) {
  let current = { ...(await request(url, init)) };
  for (let hops = 0; hops < 15; hops++) {
    const { response } = current;
    if (response.status < 300 || response.status > 399) return current;
    const location = response.headers.get("location");
    if (!location) return current;
    const next = new URL(location, current.url).toString();
    current = await request(next);
  }
  throw new Error("too many redirects");
}

function formFields(html) {
  const action = /<form[^>]*action="([^"]*)"/i.exec(html)?.[1]?.replace(/&amp;/g, "&");
  const fields = {};
  for (const m of html.matchAll(/<input[^>]*>/gi)) {
    const tag = m[0];
    const name = /name="([^"]*)"/i.exec(tag)?.[1];
    if (!name) continue;
    fields[name] = /value="([^"]*)"/i.exec(tag)?.[1] ?? "";
  }
  return { action, fields };
}

async function post(pageUrl, html, overrides) {
  const { action, fields } = formFields(html);
  if (!/<form/i.test(html)) throw new Error(`no form on ${pageUrl}`);
  const body = new URLSearchParams({ ...fields, ...overrides });
  // A form with no action posts back to its own URL (Dex's consent screen).
  return follow(new URL(action || pageUrl, pageUrl).toString(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

async function main() {
  // 1. Verity starts the flow: sets the signed transaction cookie and sends us to the IdP.
  let step = await follow(`${BASE_URL}/api/auth/oidc/start`);

  // 2. The IdP's login form (Dex static password connector: fields "login", "password").
  let html = await step.response.text();
  if (!/name="password"/i.test(html)) {
    throw new Error(`expected an IdP login form, got HTTP ${step.response.status} at ${step.url}`);
  }
  step = await post(step.url, html, { [USER_FIELD]: EMAIL, password: PASSWORD });

  // 3. Dex may show a one-time "Grant Access" screen; approve it if so.
  html = await step.response.text();
  if (/name="approval"/i.test(html)) {
    step = await post(step.url, html, { approval: "approve" });
  }

  // 4. The callback has run by now (followed through redirects) and Verity set its session.
  const verity = cookieHeader(BASE_URL);
  if (!verity) {
    throw new Error(`no Verity session cookie after sign-in; ended at HTTP ${step.response.status} ${step.url}`);
  }
  writeFileSync(COOKIE_OUT, verity, { encoding: "utf8", mode: 0o600 });
  console.log(
    JSON.stringify({
      ok: true,
      finalStatus: step.response.status,
      finalUrl: step.url,
      verityCookieNames: [...jarFor(BASE_URL).keys()],
      cookieFile: COOKIE_OUT,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
