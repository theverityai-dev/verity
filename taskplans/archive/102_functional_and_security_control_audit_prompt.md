# 102 — Functional, conformance and security-control audit prompt

This file **is** the prompt. Paste everything below the line into a fresh Claude Code
session at the repo root. Nothing above the line is part of it.

The audit it drives is deliberately **black-box**: the auditor drives the running
application like a demanding user, and is forbidden from reading application source to
decide whether something works. Reading the source is how an auditor talks themselves
out of a finding — "the code looks right, so the behaviour must be right".

Scope is correctness **and** security posture: whether every feature works, whether the
architecture's claims hold, whether the books and the tax returns are right, what
happens when infrastructure fails, and whether the controls that are supposed to keep
attackers out are present and correctly configured.

**Security here is reviewed, not exercised.** Phase 7 verifies that each control exists
and is set up correctly - is RLS forced on every table, is the session cookie HttpOnly,
does the role grant refuse - by reading configuration and observing ordinary behaviour
under a legitimate session. It does not fire injection payloads, stuff credentials, or
attempt to breach anything. That is a deliberate choice and the better one here: an
exploit test tells you which holes happen to be reachable today, while a control review
tells you which controls are missing, including the ones nobody has found a route to
yet. It is also safe to run against production, which an exploit test never is.

---

# VERITY — FUNCTIONAL, CONFORMANCE AND SECURITY-CONTROL AUDIT

Your job is to find where this system is wrong, not to admire it. Assume the software
is guilty until it proves itself innocent, and assume that anything you did not
personally observe working does not work.

## THE ONE RULE THAT SHAPES EVERYTHING

**You audit the running application, not the source code.**

Until Phase 7, you may not open a file under `src/` to decide whether a behaviour is
correct. You may read `README`, `CLAUDE.md`, the `taskplans/` and `verity-spec/`
documents to learn what the system *claims*, and you may read migration SQL to
understand the data model — but every verdict about behaviour must come from an
observation: a page you loaded, a button you pressed, a request you replayed, a row you
read back from the database, a log line you watched appear.

Why: reading the implementation tells you what the author intended, and a user gets
neither the source nor the intent — only the behaviour. Three of the worst classes of defect in
this system's history — a hydration mismatch on every modal, an activity diff that
silently recorded nothing, a seed that could only ever run once — all typechecked, all
passed review, and all were only visible by running the thing.

When you catch yourself reasoning "the handler probably validates this", stop. Go and
send the request that violates it, and write down what actually came back.

## SKILLS AND COMMANDS TO USE

Invoke these; do not reimplement what they already do.

| When | Use |
|---|---|
| Before touching anything | `superpowers:brainstorming` to map the surface and agree scope with the user |
| Every bug, without exception | `superpowers:systematic-debugging` — reproduce, isolate, prove, then write the finding |
| Any error message or stack trace | `error-resolver` before guessing |
| Driving the browser | the `claude-in-chrome` skill and its `mcp__claude-in-chrome__*` tools; `playwright-cli` for scripted multi-user and replay flows |
| Starting the app | the `run` skill |
| UI defects and accessibility | `web-design-guidelines`, then `ecc:accessibility` |
| Schema, RLS and migration safety | `verity-migration-safety` and `db-migration-helper` |
| Architecture decisions you think are being violated | `verity-adr-gate` |
| Understanding what the corpus claims | `graphify query "<question>"` — the graph is at `graphify-out/` |
| Verifying you are actually done | `superpowers:verification-before-completion` |

Subagents for Phases 7 and 8, where source access is permitted:
`ecc:security-reviewer` (control review), `ecc:database-reviewer` (RLS, grants, schema),
`ecc:silent-failure-hunter` (swallowed errors and bad fallbacks).

Slash commands: `/security-review` and `/code-review high` at the very end, as a
cross-check against your black-box findings — never as a substitute for them. Do not run `/code-review ultra`
yourself; it is user-triggered and billed. Tell the user if you think it is warranted.

Shell: `npm run typecheck`, `npm run test`, `npm run build`. **Ask before running the
test suite** — it points at the live database and reseeds it.

## GROUND RULES

1. **Do not fix anything.** This audit produces findings, not patches. A fix mid-audit
   destroys the evidence and the reproduction. Write everything to the report and stop.
2. **Never test destructive behaviour against production data without explicit
   permission for that specific test.** Ask, name the exact operation, wait.
3. **Never put a real secret or a real customer's details in the report.** Name the
   variable or the row, not its contents.
4. **Every finding needs a reproduction a stranger can follow** — starting state, exact
   steps, observed result, expected result. A finding without steps is an opinion.
5. **Rank by what it costs the business**, not by how clever the bug is. A wrong figure
   on a filed return outranks a lost order outranks a console warning.
6. If a test would damage a third party (load-testing a provider, sending real email),
   do not run it. Record it as untested and say why.

## THE REPORT

Create `audit/FINDINGS.md` and write to it continuously — not at the end. A session that
runs out of context with everything in your head produces nothing.

Every finding:

