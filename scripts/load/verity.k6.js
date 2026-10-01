// Verity load harness (k6).
//
// Authority: taskplans/123_enterprise_readiness_evidence_program.md, Phase 3.
//
// SCOPE OF THIS FILE
// Read traffic only: a readiness probe plus authenticated page reads.
// There is deliberately NO write scenario yet. A write must go through the
// real command path (enforcePolicy, events, audit), and which HTTP surface
// carries it is an open decision: the only authenticated machine surface is
// `POST /api/tools/invoke` (ADR-029, dark by default, API-key identity). Until
// that is chosen, any "write RPS" would be invented. Do not add one by
// pointing at a bypass.
//
// NO DEFAULT LOAD. Every knob below is required; a run that does not state its
// ramp does not start, so no number in a result was ever a silent default.
//
//   BASE_URL        target, e.g. http://localhost:3000 (never the shared prod)
//   VUS_STAGES      comma list of target VUs per stage, e.g. 100,250,500
//   STAGE_SECONDS   hold duration of each stage
//   RUN_LABEL       free text recorded in the artifact (hardware, pool size...)
//   READ_ROUTES     comma list of authenticated GET paths to exercise
//                   (optional; empty means a probe-only run)
//   AUTH_COOKIE     full Cookie header value of a real signed-in session,
//                   obtained through the real sign-in path (see
//                   scripts/load/oidc-login.mjs); required when READ_ROUTES is set
//   FORBID_BODY_TEXT  optional text that marks an access-denied page; Verity
//                   serves one with HTTP 200, so status alone is not enough
//
// Run:
//   k6 run -e BASE_URL=... -e VUS_STAGES=100,250 -e STAGE_SECONDS=120 \
//          -e READ_ROUTES=/outreach -e AUTH_COOKIE="$COOKIE" \
//          -e RUN_LABEL="8vcpu/16gb pool=10" scripts/load/verity.k6.js

import http from "k6/http";
import { check, sleep } from "k6";

function required(name) {
  const value = __ENV[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required. Load runs have no default (Task 123).`);
  }
  return value;
}

const BASE_URL = required("BASE_URL").replace(/\/$/, "");
const STAGES = required("VUS_STAGES")
  .split(",")
  .map((s) => Number(s.trim()));
const STAGE_SECONDS = Number(required("STAGE_SECONDS"));
const RUN_LABEL = required("RUN_LABEL");
const READ_ROUTES = (__ENV.READ_ROUTES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const AUTH_COOKIE = __ENV.AUTH_COOKIE || "";
// "|"-separated: any one of these in a page body fails the check (an access-denied
// message, or another tenant's record name, which would be an isolation failure).
const FORBID_BODY_TEXT = (__ENV.FORBID_BODY_TEXT || "").split("|").filter(Boolean);
const REQUIRE_BODY_TEXT = __ENV.REQUIRE_BODY_TEXT || "";

if (STAGES.some((n) => !Number.isInteger(n) || n < 1) || !(STAGE_SECONDS > 0)) {
  throw new Error("VUS_STAGES must be positive integers and STAGE_SECONDS a positive number.");
}
if (READ_ROUTES.length > 0 && AUTH_COOKIE === "") {
  throw new Error("READ_ROUTES needs AUTH_COOKIE from a real signed-in session.");
}

export const options = {
  scenarios: {
    ramp: {
      executor: "ramping-vus",
      startVUs: 0,
      // Each stage ramps to its target then holds, so a stage's numbers are a
      // steady-state measurement, not a transient.
      stages: STAGES.flatMap((target) => [
        { duration: `${Math.ceil(STAGE_SECONDS / 4)}s`, target },
        { duration: `${STAGE_SECONDS}s`, target },
      ]),
      gracefulRampDown: "30s",
    },
  },
  // No pass/fail thresholds here: a threshold is a claim, and claims come from
  // Phase 6 after the numbers exist. These entries exist only to make k6 report a
  // per-status request count (a submetric appears in the summary only if something
  // references it), giving the HTTP status distribution of every run.
  thresholds: Object.fromEntries(
    ["200", "301", "302", "307", "400", "401", "403", "404", "409", "429", "500", "502", "503", "504", "0"].map((s) => [
      `http_reqs{status:${s}}`,
      ["count>=0"],
    ]),
  ),
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export default function () {
  const probe = http.get(`${BASE_URL}/api/ready`, { tags: { name: "probe_ready" } });
  check(probe, { "ready 200": (r) => r.status === 200 });

  for (const route of READ_ROUTES) {
    const res = http.get(`${BASE_URL}${route}`, {
      headers: { Cookie: AUTH_COOKIE },
      tags: { name: `read ${route}` },
      redirects: 0,
    });
    // A 3xx means the session was rejected and the app bounced to sign-in;
    // counting it as success would measure the redirect, not the page.
    check(res, { "read 200": (r) => r.status === 200 });
    // Verity renders an access-denied screen with HTTP 200, so status alone
    // cannot tell a page from a refusal. FORBID_BODY_TEXT names text whose
    // presence means the request was refused.
    if (FORBID_BODY_TEXT.length > 0) {
      check(res, {
        "no forbidden text (denied page or another tenant's data)": (r) =>
          FORBID_BODY_TEXT.every((t) => !String(r.body).includes(t)),
      });
    }
    // REQUIRE_BODY_TEXT proves the page carried the signed-in tenant's own data
    // (for example a seeded record's name), not merely an empty shell.
    if (REQUIRE_BODY_TEXT) {
      check(res, { "carries the tenant's data": (r) => String(r.body).includes(REQUIRE_BODY_TEXT) });
    }
  }
  sleep(1);
}

// Result artifact: one JSON file per run, same shape every time, so runs are
// comparable and a claim can cite a file rather than a screenshot.
export function handleSummary(data) {
  const artifact = {
    kind: "verity-load-run",
    label: RUN_LABEL,
    baseUrl: BASE_URL,
    stages: STAGES,
    stageSeconds: STAGE_SECONDS,
    readRoutes: READ_ROUTES,
    finishedAt: new Date().toISOString(),
    metrics: data.metrics,
  };
  return { [`scripts/load/results/run-${Date.now()}.json`]: JSON.stringify(artifact, null, 2) };
}
