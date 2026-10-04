# Task Plan 39 — Integration Framework

**Phase 8, Task 4 of 9.** Control document: `35A_phase8_execution_program.md`.
**Depends on:** Tasks 36–38 (identity, authorization, audit boundaries).
**Gate owned:** G07 — integration boundary.

---

## 1. Objective

```text
                    Verity
                       │
              Integration Layer
                       │
      ┌────────────────┼────────────────┐
      ▼                ▼                ▼
    REST            Webhook         File / SFTP
      ▼                ▼                ▼
  External          External          Legacy
   system            system           system
```

**The golden rule.** Domain code must never say `callClientX()`. It says
`integrationPort("customer-master")` and an adapter knows Client X. This is what
makes a tender deployment a configuration exercise rather than a fork.

---

## 2. Categories

Six, from the brief, each a direction and a trigger rather than a technology:

| Category | Direction | Started by |
|---|---|---|
| `inbound.api` | in | the external system, calling us |
| `outbound.api` | out | us, calling them |
| `webhook.inbound` | in | their event |
| `webhook.outbound` | out | our event |
| `file.import` / `file.export` | either | a drop, a schedule |
| `sync.scheduled` | either | a schedule |

The transport (REST, SFTP, a message queue) is an adapter's business. The
platform contract names the *shape of the exchange*, not the wire.

---

## 3. Design

### 3.1 Ports and adapters

```text
Capability code ──► IntegrationPort (a name + a typed contract)
                          ▲
                          │ registered at deployment
                    IntegrationAdapter (knows Client X)
```

*   A **port** is declared by the capability that needs an exchange:
    `customer-master`, `invoice-dispatch`. Its key is a free string, exactly as
    `entity` is in the authorization model, so a new integration needs no
    platform change.
*   An **adapter** is registered at deployment through the extension point,
    exactly as `registerStorageDriver` binds a storage backend. Nothing in
    `src/server/platform/` changes to add, replace or remove one.
*   **No adapter registered is a valid state.** `E_INTEGRATION_UNAVAILABLE` is
    raised at the point of use, never at boot — the same decision `files.ts`
    made and for the same reason: failing at boot takes down sign-in over an
    integration nobody on that deployment has reached for yet.

### 3.2 What travels with every exchange

*   **Correlation.** Task 38's `correlationId` is carried outbound and accepted
    inbound, so an external call and the audit rows around it are one request.
*   **Tenant.** Every exchange is tenant-scoped. An adapter never sees a request
    without one, and INV-001 does not soften because the data is leaving.
*   **Attempt policy, declared not hidden.** Timeout and retry are values on the
    exchange, not behaviour buried in an adapter. A silent retry on a
    non-idempotent outbound call is how duplicate invoices are created.
*   **Redaction.** The result of an exchange is recorded through Task 38's
    redaction, so a bearer token in a header is never written into an
    append-only table.

### 3.3 Inbound trust

An inbound webhook is an unauthenticated HTTP request until proven otherwise.
The contract requires:

*   a **signature check** against a secret held in the encrypted `Credential`
    registry (MET-AUT-003) — never a config file, never a literal;
*   **constant-time comparison**, because a byte-by-byte early return leaks the
    signature one byte at a time;
*   a **freshness window**, because a valid signature replayed a month later is
    still a valid signature;
*   **no tenant from the payload.** PLA-TEN-006 holds for machines too: the
    tenant comes from which endpoint/secret verified, never from a field the
    caller sent.

### 3.4 What this task is not

Not a message broker, not a transformation engine, not a connector catalogue.
One contract, one registry, one reference adapter, and the tests that prove the
seam. A capability that needs Client X writes Client X's adapter.

---

## 4. Files

```text
src/server/platform/integration.ts   NEW — ports, adapters, exchange, inbound verification
src/server/integrations/http.ts      NEW — the reference outbound REST adapter
src/test/integration-framework.test.ts NEW
```

`src/server/integrations/` mirrors `src/server/storage/`: a concrete adapter is
a deployment fact and lives outside the platform.

---

## 5. Acceptance Criteria

*   [x] AC-01 A capability can call an external system without naming it.
*   [x] AC-02 An unregistered port fails at use with `E_INTEGRATION_UNAVAILABLE`.
*   [x] AC-03 Correlation and tenant travel with every exchange.
*   [x] AC-04 Timeout is enforced; retries happen only when declared.
*   [x] AC-05 An inbound webhook with a bad, stale or absent signature is refused.
*   [x] AC-06 Signature comparison is constant-time.
*   [x] AC-07 A tenant claimed in an inbound payload is ignored.
*   [x] AC-08 Secrets never reach a log or an audit row.
*   [x] AC-09 No platform module names a vendor; no capability names a transport.
*   [x] AC-10 Typecheck clean; suite green.