```markdown
### F-NNN — <one line, the defect not the symptom>

- **Severity:** Critical | High | Medium | Low | Informational
- **Category:** Correctness / Data integrity / Architecture / Availability /
  Regulatory / Interface / Security control
- **Surface:** the route, API, command key, or table
- **Actor:** which role, in which tenant, was logged in
- **Reproduction:**
  1. …
- **Observed:** what actually happened, quoted exactly
- **Expected:** what should have happened, and the authority that says so
  (`CLAUDE.md` invariant, ADR number, spec REQ-ID, or GST law)
- **Impact:** what it costs the business, or what an unlucky user ends up with
- **Confidence:** Confirmed (I saw it) | Probable (strong signal, one step unproven)
- **Suggested direction:** one or two sentences. Not a patch.
```

Also maintain, as sibling files:

- `audit/COVERAGE.md` — every route, API, command and capability, marked Tested /
  Partially tested / Untested-and-why. **Seed it from the appendix at the end of this
  file**, which lists all 206 registered command and query keys as a checklist. **An honest untested list is worth more than a
  fake green tick.**
- `audit/METHOD-GAPS.md` — anything the Phase 8 source review found that the black-box
  phases missed. That gap is itself a result worth recording.
- `audit/ATTEMPTED-AND-FAILED.md` — every way you tried to break the system that it
  correctly refused. This is the evidence that the guards work, and it is the half of an
  audit that everybody skips.

## SETUP

1. Read `CLAUDE.md` end to end. It carries constitutional invariants (INV-001 tenancy
   isolation, INV-002 read-only closed states, INV-003 unified Party identity), the
   database role rules, the forbidden-pattern list, and the accepted ADRs. These are the
   authorities you audit *against*.
2. Establish which environment you are pointed at. Confirm with the user before you
   start whether this is local, preview, or production. Write it at the top of the
   report. **An audit that does not name its environment is worthless.**
3. Get at least four identities, and ask the user to create any that do not exist:
   - an HQ / platform operator,
   - a tenant owner in tenant A,
   - a low-privilege user in tenant A (no finance, no configuration),
   - any user in a **second** tenant B.
   Tenant B is not optional: a single tenant cannot show that one client's data,
   navigation and capability set stay separate from another's. `npm run seed:audit-tenant`
   builds one, with a root and a child organization, an owner, a narrow counter user and
   a deliberately roleless membership.
4. Start the app (`run` skill). Confirm you can sign in as each identity and keep the
   four sessions available — separate browser profiles or separate Playwright contexts.

---

# PHASE 1 — WALK EVERY SURFACE AS AN HONEST USER FIRST

Learn what "working" looks like before you go looking for wrong. You cannot recognise a
broken state if you never saw the correct one.

Visit every route below, as the tenant owner, and record for each: does it load, does it
show real data, does every control do what its label says, what happens with the empty
state, what happens on error.

**HQ shell** — `/hq`, `/hq/clients`, `/hq/clients/[tenantId]` and its `modules`,
`operations`, `organizations`, `people`, `roles`, `settings` sub-pages, `/hq/audit`,
`/hq/settings`.

**Business shell** — `/`, `/workspace`, `/overview`, `/catalogue` and
`/catalogue/[productId]`, `/stock` and `/stock/[productId]`, `/godowns` and
`/godowns/[locationId]`, `/purchases` and `/purchases/[orderId]`, `/sales` and
`/sales/[orderId]`, `/customers` and `/customers/[customerId]`, `/suppliers` and
`/suppliers/[supplierId]`, `/prices`, `/finance` and `/finance/[invoiceId]`, `/ledgers`,
`/transactions`, `/counter` and `/counter/[billId]`, `/tax`, `/tax/close`,
`/tax/exceptions`, `/tax/gstr-1`, `/tax/gstr-3b`, `/tax/itc`, `/tax/purchases`,
`/reports` and its `finance`, `inventory`, `purchases`, `sales` children, `/people`,
`/roles`, `/approvals`, `/assets` and `/assets/[id]`, `/audit`, `/capabilities`,
`/configuration`, `/evidence`, `/locations` and `/locations/[id]`, `/scheduling`,
`/settings/business`, `/settings/tax`, `/floor`, `/floor/setup`, `/floor/[orderId]`,
`/kitchen`, `/menu`.

**The other capabilities are not optional.** `accounting`, `approval`, `asset`,
`billing`, `dinein`, `evidence`, `hr`, `inventory`, `location`, `scheduling` and
`trading` all exist. The dine-in and kitchen surfaces belong to a *different* business
shape than plywood and are the best available test of whether the platform is genuinely
multi-capability or has quietly grown a plywood-shaped spine. Activate them for a test
tenant and drive them.

**APIs** — `/api/health`, `/api/ready`, `/api/metrics`, `/api/scheduled`,
`/api/agent/chat`.

For each, note in `COVERAGE.md` before moving on.

---

# PHASE 2 — WILD CASES: WHAT HAPPENS WHEN THINGS BREAK

Ask permission before each of these. Run them against local or preview, **never**
production, unless the user explicitly says otherwise for a specific test.

**Database disappears mid-flight.** Kill the database connection while a multi-step
command is in progress — a sales order that writes lines, a reservation across two
godowns, an invoice that writes lines and a ledger entry. Then bring it back and read
the data. Is there a half-written order? An invoice with no ledger entry? A reservation
against nothing? Anything that is not all-or-nothing is a finding.

**Database is completely wiped.** Restore an empty schema and start the app. Does it
boot, or crash? Does it say something a human can act on? Then run the migrations from
zero on a fresh database and confirm the entire chain applies cleanly in order — this
system has 65+ migrations and a broken one only shows up here. Then seed and confirm the
seed is **idempotent**: run it twice.

