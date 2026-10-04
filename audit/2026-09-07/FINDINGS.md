# Verity — functional, conformance and security-control audit

**Run:** 2026-09-07 · **Auditor:** Claude Code session · **Prompt:** `taskplans/archive/102_functional_and_security_control_audit_prompt.md`
**Status:** complete for the scope stated in "What was not tested". Nothing in the repository or the database was modified.

## Environment audited

| | |
|---|---|
| **Application** | `http://localhost:3000` — Next.js 16.3.3 dev server (pid 3360, started 2026-09-06 21:02), working tree at commit `363f098`, clean |
| **Database** | Supabase project `ygkjidaggwvhjgpqlkmj`, region `ap-south-1`, transaction pooler `:6543`, `connection_limit=3`, `pool_timeout=20` |
| **Environment class** | **PRODUCTION DATA.** `.env` points the local app at the same Supabase project that serves `https://app.theverityai.xyz`. There is no separate development database. |
| **Runtime role** | `verity_app` — verified `rolsuper = false`, `rolbypassrls = false` |
| **Method** | Black-box first (pages driven with Playwright, requests replayed, rows read back through the runtime role), then source review. **Read-only throughout** — no write probe was run, on the operator's instruction. |

### Identities used

Re-used from the previous run's seeded audit identities (`npm run seed:audit-tenant` plus the operator/owner/manager logins). Sessions were re-established by signing in; no password was changed and no account was created.

| Handle | Tenant | Role |
|---|---|---|
| `operator` | Verity Platform | Verity Operator |
| `ownerA` | Shri Ganesh Timber Trading Co. (`96793a76…`) | Owner |
| `managerA` | Shri Ganesh | Manager (Organization scope) |
| `ownerB` | Vireshwar Timber Mart (`b0000000…0001`) | Owner |
| `staffB` | Vireshwar (child org) | Counter Staff |
| `rolelessB` | Vireshwar | **no role** |

Tenant A: 12 customers, 5 suppliers, 31 products, 31 sales orders, 48 invoices, 73 activity rows, 1,185 domain events, 7 active capabilities, 1 organization.
Tenant B: 3 customers, 8 products, 2 invoices, 5 active capabilities, 2 organizations.
`field_permission` rows in either tenant: **0**.

---

## Executive summary — the five that matter

Thirty-eight findings. Ranked by what they cost the business rather than by how interesting they are.

1. **The application does not render its own core screens.** With one user and twelve customers,
   `/customers`, `/sales`, `/prices`, `/ledgers`, `/transactions`, `/workspace` and `/evidence`
   fail with a `Transaction API error` and show "This page couldn't load". The app's own
   `/api/ready` probe reports `not_ready` at the same time. The cause is a per-customer,
   three-query loop inside one 15-second transaction holding one of three pooled connections —
   so **one tenant's slow page starves every other tenant's requests.** This is live, on
   production data, today. (**F-001**, **F-002**)
2. **A GST return is wrong, and two other money figures with it.** GSTR-3B counts unconfirmed
   provisional purchase bills as eligible input tax credit — overstating claimable credit and
   understating cash payable — while the *same codebase* excludes them correctly in two other
   places. Separately, every invoice number's financial year is computed in UTC, so a document
   raised before 05:30 IST on 1 April is numbered into the wrong year while the returns report it
   in the right one; and "paid" is read from `payment.invoiceId` rather than from allocations in
   six places, including the credit check, so a customer who has paid can be refused credit.
   (**F-023**, **F-024**, **F-025**)
3. **Authorization is one layer deep, and two paths escalate inside a tenant.** Anyone holding
   `Edit` on membership can assign themselves the Owner role; anyone holding `Edit` on role can
   grant their own role any permission. Layer 2 row scoping exists in three capabilities of
   twelve and **cannot work at all** for entities carrying no organization or location anchor —
   observed: a branch counter clerk reads the head office's entire customer book with credit
   limits and exposure. Layer 3 never runs. The audit screen is gated on "holds any permission at
   all", and grants the security-event stream to anyone with a `Delete` on anything. A membership
   with **no role** — the fail-closed state — reads the tenant's last 60 domain events on the
   home page. (**F-003**, **F-004**, **F-005**, **F-031**, **F-033**, **F-034**, **F-006**)
4. **Nothing reports failure.** `captureError()` has zero call sites; there is no
   `instrumentation.ts`, so the Sentry server config is never loaded; there is no `error.tsx`
   anywhere, which is why an inactive capability renders a raw 500 on **30 of 47 routes for the
   platform operator**; the scheduled endpoint returns HTTP 200 when every unit fails; and a
   failed sign-in is written to no audit trail. The metrics endpoint reported `"counters":{}`
   after fourteen hours and several hundred logged errors. (**F-009**, **F-010**, **F-011**)
5. **The session cookie is readable by JavaScript and lives ~13 months, there is no CSP, and rate
   limiting protects sign-in and nothing else** — including `/api/agent/chat`, which accepts a
   message of any length and can run eight tool-calling iterations per request against the same
   three-connection pool. (**F-007**, **F-008**)

What is genuinely solid is worth stating too, because it is most of the platform: tenant
isolation, the identity model, the command/query pipeline, immutability of posted documents, the
HQ boundary, invoice numbering, the CGST/SGST-versus-IGST decision, and the agent channel's
authority model all hold under test. See `ATTEMPTED-AND-FAILED.md`, which is longer than this
file's Critical section for a reason.

---

## Findings

### F-001 — Core business screens fail to render for the tenant owner

- **Severity:** Critical
- **Category:** Availability / Correctness
- **Surface:** `/customers`, `/sales`, `/prices`, `/ledgers`, `/transactions`, `/workspace`, `/evidence` — 8 of the 47 routes swept, plus `/configuration` which timed out at 30 s and redirected to `/`
- **Actor:** `ownerA`, Owner role, tenant A — the most privileged ordinary user there is
- **Reproduction:**
  1. Sign in as the tenant owner.
  2. Navigate to `/customers`.
  3. Observe the page body.
- **Observed:** `This page couldn't load — A server error occurred. Reload to try again.` The dev server log records, at `14:37:45`, `14:38:14`, `14:38:46`, `14:39:08` (four consecutive loads):
  ```
  ⨯ PrismaClientKnownRequestError:
  Invalid `tx.tradingSalesOrder.findMany()` invocation …
  Transaction API error: Transaction not found. Transaction ID is invalid, refers to an
  old closed transaction Prisma doesn't have information about anymore, or was obtained
  before disconnecting.
  ```
  and separately, on `/workspace` and `/`:
  ```
  ⨯ PrismaClientKnownRequestError: Transaction API error: Unable to start a transaction in the given time.
  ```
- **Expected:** The page renders. `PRN-001` (least surprise) at minimum requires a failure a human can act on.
- **Impact:** The customer list, the sales list, the price sheet, the ledgers and the transaction register are the screens a plywood business runs its day on. They are unusable. The failure is not a cosmetic one — it is the whole page. A full 47-route sweep as the tenant owner produced 12 failing routes: these 8, plus the 4 dine-in routes covered by F-009.
- **Confidence:** Confirmed (observed live, four times, with matching server-side stack traces).
- **Suggested direction:** Root cause is **F-002**. The transaction runs longer than `VERITY_TX_TIMEOUT_MS` (default 15,000 ms) and Prisma discards it mid-flight; while it is held, other requests exhaust the 3-connection pool and fail with the second message.

### F-002 — Customer exposure is recomputed per row inside a single interactive transaction

- **Severity:** Critical
- **Category:** Correctness / Availability
- **Surface:** `verity.trading.list_customers`, `verity.trading.customer_detail`
- **Reproduction:** load `/customers` as any actor in a tenant with a non-trivial customer list.
- **Observed:** `src/server/capabilities/trading/orders.ts:3124-3126` loops the customer list and calls `customerExposurePaise(ctx.tx, customer.id)` once per customer. Each call issues three queries (`orders.ts:1765` invoices with nested `payments` and `notes`, `:1798` sales orders, `:1808` invoices by order). For N customers that is **3N sequential round-trips**, all inside the one `withTenant` interactive transaction (`src/server/platform/tenancy.ts:109`, `timeout: 15,000 ms`, `maxWait: 5,000 ms`), against a pooler in `ap-south-1`.
  Twelve customers is already enough to blow the budget on this deployment.
