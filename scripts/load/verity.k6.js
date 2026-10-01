// Verity load harness (k6), methodology v2.
//
// Authority: taskplans/123_enterprise_readiness_evidence_program.md, Phase 3;
// design from the red-team review of run 06
// (verityplus-docs/10-execution/audit/benchmark-methodology-review-run06.md).
//
// WHAT CHANGED FROM v1 AND WHY
//   1. /api/ready is no longer part of the measured iteration. It is its own
//      low-rate scenario ("readiness") with its own metrics. It does five
//      database round trips and an IdP HTTP call per request, so folding it into
//      the business workload made run 06 unusable as an application curve.
//   2. Every business request carries a `route` tag; per-route latency is
//      reported, never one blended number.
//   3. Ramp and hold are separated. Every request is tagged `phase:ramp` or
//      `phase:hold`; headline numbers come from `phase:hold` only.
//   4. The hold is long (set by HOLD_SECONDS; the plan states the value).
//   One VU level per invocation, so a level's artifact is self-contained and a
//   repeat is a second invocation.
//
// SCOPE
// Read traffic only. There is deliberately NO write scenario: a write must go
// through the real command path, and which HTTP surface carries it is an open
// decision (ADR-029). Do not add one by pointing at a bypass.
//
// NO DEFAULT LOAD. Every knob is required; a run that does not state its shape
// does not start, so no number in a result was ever a silent default.
//
//   BASE_URL            target (never the shared production deployment)
//   VUS                 virtual users for the business scenario
//   RAMP_SECONDS        ramp from 0 to VUS; measured but tagged phase:ramp, excluded from headline
//   HOLD_SECONDS        steady hold at VUS; tagged phase:hold, the measured window
//   THINK_SECONDS       sleep between iterations of one virtual user
//   READ_ROUTES         comma list of authenticated GET paths (business workload)
//   READY_EVERY_SECONDS seconds between readiness probes (0 disables the scenario)
//   AUTH_COOKIE         full Cookie header of a real signed-in session
//                       (scripts/load/oidc-login.mjs)
//   RUN_LABEL           free text recorded in the artifact (topology, versions)
//   OUT_FILE            path of the JSON artifact to write
//   FORBID_BODY_TEXT    optional, "|"-separated: any of these in a page body fails the
//                       check (an access-denied message, or another tenant's record name)
//   REQUIRE_BODY_TEXT   optional: text that must be in the page (the tenant's own data)
//
// Run (note: set MSYS_NO_PATHCONV=1 under Git Bash so "/" routes are not rewritten):
//   k6 run -e BASE_URL=... -e VUS=50 -e RAMP_SECONDS=30 -e HOLD_SECONDS=240 \
//          -e THINK_SECONDS=1 -e READ_ROUTES=/locations -e READY_EVERY_SECONDS=10 \
//          -e AUTH_COOKIE="$COOKIE" -e RUN_LABEL="..." -e OUT_FILE=run.json scripts/load/verity.k6.js

import http from "k6/http";
import { check, sleep } from "k6";

function required(name) {
  const value = __ENV[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required. Load runs have no default (Task 123).`);
  }
  return value;
}

function positiveInt(name) {
  const n = Number(required(name));
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer.`);
  return n;
}

const BASE_URL = required("BASE_URL").replace(/\/$/, "");
const VUS = positiveInt("VUS");
const RAMP_SECONDS = positiveInt("RAMP_SECONDS");
const HOLD_SECONDS = positiveInt("HOLD_SECONDS");
const THINK_SECONDS = Number(required("THINK_SECONDS"));
const READY_EVERY_SECONDS = Number(required("READY_EVERY_SECONDS"));
const RUN_LABEL = required("RUN_LABEL");
const OUT_FILE = required("OUT_FILE");
const AUTH_COOKIE = required("AUTH_COOKIE");
const READ_ROUTES = required("READ_ROUTES")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const FORBID_BODY_TEXT = (__ENV.FORBID_BODY_TEXT || "").split("|").filter(Boolean);
const REQUIRE_BODY_TEXT = __ENV.REQUIRE_BODY_TEXT || "";

if (!(THINK_SECONDS >= 0) || !(READY_EVERY_SECONDS >= 0)) {
  throw new Error("THINK_SECONDS and READY_EVERY_SECONDS must be >= 0.");
}
if (READ_ROUTES.length === 0) throw new Error("READ_ROUTES must name at least one route.");

/** A tag-safe label for a route path ("/" becomes "root", "/a/b" becomes "a_b"). */
function routeLabel(path) {
  const clean = path.replace(/^\/+|\/+$/g, "").replace(/[^A-Za-z0-9]+/g, "_");
  return clean === "" ? "root" : clean;
}