**Restore from backup.** Ask the user what the backup and restore procedure is. If there
isn't one, that is a Critical finding on its own — an accounting system with no tested
restore is one storage failure from being unrecoverable. If there is one, ask to watch
it run, and check the recovery point and recovery time against what the business
actually needs.

**Connection pool exhaustion.** The runtime uses the transaction-mode pooler on 6543 and
`CLAUDE.md` records that session mode once took production down with `EMAXCONNSESSION`.
Open many concurrent sessions and see what happens. Confirm nothing has reintroduced
session state that outlives a transaction.

**Partial infrastructure failure.** Storage down but database up: does evidence upload
fail loudly or silently? Supabase Auth down: what does sign-in say? Clock skew: move the
server clock forward a day and check period close, SLA clocks, and invoice numbering.

**Concurrency.** Two users reserving the last sheet simultaneously. Two users closing the
same period. Two users invoicing the same order. Two browser tabs submitting the same
form. Double-click every submit button in the app — idempotency is usually an
afterthought and double-submission is the most common real-world corruption.

**Scale.** An order with 500 lines. A catalogue with 10,000 products. A laminate design
with 50 shades × 50 textures — that is 2,500 generated products in one transaction; find
out where it breaks and whether it fails cleanly or half-writes.

**Time.** Financial year rollover on 1 April. A backdated invoice. Two invoices in the
same second — does the number sequence hold? Daylight-saving and timezone: the temporal
model resolves zones organization → tenant → UTC and never guesses; try to make it guess.

**Scheduled work.** `CRON_SECRET` unset means nothing runs, by design. Confirm that
failure is visible rather than silent. Then run the scheduled endpoint twice in a row
and confirm the sweeps are idempotent.

---

# PHASE 3 — ARCHITECTURE, TESTED NOT READ

The claim in `CLAUDE.md` is **PLATFORM FOUNDATION READY**: a new capability can be
registered, with new entities, workflows, permissions, events and UI, *without*
modifying platform infrastructure. Test the claim behaviourally.

- Activate and deactivate a capability for a tenant. Does its navigation appear and
  disappear? Does a deactivated capability's data become unreachable, or merely hidden?
- Two tenants with **different** capability sets — does either see the other's
  navigation, entities or queues?
- Capability dependencies: `plywood` depends on `trading` (ADR-018). Try to activate
  plywood without trading and confirm it is refused.
- Custom fields: define one on an entity, fill it, and confirm the server re-validates
  when you bypass the client.
- The shell must hold no capability-to-route map. Prove it from outside: a capability's
  navigation should appear purely because the capability declared it.
- **Legacy contamination.** `CLAUDE.md` forbids VEDA patterns by name. Check the running
  system for `factoryId`, `Department` as a production stage, role-based routes
  (`/owner`, `/worker`, `/inspector`, `/supervisor`, `/verity`), and the forbidden enum
  values. Report anything you can reach.
- **HQ vs tenant boundary** (ADR-013). Can an HQ operator read tenant business data? What
  *should* they be able to see? Whatever the answer, is every HQ action written to the
  audit trail with the operator named?

---

# PHASE 4 — THE AUDIT TRAIL AND THE EVENT LOG

An accounting system's audit trail is a control, and this one is append-only by design.

- Perform each kind of change and confirm an Activity row appears with the right actor,
  the right command key, and a diff that names **what it was** and **what it became**.
  A diff that records "changed" without values is a finding — this exact bug shipped once
  in `editProduct`.
- Try to edit or delete an Activity or DomainEvent row through any surface.
- Confirm nothing you did in Phases 1–3 went *unrecorded*. An action with no audit row is
  worse than a refused action.
- Check that history written before the ADR-018 key rename still renders with human
  labels rather than raw keys like `verity.plywood.receive_goods`.
- Confirm the audit trail records failed and forbidden attempts, not only successful ones.

---

# PHASE 5 — REGULATORY AND FINANCIAL CORRECTNESS

This system files GST returns in India. Correctness here is a legal obligation.

- Raise invoices intra-state and inter-state and confirm CGST+SGST vs IGST is chosen from
  the state codes, never guessed. An invoice must never carry both.
- Confirm the invoice number sequence is gapless and monotonic per series per financial
  year, and that it cannot be reused after a failure.
- Confirm an issued invoice is immutable, and that corrections happen through credit and
  debit notes.
- Reconcile GSTR-1 and GSTR-3B against the underlying invoices. Any figure the working
  shows that the documents do not support is Critical.
- Confirm the ITC reconciliation does not claim credit on a bill that carried no tax.
- Confirm HSN, now optional, degrades to the tenant default rate rather than to zero —
  and that period close still flags every invoice missing one.
- Confirm the `gstApplicable = false` path records **zero tax as a statement**, not as a
  gap, and that it cannot be flipped after goods have arrived.
- Data protection: check what personal data is held on Party, User and customers, whether
  it is exported or deletable, and whether India's DPDP Act obligations are met. Identity
  has no deprovision path by design (Bible V2 Primitive 2 §3 ends at `Archived`) — flag
  the tension between that and a data-erasure request as a decision the user must make,
  not a bug for you to fix.