---

## 6. Implementation Notes (Claude Code, 2026-08-30)

### Status: COMPLETE — BUILT and PROVEN

### What was built

| File | Change |
|---|---|
| `src/server/platform/integration.ts` | NEW. Ports, adapter registry, `exchange()`, attempt policy, outbound redaction, inbound webhook verification, one signing scheme. |
| `src/server/integrations/http.ts` | NEW. The reference outbound REST adapter — outside the platform, exactly as `server/storage/supabase.ts` is. |
| `src/test/integration-framework.test.ts` | NEW, 32 tests. |
| `src/test/conformance.test.ts` | Module tripwire 29 → 30, reason recorded. |

### Decisions worth defending

**A registry here, when authentication refused one.** `authProvider.ts` argued
against a registry because authentication is never optional and there is exactly
one active provider. Integrations are the opposite on both counts: a deployment
may have none, one, or fifteen, and which ones exist is a property of the
*customer*, not of the product. So this follows the storage shape — register at
deployment, refuse at point of use — and says why in the module, because the two
decisions look contradictory until the reason is written down.

**Retry is refused unless the caller declares idempotence.** `attempts > 1`
without `idempotent: true` raises `E_INTEGRATION_CONTRACT`. A silent retry on a
non-idempotent outbound call is how an external system ends up with two invoices
for one sale, and a default that hides it is worse than no retry at all. The
framework refuses rather than trusting that the caller considered it.

**Timeout is enforced by the framework, not requested of the adapter.** An
adapter that never returns is the failure mode a per-adapter timeout cannot
catch, because the adapter is the thing that is broken.

**Tenant and correlation are required, not optional.** Data leaving the platform
is still tenant data — INV-001 does not soften at the boundary — and an external
call that cannot be tied back to the request that made it is precisely the gap
Task 38 closed everywhere else.

**Inbound trust needs three true things, not one.** A signature over material
that *includes the timestamp*, a constant-time comparison, and a freshness
window. Each has a test, and one of them is the test worth reading: re-stamping
the timestamp header on an old signature fails, because the timestamp is inside
the signed material rather than beside it. That is the difference between replay
protection and the appearance of it.

`timingSafeEqual` throws on a length mismatch, which would itself be a
timing-visible early exit, so both sides are hashed to a fixed width before
comparison. Tested with a difference at the first byte, the last byte, and in
length.

**One signing scheme, defined once.** `signOutboundWebhook` and
`verifyInboundWebhook` are the same construction. Two implementations of "how we
sign" is how a receiver ends up unable to verify what a sender produced.

**PLA-TEN-006 holds for machines.** A signed inbound payload asserting
`tenant_id` verifies successfully — the signature is genuine — and the result
carries nothing a caller could use to select a tenant: `{ ok, correlationId }`
and nothing else. The tenant comes from which secret verified the call. There is
a test that asserts the returned object's exact key set, because "we ignore it"
is a claim and a key set is a fact.

**Secrets are redacted on the way out, twice.** An adapter's error text can
quote a request header back — a 401 body containing `Authorization: Bearer ...`
is a real thing upstream systems do — so `redactMessage` runs in the adapter and
again in `exchange`. `safeMetadata` strips credential-shaped routing hints,
because `metadata` is documented as "never credentials" and callers get it
wrong.

### Boundary, enforced structurally

*   `platform/integration.ts` contains no `fetch`, no vendor SDK, no URL. The
    platform names the *shape* of an exchange; the wire is the adapter's.
*   No file under `src/server/capabilities/` imports anything from
    `src/server/integrations/`. A capability that imported an adapter would be
    naming Client X, which is the coupling this task exists to prevent. Both are
    tested by walking the tree, not asserted in prose.

### Evidence

```text
Test Files  45 passed (45)
Tests       623 passed | 3 skipped (626)
```

*   Before Task 39: 594. After: 626 (+32). Zero regressions.
*   `npx tsc --noEmit`: clean.
*   Legacy-pattern scan on changed files: NONE FOUND.

### Not done, deliberately

*   No connector catalogue. One OIDC-style argument applies: a named adapter per
    vendor is a maintenance surface the platform should not own.
*   No message broker and no transformation engine. A capability that needs
    field mapping owns its mapping; a platform-level transformer would become a
    second place business rules live.
*   Inbound API and file-drop categories are declared and typed but have no
    reference adapter yet. The contract is what Phase 8 needs; a second adapter
    would demonstrate nothing the first does not, and Task 41 already exists to
    prove a seam by second implementation — for storage, where the seam is
    older and the risk is real.
