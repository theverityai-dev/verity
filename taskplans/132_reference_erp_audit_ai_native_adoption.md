# Task Plan 132 — Four reference ERPs (OpenConstructionERP, ERPClaw, Open Mercato, Lambda ERP): what Verity adopts, rebuilt natively, AI first

**Authority:** Product-owner request, 2026-11-06: "adapt what we can from [OpenConstructionERP] to verity", then "put these
too [erpclaw, open-mercato, lambda-erp] … complete deep analysis of these and find what can be adapted from them in verity and
can be redesigned to make it natively optimal in verity especially AI and all". This is a request for analysis. It authorizes
no build by itself: each stage below names the authority it would run under, and anything that is a new business capability
still needs the owner's go-ahead (`CLAUDE.md` scope list; Task 129 "demo inventory" note). Governing decisions: ADR-017 (the
agent is the caller), ADR-019 and ADR-056 (no framework owns state; component libraries only under six conditions; untrusted
content is data), ADR-055 (approval classes, stored pending actions, turn records), ADR-027 (general model calls from a
capability), ADR-029 (external tool surface, inert), ADR-051 (saved views), ADR-054 (no model on-premises). Paired work:
Task 131 (agent approvals, phases D to I), Task 90 (Attention), Task 88 (reconciliation), Task 129 (demo inventory).

## Status: STAGE 1 PARTLY BUILT 2026-11-07 (local database only); stages 2 to 5 PROPOSED

Owner said "go ahead" on 2026-11-06. Built in stage 1, proven on a migrated local database (`verity_t132`):

| Item | What was built | Proof |
|---|---|---|
| A1 tool search | Above 12 tools (`TOOL_SEARCH_THRESHOLD`) a general turn gets one `find_tools` tool instead of every schema; each search adds up to 8 matching tools from the actor's own manifest (`searchTools` in `tool-manifest.ts`). `toolKeys` turns and small manifests are unchanged | `agent-pending.test.ts` (first request carries only `find_tools`; a role-less actor finds nothing), `agent-tool-search.test.ts` |
| A3 budgets and usage | Per turn: 16 tool calls, 90 s, 150,000 tokens (`TURN_BUDGET`). Provider-reported tokens summed and stored on `agent_turn` (`prompt_tokens`, `completion_tokens`). Per-tenant ceiling over any 24 hours, `AGENT_TENANT_DAILY_TOKENS`, default 1,000,000; reached means a plain reply and no provider call | `agent-pending.test.ts` (tokens recorded, ceiling stops without calling the model, call budget ends a turn) |
| A4 stale re-check | Confirm is refused with `E_STALE` (HTTP 409) and the row marked `stale` when the activity trail shows a change, by anyone, to any record the stored input names in a `*Id` field since the proposal | `agent-pending.test.ts` (changed record refused and never run, unrelated change still runs) |
| A9 plain words (part) | Prompt rules 6 and 7; `plainDescription` gives the model and the confirmation card a readable name when a command has no `description` | `agent-tool-search.test.ts` |
| A10 what just happened | `verity.platform.recent_changes` on `verity.platform.activity`: the caller's own changes in the last N minutes (or everyone's with `mine: false`), field names only, through the ordinary Read grant | registry search test |

Mutation check: disabling the stale check, the search, or the call budget each fails its test. Migration
`20261107000000_agent_turn_usage_and_stale` is **not on production**; the build's migration assertion blocks a deploy until it is.

Not built in stage 1: the old-beside-new diff on the confirmation card (needs a per-entity read of the target row); `resolve_by_name`
(the prompt's exact-match rule and grounding's ambiguity check stand in); writing `description` on the 318 of 384 commands and
239 of 259 queries that lack one (`plainDescription` covers the gap, so the search still matches key words).
The per-tenant ceiling override (section 7.4) is not built; the deployment-wide setting is.

Section 6 is the recommended order; section 7 lists what needs a decision.

---

## 1. The four references, and what may be taken from each

