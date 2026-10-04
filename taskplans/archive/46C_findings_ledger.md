# Task 46C — Findings Ledger

The audit's output. Every row is evidence-backed and was reproduced against the
repository at `6604a30` or against the live database during the audit.

**No production code was modified to produce this document.** Remediation is
Phase 10A; each finding names its intended task.

Severity: **P0** blocks deployment. **P1** must be cleared before the Enterprise
Baseline Freeze. **P2** should be scheduled. **P3** is recorded, not urgent.

---

## Status at Phase 10A close

| ID | Severity | Status |
|---|---|---|
| F-00 Next.js 16.2.10 | P1 | **Resolved** — 16.3.3 (Task 47) |
| F-01 no rate limiting | P1 | **Resolved** — Task 66 |
| F-02 15 MB action bodies | P2 | **Resolved** — 2 MB, Task 66 |
| F-03 no security headers | P2 | **Partly resolved** — four headers shipped; **CSP still open** |
| F-04 unredacted telemetry egress | P1 | **Resolved** — Task 66 |
| F-05 Sentry on a legacy VEDA project | P2 | **Resolved** — Task 66 |
| F-06 unauthenticated `/monitoring` | P2 | **Resolved** — opt-in, Task 66 |
| F-07 `/api/metrics` open outside production | P3 | Open — deliberate |
| F-08 transitive advisories | P2 | **Resolved** — analysis done; browser-reachable one removed |
| **F-09 Layer-2 sweep** | **P1** | **Resolved** — seven queries, Task 66 |

Every P0 and P1 is closed. The two that remain are a P2 needing analysis before
it can be called exploitable, and a P3 that is deliberate.

---

## F-09 · P1 · Seven more queries missing Layer 2 (found by the sweep this ledger argued for)

**Evidence.** Every plywood query was classified by whether it reads
godown-anchored records. 27 of 36 applied no godown filter; most read records
that are not anchored to a godown, where a filter would be a scope rule with no
basis in the model. Seven were genuine holes:

`purchaseOrderDetail`, `salesOrderDetail`, `purchaseMatch`,
`goodsReceiptDetail`, `purchaseReviewQueue`, `listGodownRacks`,
`stockAvailability`.

**Why it matters.** A warehouse role restricted to one godown could open another
godown's purchase or sales order by id — supplier, customer, prices, credit
position, receipts — and read another branch's rack layout and stock. Identical
in shape to the `productMovements` hole already fixed: Layer 1 passed, which is
what made it look authorized.

**This is the finding that justifies the sweep.** Five point fixes would have
left these seven in place. The ledger's own observation — that four of five
earlier defects shared one shape — was the reason to look, and looking found
almost as many again.
→ **Resolved in Task 66.**

---

## Open findings

### F-00 · P1 · Next.js 16.2.10 carries known vulnerabilities
**Evidence.** `npm audit`: `next` high, "Middleware / Proxy bypass in App Router
applications using Turbopack and single locale" and "Denial of Service in App
Router using Server Actions". This project builds with Turbopack and uses server
actions as its primary write path, so both advisories describe this
application's configuration rather than a hypothetical one.

**Also resolved by the same upgrade:** `postcss` (high — arbitrary file read via
attacker-controlled `sourceMappingURL`) and `sharp` (high — inherited libvips
CVEs). Both are transitive through `next`.

**Fix is non-breaking:** `npm audit` reports `next@16.3.3`,
`isSemVerMajor: false`.
→ **Task 47** (plan already written).

### F-01 · P1 · No rate limiting anywhere, including sign-in
**Evidence.** No `middleware.ts` exists. No `rateLimit`/`throttle` symbol
appears anywhere in `src/`. `signInWithPassword` calls Supabase directly with no
attempt counter, and `/api/scheduled`, `/api/metrics` and `/monitoring` have
none either.