- **Expected:** A list screen's cost should not scale with a per-row multi-query computation, and certainly not inside a transaction holding one of three pooled connections.
- **Impact:** Two compounding costs. (a) The page fails outright — F-001. (b) While it runs it holds a pooled connection, and `CLAUDE.md` records the pool as the thing that already took production down once; **one tenant's slow page starves every other tenant's requests.** That is a cross-tenant availability coupling with no attacker involved.
- **The controlled comparison.** The same 47-route sweep as `ownerB` — Owner of tenant B, same code, same server, same pool, **3 customers instead of 12** — renders `/customers`, `/sales`, `/prices`, `/ledgers` and `/transactions` **without error**. Tenant B fails only on `/workspace`, `/evidence` and `/configuration` (pool starvation) and the five dine-in routes (F-009). The variable is the customer count, which is exactly what the per-row loop scales on.
- **Corroboration from the app's own probe.** While the sweep was running, `GET /api/ready` returned
  ```json
  {"status":"not_ready","checks":{"db":"error","detail":"database probe timed out after 3000ms"},"durationMs":3004}
  ```
  The readiness probe cannot get a database connection within three seconds while a single user browses. On a deployment that honours readiness, instances would be pulled from rotation under ordinary use.
- **Confidence:** Confirmed (code read, the live failure it produces, and the readiness probe failing alongside it).
- **Suggested direction:** Compute exposure set-wise — one grouped query over invoices/payments/notes and one over committed orders — rather than per customer. The comment at `orders.ts:3121-3123` correctly explains why the calls cannot be parallelised on one connection; that is an argument for not making N of them.

### F-003 — An actor with `Edit` on membership can assign any role, including to themselves

- **Severity:** High
- **Category:** Security control / Authorization
- **Surface:** `verity.platform.assign_role`, `verity.platform.invite_person`
- **Reproduction (from source; not executed, because it is a write):**
  1. Hold a role granting `Edit` on `verity.platform.membership` — a plausible onboarding/HR grant, not necessarily an administrative one.
  2. Call `assignRole({ membershipId: <your own membershipId>, roleId: <the tenant's Owner role id> })`.
- **Observed:** `src/server/platform/administration.ts:282-296` — `verb: "Edit"`, `entity: ENTITY_MEMBERSHIP`. The only precondition (`:298-302`) is that the role exists in the tenant. No check that the actor already holds the permissions the target role carries, and — unlike `revokeMembership`, which explicitly refuses `input.membershipId === ctx.actor.membershipId` at `:350-355` — no self-target guard. `invitePerson` (`:252-256`, reached from `src/server/actions/people.ts:43-49,101-108`) takes a client-supplied `roleId` under the same single `Create`-on-membership gate.
- **Expected:** Granting authority you do not hold is escalation. PLA-AUT-001 composes roles; nothing in Bible or spec authorises an actor to confer more than they hold.
- **Impact:** Any user trusted to add a colleague can become the tenant Owner. The act is written to the security stream (`RoleAssigned`), so it is *detectable* — but nothing prevents it.
- **Confidence:** Confirmed from source; the exploiting call was deliberately not executed against production data.
- **Suggested direction:** A grant ceiling resolved through `verity.resolve_permissions` — an actor may confer only what they already hold — plus a self-target guard mirroring `revokeMembership`.

### F-004 — An actor with `Edit` on role can grant their own role any permission

- **Severity:** High
- **Category:** Security control / Authorization
- **Surface:** `verity.platform.grant_permission`
- **Observed:** `src/server/platform/administration.ts:518-548` — `verb: "Edit"`, `entity: ENTITY_ROLE`, input `{ roleId, verb, entity, scope }` where `entity` is a free string (correct, per the platform ontology rule) and `scope` is any of `Tenant | Organization | Location`. The preconditions check only that the role exists and the grant is not a duplicate. There is no check that `roleId` is not the actor's own role, and none that the actor holds the permission being granted.
- **Expected:** As F-003.
- **Impact:** Escalation to full tenant authority in one command, from a grant that reads like "may edit roles".
- **Confidence:** Confirmed from source.
- **Suggested direction:** Same ceiling check. Note that `Global` is already correctly filtered out of resolution (`verity.resolve_permissions`), so the tenant boundary itself is not crossed — this is escalation **inside** a tenant, not across one.

### F-005 — Layer 2 row scoping exists in three capabilities and in none of the other nine

- **Severity:** High
- **Category:** Architecture / Security control
- **Surface:** `accounting`, `approval`, `asset`, `billing`, `dinein`, `evidence`, `hr`, `inventory`, `scheduling`
- **Observed:** Counting call sites of every Layer-2 helper (`ctx.scope()`, `assertRowInScope`, `reachableOrganizations`, `reachableGodownIds`, `godownFilter`, `assertGodownInScope`) per capability:

  | capability | registered keys | Layer-2 calls |
  |---|---|---|
  | trading | 97 | 42 |
  | plywood | 10 | 2 |
  | location | 8 | 1 |
  | accounting | 7 | **0** |
  | approval | 3 | **0** |
  | asset | 4 | **0** |
  | billing | 7 | **0** |
  | dinein | 30 | **0** |
  | evidence | 2 | **0** |
  | hr | 8 | **0** |
  | inventory | 7 | **0** |
  | scheduling | 5 | **0** |

  `assertRowInScope` (`src/server/platform/authorization.ts:268`) has **zero** callers anywhere in the application; `ctx.scope()` has one (`src/server/capabilities/location/index.ts:333`).
- **Expected:** `CLAUDE.md` — "All three layers are enforced… Layer 2 `assertRowInScope()` / `scopeFilter()` decides which records are theirs". PLA-ORG-002 downward visibility and PLA-ORG-003 sibling isolation.
- **Impact:** In those nine capabilities an Organization-scoped role reads and mutates every row in the tenant. `trading/scope.ts:17-22` documents this exact defect being closed for plywood — "Layer 1 was enforced and Layer 2 was not, which is the worst combination: it looks authorized." The same sentence is still true of nine capabilities.
- **Confidence:** Confirmed from source. Not confirmed behaviourally, because no tenant in this database has both a multi-organization hierarchy and one of the nine capabilities carrying data.
- **Suggested direction:** The platform cannot enforce this centrally today because the row→organization hop is capability-specific. Either give the query pipeline a declared scope anchor per entity so Layer 2 becomes default-on, or record each unscoped capability as a known gap — but do not leave the claim in `CLAUDE.md` as written.

### F-006 — Layer 3 field redaction never runs

- **Severity:** Medium
- **Category:** Security control
- **Surface:** the query pipeline, all capabilities
- **Observed:** Three independent facts. (a) `src/server/platform/query.ts:121-131` applies `redactFields` **only** when the handler's result is a top-level array of objects; every `*_detail` query returns an object and is therefore never redacted. (b) `ctx.redact(...)` is offered at `query.ts:114` and called by **zero** handlers. (c) `field_permission` holds 0 rows in both audited tenants, so no restricted field is declared anywhere.
- **Expected:** `CLAUDE.md`: "Layer 3 `redactFields()` removes restricted fields, applied automatically to a top-level array result."
- **Impact:** Today: nil, because nothing is declared restricted. The moment a `FieldPermission` row is added — e.g. to hide cost price from a counter role — it will take effect on list screens and silently not take effect on any detail screen. That is worse than the control being absent, because it will be believed.
- **Confidence:** Confirmed.
- **Suggested direction:** Either redact object results too (walking one level), or make a declared `FieldPermission` on an entity whose queries return objects a startup-time error.

### F-007 — Session cookie is not `HttpOnly`, lives ~13 months, and no CSP is served

- **Severity:** High
- **Category:** Security control
- **Surface:** the `sb-<project>-auth-token` cookie; all responses
- **Reproduction:** sign in with any identity and read the cookie jar.
- **Observed:** every identity receives exactly one auth cookie with `httpOnly: false`, `secure: false` (localhost), `sameSite: "Lax"`, `path: "/"`, `expires` ≈ 2027-10 — a ~13-month lifetime on a cookie that carries the Supabase access **and refresh** token. The `verity_active_membership` cookie, by contrast, is correctly `httpOnly: true` (`src/server/platform/auth.ts:242-247`).
  Response headers on production (`https://app.theverityai.xyz/sign-in`, checked live): `strict-transport-security`, `x-frame-options: DENY`, `x-content-type-options: nosniff`, `referrer-policy` — and **no `Content-Security-Policy`**, no `Permissions-Policy`. `next.config.ts:60-78` documents the CSP omission as deliberate and deferred to `taskplans/66`.
