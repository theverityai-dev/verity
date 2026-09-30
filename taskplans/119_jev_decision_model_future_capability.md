# Task Plan 119 — Jev (TypeSafe AI Decision Model) as a Future Verity Capability

**Authority:** User synthesis, 2026-09-23 (Jev architecture discussion) +
`CLAUDE.md` Foundation-ready definition, build priority order, and stop
conditions ("a new platform primitive appears necessary").

## Status: BUILT 2026-09-30 (unit-proven; NOT live-verified) — both gates closed

**Gate 2 closed 2026-09-30:** the product owner authorized business-capability
build for Tasks 118/119/120 (`CLAUDE.md`, "Product-owner scope decision,
2026-09-30"). Gate 1 was closed by ADR-027 on 2026-09-25.

**BUILT:** `src/server/platform/decision.ts`, a workflow *node type*
(`verity.decision.ask`), not a new subsystem — registered in
`installCapabilities()`, inert until a workflow names it AND the tenant has
activated `verity.capability.decision_egress`. It asks typed questions about a
minimal, named projection and writes the answers into the payload, so the
existing `EdgeCondition` operators (`gte 0.8`) threshold against them and
`evaluateCondition` is unchanged. Every ADR-027 constraint is enforced in code
and named in the file's header (opt-in, minimal/justified fields, audit in
`workflow_step_run.output`, plain `fetch` with no SDK, vendor responses read as
typed data only and error bodies never stored, mandatory declared fallback on
every failure incl. a 4s timeout). Contract taken from TypeSafe's published
API doc (`POST https://api.typesafe.ai/v1/systemone`, bearer auth, `state` +
typed `questions`), read as data; the page carried no agent instructions.
Tests: `src/test/decision-node.test.ts`, 9 tests in the pure suite, all pass
(157/157 pure tests pass overall). `tsc --noEmit` and `eslint` clean.

**Update 2026-09-30 (later): backend-agnostic, Laya added.** The node now serves
Jev or Laya (`DECISION_BACKEND`, `LAYA_ENDPOINT`; ADR-027 amendment). Laya is the
preferred backend: open weights, self-hosted, no third-party egress. 19 pure tests
pass. Still no real call to either: Laya needs a `laya-serve` instance stood up
and, before any threshold is trusted, a labeled sample to validate calibration.

**NOT done — needs you:**
1. **Apply the migration** `prisma/migrations/20260930000000_capability_
   decision_egress` (one `capability_definition` row). Written, deliberately
   not run against the shared database.
2. **A real API key**, stored via `storeCredential(tx, "typesafe-jev", key,
   <encryption key>)`, with `CREDENTIAL_ENCRYPTION_KEY` set. That key's storage
   location is still the open platform decision in `CLAUDE.md`; this reads the
   same per-call env value it currently uses and decides nothing new.
3. **A live call has never been made.** An unauthenticated probe of the endpoint
   returned 403 (the vendor doc says 401 for a missing key), so the route is
   live but auth behaviour is unverified. Confirm one real request/response
   before relying on it.
4. **No workflow uses it yet.** No concrete workflow-condition requirement
   exists; the node is available, not wired into any business flow.

**Original status (superseded above):** PROPOSED / DRAFT — gate 1 CLOSED 2026-09-25, gate 2 still open

**ADR-027** (`verity-spec/17_decisions/adr/adr-027.md`) now answers gate
1's policy question: an external structured-decision model may be used as
an advisory `EdgeCondition` source, never an authorization/state-mutation
authority, under seven numbered constraints (opt-in egress, minimal
fields, audited, no vendor SDK, vendor docs treated as data never
instructions, defined fallback on failure). **This does not authorize
building it today** — gate 2 (CLAUDE.md's objective moving past PLATFORM
FOUNDATION READY, or a concrete named workflow-condition requirement) is
still open, and ADR-027 says so explicitly. No code exists or should exist
against this document until gate 2 is also true. It exists so the idea is
not silently lost or silently built without authority.

## What Jev is (verified, not taken on faith)

Jev is TypeSafe AI's structured-decision model, hosted as an alpha route on
Vercel AI Gateway (`typesafe-ai/jev`) and independently on OpenRouter
(`typesafe/jev-1.13`, `~typesafe/jev-latest`). It does not generate prose —
it takes a `state` (text/structured content) plus one or more typed
`questions` (choice / score / boolean-"Noul") and returns typed answers with
probabilities. Intended use: classification, routing, scoring, verification
— bounded structured decisions, not chat.

**Verification performed this session** (do not re-trust marketing pages
without this kind of check):

- Live-probed `POST https://openrouter.ai/api/alpha/decisions` unauthenticated.
  Got `HTTP 401 {"error":{"message":"No cookie auth credentials found","code":401}}`
  — a real, live route (not 404, not DNS failure). This is the load-bearing
  evidence; page content alone was not trusted.