**Why it matters.** Credential stuffing against sign-in is unthrottled, and
failure responses correctly do not distinguish "no such user" from "wrong
password" — which is right for enumeration but means an attacker's only cost is
request volume, and there is no cost on volume. Supabase applies its own limits
at its edge; this application applies none, and that distinction matters for a
self-hosted deployment where Supabase may be swapped out.
→ **Phase 10A, new task.**

### F-02 · P2 · Server-action body limit raised to 15 MB
**Evidence.** `next.config.ts`: `experimental.serverActions.bodySizeLimit:
'15mb'`, against a 1 MB default.

**Why it matters.** It applies to *every* server action including the
unauthenticated `signInWithPassword`, so an anonymous caller can make the server
buffer 15 MB per request. Combined with F-01 (no rate limit) this is a cheap
memory-pressure vector. The limit was presumably raised for file upload; the
narrower fix is a per-action limit rather than a global one.
→ **Phase 10A, same task as F-01.**

### F-03 · P2 · No security response headers
**Evidence.** `next.config.ts` sets `poweredByHeader: false` and defines no
`headers()`. No CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options` or
`Referrer-Policy`.

**Why it matters.** Clickjacking and MIME-sniffing have no mitigation, and any
future XSS has no CSP to contain it. This is also the first thing an enterprise
security questionnaire asks for, so it has commercial as well as technical
weight.
→ **Phase 10A, new task.**

### F-04 · P1 · Tenant business data egresses to Sentry unredacted
**Evidence.** `sentry.{server,client,edge}.config.ts` each call `Sentry.init`
with `dsn`, `tracesSampleRate: 1`, `debug: false` — **no `beforeSend`, no
`ignoreErrors`, no scrubbing**. The platform's redaction (`redactMessage`,
`redactFieldsForLog`, `isSensitiveField`) lives in `observability.ts`'s `log()`
and Sentry does not go through it.

Error messages in this codebase deliberately carry business detail so operators
get actionable failures — product names, supplier invoice numbers, godown and
role identifiers. Those leave the deployment to a third-party SaaS.

**Mitigating fact, not a control:** Sentry initialises only when
`NEXT_PUBLIC_SENTRY_DSN` is set.
→ **Phase 10A, new task.** Fix shape: a `beforeSend` that runs the same
redaction the logger uses, so there is one scrubbing implementation rather than
two that can drift.

### F-05 · P2 · Sentry reports into a legacy VEDA project
**Evidence.** `next.config.ts`: `org: "factory-qc"`, `project:
"factory-qc-platform"`.

**Why it matters.** Two ways. It is legacy VEDA naming, which `CLAUDE.md`
forbids in the active tree. And operationally, Verity's production errors —
carrying the tenant data of F-04 — are delivered into a different product's
Sentry organisation, which is a data-governance problem independent of the
scrubbing one.
→ **Phase 10A, same task as F-04.**

### F-06 · P2 · `/monitoring` is an unauthenticated forwarding endpoint
**Evidence.** `tunnelRoute: "/monitoring"` in `sentryConfig`. It exists at
runtime and appears in no `route.ts`, so a route inventory taken by listing
files misses it — it is recorded in 46A for that reason.

**Why it matters.** Unauthenticated, unrate-limited, and its purpose is to
forward request bodies to an external host. Bounded by the Sentry SDK's envelope
handling rather than by anything in this codebase.
→ **Phase 10A, same task as F-04.**

### F-07 · P3 · `/api/metrics` is open outside production
**Evidence.** `src/app/api/metrics/route.ts`: the secret check returns `true`
early when `identity.environment !== "production"`.

**Why it matters.** Staging and preview environments frequently hold real or
realistic data, and operational counters describe the system's shape. Low
severity because it is deliberate and documented in the route, recorded because
"non-production" is doing more security work than it looks.
→ **Phase 10A, discretionary.**

### F-08 · P2 · Transitive advisories — **reachability established**
**Evidence.** `npm audit`: `brace-expansion` (DoS), `deepmerge-ts` (stack
exhaustion), `fast-uri` (host confusion), `js-yaml` (quadratic CPU in `!!omap`,
CVE-2026-59870 not backported), `nanoid` (infinite loop at size zero),
`dompurify` (XSS via `IN_PLACE` hook removal). All transitive; several reachable
only from build tooling rather than the request path.

**Reachability analysis (Task 66).** Each was traced to the dependency that
pulls it in:

| Advisory | Enters via | Reachable from a request? |
|---|---|---|
| `js-yaml` | `@eslint/eslintrc` | No — lint only, devDependency |
| `fast-uri` | `ajv` | No — schema tooling, build time |
| `brace-expansion` | `minimatch` | No — glob matching, tooling |
| `nanoid` | `postcss` | No — build-time source-map ids |
| `deepmerge-ts` | `@prisma/config` ← `prisma` | No — CLI, devDependency |
| `prisma` / `@prisma/config` | direct devDependency | No — migrations, not runtime |
| `dompurify` | **`posthog-js`** | **Yes — shipped to the browser** |

Six are build- or development-time and never enter the request path. The
seventh did.

**`posthog-js` was a runtime dependency with zero references anywhere in the
source.** An unused analytics SDK, shipping to the browser, in a system holding
other businesses' books — and the only path by which a browser-reachable XSS
advisory entered the tree. Removed. That is also the right outcome
independently of the advisory: an analytics SDK nobody imports is egress no one
decided to accept.

Result: 8 advisories → 7, and the moderate `dompurify` is gone. Every remaining
advisory is build- or development-time. The `posthog-js` name is deliberately
kept in `observability.test.ts`'s forbidden-import assertion, so re-adding it
would have to pass that test again.
→ **Resolved in Task 66.**

---

## Findings already remediated during Phase-11-style capability work

Recorded because they were real, and because the audit must not claim to have
found a clean system. Each was fixed under its own commit before this ledger
existed.

| Was | Severity | Fixed in |
|---|---|---|
| `productMovements` applied no godown row scope — a warehouse role restricted to one godown could read every godown's movement history. Layer 1 passed, which is what made it look authorized. | P0 | Task 55 |
| `listCustomers` used a second definition of credit exposure, disagreeing with the check that blocks orders, on the screen a sales manager decides from. | P0 | Task 54 |
| Purchase invoices stored no tax split, so input credit was structurally always nil and the GST estimate overstated tax payable by the entire input side. | P0 | Task 57 |
| `ownerConsole` read stock tenant-wide, so a godown-scoped role saw whole-business inventory value on its home screen. | P1 | Task 60 |
| The configuration page had **no authorization check at all** — any authenticated member could read every configuration key by URL. The nav link was hidden from most of them, which made it look controlled. | P1 | commit `6e4bb0a` |

The pattern in four of these five is the same and is worth stating: **Layer 1
was enforced and Layer 2 was not.** A missing row scope is invisible from the
write path and from the permission model; it only appears when someone asks
"what does this actually return for a restricted role". Phase 10A should include
a systematic Layer-2 sweep of every query handler rather than treating these as
five unrelated fixes.

---

## Confirmed sound

Recorded so that a later reader knows these were examined, not skipped.

- **Tenant isolation.** RLS enabled and forced; `verity_app` verified live as
  `rolsuper=f, rolbypassrls=f`; `assertRlsEnforceable()` refuses a bypassing
  role at startup; tenant context derives from the actor and never from a
  payload.
- **Secret-gated routes fail closed.** `/api/scheduled` and `/api/metrics` use
  `timingSafeEqual` and return 503 when unconfigured rather than running open.
- **`/api/ready` sanitises credentials** out of driver error text.
- **Log redaction** is applied to both message and fields, recursively.
- **Sign-in credentials never reach the log** — `FormData` signature, adopted
  specifically to stop Next.js logging plaintext passwords as action arguments.
- **HQ authorization is at the data-access boundary, not the route.** Verified
  page by page; no page relies on a layout guard alone, which matters because
  App Router layouts and pages render in parallel.
- **Append-only invariants** on stock ledger, invoices and closed periods are
  database-enforced, not application-enforced.