- **Expected:** A session token no client-side code reads should be `HttpOnly`. Nothing in this application uses a Supabase **browser** client — `createBrowserClient` appears nowhere; the only `supabase.auth` calls are in `src/proxy.ts` and `src/server/platform/auth.ts`, both server-side. So the cookie is readable by script for no functional reason.
- **Impact:** Any script execution in the app's origin yields a 13-month session, and with no CSP there is no second line of defence. `localStorage`/`sessionStorage` were checked and are empty, which is the one part of this that is right.
- **Confidence:** Confirmed for the audited environment. **Not verified on production** — the `Secure` flag depends on `NODE_ENV`/host and I did not sign in against `app.theverityai.xyz`.
- **Suggested direction:** Set `httpOnly: true` in the `@supabase/ssr` cookie options (both `src/proxy.ts:36-41` and `src/server/platform/auth.ts:94-104`), shorten the session lifetime, and move CSP off the deferred list.

### F-008 — Rate limiting protects sign-in and nothing else

- **Severity:** High
- **Category:** Availability / Cost
- **Surface:** `/api/agent/chat`, every server action
- **Observed:** `rateLimit()`, `SIGN_IN_LIMIT` and `signInKey` (`src/server/platform/rate-limit.ts`) have exactly one call site in the whole application: `src/server/actions/platform.ts:146`. `/api/agent/chat` (`src/app/api/agent/chat/route.ts:30-60`) requires a session and then accepts a `message` of any length and a `history` array of any size (`isChatRequestBody`, `:22-28`, checks `typeof === "string"` and `Array.isArray` only). Each turn may run up to `MAX_TOOL_ITERATIONS = 8` model round-trips, each of which may execute commands and queries. The 2 MB `serverActions.bodySizeLimit` in `next.config.ts` does **not** apply to route handlers.
- **Expected:** Phase 7 §7 of the audit brief; and the module's own doc comment describes itself as the protection that must not disappear.
- **Impact:** One authenticated user can drive unbounded LLM-provider spend and unbounded database load. Because the pool is three connections wide (F-002), that load is felt by every tenant.
- **Confidence:** Confirmed.
- **Suggested direction:** Cap `message` and `history` in the route's own validator, and apply `rateLimit()` keyed on the actor to the chat route and the heaviest server actions. Note the existing limiter is per-process and per-email — documented honestly in the module, and a password-spray across many accounts is not covered by it.

### F-009 — An inactive capability produces an unhandled 500, and the application has no error boundary

- **Severity:** High
- **Category:** Interface / Availability
- **Surface:** every page whose capability is not active for the tenant — 30 of 47 routes for the platform operator
- **Reproduction:**
  1. Sign in as the platform operator (whose platform tenant has neither `trading` nor `dinein`).
  2. Visit `/catalogue`, `/sales`, `/tax/gstr-1`, `/reports/finance`, `/settings/tax`.
  3. As any plywood-tenant user, visit `/floor`, `/floor/setup`, `/kitchen`, `/menu`.
- **Observed:** every one of those renders `This page couldn't load — A server error occurred. Reload to try again. ERROR <digest>`. Server log:
  ```
  ⨯ CapabilityError: E_CAPABILITY_INACTIVE: verity.capability.trading is not active for this tenant
      at requireCapabilityActive (src/server/platform/capability.ts:73:11)
      at <anonymous> (src/server/platform/query.ts:102:21)
      at Gstr1Page (src/app/(shell)/tax/gstr-1/page.tsx:46:15)
  ```
  `find src/app -name error.tsx -o -name global-error.tsx` returns **nothing** — there is no App Router error boundary anywhere in the tree.
- **Expected:** PRN-001. A capability that is simply not activated is an ordinary, expected state, not a crash. The routes should not be navigable, or should say so.
- **Impact:** The most common configuration state in a multi-capability platform renders as a server crash. It also means a route that exists but is not contributed by any active capability is reachable by URL — which is how the shell's route/capability decoupling shows its seam.
- **Scale, measured.** A full 47-route sweep signed in as the **platform operator** — whose platform tenant activates neither `trading` nor `dinein` — returns the server-error page on **30 of 47 routes**. The operator's own HQ surfaces (`/hq`, `/hq/clients`, `/hq/audit`, `/hq/settings`) all render correctly; it is the shared business shell that crashes. The same 4 dine-in routes crash for every plywood-tenant identity.
- **Confidence:** Confirmed (30 pages for the operator, 4 more for each tenant identity, both directions — trading-less tenant and dinein-less tenant).
- **Suggested direction:** Catch `CapabilityError` at the shell layout and render a "not enabled for this workspace" state; add `error.tsx` so that no unexpected throw ever reaches Next's default page.

### F-010 — Nothing reports errors: `captureError` has no call sites and Sentry's server config is never loaded

- **Severity:** High
- **Category:** Availability / Operations
- **Surface:** the whole server tree
- **Observed:**
  - `grep -rn "captureError(" src` returns the definition (`src/server/platform/observability.ts:336`) and its own doc comment. **Zero call sites.** `errors_total` is only incremented inside it, so it is always zero — consistent with `/api/metrics` returning `"counters":{}` after 14 hours of uptime and hundreds of logged errors.
  - There is **no `instrumentation.ts`** anywhere in the repository. `sentry.server.config.ts` and `sentry.edge.config.ts` exist and are imported by nothing (`grep` for their names returns no importer). In Next.js the server-side Sentry init is loaded through `instrumentation.ts`; without it, the server SDK — and therefore `scrubTelemetryEvent`, which is wired only into those configs — never initialises.
  - Failed sign-ins are recorded nowhere. `src/server/actions/platform.ts:166-172` documents the reason (no tenant context before authentication) and leaves it to "the auth provider's own log".
- **Expected:** Phase 4 of the brief: "Confirm the audit trail records failed and forbidden attempts, not only successful ones." And an accounting platform that cannot see its own failures cannot be operated.
- **Impact:** Every one of the errors in F-001 and F-009 reached a user and no operator signal exists anywhere. In production the user sees a digest and the operator sees nothing.
- **The Sentry half is confirmed, not inferred.** `@sentry/nextjs` 10.63.0 loads the server SDK from `instrumentation.ts` (`build/cjs/config/webpack.js:28-34`) and the browser SDK from `instrumentation-client.ts`, and its own code carries this warning: *"DEPRECATION WARNING: It is recommended renaming your `sentry.client.config.ts` file, or moving its content to `instrumentation-client.ts`. **When using Turbopack `sentry.client.config.ts` will no longer work.**"* This repository has `sentry.server.config.ts`, `sentry.client.config.ts` and `sentry.edge.config.ts`, **no `instrumentation.ts`, no `instrumentation-client.ts`**, and `next build` uses Turbopack (stated in `next.config.ts:135-137`). Neither SDK initialises, so `scrubTelemetryEvent` — wired only into those three files — never runs either. The same library also warns about the missing `global-error.js`, which is F-009.
- **Confidence:** Confirmed.
- **Suggested direction:** Call `captureError` from `toActionFailure` and from an `error.tsx`; add `instrumentation.ts` re-exporting the Sentry configs; record failed authentication against the platform tenant or a dedicated stream.

### F-011 — The scheduled endpoint returns HTTP 200 when every unit fails

- **Severity:** Medium
- **Category:** Availability / Operations
- **Surface:** `POST|GET /api/scheduled`
- **Observed:** `src/app/api/scheduled/route.ts:98-103` returns `NextResponse.json({ cadence, tenants, ran, results })` unconditionally. `runDueWork` (`src/server/platform/contribution.ts:335-360`) catches each unit's failure into `{ status: "failed", error }` and logs nothing. The per-tenant loop (`route.ts:93-96`) has no per-tenant try/catch, and `runForTenant`'s own `tenantActivation.findMany` (`:126-132`) sits outside that catch — one tenant's exception aborts every tenant after it.
- **Expected:** ADR-015 bound this trigger precisely so scheduled work would stop failing invisibly.
- **Impact:** Vercel Cron records a green run forever while SLA sweeps, low-stock notifications and metric snapshots fail. This is the incident ADR-015 exists to prevent, reintroduced one layer up.
- **Confidence:** Confirmed from source. Not exercised — the endpoint runs work, and this audit was read-only.
- **Suggested direction:** Non-200 (or an explicit alertable flag) when any outcome failed; log each failure; wrap the per-tenant loop.

### F-012 — Dine-in bills silently charge 0% GST when the rate is not configured