**One thing you must refuse.** If you find, or are asked to build, any facility for
recording transactions so they are hidden from tax authorities — off-books sales, an
invoice-suppression mode, parallel books — do not implement it, do not help design it,
and record it in the report as a Critical regulatory finding. Note that the existing
per-order GST switch is legitimate: an unregistered or composition supplier genuinely
charges no tax. The line is between *recording a real untaxed trade* and *concealing a
taxable one*.

---

# PHASE 6 — THE INTERFACE UNDER STRESS

Use `web-design-guidelines` and `ecc:accessibility`, and drive with the browser tools.

Every page at 320px, 768px, 1440px. Keyboard only, start to finish — can you complete a
sale without a mouse? Every modal: does focus trap, does Escape close, does focus return?
Screen-reader labels on every icon-only control. Both themes. `prefers-reduced-motion`.
Long strings, empty states, error states, loading states. Double-submit every button.
Browser back after a mutation. Refresh mid-form.

Check the console on every page for hydration mismatches — one previously affected every
modal in the application and was invisible until someone looked.

---

# PHASE 7 — SECURITY CONTROLS, REVIEWED NOT EXERCISED

**Read this before starting the phase.** Every item is answered by inspecting
configuration, by reading what the application returns to a session that is entitled to
it, or by reading the source once Phase 8 opens it. You are confirming that a control is
present, enabled and correctly scoped — not defeating it. Do not send injection payloads,
do not brute-force or stuff credentials, do not upload hostile files, and do not forge a
request to reach another tenant's data.

If a control is missing, **that is the finding**. Write it up with the evidence of its
absence. You never need to demonstrate a breach to justify reporting a gap, and a report
that says "RLS is not forced on `trading_invoice`" is more useful than one that says "I
got a row out", because it names the fix.

### 1. API keys and client-side secrets
Read what the browser is actually handed: page source, the JS bundles, `__NEXT_DATA__`,
and the response bodies of the app's own requests during a normal session. Confirm the
only Supabase key present is the **anon** key, which is public by design. Confirm no
`service_role` key, no `postgres://` string, no `CRON_SECRET`. Confirm `localStorage`
and `sessionStorage` hold no bearer token beyond the auth session the client is meant to
have. The question to answer: *does the browser receive anything that would let a holder
act beyond that signed-in user's own rights?*

### 2. Row-level security
This is the mechanism INV-001 rests on, so verify it as configuration rather than by
probing:
- every table in `public`: `relrowsecurity` **and** `relforcerowsecurity` both true.
  `FORCE` matters — without it the table owner is exempt from its own policy;
- every table has an isolation policy, and its `USING` and `WITH CHECK` both compare to
  `verity.current_tenant_id()`;
- the runtime role satisfies `rolbypassrls = false` and `rolsuper = false`;
- `assertRlsEnforceable()` still refuses to boot on a bypassing role — check it is
  called on the startup path and has not been weakened;
- newly added tables are the usual gap: `plywood_shade`, `plywood_texture`,
  `plywood_product_detail` and anything added since.

### 3. Object references and ownership checks
For each id-bearing route (`/sales/[orderId]`, `/purchases/[orderId]`,
`/finance/[invoiceId]`, `/catalogue/[productId]`, `/customers/[customerId]`,
`/suppliers/[supplierId]`, `/godowns/[locationId]`, `/assets/[id]`, `/locations/[id]`,
`/counter/[billId]`, `/floor/[orderId]`, `/hq/clients/[tenantId]`), confirm from the
source in Phase 8 that the lookup is scoped — that the query filters by tenant and, where
relevant, passes through `assertRowInScope()` — rather than fetching by id alone and
trusting that the id came from a page the user was allowed to see.

Note also whether "not found" and "forbidden" are distinguishable in the response. If
they are, record it: that difference lets an outsider learn which ids exist.

### 4. Secrets in version control
Deferred to Phase 8.
### 5. Administrative surfaces
Confirm every `/hq/*` route is gated server-side, and that the gate refuses the **data**
and not merely the page — a route that redirects only after streaming the tenant list has
already disclosed it. Check the gate is an authorization call, not a client-side
condition. Confirm `/api/scheduled` returns 503 rather than running unauthenticated
(ADR-015) and compares its secret in constant time.

### 6. Tenant and organization isolation
INV-001 is the constitutional invariant, so confirm the mechanism rather than probing it:
- every tenant-scoped read goes through `withTenant()`, and the GUC is set with
  `set_config(..., true)` so it cannot outlive its transaction;
- tenant context is derived from the authorization context and never from a request
  payload (Spec PLA-TEN-006);
- organization scope resolves to the actor's node **plus descendants** and excludes
  siblings (PLA-ORG-002, PLA-ORG-003);
- a membership with a null `roleId` resolves to no permissions — check with the roleless
  identity the audit tenant provides, by signing in as them and observing that the app
  offers nothing;
- `Global` scope is filtered out by `verity.resolve_permissions`, so a Global grant
  cannot silently take effect;
- Party and User are global tables and their isolation is reachability through
  `TenantMembership` — confirm the queries that read them join through it.