All four are cloned under `D:\Code\R&D\` (beside `twenty`, `erpnext`, `odoo-19.0`, `ury-develop`).

| Repo | Commit read | Licence | Stack | What may be taken |
|---|---|---|---|---|
| `OpenConstructionERP` (DataDrivenConstruction) | `d9bc6b36`, 2026-11-03 | **AGPL-3.0-or-later**, with a CLA and a commercial option | Python/FastAPI, React, 194 modules | **Ideas and data models only. No source, no prose.** AGPL's network clause would bind hosted Verity. Its source also carries invisible zero-width characters in docstrings (seen in `backend/app/modules/voice/service.py`), i.e. a watermark: copied text would be traceable. |
| `erpclaw` (AvanSaber) | `aea9795`, 2026-10-09 | **GPL-3.0** | Python + SQLite/Postgres, driven by an agent runtime (OpenClaw/Hermes/MCP) | **Ideas only.** Already used as the reference for Tasks 72-78 (`D:\Code\R&D\erpclaw-main` is the older snapshot). |
| `open-mercato` | shallow clone 2026-11-06 | **MIT** core; enterprise modules licensed separately | TypeScript, Next.js, PostgreSQL (MikroORM), Vercel AI SDK | Code may legally be adapted with the MIT notice kept, **enterprise packages excluded**. In practice we still rewrite against Verity's runtime: its code assumes MikroORM, Awilix DI and its own ACL, none of which Verity has. |
| `lambda-erp` (Lambda Development / Torus Investments AG) | `d12e220`, 2026-11-03 | **Apache-2.0** | Python core, FastAPI, React/Vite, OpenAI | Code may be adapted with attribution and the NOTICE; same practical answer as Open Mercato. Single-company deployment, not multi-tenant. |

Rule for this plan, as for Task 128 (Twenty): **no source file is copied into Verity.** Every pattern is rebuilt on
`registerCommand` / `registerQuery` / `enforcePolicy()` / `withTenant()`. Where an MIT or Apache file is close enough to be
worth porting line by line, that is called out and the licence notice goes with it.

## 2. What each one is, in one paragraph

**OpenConstructionERP.** A very wide construction ERP: BOQ and estimating, cost databases, BIM/CAD/clash, tendering,
4D schedule, EVM, change orders, daily diary, punch list, QMS/NCR, HSE, CDE document control, regional packs (DACH, UK, US,
India…), plus a large AI layer (agent loop with a tool registry, ERP chat that only *proposes* changes, voice capture, a
"trust envelope" on every AI output, an accuracy scoreboard with Brier score and calibration). Breadth over depth; most of
it is construction-only and outside Verity's scope.

**ERPClaw.** An ERP whose *only* interface is an agent. 496 actions across 14 domains behind three MCP tools:
`list_actions`, `describe_action`, `action`. Its strengths are discipline rules for the agent: look it up this turn before
claiming it exists; exact-match a company name, never fuzzy-pick whose books get posted; describe actions to the user in plain
English, never by internal name; destructive classes need confirmation; "the books say no" (three-way match lives in the
ledger, not in a prompt).

**Open Mercato.** The closest to Verity in stack and intent: modular Next.js + Postgres business platform, multi-tenant,
built to be extended by coding agents. Its `ai-assistant` package is the most complete agent subsystem of the four: typed
per-module agents (`AiAgentDefinition`: prompt, tool allowlist, mutation policy, loop budget), a pending-action table with a
**re-check at confirm time** and field-diff preview cards, tool search over the tool registry, token-usage recording,
per-tenant versioned prompt overrides, ten LLM providers behind one port, an MCP server keyed by API keys. Its `inbox_ops`
module turns forwarded emails into reviewed action proposals with confidence and discrepancy flags. Core modules worth
noting: `perspectives` (saved table views), `forms` (versioned definitions, append-only submissions), `business_rules`,
`planner` (availability), `query_index` (full-text + vector).

**Lambda ERP.** Chat-first ERP for one company. The model never writes SQL: it calls **whitelisted semantic datasets**
(`sales_invoices`, `ar_open_items`, `stock_balances`…) with whitelisted filters and group-bys; a second "report specialist"
call returns a **declarative report spec** (JSON, never code) that the browser interprets into a chart. Other ideas: company
setup by describing the business (country pack × sector profile → chart of accounts and tax templates, previewed then booked),
attachments in chat become draft documents, bank-statement import with suggested matches, PDF layouts edited by asking, and a
**seeded historical business simulator** that walks business days and generates realistic document flows.

## 3. What Verity already has (do not rebuild)

Checked in the code on 2026-11-06:

| Pattern seen in the references | Verity today |
|---|---|
| Tool list generated from the module registry, filtered by the caller's permissions (OM tool registry, Lambda doctype seams, ERPClaw catalog) | `src/server/platform/tool-manifest.ts`: one manifest from `listCommands`/`listQueries`, scoped by one `resolvePermissions` call and active capabilities |
| Agent acts with the user's own authority (all four, with varying rigour) | ADR-017; `agent-chat.ts` passes `channel: "agent"` for provenance only |
| Mutation approval with stored pending actions (OM D16, ERPClaw ADR-0018 classes) | ADR-055: `routine` / `confirm` / `blocked`; `agent_pending_action` under RLS; `agent-approval.ts` |
| "Query before you claim" (ERPClaw's system-of-record rules) | `grounding.ts`: ids must have appeared in a query result this turn; `checkProseClaims` checks numbers in the reply |
| Untrusted documents and emails as data (OM InboxOps risks, OCE erp_chat) | ADR-056 clause 3 |
| Turn history / audit of agent runs | `agent_turn` rows, 90-day retention |
| Saved table views (OM `perspectives`) | ADR-051, `src/server/platform/views.ts` |
| Generic approval routes (OCE `approval_routes`) | `capabilities/approval`, `workflow.ts` |
| Notifications with an outbox | ADR-039, `notification-outbox.ts` |
| Project jobs with tasks, milestones, time, cost, invoices (OCE `projects`, `tasks`, `finance`) | `capabilities/project` (DSEW) |
| Inspection with sampling (OCE `inspections`) | piecework inspection with AQL (in progress in this checkout) |
| Module manifests, enable/disable per tenant (OCE `manifest.py`, OM modules) | `capability.ts` (`CapabilityDefinition`, `TenantActivation`), packs (`pack.ts`, ADR-022) |
| API keys for machine callers (OM `api_keys`, Lambda bearer keys) | `external-tools.ts` primitives, ADR-029 PROPOSED, **inert by design** |

So Verity's agent foundation is *stricter* than any of the four (RLS-held approvals, grounding, one authorization path). The
gaps are elsewhere: cost of the tool list, what the agent can usefully *answer*, how proposals earn trust, and how outside
content gets in.

## 4. AI: what to adopt, redesigned for Verity

Ranked by value to Verity's clients (10-100 person Indian businesses, hosted multi-tenant).

### A1. Tool search instead of the whole manifest (from ERPClaw's 3 tools and OM `tool-search.ts`)

- **Problem it fixes:** `agent-chat.ts` (comment on `runTurnLoop`'s `toolKeys` option) records that the full manifest is
  about 18k tokens, over a free-tier per-minute cap; `toolKeys` was added as a workaround for single-purpose turns. Every
  general turn pays for ~110 tool schemas.
- **Native design:** two always-present tools built from the same actor-scoped manifest: `find_tools(query)` returns the
  top N keys with one-line descriptions (lexical match over key, entity, description and the capability label; no vector index
  needed at this size), and `describe_tool(key)` returns one input schema. The model then calls the tool by key. A tool not
  in the actor's manifest can never be found, so ADR-017 is unchanged. Per-turn manifest cost drops to the two meta-tools
  plus whatever was described.
- **Where:** `tool-manifest.ts` (search over descriptors), `agent-chat.ts` (loop). No dependency, no migration.
- **Done when:** the Task 131 phase E scenarios pass with the meta-tools at equal or better tool-selection accuracy, and
  the recorded prompt tokens per turn drop.

### A2. Declared agents (personas) as data (from OM `AiAgentDefinition`)

- Task 131 phase F already needs "a system prompt plus a `toolKeys` bundle". Make that a registered definition, the way
  capabilities register commands: `registerAgent({ key, label, prompt, toolKeys, maxSteps, budget })`. The definition can
  only *narrow* the actor's manifest. The first one is the read-only Business Analyst (131 F).
- Not adopted: OM's per-tenant prompt overrides stored in the database and its `ToolLoopAgent` engine (ADR-056 clause 1).
  Tenant prompt overrides can come later as configuration once there is a second persona and a reason.

### A3. Loop budgets and recorded usage (OM token-usage recorder and loop budget; Lambda's daily spend cap)

- Add `maxToolCalls`, `maxWallClockMs` and `maxTokens` per turn (today only `MAX_TOOL_ITERATIONS = 8`), and record prompt
  and completion tokens, model and latency on `agent_turn`.
- A per-tenant daily token ceiling, configured by HQ, refuses new turns with a clear message once reached. Hosted multi-tenant
  needs this before any paid provider is switched on (Task 131 phase D): one tenant must not be able to spend the month's
  budget.
- Migration: columns on `agent_turn`, a ceiling on tenant configuration. HQ sees totals only (the ADR-036 pattern).

### A4. Re-check and show the diff at confirm (OM `pending-action-recheck.ts`, field-diff card)

- Today a confirm re-runs `enforcePolicy()` (so permissions are rechecked) and expiry is checked, but **nothing notices that
  the target record changed between proposal and confirm.** Store the target's `updatedAt` (or version) on the pending action
  at proposal; refuse with `E_STALE` at confirm if it moved, and ask the person to re-ask.
- The preview card shows the fields that will change, old beside new, read from the stored input and a fresh query, never
  from model text.

### A5. Semantic datasets for questions about numbers (from Lambda ERP)

- **Problem:** the Business Analyst will be asked "sales by outlet last month", "who owes us most", "karigar output this
  week". Today that means many list queries and the model adding up rows, which is slow, costly and where wrong numbers come
  from.
- **Native design:** each capability *declares* datasets: a name, the measures (sum/count/avg over named columns), the allowed
  dimensions (date bucket, outlet, party, item, state…) and allowed filters. One generic query,
  `verity.analytics.aggregate`, takes `{ dataset, measures, groupBy, filters, period }`, validates against the declaration,
  builds the SQL from the declaration (never from model text), runs it under `withTenant()` and the dataset's `Read`
  permission, and returns rows. The numbers it returns feed `checkProseClaims`, so the reply can only quote numbers the
  platform computed.
- Same declarations can serve dashboards and the export registry (ADR-037), so this is one registry, not a third.
- Needs: a decision on where declarations live (proposed: `contribution.ts`, like navigation), because it is a new platform
  registry. Classification: **implementation decision required**, small.

### A6. Reports drafted by chat as a declarative spec (Lambda's report specialist)

- After A5: the agent may return a report spec `{ dataset, measures, groupBy, filters, chart: "bar" | "line" | "ring" |
  "table" }`, validated by a schema, rendered by the existing instrument charts (`PieceRing`, tick bars, hairline areas,
  ADR-053), and saved as a saved view (ADR-051). No generated code ever runs; one model, not a second "specialist", until a
  measured need.

### A7. Outside content becomes a proposal (OM InboxOps, Lambda chat attachments, OCE voice capture)

- This is Task 131 phase G, widened from "supplier quotation PDF" to the channels Indian SMEs actually use: a **forwarded
  email**, a **WhatsApp message or photo** (order lists, challans), a **PDF**, a **voice note** (often Hindi).
- Design per ADR-056 clause 3: one no-tools extraction call, a typed result validated by zod, a proposal card beside the
  source, then a `confirm`-class command. Two things to take from InboxOps: **discrepancy flags** computed by Verity, not the
  model (price differs from the price list, quantity over the open order, unknown party, item not found), and **proposal-id
  provenance** stored on whatever record the confirm creates. From OCE voice: transcription and structuring both degrade to a
  plain-text draft when no provider is configured (ADR-027's non-AI fallback).
- Each channel needs its feature addendum naming the projection (ADR-056 clause 4). Inbound email and WhatsApp intake are new
  public write surfaces: **missing ADR** before either is reachable from outside.

### A8. Trust envelope and an accuracy scoreboard (OCE `trust.py`, `accuracy.py`)

- Every extraction proposal (A7) carries a structured envelope: `confidence` 0..1, a one-line `rationale`, `sources` that are
  real ids or source-text spans, and `missing` (what would raise confidence). Verity validates that each source exists;
  an invented source zeroes the confidence.
- Record the person's decision on each proposal: accepted unchanged, edited (which fields), rejected. From that, per agent and
  per field: acceptance rate, edit rate, and calibration (Brier score and expected calibration error, computed in plain
  TypeScript). This is **exactly the evidence ADR-055's Review clause waits for** ("allowing a proposal waits 90 days of
  data") and the honest basis for ever moving a proposal kind from `confirm` to `routine`.

### A9. Plain words and safe name resolution (ERPClaw)

- Commands carry an optional `description` (`command.ts`), and the pending card falls back to the raw `commandKey` when it
  is absent (`agent-chat.ts`, `decidePendingAction`). Make `description` required for every command the agent can reach
  (a conformance test over `listCommands()`), and have the prompt describe actions by it, never by key.
- Add one generic read per entity type, `resolve_by_name`, returning ranked candidates. Rule from ERPClaw, adopted as written:
  for anything that decides **whose money or books** (party, company, ledger account), more than one candidate means *ask*,
  never pick. Grounding already stops invented ids; this stops a *real but wrong* id.

### A10. "What just happened" (ERPClaw)

- A read-only agent query over the tenant's audit/activity for the last N minutes, scoped to the caller's own actions unless
  they hold the audit permission. Cheap, and it answers the most common follow-up after a confirm.

### A11. Set up by describing the business (ERPClaw onboarding, Lambda country × sector chart of accounts)

- Verity's version: the person describes the business; the agent proposes a pack/template plan (capabilities, roles,
  sample masters, GST settings) built from `pack.ts` / `template.ts`; the plan is one `confirm`-class action, previewed in full.
  Strong for demo inventory (Task 129) and onboarding. Needs the owner's go-ahead because it changes what a tenant gets.

### A12. MCP endpoint (all four expose one)

- MCP is only a transport over the same manifest. Verity should not add it before ADR-029 moves past PROPOSED with a key
  store, rate limits and audit (Task 120). When it does, the tool list is A1's search, and the approval classes are mapped the
  way ERPClaw maps them (`destructiveHint`), with one rule ERPClaw learned the hard way (`mcp/tool_router.py` header): a
  model-supplied "confirmed" flag is **never** human approval.

### A13. Evaluation (OM tool test fixtures, Lambda's scripted demo)

- Task 131 phase E. Add scenario fixtures per declared agent (A2) and per dataset (A5): expected tool, expected numbers. Run
  them against each provider before ADR-056 clause 5's gate.

### Not adopted

| Idea | Why not |
|---|---|
| Vercel AI SDK agent loop, `ToolLoopAgent`, its tool approval (OM) | ADR-056 clauses 1 and 2. The SDK as a model-I/O adapter stays the candidate for streaming (131 phase H). |
| OpenCode container as the AI backend (OM) | A second runtime with its own tool execution path outside `enforcePolicy()`. |
| Vector search / embeddings now (OM `query_index`, OCE `search`) | No measured need: tool search (A1) and datasets (A5) cover the cases. Revisit with a real retrieval use (documents, SOPs); pgvector is then an implementation decision under RLS. |
| LLM-built modules at runtime (OCE `module_builder`) | Generates code in production; contradicts the foundation's "capabilities are reviewed code". |
| Natural-language compliance rules compiled to an engine (OCE `compliance_ai`) | No rules engine to compile into yet; revisit with Task 104's open questions. |
| Model-supplied confidence used to auto-execute | Confidence informs review; only measured acceptance (A8) can change an approval class, and only by ADR. |

## 5. Non-AI patterns worth taking

| # | Pattern (source) | Native shape in Verity | Authority to build |
|---|---|---|---|
| P1 | Cross-module deadline sweep with escalation (OCE `deadlines`) | Task 90 "Attention": capabilities register due-date sources (query + owner + severity rule); one scheduled sweep classifies overdue / due soon; notifies the owner through the outbox; escalates to the manager on repeat. Pure classification logic unit-tested without a database | Task 90 (PENDING, platform-shaped) |
| P2 | Statutory payment clock (OCE `payment_clock`, which models India's MSMED Act 2006) | For suppliers registered as micro or small enterprises (Udyam): payment due by the agreed date, at most 45 days from acceptance (15 days if nothing agreed); late payment carries compound interest at three times the RBI bank rate with monthly rests; Income-tax Act s.43B(h) disallows the expense until paid. Verity: an MSME flag and Udyam number on the supplier, a derived statutory due date on each payable, an ageing flag, and a P1 Attention source. **Verify every figure against the bare Act before building; OCE's data file is not a source.** | Trading/buying payables; needs owner go-ahead (every current client is an MSME buyer or supplier) |
| P3 | Validity-window documents with reminders (OCE `compliance_docs`, `credentials`) | One generic "valid until, remind N days before" on documents and evidence: GST and trade licences, vehicle and machine insurance, AMC contracts, worker certificates. Feeds P1 | Extends `document`/`evidence`; small |
| P4 | Seeded historical business simulator (Lambda `simulation.py`) | A demo generator that walks business days (Indian holidays), with seasonality and partial flows (split deliveries, part payments, some unpaid), **through registered commands, not raw inserts**, so every invariant, event and audit row is real. Gives demo tenants months of history for dashboards, the analyst and ROUTE-WALKED/DEMO-READY | Task 129 (demo inventory) |
| P5 | Change orders / variations with cost and time impact and "ball in court" (OCE `changeorders`, `variations`) | On `project` jobs: a variation with cost and day impact, linked quote revision, approval through `approval`, and the job's budget and due date updated on approval. DSEW engineered jobs are the use | Owner go-ahead (business capability growth) |
| P6 | Punch / snag list with photo, verify-close, reopen history (OCE `punchlist`) | Job-level defect items using `evidence` for photos; closed only by a different person who verifies. Overlaps complaint and inspection: build once, generic | Owner go-ahead |
| P7 | Versioned forms with append-only submissions (OM `forms`) | Checklist templates with versions; a submission pins the version it answered. Inspection checklists, daily site logs (OCE `daily_diary`) and audits all become instances | Platform-shaped; check against custom fields (Task 104) first |
| P8 | Bank statement import with suggested matches (Lambda) | After Task 130 (ledger posting): import, deterministic match first, model suggestion as a `confirm` proposal | After Task 130 |
| P9 | "The books say no" (ERPClaw three-way match) | Already the Verity rule (invariants live in commands, never in prompts). Add the three-way match when buying invoices exist | Existing |

**Out of scope, not taken:** BOQ/estimating, cost databases, BIM/CAD/clash, GAEB/NRM/MasterFormat, EVM, 4D schedules,
tendering, HSE, CDE/ISO 19650, regional construction packs. No client has asked; construction is not an authorized capability.
Revisit only if a construction client appears, and then from this list, not from a fork.

## 6. Recommended order

| Stage | Items | Runs under | Needs before start |
|---|---|---|---|
| 1. Agent cost and safety | A1 tool search, A3 budgets + usage + tenant ceiling, A4 stale re-check + diff, A9 resolve-by-name, A10 what happened | Task 131 (the agent channel), ADR-055/056 | Nothing new; one migration for A3/A4 columns |
| 2. An agent that answers | A5 datasets (+ small decision on the registry's home), A2 declared agents, then the Business Analyst (131 F), A6 report specs, A13 fixtures | Task 131 phases E and F | Provider key and paid tier (131 D) for the measured part |
| 3. Outside content | A7 extraction (PDF first, then email, WhatsApp, voice) with A8 envelope and scoreboard | Task 131 phase G, ADR-056 cl. 3 | Feature addendum per channel; an ADR for any inbound public surface |
| 4. Platform and demo | P1 Attention sweep, P3 validity windows, P4 simulator | Tasks 90 and 129 | Nothing for P1/P3; P4 per demo tenant |
| 5. Owner-gated | P2 MSME clock, P5 variations, P6 snag list, P7 forms, A11 setup by description, A12 MCP | Owner decision; ADR-029 for A12 | See section 7 |

## 7. Open decisions (do not solve silently)

1. **Owner:** authorize stage 5 items individually (P2 is the one with value for every current client).
2. **Implementation decision required:** where dataset declarations (A5) live: `contribution.ts` (proposed) or a new
   registry.
3. **Missing ADR:** any inbound email or WhatsApp address that creates proposals from outside (A7).
4. **Product owner:** the per-tenant daily token ceiling (A3): its default and who can raise it (HQ only is proposed).
5. **Verification required:** MSMED Act s.15-16 and Income-tax s.43B(h) figures (P2) from the bare Act, not from OCE.

## 8. Non-goals

- No source copied from any of the four; no AGPL or GPL text in the tree.
- No agent framework, no second tool-execution path, no change to ADR-017, INV-001 or `enforcePolicy()`.
- No construction capability.
- No unattended or scheduled agent runs (Task 95 phases 4 to 6).