- **Severity:** High
- **Category:** Regulatory
- **Surface:** `verity.dinein.generate_bill` / `settle_bill`
- **Observed:** `src/server/capabilities/dinein/index.ts:876-877`:
  ```ts
  const cgstRateBp = Math.round(Number((await resolveConfig<number>(ctx.tx, CONFIG_CGST_RATE)) ?? 0) * 100);
  const sgstRateBp = Math.round(Number((await resolveConfig<number>(ctx.tx, CONFIG_SGST_RATE)) ?? 0) * 100);
  ```
  `resolveConfig` returns `undefined` when no `ConfigParameter` row exists at any scope (`src/server/platform/capability.ts:141-159`), so "never configured" and "configured as zero" are indistinguishable. The trading capability faces the identical situation and **refuses**: `src/server/capabilities/trading/finance.ts:793-802` throws `E_VALIDATION: no GST registration and no fallback rates are configured, so tax cannot be decided`.
- **Expected:** The brief's own line: zero tax must be recorded as a statement, never as a gap. Two capabilities in the same platform must not answer the same question differently.
- **Impact:** A restaurant tenant whose admin has not yet opened Settings → Tax bills every cover at 0% GST. The bill then settles and locks. The under-collected tax is a liability the business still owes.
- **Confidence:** Confirmed from source. Not exercised — `dinein` is not active for either audited tenant.
- **Suggested direction:** Adopt `finance.ts`'s behaviour: refuse, or require an explicit exempt flag.

### F-013 — Billing generates a permanent ₹0 invoice when readings are missing

- **Severity:** Medium
- **Category:** Correctness / Regulatory
- **Surface:** `verity.billing.generate_invoice_for_meter`
- **Observed:** `src/server/capabilities/billing/index.ts:159-217` — `const usageUnits = usage._sum.readingUnits ?? 0;` with no precondition that any reading exists for the period, and a uniqueness guard on `(tenantId, meterId, billingPeriodId)` (`:184-197`) that makes the ₹0 invoice unrepeatable once written.
- **Expected:** "No readings received" and "zero usage" are different facts.
- **Impact:** An ingestion outage becomes a permanent under-bill with no correction path.
- **Confidence:** Confirmed from source; not exercised (capability inactive here).

### F-014 — Unrecognised errors are returned to the client verbatim

- **Severity:** Medium
- **Category:** Security control / Interface
- **Surface:** every server action and API route
- **Observed:** `src/server/platform/action-error.ts:68-69` — the `E_UNKNOWN` fallback returns `error.message` unchanged. Consumed by `src/server/actions/platform.ts:69,84`, `src/server/actions/hq.ts:104,124`, `src/server/platform/agent-chat.ts:199-200` and `src/app/api/agent/chat/route.ts:59`. A Prisma exception's message names models, relations and sometimes query fragments — exactly the content `telemetry-scrub.ts` was written to keep out of Sentry, taking the shorter path to the browser instead. `src/server/actions/hq.ts:29-39` already implements the right behaviour ("Something went wrong") and is bypassed by `runClientCommand`/`runClientQuery` in the same file.
- **Impact:** Internal schema detail disclosed to any authenticated user; in the HQ case, to an operator.
- **Confidence:** Confirmed from source.

### F-015 — The agent may change authorization without confirmation, and tool output is fed back unsanitised

- **Severity:** High
- **Category:** Security control
- **Surface:** `/api/agent/chat`, `src/server/platform/batch.ts`, `src/server/platform/administration.ts`
- **Observed:** `batch.ts:71` requires human approval only when `def.impact === "destructive"`; `command.ts:100` leaves `impact` undefined by default. Only four commands are marked destructive (`accounting.post_journal_entry`, `accounting.reverse_journal_entry`, `hr.decide_leave_application`, `billing.generate_invoice_for_meter`). **`assign_role`, `grant_permission`, `invite_person`, `revoke_membership` and `set_person_state` are not** — verified by `grep -rn 'impact: "destructive"' src/server`, which returns exactly four lines (`accounting/index.ts:129`, `:193`, `hr/index.ts:230`, `billing/index.ts:182`). Nor are the plainly destructive *business* commands: `cancel_sales_order`, `cancel_purchase_order`, `remove_customer`, `remove_supplier`, `record_damaged_stock`, `close_period` and `reopen_period`. Separately, `agent-chat.ts:240-244` serialises tool results — which include tenant free-text — straight back into the model's context with no filtering.
- **Expected:** ADR-017 is satisfied on the authority question — every tool call executes as the calling human, which I verified through `batch.ts:84 → executeCommand(actor, …)` and `tool-manifest.ts:60-124` filtering the manifest by `resolvePermissions`. What is missing is the confirmation gate on the commands that change who holds authority.
- **Impact:** Combined with F-003 and F-004: a prompt-injected or merely mistaken agent turn, run by a user holding `Edit` on membership, can silently escalate a role. The tool-output path gives a low-privileged user a way to plant instructions that a privileged user's later agent session will read.
- **Confidence:** Confirmed from source.
- **Suggested direction:** Mark every authorization-mutating command `impact: "destructive"`; fence tool output in the prompt as untrusted data.

### F-016 — The active-membership cookie is signed with a public value on this deployment

- **Severity:** Medium
- **Category:** Security control
- **Surface:** `verity_active_membership`
- **Observed:** `src/server/platform/config.ts:199-203` resolves the HS256 signing key as `SUPABASE_JWT_SECRET ?? VERITY_SESSION_SECRET ?? NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""`. In this repository's `.env`, **neither of the first two is set** — the file defines `JWT_SECRET`, a name no code reads (`grep -rn '"JWT_SECRET"' src` matches only a test asserting it must not reach a container). So the cookie is signed with the Supabase **anon** key, which is shipped to every browser.
- **Expected:** `src/server/platform/auth.ts:58-62`: "The cookie is signed, not merely set: it names a membership, and an unsigned one would let a client nominate someone else's."
- **Impact:** The signature is not tamper-evident in this configuration. Escalation is still blocked, because `resolveActor()` (`auth.ts:320-338`) only honours a `membershipId` that appears in `verity.memberships_for_auth_user(<authenticated user>)` — so a forged cookie can at most select among memberships the caller already holds. The control is defeated; the invariant behind it holds by a second mechanism.
- **Confidence:** Confirmed for the local environment. **The deployed environment was not checked** — Vercel may set `SUPABASE_JWT_SECRET`.
- **Suggested direction:** Remove the anon-key fallback and fail closed. Delete or rename the unused `JWT_SECRET` line so the `.env` stops implying a secret is configured.

### F-017 — The file primitive has no size cap, no MIME allow-list and no `Content-Disposition`

- **Severity:** Medium (latent — no route reaches it yet)
- **Category:** Security control
- **Surface:** `src/server/platform/files.ts`, `src/server/storage/{supabase,s3}.ts`
- **Observed:** `files.ts:86` rejects only `byteSize <= 0`; there is no maximum. `mimeType` is taken from the caller and set verbatim as the upload `Content-Type` (`storage/supabase.ts:79`, `storage/s3.ts:100-109`) with no allow-list, and read URLs are signed but carry no `Content-Disposition` (`storage/supabase.ts:83-91`, `storage/s3.ts:116-122`) — so a stored `text/html` or `image/svg+xml` object renders inline in the storage origin. `reserveUpload`/`confirmUpload`/`readUrlFor` have no callers outside tests today, which is what keeps this latent.
- **Good:** the storage key is server-generated (`randomUUID`), tenant-prefixed, and the filename component is sanitised (`files.ts:64-67`) — no traversal, no cross-tenant collision. URLs are signed and expiring on both drivers. `readUrlFor` refuses `Pending` and `Quarantined` files.
- **Confidence:** Confirmed from source.

### F-018 — `npm audit` reports 9 high-severity advisories

- **Severity:** Medium
- **Category:** Supply chain
- **Observed:** `npm audit`: 9 high, 0 critical — `brace-expansion`, `browserslist` (via `@serwist/next`), `deepmerge-ts` (via `@prisma/config` → `prisma`), `fast-uri`, `js-yaml` (CVE-2026-59870 not backported), `nanoid`. Lockfile is committed and consistent. No secrets were found anywhere in git history (see ATTEMPTED-AND-FAILED.md).
- **Impact:** Most are build-time paths (`prisma` CLI, `serwist`); `nanoid` and `fast-uri` can be runtime-reachable. None is confirmed reachable from a request in this application.
- **Confidence:** Confirmed (tool output). Reachability not analysed.

