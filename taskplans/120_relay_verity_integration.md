# Task Plan 120 — Relay <-> Verity Integration (Ecommerce/Comms Layer to Business-Ops Backend)

**Authority:** User synthesis, 2026-09-23 (Relay discussion, same session as
Tasks 118/119). Grounded against `D:\Code\relay\PRODUCT.md` (live product
scope, read this session) and Verity's own `src/server/platform/tool-
manifest.ts`, `src/server/platform/integration.ts`, `verity-spec/17_
decisions/adr/adr-017.md` — not against assumption.

## Status: PARTIAL 2026-09-30 — ADR-029 written; inert primitives built; route and Relay adapter NOT built

The product owner authorized this task 2026-09-30 (`CLAUDE.md`, "Product-owner
scope decision"), which closes gate 3 of the original three (scope). The other
two triggers below are not met by authorization alone, and the security review
the third bullet demands is what ADR-029 is.

**DONE:** **ADR-029** (`verity-spec/17_decisions/adr/adr-029.md`, `PROPOSED`
pending your review of the security design): machine callers are real
provisioned identities behind a revocable, hashed, expiring key; tenant from
the credential never the payload; only tools already in the actor's manifest,
with unknown and ungranted refused identically; destructive commands closed by
default; idempotency key on commands; existing rate limits; dark (503) when no
key store is bound. **`src/server/platform/external-tools.ts`** — key mint/
parse/constant-time verify and the manifest-scoped dispatcher — with
`src/test/external-tools.test.ts` (10 tests, pure suite, all pass).

**NOT built, deliberately:**
1. `ExternalApiKey` table + RLS + a `SECURITY DEFINER` lookup (the tenant is
   unknown until the key is read), the idempotency store, and
   `POST /api/tools/invoke`. Authentication code that cannot be exercised
   against a database should not ship untested, and applying migrations to the
   shared database is not something to do unasked. Build order is in ADR-029.
2. The Verity -> Relay outbound adapter. It needs Relay's API contract, and
   Relay still has no backend (marketing site only), so any adapter would be
   guessing at a wire format.
3. Nothing calls `dispatchExternalTool` yet; it is inert.

**Original status (superseded above):** PROPOSED / DRAFT — design only, not building now

No code exists or should exist against this document yet. It records the
integration shape and its open decisions so the idea isn't silently lost or
silently built without a scope check, the same posture as Tasks 118/119.

## Background — why this document exists

Original ask was whether veda's unfinished work (a full finance/accounting
system, a direct storefront-to-ecommerce connector) needed replicating in
Verity. Resolved in-session: it does not.

- **Finance/accounting**: Verity already ships `capabilities/accounting`,
  `finance`, `billing` (Task 84 Phase 4, product-owner override
  2026-09-04, `registry.ts`). Nothing from veda's incomplete accounting
  work needs porting.
- **Ecommerce/storefront connector**: explicitly **not** Verity's job.
  `D:\Code\relay` is a separate, purpose-built product for exactly this —
  "business communication infrastructure," message -> signal -> flow ->
  action -> outcome, with Shopify + Payments named in its own MVP scope
  (`PRODUCT.md` "Capabilities and Constraints"). Building a second
  ecommerce connector inside Verity would duplicate Relay's own product
  thesis rather than reuse it.

Relay is pre-launch (`PRODUCT.md`: "current build-in-progress is the
marketing/landing site... No real customer logos... this is a pre-launch
marketing site"). This document is a design for when Relay has a real
backend to integrate against, not a claim that integration code should
start today.

## What Relay is (verified against its own PRODUCT.md, not assumed)

Horizontal comms platform across WhatsApp/email/SMS/Instagram/voice/API.
Core mechanism: an incoming message becomes a Signal, runs through a Flow,
proposes/executes an Action, produces a tracked Outcome. Its own MVP scope
names a **Tool Registry**, an **Action Engine**, a **Policy Engine**, an
**Action Ledger**, plus Shopify and Payments connectors. E-commerce is
explicitly its GTM wedge, not its whole positioning — it stays horizontal
by design (`PRODUCT.md` "Positioning").

The load-bearing observation: Relay's own "Tool Registry" / "Action Engine"
concept is architecturally the same shape as Verity's already-built
`tool-manifest.ts`. Neither side needs a new abstraction invented for the
other — they already speak the same shape independently.

## Proposed integration shape

Two directions, each mapped onto an existing Verity extension point —
no new platform primitive:

### 1. Relay -> Verity (action direction)

Relay's Action Engine calls Verity as an external tool provider. Verity's
`buildToolManifest()` (`tool-manifest.ts`, Task 84 areas 1+3) already
produces exactly the shape an external action engine needs: a scoped list
of `{key, kind: command|query, entity, inputSchema, impact}` for whichever
actor is calling. Nothing new to build to *expose* the tools — the
manifest generator already exists; what's needed is the authenticated HTTP
surface that lets Relay call a command/query by key (this surface does not
yet exist and is the actual net-new work, not the manifest itself).

Example candidate tools Relay would call: order-status query,
create-order command (from a Shopify webhook Relay already ingests),
record-payment command, customer lookup query.

### 2. Verity -> Relay (signal direction)

Verity-side state changes that should become a customer-facing message
(order shipped, payment overdue, low-stock backorder delay) go out through
`integration.ts`'s existing `IntegrationPort`/`IntegrationAdapter` pattern,
category `webhook.outbound` or `outbound.api`. Domain code keeps calling
`exchange("customer-notify", ...)` — per that file's own golden rule, it
never calls Relay by name directly. A `relay` adapter is written once,
outside `integration.ts`, and can be swapped without touching domain code.

### 3. Identity — ADR-017 applies, no exception

Relay is not a privileged service-account caller. Per ADR-017 (the AI/agent
channel, and by the same logic any external system, executes as a real
`ActorContext` — no elevated authority path exists or should be built for
this). Relay needs a real provisioned identity in Verity
(`provisionIdentity()`), with a Role granting exactly the verbs it needs at
Tenant scope (e.g. `Order#Read`, `Order#Execute`, `Payment#Execute`),
resolved through the ordinary `resolvePermissions()` path — same
authorization and audit trail as any human actor. No bypass, no
Relay-specific carve-out in `policy.ts`.