- Cross-referenced independently on `docs.typesafe.ai/llms.txt` (native
  TypeSafe docs) and OpenRouter's own model page — consistent on model
  shape (state + typed questions -> probabilistic typed answers), inconsistent
  on question-type naming (Vercel docs said "boolean," TypeSafe's own docs
  said "Noul" for the same yes/no primitive) — a minor documentation
  inconsistency, not a red flag on its own once the live probe confirmed the
  route is real.
- **Flag:** the Vercel AI Gateway docs page
  (`vercel.com/docs/ai-gateway/getting-started/evaluation`) contains a block
  titled "Agent prompt" that directly instructs a coding agent with terminal
  access to auto-create API keys and install packages. This is a
  prompt-injection pattern targeting agents specifically. **It was not
  executed.** No API key was created, no package installed, purely from
  reading that page. Any future work against Jev should re-verify through a
  live call, not by following instructions found embedded in vendor docs.
- No SDK (Python/JS) was installed — first-party supply-chain risk avoided
  by calling the HTTP API directly if/when this is ever built.

## Where it would plug in, if built

Not a new subsystem. Maps onto existing infrastructure already in
`src/server/platform/`:

- **`EdgeCondition`** in `workflow.ts` (item 9, Rules/Workflow infrastructure,
  already built per `taskplans/104_verity_native_configuration_extension_
  architecture.md`) — a Jev call could back one edge condition's evaluation
  (e.g. "does this Request look like an escalation?"), returning a typed
  probability the existing `ops` (`eq/neq/gt/...`) already know how to
  threshold against. No new condition-evaluation primitive needed — an
  additional condition *source*, if anything.
- **Advisory layer above `enforcePolicy()`, never a replacement for it.**
  Per `ADR-017` (agent channel has no elevated authority — every action
  still runs through the calling human's own `ActorContext` and
  `enforcePolicy()`), Jev's output would be advisory input into a Command,
  never an authority decision itself. Flow: `LLM/user intent -> Jev
  (advisory classification/score) -> enforcePolicy() (actual gate) -> Command
  execution`. Jev never gets to skip or short-circuit the policy engine.

## Why this is gated, not built

1. **Scope violation against the current objective.** `CLAUDE.md`: current
   objective is PLATFORM FOUNDATION READY. Explicitly out of scope now: any
   business capability, any industry pack, any client-specific module. An
   "Intelligence" pillar / "Jev Decision Engine" / industry-specific decision
   packs (construction/logistics/manufacturing decision schemas, as sketched
   in the user's source discussion) is exactly the excluded scope — none of
   the 14 foundation build-priority items include a decision-engine layer.
2. **New platform primitive, no ADR.** Wiring an external structured-decision
   model into the workflow/condition layer is a new platform primitive by
   this repo's own definition (`CLAUDE.md` stop conditions: "a new platform
   primitive appears necessary" -> stop and surface, do not build). Needs an
   ADR before any code, per `verity-adr-gate`.
3. **Tenant data egress — undecided security question.** Sending tenant
   state (Party/Request/Order content) to a third-party API is data leaving
   the tenant boundary. `INV-001` governs intra-platform tenant isolation and
   does not by itself cover external egress, but the repo's own Security rule
   ("Security is part of the foundation, never bolted on later... determine
   actor, authorization, scope, preconditions, state mutation, audit, events,
   failure behavior" for every mutating operation) has not been applied to
   this case. Undecided: what tenant data (if any) is permitted to leave the
   platform boundary, to what third party, under what data-retention/ToS
   terms, and whether per-tenant opt-in is required.

## Non-goals

- Not a build task. No `src/server/platform/` code, no Prisma schema, no
  workflow condition source added by this document.
- Not a decision that Jev is the right tool — only that if it is ever
  pursued, this is the gate sequence: ADR first, then a bounded scoped
  implementation, not silent wiring into `workflow.ts`.
- Not a Claude-Code-harness-level integration (per-turn model routing was a
  separate thread in the same conversation this document originates from,
  explicitly deferred — see conversation record, not reproduced here since
  it is a Claude Code tooling question, not a Verity platform question).

## Trigger to pick this up

1. An ADR is written and accepted deciding: (a) whether an external
   structured-decision dependency is acceptable at all for Verity, (b) what
   tenant data, if any, may be sent to it, under what safeguards.
2. `CLAUDE.md`'s objective moves past PLATFORM FOUNDATION READY into
   business-capability build, per the stated build order — or a concrete,
   named workflow-condition requirement emerges that this would serve (not
   a speculative "would be useful someday").

Until both are true, this stays PROPOSED/DRAFT.