### F-019 — A missing permission and an empty result look identical on financial screens

- **Severity:** Medium
- **Category:** Interface / Correctness of interpretation
- **Surface:** ~15 page loaders, including `finance`, `ledgers`, `tax`, `prices`, `reports`
- **Observed:** the consistent pattern `executeQuery(...).catch(e => { if (e instanceof ForbiddenError) return []; throw e; })` — e.g. `src/app/(shell)/finance/page.tsx:34-40`, `ledgers/page.tsx:44-70`, `reports/page.tsx:61-68`. Non-`ForbiddenError` is correctly rethrown, so this swallows no bugs.
- **Impact:** A manager missing one grant sees an empty receivables panel, which in a finance context reads as "nothing is outstanding". That is a wrong business conclusion drawn from a correct refusal.
- **Confidence:** Confirmed from source.
- **Suggested direction:** Render a distinct "you do not have access to this panel" state.

### F-020 — Telemetry scrubbing is thorough for platform errors and thin for everything else

- **Severity:** Low
- **Category:** Security control
- **Observed:** `src/server/platform/telemetry-scrub.ts` withholds the entire message body only for `E_VALIDATION|E_FORBIDDEN|E_CONFLICT|E_CAPABILITY_INACTIVE` (`:62`). Every other exception — a Prisma error naming tables and columns, a `TypeError` carrying a path — passes with only five patterns applied (GSTIN `:36`, email `:41`, Indian mobile `:39`, UUID `:33`, connection string `:48`). `exception.values[].stacktrace` is not touched at all and is not even declared on `ScrubbableEvent`. The phone pattern is India-only.
- **Note:** this only matters once F-010's wiring gap is closed; today the server SDK does not appear to initialise at all.
- **Confidence:** Confirmed from source.

### F-021 — Cross-tenant edit surface on the shared `Party` row

- **Severity:** Low
- **Category:** Data integrity
- **Observed:** the `party_update` and `user_update` policies use `verity.party_visible(id)` / `verity.user_visible(id)` for both `USING` and `WITH CHECK` — reachability through `tenant_membership`, exactly as `CLAUDE.md` describes. For a subcontractor who is a member of two tenants (the PLA-IDE-004 case INV-003 exists for), **either** tenant may update the shared `display_name`, `email` and `phone`, and the other sees the change.
- **Expected:** This may well be intended — one Party per person means one name. It is recorded because it is the one place where a tenant's write is visible in another tenant, and nothing in Bible or spec states which tenant owns those fields.
- **Confidence:** Confirmed (policy definitions read from `pg_policies`).
- **Suggested direction:** A decision, not a bug: either state that Party attributes are globally shared and last-writer-wins, or move tenant-specific naming to the membership.

### F-022 — `_prisma_migrations` carries no row-level security

- **Severity:** Informational
- **Observed:** of 112 tables in `public`, exactly one has `relrowsecurity = false`: `_prisma_migrations`. Every other table has both `relrowsecurity` and `relforcerowsecurity` true, has at least one policy, and every policy compares to `verity.current_tenant_id()` except the deliberate `party`/`user` reachability pair.
- **Impact:** Discloses migration names and timestamps to the runtime role. No tenant data.

### F-023 — GSTR-3B reports unconfirmed purchase bills as eligible ITC

- **Severity:** Critical
- **Category:** Regulatory
- **Surface:** `verity.trading.gstr3b_working`, `verity.trading.itc_reconciliation`
- **Observed:** `src/server/capabilities/trading/tax.ts:713-716` fetches purchase invoices without their `confirmation` relation, and `:757-775` computes
  ```ts
  const unsubstantiated = purchases.filter((invoice) => taxOf(invoice) === 0);
  const booksItcPaise = purchases.reduce((sum, i) => sum + taxOf(i), 0);
  … eligibleItcPaise: booksItcPaise,
  ```
  so the only purchases excluded are those carrying *zero* tax. A **provisional** bill — raised automatically at goods receipt, with a tax split this business computed from its own HSN rules and no supplier document behind it — carries non-zero tax and is counted as eligible.
  Two other places in the same codebase define eligible ITC correctly and differently:
  - `taxSummary`, same file, `:415-420`: `inputTaxEligiblePaise = inputTaxPaise - inputTaxAwaitingBillPaise`, where `awaiting` is `confirmation === null`.
  - the dashboard KPI SQL, `finance.ts:2540-2548`, which joins `trading_purchase_bill_confirmation` and comments: *"a provisional bill's tax split was computed from this business's own rules, not read off a supplier's document, and presenting it as eligible credit would overstate what can be claimed by exactly the amount nobody has evidence for."*
  `itc.ts:255-261` has the same gap in `booksTaxPaise`.
- **Expected:** ITC is claimable only against a supplier's actual tax invoice. The codebase already says so, twice.
- **Impact:** **GSTR-3B is the return the business pays from.** It overstates claimable credit by the tax on every unconfirmed goods-receipt bill, which understates the cash payable. That is an incorrect return with interest and penalty exposure, and the working paper the accountant checks against shows the wrong figure.
- **Confidence:** Confirmed from source (three definitions read side by side). Not reproduced through the UI — `/tax/gstr-3b` was not loadable for the audit owner during this run.
- **Suggested direction:** `gstr3bWorking` and `itcReconciliation` should apply the `confirmation === null` filter `taxSummary` already applies. The comment at `tax.ts:767-771` explaining that `eligible` and `books` are "identical today" is the defect: they are not identical anywhere else in the system.

### F-024 — The financial year on every document number is computed in UTC

- **Severity:** High
- **Category:** Regulatory
- **Surface:** every invoice, credit/debit note, purchase order and sales order number
- **Observed:** `src/server/capabilities/trading/finance.ts:115-120`:
  ```ts
  export function financialYearOf(instant: Date): string {
    const year = instant.getUTCFullYear();
    const month = instant.getUTCMonth(); // 0-based; March is 2.
  ```
  Called at `finance.ts:396, 637, 930, 1061, 3363` and `orders.ts:92, 1501, 2693`. Meanwhile `src/server/capabilities/trading/clock.ts` exists specifically to fix this class of bug for *periods* — its own header records the earlier finding: *"An invoice raised between 00:00 and 05:30 IST on the 1st was stamped into the PREVIOUS month's GST period. That is a filing error with a paper trail behind it."* `periodKeyOf` / `businessPeriodKey` were made zone-aware. `financialYearOf` was not.
- **Impact:** For an IST tenant, a document raised between 00:00 and 05:29 IST on 1 April is still 31 March in UTC. It is numbered into the **old** financial year (`SALES/2025-26/00xx`) while `gstr1Working`, `gstr3bWorking` and `closeChecklist` — all correctly zone-aware — report it in the **new** one. The number printed on the legal document contradicts the return it appears in, which is precisely the discrepancy an officer looks for.
- **Confidence:** Confirmed from source.
- **Suggested direction:** Route `financialYearOf` through `businessZone` the way `clock.ts` already does for periods.

### F-025 — "Paid" is computed from `payment.invoiceId` rather than from allocations, in six places

- **Severity:** High
- **Category:** Correctness / Data integrity
- **Surface:** `customerExposurePaise` (credit approval), sales/purchase order detail, `finance_ageing`
- **Observed:** `orders.ts:1779`, `:3324`, `:3547`, `:4121`, `:4345` and `reports.ts:491` all do
  ```ts
  const paid = invoice.payments.reduce((sum, payment) => sum + payment.amountPaise, 0);
  ```
  reading the `TradingPayment.invoiceId` back-relation. The schema is explicit (`prisma/schema.prisma:3105-3110`): that column is nullable since Task 71 and set **only** for single-allocation payments — *"a single cheque routinely settles three"*. The real allocation record is `TradingPaymentAllocation` (`schema.prisma:3151-3167`). `finance.ts:2501-2510` was already migrated off this join with the comment *"a settled invoice may have no payment pointing at it at all; the old join reported every such invoice as fully outstanding"* — the fix was not propagated.
- **Impact:** Any payment split across invoices is invisible to all six readers. Receivables and payables ageing overstate what is owed; `customerExposurePaise` overstates exposure, so **a customer who has paid can be refused further credit** — and the same number is what `/customers` shows a sales manager deciding whether to take the next order.
- **Confidence:** Confirmed from source and schema.
- **Suggested direction:** Sum `TradingPaymentAllocation.amountPaise` per invoice, as the dashboard query already does.

### F-026 — Composition-scheme registration is recorded and then ignored