### 7. Rate limiting and abuse resistance
Confirm a server-side limiter exists on sign-in, on `/api/agent/chat`, and on the busiest
server actions; that it is enforced in the handler and not by a disabled button; and
whether its key is per-account, per-IP or both. Read `src/server/platform/rate-limit.ts`
in Phase 8 and confirm the limits are actually applied on those paths. Note whether one
tenant's traffic can consume a limit shared with another — that is a cross-tenant
availability weakness even with no attacker involved.

### 8. File storage
Confirm the evidence bucket is private, that objects are served by **signed, expiring**
URLs rather than by unguessable paths, and that anonymous listing is disabled. Confirm
the two-phase upload freezes key, checksum and size at confirmation, and that a file can
only be confirmed by the tenant that prepared it.

### 9. Input validation
Confirm every command validates server-side, in its zod schema and preconditions, and
that no rule exists only in the browser. Walk the schemas and check the numeric bounds
are real: quantities positive, discounts capped at 10,000 basis points, HSN 4/6/8 digits,
GSTIN shape enforced, money integer paise, thickness and dimensions positive integers.
Where the UI enforces something the schema does not, that is the finding.

Ordinary boundary values through the real forms are fine and useful — a zero quantity,
an empty name, a date far in the past. That is functional testing, not exploitation.

### 10. Unauthenticated access
Signed out, confirm each route and API redirects or refuses, and that none returns
content. Then confirm the session lifecycle handles the in-between states: expired
session, revoked membership, deleted user, and switching organization.

### 11. Query construction
The stack is Prisma, so parameterisation is the default and the interesting cases are the
places that opt out. Inventory every `$queryRaw`, `$queryRawUnsafe`, `$executeRaw` and
`$executeRawUnsafe` in the source, and for each confirm the values are passed as
parameters rather than interpolated into the string. Where a table or column name is
interpolated — which cannot be parameterised — confirm it comes from a fixed list in the
code and never from a request. Pay attention to report filters, date ranges, sort
parameters and the period key on tax close, and to the agent chat path.

### 12. Log and error hygiene
Drive ordinary workflows and read the console. Then trigger ordinary failures — a wrong
password, a forbidden action, an invalid form — and read what the error page and the
response body disclose. A production response carrying a stack trace, a file path or a
SQL fragment is a finding. Confirm `telemetry-scrub` actually redacts: check what it
matches, and confirm an error carrying a GSTIN or a godown UUID comes out scrubbed.

### 13. Assignable fields
Mass assignment is a design question, so read the schemas. For each mutating command,
confirm the input schema accepts **only** the fields the operation legitimately takes,
and that these are absent from it: `tenantId`, `roleId`, `permissions`, `scope`, `id`,
`version`, `createdAt`, `createdBy`, and every derived quantity (`qtyShipped`,
`qtyReceived`, `totalCostPaise`, `parentProductId`, `type: TEMPLATE`). Zod strips unknown
keys by default — confirm nothing has switched to `passthrough()`.

Then confirm field-level redaction: a role without a `<entityKey>#<fieldName>` grant must
have the field **omitted** from the response, not nulled, because a null cannot be told
apart from a genuinely absent value.

### 14. Upload restrictions
Confirm, from the source, that the upload path checks content type rather than trusting
the extension or the client-supplied MIME type; that there is a size ceiling; that the
stored key is generated rather than taken from the filename, so a traversal sequence in a
filename cannot escape; and that anything served back is delivered with a
`Content-Disposition` and a content type that will not execute in the app's origin.

### 15. Business-rule enforcement
The business rules are a security boundary in an accounting system, and Phase 1 and
Phase 4 already exercise them legitimately. Here, confirm the guard exists in the
**command**, not only in the screen, for each of: selling stock that is not there,
issuing more than was reserved, receiving against a cancelled order, invoicing twice,
over-allocating a payment, posting into a closed period, editing an issued invoice,
ordering a TEMPLATE product, and moving stock against one. For each, name the line that
refuses. A rule enforced only in the UI is the finding.

### 16. Response shape
Read the response bodies the app produces during normal use and confirm they carry only
what the screen renders. Look for `authUserId`, internal ids, cost prices on a
customer-facing surface, other tenants' names in a lookup, and full user records where a
display name would do. Over-fetching is how one careless component becomes a disclosure.

### 17. Session and transport controls
Confirm on the session cookie: `HttpOnly`, `Secure`, `SameSite`, `Path`, and a bounded
expiry. Confirm sign-out invalidates server-side rather than only clearing the cookie,
and that the session identifier is reissued on sign-in and on privilege change. Confirm
CSRF protection covers every state-changing action — Next.js server actions carry some by
default; verify it rather than assuming. Confirm the response headers: CSP, HSTS,
`X-Frame-Options` or `frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`.

### 18. Dependencies
Deferred to Phase 8.

### 19. The three authorization layers
Confirm each layer exists and is independently effective:
- **Layer 1** `authorize()` — gates the entity type, and throws `ForbiddenError` rather
  than returning a boolean a caller can forget to check (MET-ACT-002);
- **Layer 2** `assertRowInScope()` / `scopeFilter()` — gates which records, and a
  `Location`-scoped grant reaches nothing rather than widening to the tenant;
- **Layer 3** `redactFields()` — removes restricted fields, applied automatically to a
  top-level array result.

Then the property that matters most: find a command where Layer 1 passes and Layer 2 is
the only thing standing between the actor and someone else's record, and confirm Layer 2
is actually invoked there. A system where Layer 1 incidentally covers a missing Layer 2
is one refactor away from a gap.

