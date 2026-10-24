# Task Plan 131 — The assistant's approvals, records and provider gate (ADR-055, ADR-056)

**Authority:** ADR-055 and ADR-056 (both ACCEPTED 2026-10-24); ADR-054 (accepted the same day); ADR-017 (the agent is the caller),
ADR-019 (no second framework or tenant-access surface), ADR-027 (Jev constraints), INV-001. Task 84 (the agent system, built
2026-09-04), Task 81 (operating rules), Task 95 (long-term vision, phases 4 to 6 not authorized), Task 113 (audit, closed).
Grounded in `reports/Verity agent framework choice.md` (research of 2026-10-24, five source notes beside it in
`research_notes/Verity agent framework choice/`). Changes no invariant, no grant, and not `enforcePolicy()`.

## Status: PARTIALLY BUILT 2026-10-24 — phases A to C built and proven on a migrated scratch database; not pushed, migration not on production

The question was whether to adopt Mastra, LangGraph, Dify or CrewAI for an "agentic ERP". The answer, recorded in ADR-056, is no
framework: Verity's loop already runs every tool as the caller through the command pipeline, and every framework examined keeps its
own state outside `withTenant()`. What Verity lacked was narrower, and this plan builds it on Verity's own tables.

## Decisions made by the product owner's delegation ("decide for me", 2026-10-24)

| Question | Decision | Where |
|---|---|---|
| ADR-054 (hosted default, DSEW the one Mode B target, no model on-prem) | ACCEPTED, text unchanged | `adr-054.md` |
| A single routine write from the agent | Stays immediate. The person's message is the authorization | ADR-055 cl. 1 |
| Money, ledger, cancel, void, approve, send, merge, bulk, import | `confirm`: stored, run only on the proposer's Confirm | ADR-055 cl. 1 |
| Destructive commands | Still never run from the agent. Allowing a *proposal* waits 90 days of data | ADR-055 Review |
| Where a pending action lives | A tenant table under RLS, not browser state and not a framework store | ADR-055 cl. 3 |
| What is recorded per turn | Bounded `agent_turn` row; 90 days; pending actions purged 30 days after decision | ADR-055 cl. 4, 5 |
| Agent frameworks | None own state, orchestration, storage or authorization | ADR-056 cl. 1 |
| Libraries | Allowed at component level under six conditions; Vercel AI SDK is the first candidate, adopted when streaming or a non-compatible provider is built | ADR-056 cl. 2 |
| Documents from outside (supplier PDFs, email) | Untrusted data: no-tools extraction call, typed result, review step, `confirm` for anything that follows | ADR-056 cl. 3 |
| Provider | An environment setting chosen by an evaluation gate (cl. 5 bars); paid tier with written non-training terms before real client data | ADR-056 cl. 5 |
| The six personas | **Only the read-only Business Analyst is authorized**, after phases D and E. The other five (Quotation, Procurement, Project Coordinator, Quality, Document) each need their own go-ahead after the analyst's numbers are reviewed | this plan, phase F |

The thresholds in ADR-055 cl. 5 and ADR-056 cl. 5 are the author's initial choice. Change them in the ADR text, no new ADR.

## Phases

| Phase | What | Status |
|---|---|---|
| A | ADR-054 accepted; ADR-055, ADR-056 written; `CLAUDE.md` register corrected | DONE 2026-10-24 |
| B | `agent_pending_action` table (RLS, forced), `agentApprovalClass`, propose/claim/outcome, `decidePendingAction`; the route and dock send the pending action's id, not inputs; grounding and schema check before a row is stored | BUILT 2026-10-24: `src/server/platform/agent-approval.ts`, `agent-chat.ts`, `src/app/api/agent/chat/route.ts`, `AgentChatDock.tsx`, migration `20261025000000_agent_pending_action_and_turn`. 15 database tests and 6 classifier tests; a mutation check (classifier disabled) fails 4 of them |
| C | `agent_turn` record on every `runAgentTurn`; daily purge schedule (`verity.platform.purge_agent_records`) | BUILT 2026-10-24, same files; record failure proven not to block the reply |
| D | Provider: take a paid tier, set `OPENAI_BASE_URL` / `OPENAI_MODEL`, run phase E against it | NOT STARTED — needs the product owner's account and key |
| E | Scenario suite scored per model: single-step reads, ungrounded and invented ids, permission denial, duplicate writes, injection through a record's text and through a document, plus latency and cost. Deterministic checks already exist as tests; the model-scored half (Promptfoo, dev dependency, pinned) is not built | NOT STARTED |
| F | Read-only Business Analyst: a system prompt plus a `toolKeys` bundle of queries. Measure accuracy, grounding failures, authorization failures, cost, latency before widening | NOT STARTED — after D and E |
| G | Document extraction (supplier quotation PDF to a proposed quotation or purchase request) under ADR-056 cl. 3 | NOT STARTED — needs a feature addendum naming the field projection, and F's numbers |
| H | Streaming and the AI SDK adapter (ADR-056 cl. 2) | NOT STARTED — trigger: a client needs streamed answers or a non-OpenAI-compatible provider |
| I | A read surface for turn records for a permitted role or an entered support session | NOT STARTED — none exists by decision (ADR-055 cl. 5) |

## Evidence

- **Where the code is:** commit `b66642c0` (message: "ui: sticker slips no longer clip; page-header actions are an even grid on
  phones"). Another session committed while this work was staged in the shared index, so the commit holds both. The agent files,
  migration, ADR-054/055/056, this plan and the tests are in it; the research is `a72df7fd`. Not rewritten, because the branch is
  shared and unpushed. To review only the agent work: `git show b66642c0 -- <path>` for the paths above.
- Local test database: `postgres` container `verity-baseline-db-1`, database `verity` is a stale baseline (missing months of
  migrations, `prisma migrate deploy` refuses with P3005). Recipe that works: `CREATE DATABASE verity_agent_test TEMPLATE
  verity_clean`, then `prisma migrate deploy` with `DATABASE_URL`/`DIRECT_URL` pointing at it (all 156 migrations apply, mine
  included), then run vitest with the same two variables exported (`setup-env.ts` does not override variables already set).
- `src/test/agent-pending.test.ts` (15), `src/test/agent-approval.test.ts` (6, also in `vitest.pure.config.mts`),
  `src/test/agent-chat-route.test.ts` (8, rewritten for id-only decisions); conformance, tool-manifest, grounding, outreach,
  external-tools, tenant-isolation suites pass unchanged except two conformance budgets raised with reasons (three JSON column
  names, platform module count 58 to 59).
- `npx tsc --noEmit` and ESLint clean on every changed file.

## Rollout order (the part that can hurt)

1. Apply `20261025000000_agent_pending_action_and_turn` to production **before** the push (the same rule as FINISHER P0-2). Code
   without the tables fails closed: a `confirm`-class proposal throws (500) and nothing runs; a turn record fails quietly.
2. Push. Open the assistant, ask for a `confirm`-class action, confirm it once, confirm it again (expect "already answered").
3. Browser-check the dock's pending card at desktop and 390px in both themes before calling it DEMO-READY (not done).

## Non-goals

No agent framework. No unattended or scheduled agent runs (Task 95 phases 4 to 6, which need their own ADR). No second approver
(an `ApprovalRequest` chain) and no destructive proposals until the ADR-055 Review. No document ingestion without ADR-056 cl. 3.
No change to Relay's tool surface (ADR-029, Task 120): this plan covers the in-app assistant only.