- **Severity:** Medium
- **Category:** Regulatory
- **Observed:** `registrationType: "regular" | "composition"` is captured and displayed (`business.ts:145-185`, `tax.ts:834-871`) and read by no tax path — `computeInvoiceTax`, `ratesFor` and `raiseSalesInvoice` contain no branch on it.
- **Impact:** A composition-scheme tenant raises ordinary tax invoices collecting CGST/SGST. A composition dealer is legally barred from collecting tax separately, must issue a Bill of Supply, and files CMP-08/GSTR-4 rather than GSTR-1/3B. Every document and every return would be wrong in kind, not degree.
- **Confidence:** Confirmed from source.
- **Suggested direction:** Either refuse to set `composition` until the path exists, or implement the Bill of Supply branch. Storing a setting that changes nothing is the worst of the three.

### F-027 — Smaller financial defects

- **Severity:** Low
- **Odd basis-point rates round up on both halves.** `tax.ts:169-171`: `cgstRateBp: Math.round(rateBp / 2)` and the same for SGST. For `rateBp = 251` both halves are 126 and the invoice carries 252 bp. Standard slabs are even in bp, so this bites only a custom rate.
- **No retry on the first document of a new series.** `nextDocumentNumber` (`finance.ts:176-218`) takes `FOR UPDATE` only on an existing series row; two concurrent "first invoice of the financial year" requests both take the `create` branch and race the unique constraint. No number is duplicated or burned — the loser simply gets an unhandled constraint error instead of a retry.
- **`Number()` on `::bigint` aggregates** at `finance.ts:2565-2587, 2641, 2731, 2916-2917`. Safe below 2^53 paise (≈ ₹90,000 crore) but inconsistent with the integer-paise discipline the rest of the module keeps.
- **Reverse charge and e-invoice/IRN do not exist** — no fields, no logic. Unimplemented rather than wrong, but a business over the e-invoicing threshold cannot use this system to comply.

### F-028 — Most commands write no Activity row, and both audit streams are opt-in per handler

- **Severity:** High
- **Category:** Architecture / Regulatory (audit trail)
- **Surface:** the command pipeline and 84 of the 116 registered commands
- **Observed:** `recordActivity` must be called by the handler (`src/server/platform/audit.ts:118` and its own comment), and `DomainEvent` rows are written centrally **only for the events a handler chooses to return** (`src/server/platform/command.ts:271-284`). Neither is automatic. Counting `recordActivity` call sites against registered commands:

  | capability | commands | `recordActivity` call sites |
  |---|---|---|
  | platform | 12 | 12 |
  | dinein | 19 | 9 |
  | trading | **46** | **6** |
  | asset | 3 | 2 |
  | approval | 2 | 1 |
  | location | 7 | 1 |
  | plywood | 3 | 1 |
  | accounting | 4 | **0** |
  | billing | 5 | **0** |
  | evidence | 1 | **0** |
  | hr | 6 | **0** |
  | inventory | 4 | **0** |
  | scheduling | 4 | **0** |

  Tenant A carries 73 `activity` rows against 1,185 `domain_event` rows — consistent with the table.
- **Expected:** `CLAUDE.md`'s reporting rule ("a command that mutates and records nothing is a hole in the audit trail"), EXE-AUD-001, and the brief's Phase 4: *"Perform each kind of change and confirm an Activity row appears with the right actor, the right command key, and a diff that names what it was and what it became."*
- **Impact:** For most of the trading capability — the capability that raises invoices, receives goods, issues stock, records payments and closes periods — there is no field-level record of *what changed from what to what*. In an accounting system that is the audit trail. The platform capability, by contrast, is complete: all twelve of its commands record, and `diffFields` is used everywhere it is called (30 of 33 sites; **zero** sites pass an empty `changes`, so the "changed with no values" defect the brief names as previously shipped is not present).
- **Behavioural confirmation.** Reading tenant A's `activity` table directly: **73 rows, and every single one is a permission or configuration change.** Grouped by command key: `set_role_activity` 36, `revoke_permission` 22, `approve_credit` 7, `set_configuration` 3, `grant_permission` 2, `set_credit_limit` 1, `create_role` 1, `cancel_purchase_order` 1. That tenant holds **48 invoices, 31 sales orders, 14 payments** and 1,185 domain events, and **not one** of them produced an Activity row. Raising an invoice, receiving goods, issuing stock and recording a payment leave no field-level trail.
- **Where it is recorded, it is recorded well.** Of the 73 rows: 0 have a null actor, 0 have a null `field_changed`, and 0 have both values null. The values are human — `field_changed: "Close accounting periods"`, `old_value: "not allowed"`, `new_value: "allowed"`. The "changed, with no values" defect the brief names as previously shipped is genuinely fixed.
- **Confidence:** Confirmed — by call-site count, by the live row counts, and by reading the rows.
- **Suggested direction:** Make recording structural rather than remembered — the pipeline knows the entity, the command key, the actor and the transaction, so a command that mutates and supplies no `changes` could be made a startup or test-time failure rather than a silent gap.

### F-029 — GSTIN shape is validated; the state code range and the check digit are not

- **Severity:** Medium
- **Category:** Regulatory / Input validation
- **Surface:** `verity.trading.register_gst_registration`, `create_customer`, `create_supplier`, `edit_*`
- **Observed:** two regexes, in two places, both shape-only:
  - `src/server/capabilities/trading/orders.ts:54-59` — `/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/`
  - `src/server/capabilities/trading/business.ts:154-159` — `/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/`

  The final character of a GSTIN is a **computed check digit** over the first fourteen; neither validator computes it. And the leading two digits are validated as `[0-9]{2}`, so `00`, `39` and `99` all pass, while the real state-code list runs 01–38.
- **Why it matters more than an ordinary format check:** `business.ts:167-169` derives the state code from the GSTIN precisely — and correctly — so that the two can never disagree, and `finance.ts:130-166` then decides CGST+SGST versus IGST from that state code on every invoice the business ever raises. A typo that survives the regex therefore does not fail loudly; it silently determines the tax split on every document.
- **Impact:** A mistyped customer GSTIN with a plausible-looking state prefix produces invoices with the wrong tax heads, which is a GSTR-1 mismatch on every one of them. A wrong check digit is rejected only at the portal, after filing.
- **Confidence:** Confirmed from source. The two regexes also differ slightly from each other (`[1-9A-Z]` versus `[0-9A-Z]` in the entity-code position), which is a second, smaller defect: two definitions of the same format.
- **Suggested direction:** One shared validator in `keys.ts` beside `HSN_CODE`, with the checksum computed and the state code checked against the real list.

### F-030 — The custom-field validator has one caller

- **Severity:** Low
- **Category:** Architecture
- **Observed:** `validateCustomFields` (`src/server/platform/entity.ts:104-120`) is called from exactly one place: `src/server/capabilities/location/index.ts:298`. The other open payload bag in the platform — `verity.evidence.capture`'s `payload: z.record(z.string(), z.unknown()).optional()` (`src/server/capabilities/evidence/index.ts:60`) — is stored with no schema check at all.
- **Expected:** `CLAUDE.md`: "Custom fields are rendered, validated and submitted end to end. The command re-validates server-side because a client check is a convenience, never a control."
- **Impact:** Evidence is by design immutable field data — a record that a photograph or a reading exists. An unvalidated payload on it means the immutable record can be immutably wrong-shaped. No injection risk (it is stored as JSON and never interpolated), so this is a contract gap rather than a vulnerability.
- **Confidence:** Confirmed.

### F-031 — `Organization` scope silently equals `Tenant` scope for every entity without a location

- **Severity:** High
- **Category:** Architecture / Security control
- **Surface:** `verity.trading.customer`, `.supplier`, `.product`, `.brand`, `.price_sheet`, `.invoice` — every trading entity that is not anchored to a godown
- **Actor:** `staffB` — Counter Staff, membership in the **child** organization `Counter — Nizamuddin` (`b0000000…0003`), all nine grants at `Organization` scope
- **Reproduction:**
  1. Sign in as the narrow counter user in tenant B.
  2. Open `/customers`.