### 4. Credentials

Relay's API key / webhook signing secret is a `MET-AUT-003` encrypted
credential registry entry (`integration.ts`'s stated authority), not an
environment variable read ad hoc by a new adapter. Note: this repo's own
open-items list (`CLAUDE.md`) already flags that the credential-encryption
key's storage location is an unresolved platform-wide decision — this
document does not invent a Relay-specific answer to that; the adapter
waits on whatever the platform-wide answer becomes.

## Why this is gated, not built

1. **Relay has no backend yet.** Its own `PRODUCT.md` states the current
   build is the marketing site only — there is nothing on the Relay side
   for a Verity adapter to call, and nothing calling into Verity's tool
   surface yet either.
2. **The authenticated tool-invocation HTTP surface doesn't exist in
   Verity.** `buildToolManifest()` produces data; nothing yet accepts a
   `{key, input}` call from an external caller and executes it through
   `executeCommand`/`executeQuery`. Building this is itself the same class
   of decision Task 119 names for Jev: a new externally-reachable surface
   needs its own security review (rate limits, replay protection, which
   tenants/roles may ever be targeted) before it exists, not implicitly as
   a side effect of a Relay integration.
3. **Scope**: same foundation-vs-capability tension named in Task 118 §6
   and Task 119 §"Why this is gated" — whether standing up an external
   integration surface counts as foundation work (the integration
   framework itself, arguably already built) or capability work (a
   specific Relay adapter, arguably a business integration) is a
   product-owner read, not an engineering default.

## Non-goals

- Not a build task. No adapter code, no new API route, no credential
  registry entry added by this document.
- Not a decision that Relay is definitely the ecommerce/comms answer for
  every future Verity client — only that if/when it is, this is the shape:
  reuse `tool-manifest.ts` and `integration.ts`, provision a real identity,
  never a shortcut path.
- Not a Relay product-scope document — Relay's own `PRODUCT.md`/`prd/
  RELAY_PRD.md` govern what Relay itself builds; this file only covers the
  Verity-side integration surface.

## Trigger to pick this up

1. Relay has a real backend (Action Engine / Tool Registry actually
   implemented, not just named in scope) to integrate against.
2. A concrete first client needs the ecommerce-order-to-Verity or
   Verity-event-to-customer-message flow — not a speculative "useful
   someday."
3. The authenticated external-tool-invocation surface on the Verity side
   has its own security review/design pass, sequenced before any Relay
   adapter is written against it.

Until all three are true, this stays PROPOSED/DRAFT.