Confirm ADR-017 holds: the agent channel executes under the calling human's own
`ActorContext`, `channel` is recorded for provenance and consulted by no authorization
rule, and there is no service-account or elevated path.

### 20. (blank on the source list)
Regulatory and integrity — Phase 5.

---

# PHASE 8 — SUPPLY CHAIN AND SECRETS

Source and repository tooling are permitted here.

**Secrets in history.** Search the full git history for credentials, committed `.env`
files, private keys and connection strings. Confirm `.gitignore` covers `.env*` and the
generated credential files. Confirm the deployed bundle ships no source maps exposing
server code. A secret that was committed and later removed is still disclosed — rotation
is the only remedy, and say so rather than reporting it as fixed.

**Dependencies.** `npm audit`. Check the lockfile is committed and consistent, look for
`postinstall` scripts, unmaintained or typosquatted packages, and anything resolved from
outside the public registry. Note the versions of Next.js, React, Prisma and the Supabase
client against known advisories.

**Server-side secret handling.** Confirm every secret is read only in server code, that
nothing sensitive is exposed through a `NEXT_PUBLIC_` variable, and that
`SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` appear in neither the client bundle nor any
log. Note that this repository's own `.env` has held a stale `verity_app` password —
check whether the deployment and the local file still agree.

Now run `ecc:security-reviewer`, `ecc:database-reviewer` and `ecc:silent-failure-hunter`
over the source, plus `/security-review` and `/code-review high`. **Cross-check against
your own findings**: anything they found that you missed is a gap in the black-box
method, and belongs in `audit/METHOD-GAPS.md`.

---

# FINISHING

1. Re-read every finding and confirm you personally observed it. Downgrade anything you
   inferred to Probable, or delete it.
2. Rank by likelihood × cost to the business. Put the top five in an executive summary at
   the top of `audit/FINDINGS.md`, in plain language a business owner can act on.
3. State plainly what you did **not** test and why. This is the most important paragraph
   in the report.
4. Invoke `superpowers:verification-before-completion`.
5. Report to the user in the vocabulary `CLAUDE.md` requires: requirements implemented /
   not implemented, tests, architecture conformance PASS or FAIL, legacy contamination
   NONE or FOUND, open decisions, known deviations, ready for next milestone YES or NO.
6. Do not fix anything. Hand over the findings and stop.

**If you run low on context, write what you have to the report and say where you stopped.
A partial audit that is honest about its boundary is useful. A complete-looking audit
with invented coverage is worse than no audit at all.**

---

# APPENDIX — EVERY REGISTERED COMMAND AND QUERY

206 keys. This is the depth the phases above do not reach on their own: Phase 1 walks
the *screens*, so a key with no screen — a scheduled sweep, a workspace queue, a query
another query calls — is exercised only if somebody goes looking for it. This list is
what makes them impossible to skip quietly.

**How to use it.** Copy the whole list into `audit/COVERAGE.md` at the start and tick
each box as you reach it. A key you never reached stays unticked with a reason beside
it. The reason is the useful part: "no UI path found" is a finding about the product,
not a gap in the audit, and it is exactly how a dead command or an orphaned query
surfaces.

**Three things to check per key, not one.**

1. *Reachable* — is there a path through the interface that runs it? If not, say so.
2. *Authorized* — does it declare an entity and a verb, and does an actor lacking that
   grant get refused? The narrow Counter Staff identity in the audit tenant is the
   instrument for this.
3. *Recorded* — does a command write an Activity row naming what changed? A command
   that mutates and records nothing is a hole in the audit trail.

Counts by capability, so an absent capability is visible as a zero rather than as
silence. `trading` carries 97 because ADR-018 moved the whole generic engine there;
`plywood` retains 9, which is the extension it still owns.

**accounting** — 7

- [ ] `verity.accounting.account_ledger` (query)
- [ ] `verity.accounting.create_account` (command)
- [ ] `verity.accounting.list_accounts` (query)
- [ ] `verity.accounting.post_journal_entry` (command)
- [ ] `verity.accounting.reverse_journal_entry` (command)
- [ ] `verity.accounting.set_account_active` (command)
- [ ] `verity.accounting.trial_balance` (query)

**approval** — 3

- [ ] `verity.approval.decide` (command)
- [ ] `verity.approval.list_pending` (query)
- [ ] `verity.approval.request` (command)

**asset** — 4

- [ ] `verity.asset.change_state` (command)
- [ ] `verity.asset.list` (query)
- [ ] `verity.asset.register` (command)
- [ ] `verity.asset.relocate` (command)

**billing** — 7

- [ ] `verity.billing.create_meter` (command)
- [ ] `verity.billing.generate_invoice_for_meter` (command)
- [ ] `verity.billing.list_meters` (query)
- [ ] `verity.billing.open_billing_period` (command)
- [ ] `verity.billing.period_invoices` (query)
- [ ] `verity.billing.record_meter_reading` (command)
- [ ] `verity.billing.set_meter_rate` (command)

**dinein** — 30