const ROUTES = READ_ROUTES.map((path) => ({ path, label: routeLabel(path) }));
const STATUSES = ["200", "301", "302", "307", "400", "401", "403", "404", "409", "429", "500", "502", "503", "504", "0"];

const scenarios = {
  app: {
    executor: "ramping-vus",
    exec: "app",
    startVUs: 0,
    stages: [
      { duration: `${RAMP_SECONDS}s`, target: VUS },
      { duration: `${HOLD_SECONDS}s`, target: VUS },
    ],
    gracefulRampDown: "10s",
  },
};
if (READY_EVERY_SECONDS > 0) {
  scenarios.readiness = {
    executor: "constant-arrival-rate",
    exec: "readiness",
    rate: 1,
    timeUnit: `${READY_EVERY_SECONDS}s`,
    duration: `${RAMP_SECONDS + HOLD_SECONDS}s`,
    preAllocatedVUs: 1,
    maxVUs: 2,
  };
}

// No pass/fail gates: a threshold is a claim, and claims come from Phase 6. The
// entries below exist only to make k6 report a submetric at all (a tagged
// submetric appears in the summary only if something references it).
const REPORT = ["p(50)>=0"];
const thresholds = {};
for (const r of ROUTES) {
  thresholds[`http_req_duration{phase:hold,route:${r.label}}`] = REPORT;
  thresholds[`http_req_duration{phase:ramp,route:${r.label}}`] = REPORT;
  thresholds[`http_req_failed{phase:hold,route:${r.label}}`] = ["rate>=0"];
  for (const s of STATUSES) thresholds[`http_reqs{phase:hold,route:${r.label},status:${s}}`] = ["count>=0"];
}
thresholds["checks{phase:hold}"] = ["rate>=0"];
if (READY_EVERY_SECONDS > 0) {
  thresholds["http_req_duration{scenario:readiness}"] = REPORT;
  thresholds["http_req_failed{scenario:readiness}"] = ["rate>=0"];
  thresholds["checks{scenario:readiness}"] = ["rate>=0"];
}

export const options = {
  scenarios,
  thresholds,
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

/** Runs once before the scenarios: the reference instant that separates ramp from hold. */
export function setup() {
  return { t0: Date.now() };
}

export function app(data) {
  const elapsed = (Date.now() - data.t0) / 1000;
  const phase = elapsed < RAMP_SECONDS ? "ramp" : "hold";

  for (const r of ROUTES) {
    const res = http.get(`${BASE_URL}${r.path}`, {
      headers: { Cookie: AUTH_COOKIE },
      tags: { name: r.label, route: r.label, phase },
      redirects: 0,
    });
    const tags = { route: r.label, phase };
    // A 3xx means the session was rejected and the app bounced to sign-in;
    // counting it as success would measure the redirect, not the page.
    check(res, { "page 200": (x) => x.status === 200 }, tags);
    // Verity renders an access-denied screen with HTTP 200, so status alone cannot
    // tell a page from a refusal.
    if (FORBID_BODY_TEXT.length > 0) {
      check(
        res,
        { "no forbidden text (denied page or another tenant's data)": (x) => FORBID_BODY_TEXT.every((t) => !String(x.body).includes(t)) },
        tags,
      );
    }
    if (REQUIRE_BODY_TEXT) {
      check(res, { "carries the tenant's data": (x) => String(x.body).includes(REQUIRE_BODY_TEXT) }, tags);
    }
  }
  sleep(THINK_SECONDS);
}

export function readiness() {
  const res = http.get(`${BASE_URL}/api/ready`, { tags: { name: "ready", route: "ready", phase: "all" } });
  check(res, { "ready 200": (x) => x.status === 200 }, { route: "ready", phase: "all" });
}

// One JSON artifact per invocation, same shape every time, so runs are
// comparable and a claim can cite a file. `config` records exactly what was run.
export function handleSummary(data) {
  const artifact = {
    kind: "verity-load-run",
    harness: "verity.k6.js v2",
    label: RUN_LABEL,
    config: {
      baseUrl: BASE_URL,
      vus: VUS,
      rampSeconds: RAMP_SECONDS,
      holdSeconds: HOLD_SECONDS,
      thinkSeconds: THINK_SECONDS,
      readyEverySeconds: READY_EVERY_SECONDS,
      routes: ROUTES,
      forbidBodyText: FORBID_BODY_TEXT,
      requireBodyText: REQUIRE_BODY_TEXT,
    },
    finishedAt: new Date().toISOString(),
    metrics: data.metrics,
  };
  return { [OUT_FILE]: JSON.stringify(artifact, null, 2) };
}