- **Observed:** all **three** of tenant B's customers are listed — `Kandla Timber Imports`, `Sandeep Interiors` and one left behind by an earlier audit run — together with their GSTINs, phone numbers, credit limits and exposure (`₹1,15,640 of ₹50,000 · Past their limit`). The customers belong to the tenant, not to the child organization the actor is scoped to.
- **Why:** searching the schema, **no `Trading*` or `Plywood*` model carries an `organizationId`** — `organizationId` appears eight times in the whole of `schema.prisma`, all on platform models. `trading/scope.ts` resolves an Organization-scoped grant through the one hop it can: reachable organizations → `Location`s in them → rows carrying a `locationId`. An entity with no `locationId` has no hop, so the scope resolves to nothing to filter on and the actor sees the tenant.
- **Expected:** PLA-ORG-002 (downward visibility) and PLA-ORG-003 (sibling isolation). `CLAUDE.md`: "Layer 2 … decides which records are theirs (Organization scope resolves to the actor's node plus descendants)."
- **Impact:** A branch counter clerk reads the head office's entire customer book, including credit limits and outstanding exposure. The grant that was written to confine them to their branch does not confine them, and nothing in the interface or the permission editor says so. This is the concrete, observed instance of the general defect in F-005.
- **Confidence:** Confirmed — observed in the running application, with the grant scopes read directly from the `permission` table and the organization tree read from `organization`.
- **Suggested direction:** Decide, per entity, what an Organization-scoped grant means when the entity has no organization. Failing closed (an Organization grant on an unanchored entity reaches nothing, as a `Location` grant already does) matches the platform's own fail-closed posture. Widening silently to the tenant does not.

### F-032 — The interface offers actions the role cannot perform

- **Severity:** Low
- **Category:** Interface
- **Surface:** `/customers`, and by inspection the other list screens
- **Observed:** `staffB` holds `Read` on `verity.trading.customer` and no `Edit` or `Delete`. Every row on `/customers` nonetheless renders **Edit** and **Remove** controls, and the header renders **New customer** (the role does hold `Create` on sales orders, not on customers).
- **Expected:** PRN-001 (least surprise) and PRN-002 (progressive disclosure).
- **Impact:** The action fails server-side — Layer 1 refuses, correctly — so this is not an authorization defect. It is a user being invited to do something and then told no, on a screen where the same table also shows a "You do not have access to this" state for `/godowns`, proving the pattern exists and is simply not applied per control.
- **Confidence:** Confirmed (observed; grants read from the database).

### F-033 — The audit trail is gated by "holds any permission at all", and the security stream by string-matching an entity name

- **Severity:** High
- **Category:** Security control
- **Surface:** `/audit`
- **Observed:** `src/app/(shell)/audit/page.tsx:47-62` does not call `authorize()`, `hasPermission()` or `executeQuery()`. It resolves the actor's permission list and then gates on its **length**:
  ```ts
  const permissions = actor.roleId ? await resolvePermissions(tx, actor.roleId) : [];
  if (permissions.length === 0) return null;

  const canSeeSecurity =
    permissions.some((p) => p.verb === "Edit" && p.entity.includes("role")) ||
    permissions.some((p) => p.verb === "Delete");

  const [activity, security] = await Promise.all([
    tx.activity.findMany({ orderBy: { occurredAt: "desc" }, take: 100 }),
    canSeeSecurity ? tx.securityAuditEvent.findMany({ … take: 50 }) : …,
  ]);
  ```
  So **any** grant on **anything** yields the last 100 rows of the tenant's field-level change log — who changed what, from what, to what. And the "stronger right" to read the security audit stream is conferred by holding `Delete` on *any entity whatsoever*, or `Edit` on any entity whose key merely **contains the substring `role`**.
- **Verified behaviourally:** `staffB`, whose nine grants are all Read/Create on trading entities, loads `/audit` and is shown content (750 characters against a 427-character empty-chrome baseline). `rolelessB` is correctly refused — which is the one case this gate gets right, and the reason the defect is easy to miss.
- **Expected:** `entity` is a free string precisely so that a new capability can add entities without touching the platform ontology (`CLAUDE.md`). Matching on a substring of it is the same mistake as matching on a role's *name*, which the overview page's own comment rejects: "Derived from what the role can DO, never from its name — matching on 'Accountant' breaks the moment a business calls the job something else." A capability that names an entity `verity.hr.employee_role` or `verity.trading.role_activity` grants its readers the security stream by accident.
- **Impact:** The audit trail is a control. A counter clerk reads the whole tenant's change history; anyone holding a `Delete` grant reads authentication and authorization events. And the gate will silently widen as capabilities add entities.
- **Confidence:** Confirmed (source plus observed).
- **Suggested direction:** A real `verity.platform.activity` / `verity.platform.security_event` entity with ordinary `Read` grants, checked with `hasPermission` like every other page on this list does.

### F-034 — Two pages read tenant data with no permission check at all

- **Severity:** Medium
- **Category:** Security control
- **Surface:** `/` (overview), `/capabilities`
- **Observed:**
  - `src/app/(shell)/page.tsx:58-88` fetches, inside `withTenant` and with **no** permission check on the read itself: `tx.domainEvent.findMany({ orderBy: { occurredAt: "desc" }, take: 60 })`, the full asset register, `tx.location.count()`, `tx.evidence.count()` and the active capability list. The actor's permissions are resolved (`:73`) but only to *display* a grant count.
  - `src/app/(shell)/capabilities/page.tsx:42-46` reads `capabilityDefinition` and `tenantActivation` with no check.
- **Verified behaviourally:** signed in as **`rolelessB` — a membership with `roleId = null`, which `CLAUDE.md` states "grants nothing, so an unassigned membership fails closed"** — the home page renders the organization name, `2 Locations`, `5 Capabilities`, the installed capability list with versions, and a **Recent activity table naming 60 domain events**: `verity.trading.customer_created`, `verity.trading.payment_recorded`, `verity.trading.sales_invoice_raised`, `verity.trading.sales_order_fulfilled`, `verity.trading.stock_reserved`, `verity.trading.purchase_bill_raised`, each with its entity key and timestamp.
- **Expected:** the brief's Phase 7 §6 — "a membership with a null `roleId` resolves to no permissions — check with the roleless identity … by signing in as them and observing that **the app offers nothing**." It offers the event feed.
- **Impact:** A user whose access was deliberately withheld — the state an administrator creates by removing a role rather than removing the person — still reads a continuous feed of the business's trading activity. Tenant isolation is unaffected (RLS holds; nothing from tenant A is visible). This is a within-tenant Layer 1 gap.
- **Confidence:** Confirmed, observed live.
- **Suggested direction:** Gate the event feed on the same `Read` grant `/audit` should use, and render the roleless overview as the "no role assigned" state the page already knows how to name — it prints `Role: No role assigned` directly above the feed it should not be showing.

### F-035 — Invoice and customer detail are readable by id, by anyone with the entity grant

- **Severity:** Medium
- **Category:** Security control
- **Surface:** `verity.trading.invoice_detail`, `verity.trading.customer_detail`
- **Observed:** `finance.ts:2239-2247` and `orders.ts:4258-4261` both `findUnique({ where: { id } })` with no scope filter. `salesOrderDetail` and `purchaseOrderDetail`, by contrast, do it correctly — `orders.ts:3433-3439` resolves `reachableGodownIds` first and filters `locationId: { in: reachable }`, with a comment naming the earlier finding it closed: *"the credit position, the customer and the prices on another godown's order were readable by id."*
  The difference is structural, not an oversight of style: `TradingSalesOrder` and `TradingPurchaseOrder` carry a `locationId` and `TradingInvoice`, `TradingCustomer` and `TradingPayment` do not (verified against `schema.prisma`). There is nothing to scope on.
- **Impact:** RLS still bounds the read to the tenant, so this is not cross-tenant. Within a tenant, a godown-scoped role that holds `Read` on invoices reads **every** invoice in the business by id, including its GSTIN, party and totals — the same class of exposure the sales-order fix closed, on the document that carries the money.
- **Confidence:** Confirmed from source and schema. Not exercised — reaching it needs a foreign invoice id, and the id-bearing routes were not re-driven this run.
- **Good, and worth naming:** `invoiceDetail` computes `paidPaise` from `invoice.allocations`, which is the **correct** source — the one place in the codebase that gets right what F-025 gets wrong in six others.
- **Suggested direction:** This is the concrete form of the F-031 decision. An invoice belongs to an organization through its order; either denormalise that anchor or resolve it through the order in the scope helper.

---

## What was not tested, and why

This is the most important section of the report.

**No write was performed anywhere.** The instruction for this run was "make sure no change",
and the database is production. That removes, in full:

- every one of the ~116 registered commands — so authorization refusal, precondition
  enforcement, audit recording and idempotency on the write path are **source-reviewed, not
  observed**;