- [ ] `verity.dinein.add_order_lines` (command)
- [ ] `verity.dinein.advance_order_line` (command)
- [ ] `verity.dinein.apply_bill_discount` (command)
- [ ] `verity.dinein.cancel_order` (command)
- [ ] `verity.dinein.create_menu_category` (command)
- [ ] `verity.dinein.create_menu_item` (command)
- [ ] `verity.dinein.create_menu_variant` (command)
- [ ] `verity.dinein.create_order` (command)
- [ ] `verity.dinein.define_table` (command)
- [ ] `verity.dinein.define_zone` (command)
- [ ] `verity.dinein.edit_menu_item` (command)
- [ ] `verity.dinein.generate_bill` (command)
- [ ] `verity.dinein.get_bill_detail` (query)
- [ ] `verity.dinein.get_order_detail` (query)
- [ ] `verity.dinein.item_ready` (notification)
- [ ] `verity.dinein.kitchen_queue` (query)
- [ ] `verity.dinein.list_floor` (query)
- [ ] `verity.dinein.list_menu` (query)
- [ ] `verity.dinein.list_open_bills` (query)
- [ ] `verity.dinein.move_table` (command)
- [ ] `verity.dinein.open_bills` (workspace queue)
- [ ] `verity.dinein.place_order` (command)
- [ ] `verity.dinein.position_table` (command)
- [ ] `verity.dinein.record_payment` (command)
- [ ] `verity.dinein.sales_summary` (query)
- [ ] `verity.dinein.set_menu_item_active` (command)
- [ ] `verity.dinein.settle_bill` (command)
- [ ] `verity.dinein.sweep_prep_breaches` (schedule)
- [ ] `verity.dinein.tables_to_clean` (workspace queue)
- [ ] `verity.dinein.void_order_line` (command)

**evidence** — 2

- [ ] `verity.evidence.capture` (command)
- [ ] `verity.evidence.list_for` (query)

**hr** — 8

- [ ] `verity.hr.apply_for_leave` (command)
- [ ] `verity.hr.create_department` (command)
- [ ] `verity.hr.create_employee` (command)
- [ ] `verity.hr.create_leave_type` (command)
- [ ] `verity.hr.decide_leave_application` (command)
- [ ] `verity.hr.leave_application_status` (query)
- [ ] `verity.hr.list_employees` (query)
- [ ] `verity.hr.set_employee_active` (command)

**inventory** — 7

- [ ] `verity.inventory.create_item_group` (command)
- [ ] `verity.inventory.create_item` (command)
- [ ] `verity.inventory.list_items` (query)
- [ ] `verity.inventory.record_stock_movement` (command)
- [ ] `verity.inventory.set_item_active` (command)
- [ ] `verity.inventory.stock_ledger` (query)
- [ ] `verity.inventory.stock_on_hand` (query)

**location** — 8

- [ ] `verity.location.add_geofence` (command)
- [ ] `verity.location.assign_user` (command)
- [ ] `verity.location.create_location` (command)
- [ ] `verity.location.create_place` (command)
- [ ] `verity.location.edit_location` (command)
- [ ] `verity.location.list_locations` (query)
- [ ] `verity.location.remove_location` (command)
- [ ] `verity.location.set_custom_fields` (command)

**platform** — 19

- [ ] `verity.platform.assign_role` (command)
- [ ] `verity.platform.compose_role` (command)
- [ ] `verity.platform.create_organization` (command)
- [ ] `verity.platform.create_role` (command)
- [ ] `verity.platform.grant_permission` (command)
- [ ] `verity.platform.invite_person` (command)
- [ ] `verity.platform.list_configuration` (query)
- [ ] `verity.platform.list_grantable_entities` (query)
- [ ] `verity.platform.list_modules` (query)
- [ ] `verity.platform.list_organizations` (query)
- [ ] `verity.platform.list_people` (query)
- [ ] `verity.platform.list_roles` (query)
- [ ] `verity.platform.operations_snapshot` (query)
- [ ] `verity.platform.revoke_membership` (command)
- [ ] `verity.platform.revoke_permission` (command)
- [ ] `verity.platform.set_capability_state` (command)
- [ ] `verity.platform.set_configuration` (command)
- [ ] `verity.platform.set_person_state` (command)
- [ ] `verity.platform.update_organization` (command)

**plywood** — 9

- [ ] `verity.plywood.capture_metric_snapshot` (schedule)
- [ ] `verity.plywood.create_product` (command)
- [ ] `verity.plywood.edit_product` (command)
- [ ] `verity.plywood.list_catalogue` (query)
- [ ] `verity.plywood.low_stock` (workspace queue + notification)
- [ ] `verity.plywood.product_detail` (query)
- [ ] `verity.plywood.set_product_active` (command)
- [ ] `verity.plywood.stock_on_hand` (query)
- [ ] `verity.plywood.sweep_low_stock` (schedule)

**scheduling** — 5

- [ ] `verity.scheduling.book` (command)
- [ ] `verity.scheduling.create_group` (command)
- [ ] `verity.scheduling.create_resource` (command)
- [ ] `verity.scheduling.declare_unavailable` (command)
- [ ] `verity.scheduling.list_bookings` (query)

**trading** — 97

- [ ] `verity.trading.adjust_stock` (command)
- [ ] `verity.trading.allocation_plan` (query)
- [ ] `verity.trading.approve_credit` (command)
- [ ] `verity.trading.business_settings` (query)
- [ ] `verity.trading.cancel_purchase_order` (command)
- [ ] `verity.trading.cancel_sales_order` (command)
- [ ] `verity.trading.close_checklist` (query)
- [ ] `verity.trading.close_period` (command)
- [ ] `verity.trading.confirm_purchase_bill` (command)
- [ ] `verity.trading.create_brand` (command)
- [ ] `verity.trading.create_customer` (command)
- [ ] `verity.trading.create_purchase_order` (command)
- [ ] `verity.trading.create_sales_order` (command)
- [ ] `verity.trading.create_supplier` (command)
- [ ] `verity.trading.customer_detail` (query)
- [ ] `verity.trading.customer_prices` (query)
- [ ] `verity.trading.define_godown_rack` (command)
- [ ] `verity.trading.dispatch_order` (command)
- [ ] `verity.trading.edit_customer` (command)
- [ ] `verity.trading.edit_purchase_order` (command)
- [ ] `verity.trading.edit_sales_order` (command)
- [ ] `verity.trading.edit_supplier` (command)
- [ ] `verity.trading.finance_ageing` (query)
- [ ] `verity.trading.godown_detail` (query)
- [ ] `verity.trading.goods_receipt_detail` (query)
- [ ] `verity.trading.gstr1_working` (query)
- [ ] `verity.trading.gstr3b_working` (query)
- [ ] `verity.trading.import_gst_portal_records` (command)
- [ ] `verity.trading.inventory_analysis` (query)
- [ ] `verity.trading.invoice_detail` (query)
- [ ] `verity.trading.issue_stock` (command)
- [ ] `verity.trading.itc_reconciliation` (query)
- [ ] `verity.trading.link_supplier_to_customer` (command)
- [ ] `verity.trading.list_business_activities` (query)
- [ ] `verity.trading.list_customers` (query)
- [ ] `verity.trading.list_godown_racks` (query)
- [ ] `verity.trading.list_invoices` (query)
- [ ] `verity.trading.list_suppliers` (query)
- [ ] `verity.trading.low_stock` (query)
- [ ] `verity.trading.margin_report` (query)
- [ ] `verity.trading.metrics_history` (query)
- [ ] `verity.trading.needs_attention` (query)
- [ ] `verity.trading.onboarding_checklist` (query)
- [ ] `verity.trading.open_orders` (query)
- [ ] `verity.trading.outstanding_receivables` (query)
- [ ] `verity.trading.owner_console` (query)
- [ ] `verity.trading.party_balances` (query)
- [ ] `verity.trading.party_ledger` (query)
- [ ] `verity.trading.payment_journal` (query)
- [ ] `verity.trading.product_movements` (query)
- [ ] `verity.trading.product_tax_rates` (query)
- [ ] `verity.trading.purchase_analysis` (query)
- [ ] `verity.trading.purchase_match` (query)
- [ ] `verity.trading.purchase_order_detail` (query)
- [ ] `verity.trading.purchase_review_queue` (query)
- [ ] `verity.trading.raise_invoice_note` (command)
- [ ] `verity.trading.raise_purchase_bill_from_order` (command)
- [ ] `verity.trading.raise_purchase_invoice` (command)
- [ ] `verity.trading.raise_sales_invoice` (command)
- [ ] `verity.trading.receive_goods` (command)
- [ ] `verity.trading.receive_stock` (command)
- [ ] `verity.trading.recent_activity_feed` (query)
- [ ] `verity.trading.record_damaged_stock` (command)
- [ ] `verity.trading.record_party_payment` (command)
- [ ] `verity.trading.record_payment` (command)
- [ ] `verity.trading.record_returned_stock` (command)
- [ ] `verity.trading.register_gst_registration` (command)
- [ ] `verity.trading.remove_customer` (command)
- [ ] `verity.trading.remove_supplier` (command)
- [ ] `verity.trading.reopen_period` (command)
- [ ] `verity.trading.reserve_for_order` (command)
- [ ] `verity.trading.sales_analysis` (query)
- [ ] `verity.trading.sales_order_detail` (query)
- [ ] `verity.trading.sellable_stock` (query)
- [ ] `verity.trading.set_brand_active` (command)
- [ ] `verity.trading.set_business_profile` (command)
- [ ] `verity.trading.set_credit_limit` (command)
- [ ] `verity.trading.set_customer_price` (command)
- [ ] `verity.trading.set_godown_rack_active` (command)
- [ ] `verity.trading.set_price_sheet` (command)
- [ ] `verity.trading.set_role_activity` (command)
- [ ] `verity.trading.set_supplier_price` (command)
- [ ] `verity.trading.set_tax_rule` (command)
- [ ] `verity.trading.stock_availability` (query)
- [ ] `verity.trading.stock_ledger` (query)
- [ ] `verity.trading.stock_on_hand` (query)
- [ ] `verity.trading.submit_purchase_order` (command)
- [ ] `verity.trading.supplier_detail` (query)
- [ ] `verity.trading.supplier_prices` (query)
- [ ] `verity.trading.tax_settings` (query)
- [ ] `verity.trading.tax_summary` (query)
- [ ] `verity.trading.top_customers` (query)
- [ ] `verity.trading.top_items` (query)
- [ ] `verity.trading.transfer_stock` (command)
- [ ] `verity.trading.unbilled_movements` (query)
- [ ] `verity.trading.weekly_purchase_totals` (query)
- [ ] `verity.trading.weekly_sales_totals` (query)