- the whole of Phase 2 — killing the database mid-command, restoring an empty schema, replaying
  the 65+ migrations from zero, seed idempotency, backup and restore, deliberate pool
  exhaustion, storage and auth outage, clock skew, concurrency, double-submit, 500-line orders,
  2,500-product generation, financial-year rollover;
- capability activation and deactivation, and therefore the Phase 3 test of whether navigation
  appears and disappears and whether a deactivated capability's data becomes unreachable;
- the dine-in and kitchen surfaces, which the brief names as the best available test of whether
  the platform is genuinely multi-capability — activating a capability is a write;
- `/api/scheduled` and `/api/agent/chat` under a valid credential — one performs work, the other
  spends money and can execute commands.

**Also not done:**

- **Phase 6 in full.** No 320/768/1440 px pass, no keyboard-only completion of a sale, no focus
  trapping or focus-return checks, no screen-reader labelling, no theme or reduced-motion pass.
  What *was* collected: browser console errors on every page load of the sweep — across **329
  page loads there were 2 console errors, both the same message** (`Failed to load resource: the
  server responded with a status of 500`), i.e. the client-side echo of F-001. No hydration
  mismatch, no React key or `useLayoutEffect` warning, nothing else at all — and no
  hydration-mismatch warning anywhere in fourteen hours of server log. The modal hydration defect
  the brief cites as historic did not recur.
- **The id-bearing detail routes** were not re-driven this run, so the "not found versus
  forbidden are indistinguishable" question is answered from source only.
- **`npm run test`** — the brief requires asking first and it reseeds the live database.
- **`npm run build`** — the production bundle was audited by downloading the deployed chunks
  instead.
- **`/security-review` and `/code-review high`** were not run. Three read-only source reviews
  were run in their place (security controls, silent failures, GST correctness) and every finding
  they produced was re-verified by hand before it was written here; two of their claims were
  narrowed in the process.
- **The production deployment's environment variables.** Several findings — F-007's `Secure`
  flag, F-016's signing key — are confirmed for this local environment and **unconfirmed on
  `app.theverityai.xyz`**, because checking means signing in against production.

**One thing to be aware of:** the previous audit run (2026-09-06) left a row behind —
`Audit Probe Customer 837113`, created 2026-09-06 20:50 in tenant B. Tenant B is itself an
audit-created tenant, so it is contained, but the row is real and is visible on `/customers`.
Nothing in *this* run created or changed anything.

---

## Milestone assessment, in the vocabulary `CLAUDE.md` requires

**Architecture conformance: FAIL.** Not on the platform substrate — tenancy, identity, the
command/query pipeline, the state and event infrastructure and the HQ boundary are built as
documented and hold under test. It fails on the specific claim that all three authorization
layers are enforced: Layer 2 exists in three capabilities of twelve and cannot work at all for
entities carrying no organization or location anchor (F-005, F-031, F-035), Layer 3 never runs
(F-006), and two pages plus the audit screen bypass Layer 1 with bespoke logic (F-033, F-034).

**Legacy contamination: NONE.** Every forbidden identifier and route was searched for. Zero
matches. The only trace is a stale comment in `.env` naming a route that no longer exists.

**Tests: not run** — the suite points at the production database.

**Known deviations:** CSP is deliberately deferred and documented (`next.config.ts:60-78`);
`Global` scope is defined and deliberately filtered out; identity has no deprovision path by
design; the rate limiter is per-process and says so.

**Open decisions this audit surfaces, which are the user's to make and not a bug to fix:**

1. What an `Organization`-scoped grant means for an entity with no organization (F-031). This
   needs an ADR; fail-closed is the answer consistent with the rest of the platform.
2. Whether `own`-style ceiling checks on role and permission granting are a platform primitive
   or a capability concern (F-003, F-004).
3. Who owns the attributes of a `Party` shared across tenants (F-021).
4. DPDP Act obligations against Bible V2 Primitive 2 §3, which ends the identity lifecycle at
   `Archived` with no deprovision path. A data-erasure request has no answer today. **This was
   not investigated further** — the brief correctly flags it as a decision, not a defect.

**Ready for next milestone: NO.** Two reasons, and only two. The application does not render its
own core screens under ordinary single-user load on real data (F-001/F-002), and GSTR-3B reports
a figure the same codebase computes correctly in two other places (F-023). Everything else on
this list is serious but ordinary work; those two are the ones that make the current state
unshippable.
### F-036 — The service worker is not served, and its machinery is dead weight

- **Severity:** Low
- **Category:** Correctness of documentation / Supply chain
- **Observed:** `next.config.ts:135-138` states: *"The service worker is served by `src/app/sw.js/route.ts`, not generated here. `@serwist/next` is a webpack plugin and silently no-ops under Turbopack, which is what `next build` uses — so it never actually ran."* That route **does not exist**: `src/app/sw.js/` is absent, and `GET /sw.js` returns the application's HTML 404 page (14,472 bytes). No code anywhere registers a service worker — `grep -rn "serviceWorker"` across `src` returns nothing — and `idb`, a dependency, is imported by nothing.
- **Impact:** `@serwist/next`, `serwist` and `idb` are shipped dependencies that do nothing. `@serwist/next` is one of the two packages behind the `browserslist` advisory in F-018. The comment describes a fix that was not completed, and reads as though it were.
- **Confidence:** Confirmed (route requested live; files absent; no importer).
- **Suggested direction:** Either add the route or drop the three dependencies and the comment. Leaving a comment asserting a file exists is how F-023's defect survived, in miniature.

### F-037 — Only one kind of refusal is recorded: the HQ boundary

- **Severity:** Medium
- **Category:** Security control / Audit trail
- **Surface:** `enforcePolicy`, `authorize`, `assertRowInScope`
- **Observed:** `recordSecurityEvent` has 17 call sites in the whole application, and exactly **one** of them writes `AuthorizationDenied`: `requireOperator` (`src/server/platform/operator.ts:104-113`), when a tenant user reaches an HQ route. The four places an ordinary authorization refusal is raised — `policy.ts:294`, `authorization.ts:97`, `:291`, `:297` — record nothing before throwing.
  Tenant A's `security_audit_event` distribution confirms it: `AuthSuccess` 76, `AuthorizationDenied` 30, `PermissionRevoked` 22, `ConfigurationChanged` 6, `RoleAssigned` 4, `PermissionEscalated` 3. All 30 denials are HQ-boundary hits from earlier probing; a tenant with real users refusing real actions would show far more.
  Failed **authentication** is recorded nowhere at all, for the reason `src/server/actions/platform.ts:166-172` states honestly: before authentication there is no tenant context, and the security stream is tenant-scoped.
- **Expected:** the brief's Phase 4 — "Confirm the audit trail records failed and forbidden attempts, not only successful ones." A refused action is the signal that someone is probing; a system that records only successes cannot tell an attack from a quiet day.
- **Impact:** No detection surface. Combined with F-003 and F-004 this matters more than it looks: a role escalation **is** recorded (`RoleAssigned` / `PermissionEscalated`), so the successful attack leaves a trace — but the fifty refused attempts that preceded it do not, which is the part that would have been noticed in time.
- **Confidence:** Confirmed (call sites plus the live event distribution).
- **Suggested direction:** Record the denial where the decision is made — `enforcePolicy` already builds a decision object with a reason and a channel, which is exactly the shape a security event wants. Failed authentication needs a home that is not tenant-scoped; that is a small platform decision, not a bug.

### F-038 — An offline command lost to any database error is reported as a duplicate

- **Severity:** Low
- **Category:** Data integrity / Silent failure
- **Surface:** `src/server/platform/sync.ts:44-62`
- **Observed:** the insert of an `offlineCommand` is wrapped in `try { … } catch { … }` with **no error-type check**. The catch's comment — "Lost the race against a concurrent retry; the constraint decided" — describes the unique-violation case, which is correct and is the case it was written for. But any other failure (a connection drop, a check-constraint violation, a serialization failure) lands in the same branch, which then looks the row up, finds nothing, and returns `{ accepted: false, duplicateOf: undefined }`.
- **Impact:** The caller cannot tell "this command was already accepted" from "this command was never stored". A device replaying offline work would treat a genuine write failure as a successful de-duplication and drop the command. This is the offline-sync path, so the lost command is field work that a person actually did.
- **Confidence:** Confirmed from source. Not exercised — the sync path was not driven.
- **Suggested direction:** Narrow the catch to Prisma's `P2002`, and let anything else propagate.
