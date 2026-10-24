# Verity's existing agent architecture, decisions and constraints (repo-only, read 2026-10-24)

Scope: what `D:\Code\verity` already has and has decided about AI agents, so a proposal to adopt Mastra / LangGraph / Dify / CrewAI can be judged against it. All sources are repository files; links are local paths with line numbers. Anything inferred is marked **(inferred)**.

## Q1. What does the existing agent code do?

### Takeaway
Verity already has a working, hand-rolled agent: one TypeScript tool-calling loop (about 400 lines) that calls any OpenAI-compatible chat-completions endpoint with plain `fetch`. Its tools are generated automatically from the registered Commands and Queries and filtered to what the signed-in user is allowed to do. Every tool call runs as that human through the normal `executeCommand`/`executeQuery` pipeline with `channel: "agent"`. It can perform routine writes. Destructive writes never run. Repeated writes to the same command stop at a preview the human must confirm. Tool calls are audited and grounded. Replies do not stream, and the server keeps no conversation history.

### Cited Findings
**Provider / SDK**
- `agent-chat.ts` describes itself as "the only place that talks to an LLM provider; nothing else in `src/server/platform/` knows one exists." — [src/server/platform/agent-chat.ts:12-16](file:///D:/Code/verity/src/server/platform/agent-chat.ts)
- The provider is "Groq's OpenAI-compatible chat-completions endpoint, reusing `OPENAI_API_KEY`/`OPENAI_BASE_URL`/`OPENAI_MODEL`… No SDK dependency added — the OpenAI tool-calling wire format is a handful of fields over plain `fetch`." — [agent-chat.ts:29-35](file:///D:/Code/verity/src/server/platform/agent-chat.ts)
- The call is `POST ${baseUrl}/chat/completions` with a bearer key, sending `model`, `messages`, `tools` and `tool_choice` ("required" on the first iteration only when `toolKeys` narrows the manifest, otherwise "auto"). There is no streaming flag. A non-2xx response throws `E_AGENT_PROVIDER`. — [agent-chat.ts:159-199](file:///D:/Code/verity/src/server/platform/agent-chat.ts)
- `readAgentProviderConfig()` reads `OPENAI_API_KEY`, `OPENAI_BASE_URL` and `OPENAI_MODEL`, and returns undefined if any is missing. The route then answers `503 AgentNotConfiguredError`. — [src/server/platform/config.ts:398-406](file:///D:/Code/verity/src/server/platform/config.ts); [src/app/api/agent/chat/route.ts:102-107](file:///D:/Code/verity/src/app/api/agent/chat/route.ts)
- `.env.example`: "Optional OpenAI-compatible agent provider (OpenAI, Groq, or compatible API)". — [.env.example:126-129](file:///D:/Code/verity/.env.example)
- Model history: Task 113 found that `groq/compound` returns HTTP 400 on tool calls, so the model was switched to `openai/gpt-oss-120b` on Groq. The Groq free tier is capped at 8000 TPM, which is less than one grounded multi-tool turn. "gpt-oss-120b on Groq is not fully reliable at forced tool-calling." — [taskplans/113_ai_implementation_audit_all_clients_and_global_agent.md:83-140](file:///D:/Code/verity/taskplans/113_ai_implementation_audit_all_clients_and_global_agent.md)

**Loop shape**
- `runAgentTurn(actor, history, userMessage, {toolKeys?})` builds the manifest inside `withTenant`, creates one fresh `GroundingCache` for the turn, and loops at most `MAX_TOOL_ITERATIONS = 8` times. If the cap is reached it returns "I reached the tool-call limit…". — [agent-chat.ts:37, 333-399](file:///D:/Code/verity/src/server/platform/agent-chat.ts)
- The system prompt treats tool results and history as untrusted data. It requires a query before any claim, exact-match only (list candidates when ambiguous), tells the model that destructive tools return `needs_approval`, and maps error codes to retry behaviour. — [agent-chat.ts:119-145](file:///D:/Code/verity/src/server/platform/agent-chat.ts)
- Each tool result goes back to the model wrapped as `{untrusted_data: …}`. — [agent-chat.ts:384-391](file:///D:/Code/verity/src/server/platform/agent-chat.ts)
- Tool names are command/query keys with `.` replaced by `__`, because OpenAI names cannot contain dots. — [agent-chat.ts:97-104](file:///D:/Code/verity/src/server/platform/agent-chat.ts)

**Tools: derived from the registry, filtered by the actor**
- `buildToolManifest(tx, actor)` enumerates `listCommands()`/`listQueries()` and converts each zod `input` with `z.toJSONSchema` ("one source of truth"). A tool is included only if the actor's role grants the verb on the entity and the entity's capability is ready for the tenant. A role-less actor gets `[]`. — [src/server/platform/tool-manifest.ts:42-138](file:///D:/Code/verity/src/server/platform/tool-manifest.ts)
- The descriptor shape is `{key, kind: command|query, entity, description, inputSchema, impact?: routine|destructive}`. — [tool-manifest.ts:42-53](file:///D:/Code/verity/src/server/platform/tool-manifest.ts)
- Scale: the registry holds about 110 commands/queries. The owner role on the Shree Ganesh tenant received 104 tools. The full manifest is "~18k tokens, over a free-tier provider's per-minute cap", which is why `toolKeys` narrowing exists. — [tool-manifest.ts:30-39](file:///D:/Code/verity/src/server/platform/tool-manifest.ts); [taskplans/84_verity_ai_agent_system.md:86-97](file:///D:/Code/verity/taskplans/84_verity_ai_agent_system.md); [agent-chat.ts:338-347](file:///D:/Code/verity/src/server/platform/agent-chat.ts)

**Authorization**
- "THE LOOP EXECUTES EVERY TOOL AS THE CALLING HUMAN'S OWN `ActorContext` (ADR-017) — `channel: "agent"` is passed… for audit provenance only." — [agent-chat.ts:18-23](file:///D:/Code/verity/src/server/platform/agent-chat.ts)
- `ActorContext = {tenantId, userId, membershipId, organizationId, roleId}`. — [src/server/platform/command.ts:36-43](file:///D:/Code/verity/src/server/platform/command.ts)
- `PolicyChannel = "human" | "api" | "job" | "agent"`, under the rule "THE CHANNEL IS RECORDED, NEVER CONSULTED". `policy-engine.test.ts` asserts identical verdicts across the four channels and checks that no branch reads `channel`. — [src/server/platform/policy.ts:40-58](file:///D:/Code/verity/src/server/platform/policy.ts)
- The only branch on `channel === "agent"` in the command pipeline adds grounding (`assertGrounded`), which is a restriction. It runs after `enforcePolicy`. — [command.ts:251-265](file:///D:/Code/verity/src/server/platform/command.ts); confirmed "NO DRIFT FOUND" in [taskplans/113…md:166-177](file:///D:/Code/verity/taskplans/113_ai_implementation_audit_all_clients_and_global_agent.md)
- `executeQuery` was moved onto `enforcePolicy` with a `channel` parameter (Task 84 area 5). Before that, reads called only `authorize()`. — [src/server/platform/query.ts:88-127](file:///D:/Code/verity/src/server/platform/query.ts); [taskplans/84…md:112-122](file:///D:/Code/verity/taskplans/84_verity_ai_agent_system.md)
- The route uses `requireActor()`, the ordinary session, with "no separate agent credential". It also applies a per-actor rate limit (`limitActorRequests(…, "chat")`, 429 with Retry-After), a 96 KB body cap, and zod validation that rejects a forged `system` role in history, history longer than 20 entries, and messages over 8000 characters. — [src/app/api/agent/chat/route.ts:17-75](file:///D:/Code/verity/src/app/api/agent/chat/route.ts); tests [src/test/agent-chat-route.test.ts:36-77](file:///D:/Code/verity/src/test/agent-chat-route.test.ts)

**Mutations and human approval**
- Mutations are allowed. A command tool runs through `runCommandBatch(actor, command, [input], {channel:"agent", grounding})`. — [agent-chat.ts:215-233](file:///D:/Code/verity/src/server/platform/agent-chat.ts)
- Destructive commands (`impact === "destructive"` or verb `Delete`) never run unless `confirmed: true`. The agent never passes that flag, so the result is always `needs_approval`, and the prompt tells the user to do it in the app. — [src/server/platform/batch.ts:41-81](file:///D:/Code/verity/src/server/platform/batch.ts); [agent-chat.ts:134-137](file:///D:/Code/verity/src/server/platform/agent-chat.ts)
- Preview/confirm (Task 81 rule 8 step 3): when one assistant message holds two or more calls to the same routine command, nothing runs and a `PendingPreview {commandKey, description, inputs}` is returned. When the human clicks Confirm, `executeConfirmedPreview` runs exactly those inputs without calling the model again (route body `{confirmPreview}`, capped at 50 inputs). A single routine call runs immediately. — [agent-chat.ts:51-74, 249-326, 379-382](file:///D:/Code/verity/src/server/platform/agent-chat.ts); [route.ts:40-84](file:///D:/Code/verity/src/app/api/agent/chat/route.ts)
- The confirm happens within the same request/response cycle and nothing is persisted. If the user closes the dock, the preview is lost (it lives in client state). — [src/components/shell/AgentChatDock.tsx:35-41, 88-118](file:///D:/Code/verity/src/components/shell/AgentChatDock.tsx) **(the "lost" part is inferred from client-only state)**

**Grounding, audit, idempotency, streaming**
- `GroundingCache` is one per turn. Any `*Id` input on an agent-channel command must have appeared as an `id` in a query result during this turn, otherwise `E_UNGROUNDED`. The known gap: it does not check which entity the id belongs to. Prose numbers in the reply that no query returned produce `groundingWarnings`, which are warnings only. — [src/server/platform/grounding.ts:1-60](file:///D:/Code/verity/src/server/platform/grounding.ts); [agent-chat.ts:372-376](file:///D:/Code/verity/src/server/platform/agent-chat.ts)
- Audit: every command runs in one tenant transaction (validation, then capability check, then `enforcePolicy`, then grounding, then mutation, then events to the outbox inside the transaction). `set_config('verity.channel', channel)` is applied, events are written with `source: channel`, and failures are recorded via `recordCommandFailure`. Agent actions therefore appear in the normal audit/activity trail labelled `agent`. — [command.ts:14-33, 206-306](file:///D:/Code/verity/src/server/platform/command.ts)
- Conversation and prompt/response content is not persisted server-side. The client sends `history` on each request (Task 84: "no persisted conversation history across page loads (client state only)"). — [taskplans/84…md:135-140](file:///D:/Code/verity/taskplans/84_verity_ai_agent_system.md); [AgentChatDock.tsx:58-78](file:///D:/Code/verity/src/components/shell/AgentChatDock.tsx)
- There is no streaming: "one request/response per turn, capped at 8 tool-call round trips". — [taskplans/84…md:135-136](file:///D:/Code/verity/taskplans/84_verity_ai_agent_system.md)
- The chat surface has no idempotency key. Idempotency exists on the external tool route (Q5) and on `WorkflowRun`.

**UI and second caller**
- `AgentChatDock` is a persistent dock at the bottom right, mounted in `ShellChrome` but deliberately not in `HqChrome`. Its suggested prompts are generic ("What needs my attention right now?"). — [AgentChatDock.tsx:1-34](file:///D:/Code/verity/src/components/shell/AgentChatDock.tsx); [src/components/shell/ShellChrome.tsx:506](file:///D:/Code/verity/src/components/shell/ShellChrome.tsx); [taskplans/84…md:130-133](file:///D:/Code/verity/taskplans/84_verity_ai_agent_system.md)
- The second caller is Outreach lead insights: `runAgentTurn(actor, [], insightPrompt, {toolKeys: INSIGHT_TOOL_KEYS})`, which refuses to record anything unless at least one query was read. — [src/server/actions/outreach.ts:55-75](file:///D:/Code/verity/src/server/actions/outreach.ts)
- Production proof: zero `outreach_ai_insight` rows in any of 5 tenants. "The feature has never persisted a single insight, ever, in production." — [taskplans/113…md:200-224](file:///D:/Code/verity/taskplans/113_ai_implementation_audit_all_clients_and_global_agent.md)

### Inferences
- The loop already provides what a framework's "agent + tools" layer would supply: a tool registry generated from typed schemas, filtered per user, with authorization, audit, grounding and a confirm gate. An adopted framework would have to call `executeCommand`/`executeQuery` as the actor to stay ADR-017-compliant. Its own tool layer would then wrap Verity's rather than replace it. **(inferred)**
- The real weaknesses recorded in-repo are provider-side: the free-tier TPM cap, unreliable forced tool-calling, no streaming, no server-side memory, and a confirm UI limited to the "same command ×N" shape. None of them comes from a missing orchestration framework. **(inferred)**

### Gaps
- I did not find the `policy-engine.test.ts` or `command-runtime.test.ts` assertions specific to the agent channel (cited via the comments that describe them, not read line by line).
- Whether `executeQuery` writes an audit row for every read, or only a policy decision, was not confirmed. It calls `enforcePolicy` with `channel` ([query.ts:110](file:///D:/Code/verity/src/server/platform/query.ts)).

## Q2. AI-related dependencies in package.json

### Takeaway
There are no AI or LLM packages. The only related dependency is `zod` (v4), which generates the JSON Schemas for tools.

### Cited Findings
- A grep of `package.json` for `ai`, `@ai-sdk/*`, `@anthropic-ai/*`, `openai`, `@mastra/*`, `langchain`/`@langchain/*`, `groq-sdk`, `ollama`, `llamaindex`, `crewai` and `@modelcontextprotocol/*` matched only `"zod": "^4.4.3"`. — [package.json:74](file:///D:/Code/verity/package.json)
- Stack context: `next` 16.3.3, `react` 19.2.4, `@prisma/client` ^6.12.0. — [package.json:58, 68, 71](file:///D:/Code/verity/package.json)
- "No SDK dependency added" is a deliberate choice, made because a package for the wire format would be the "single-implementation interface" the project warns against. — [agent-chat.ts:31-35](file:///D:/Code/verity/src/server/platform/agent-chat.ts)
- A repo-wide grep (md/ts/tsx/json, excluding node_modules and research_notes) for mastra, langgraph, langchain, crewai, dify, "vercel ai sdk", @ai-sdk, llamaindex, autogen, "openai agents sdk" and "claude agent sdk" found **no matches**. No agent framework has ever been evaluated or chosen in the repo.

### Inferences
- Adopting Mastra or the Vercel AI SDK would be the first AI SDK dependency, and would reverse the stated "no SDK" stance in `agent-chat.ts`. ADR-027 constraint 5 ("No first-party SDK dependency") covers the decision-model vendors specifically, not general LLMs, but it shows the same posture. **(inferred)**

### Gaps
- None.

## Q3. ADRs that bind an agent framework

### Takeaway
ADR-017, ADR-019, ADR-027, ADR-029, ADR-031 and ADR-039 are ACCEPTED. ADR-054 is PROPOSED. Together they require that any agent acts only as the calling human through `enforcePolicy()`, and that no second framework owns tenant-scoped data or authorization. Unattended or background autonomy needs a new ADR, and so does a general-purpose LLM call from a capability. On-premises hosts never run a model.

### Cited Findings
**ADR-017: agent channel carries no elevated authority (ACCEPTED 2026-09-03)**
- "The AI agent channel authenticates and authorizes as the calling human's own `ActorContext`… `channel: "agent"` is recorded… for provenance only… There is no service-account, elevated, or agent-specific authority path… now or later, without a fresh ADR superseding this one." — [verity-spec/17_decisions/adr/adr-017.md:35-44](file:///D:/Code/verity/verity-spec/17_decisions/adr/adr-017.md)
- "Any future request to give the agent broader reach than the invoking human — a background job acting with no human in the loop, a platform-level automation — is explicitly **not** covered… and needs its own ADR." — [adr-017.md:56-61](file:///D:/Code/verity/verity-spec/17_decisions/adr/adr-017.md)
- Rejected: a dedicated `verity_agent` service identity with its own grants, and treating `channel` as an authorization input. — [adr-017.md:65-78](file:///D:/Code/verity/verity-spec/17_decisions/adr/adr-017.md)

**ADR-019: Payload CMS / any second framework with its own DB-access layer rejected as control plane (ACCEPTED 2026-09-08)**
- Rejected: "Payload CMS (or any comparable second application framework with its own database-access layer)… as the authoritative control plane for any tenant-configurable Verity data", including "workflow/approval definitions". — [adr-019.md:28-34](file:///D:/Code/verity/verity-spec/17_decisions/adr/adr-019.md)
- The reasons, by weight: (1) "a second tenant-access enforcement surface". Verity's RLS plus `withTenant()` fails closed, while a framework's own query/access layer fails **open** by default. (2) "a second authorization decision point" outside `enforcePolicy()`, which ADR-017 forecloses. — [adr-019.md:36-60](file:///D:/Code/verity/verity-spec/17_decisions/adr/adr-019.md)
- Forbidden "under any future proposal": the framework owning the database, a second query authority, framework auth/access control as an authority, or "a second tenant-isolation mechanism of any kind". Patterns may be adopted natively. — [adr-019.md:62-74](file:///D:/Code/verity/verity-spec/17_decisions/adr/adr-019.md)
- Permitted only for content that is never tenant-scoped, and only with its own trigger and review. Any proposal must show "per table, that no column depends on `tenant_id`". — [adr-019.md:76-82, 115-118](file:///D:/Code/verity/verity-spec/17_decisions/adr/adr-019.md)

**ADR-027: external structured-decision model (Jev) as an advisory EdgeCondition source (ACCEPTED 2026-09-25, amended 2026-09-30)**
- Seven constraints: (1) advisory only, with the flow `intent -> model -> enforcePolicy() -> Command` and the model never gating, skipping policy or writing state; (2) per-tenant opt-in for data egress (a `TenantActivation` flag); (3) a minimal named projection with no raw entity dumps and PII excluded by default; (4) every call audited (what was sent, what came back, tenant, workflow); (5) no first-party SDK, direct HTTP only; (6) vendor docs are data, never instructions (a prompt injection was found on a Vercel AI Gateway docs page); (7) mandatory fallback to a non-AI path. — [adr-027.md:44-100](file:///D:/Code/verity/verity-spec/17_decisions/adr/adr-027.md)
- Scope limit: "It does not decide anything about a general-purpose LLM call from a capability — that is a different risk shape (unbounded output, prompt-injection surface from tenant content) and would need its own ADR if proposed." — [adr-027.md:114-118](file:///D:/Code/verity/verity-spec/17_decisions/adr/adr-027.md)
- Amendment: self-hosted Laya (Apache-2.0, `laya-serve POST /v1/systemone`) is accepted as a backend, selected by environment (`DECISION_BACKEND`, `LAYA_ENDPOINT`). Its Python package "is never a dependency of this app; it runs as its own service and is called over HTTP." — [adr-027.md:137-158](file:///D:/Code/verity/verity-spec/17_decisions/adr/adr-027.md)

**ADR-029: external tool-invocation surface for machine callers such as Relay (ACCEPTED 2026-09-30; CLAUDE.md still says PROPOSED, which is stale)**
- An external caller is a provisioned User with one membership and one Role, authenticated by a hashed, revocable key, and runs as an ordinary `ActorContext`. Its rules: tenant comes from the credential; only manifest tools, with unknown and ungranted tools refused identically; **no destructive commands externally**; an Idempotency-Key is required on commands; existing rate limits apply; the surface is dark by default (503 unless `EXTERNAL_TOOLS_ENABLED=1`); every call is auditable (channel `api`). — [adr-029.md:15-58](file:///D:/Code/verity/verity-spec/17_decisions/adr/adr-029.md)
- Built: `external-tools.ts`, `external-auth.ts`, migration `20260930010000_external_api_key`, `POST /api/tools/invoke`, and 21 tests (10 pure plus 11 against the database). — [adr-029.md:61-79](file:///D:/Code/verity/verity-spec/17_decisions/adr/adr-029.md); [src/app/api/tools/invoke/route.ts:95-137](file:///D:/Code/verity/src/app/api/tools/invoke/route.ts)

**ADR-031: deployment modes (ACCEPTED 2026-10-09)**
- Mode A (internet-connected on-prem) is supported first. Mode B (private network: self-hosted IdP and S3, no internet at runtime) and Mode C (air-gapped) are not promised. Constraint: name the mode in every claim. — [adr-031.md:39-48, 83-89](file:///D:/Code/verity/verity-spec/17_decisions/adr/adr-031.md)

**ADR-054: hosted is the default; DSEW is the one Mode B target (PROPOSED 2026-10-22, awaiting product-owner review)**
- Clause 6: "**No language model runs on an on-premises host.** Mode B ships with AI off and no outbound route. If a client opts in, the existing agent channel calls an OpenAI-compatible endpoint through one allow-listed route, per tenant, as the caller's own `ActorContext` (ADR-017)." — [adr-054.md:33-35](file:///D:/Code/verity/verity-spec/17_decisions/adr/adr-054.md)
- Context: DSEW runs Windows Server 2019. Mode B was rehearsed on Linux (Keycloak, TLS proxy, bundled object store, no outbound route) but has not run on DSEW hardware. — [adr-054.md:14-16](file:///D:/Code/verity/verity-spec/17_decisions/adr/adr-054.md)

**ADR-039: notification outbox (ACCEPTED 2026-10-09; in-app channel built)**
- The `domain_event` table is the outbox. A scheduler job dispatches at-least-once with an idempotency key (event id + channel + recipient), per-tenant opt-in, default off. Email and WhatsApp adapters, retry-with-backoff and the `failed` state are still open. — [adr-039.md:5-44](file:///D:/Code/verity/verity-spec/17_decisions/adr/adr-039.md)

### Inferences
- A framework that persists its own state (agent memory, threads, workflow snapshots) in Postgres or another store would hold tenant-scoped data outside RLS and `withTenant`. ADR-019's reasoning applies directly unless that storage is put under RLS through Verity's own tables. **(inferred)**
- Mastra/LangGraph features for agents acting unattended (scheduled or background agents, autonomous loops) fall outside ADR-017 and Task 95 Phase 6 and need a new ADR. **(inferred, grounded in adr-017.md:56-61)**
- Python-based frameworks (CrewAI, LangGraph Python, Dify) could only run as separate services called over HTTP, following the same pattern ADR-027 set for Laya. Any service would also need the ADR-029 posture (a provisioned identity, manifest-only tools, no destructive commands). **(inferred)**

### Gaps
- There is no ADR on general-purpose LLM calls from capabilities (ADR-027 explicitly defers this), on agent memory/vector storage, or on unattended agents.

## Q4. Taskplans: planned, built, deferred, rejected; Relay and Jev

### Takeaway
Task 84's six areas are BUILT (2026-09-04) and implement Task 81's rules. Task 95 is an aspirational six-phase vision: phases 1 and 2 are built, 3 to 6 are not, and Phase 6 needs a new ADR. Task 113 audited the agent: no drift found, provider problems confirmed. Task 119 (Jev/Laya advisory decision node) and Task 120 (Relay inbound tool surface) are built but not live-verified, or dark by default. No orchestration framework was ever proposed.

### Cited Findings
- **Task 84**: "all six areas BUILT 2026-09-04… 'built' does not mean 'final design'." The areas are the tool manifest, the `impact` field, actor-scoped visibility, grounding (MVP), query-channel parity and the chat surface. Its non-goals: "Not a decision about *which* LLM/provider, streaming protocol, or UI framework — implementation detail". — [taskplans/84_verity_ai_agent_system.md:9-23, 67-140, 161-170](file:///D:/Code/verity/taskplans/84_verity_ai_agent_system.md)
- Task 84's legitimate "superpowers" are speed and scale, diligence, procedural consistency, ad-hoc answers and bulk actions. It rules out "a verb the actor's role doesn't hold, cross-tenant reach, or a skipped `enforcePolicy()`". — [84…md:56-65](file:///D:/Code/verity/taskplans/84_verity_ai_agent_system.md)
- **Task 81** (ERPClaw-derived assistant rules, trigger fired 2026-09-04): rule 4 sets confirmation classes and gives a destructive checklist (rule 4a). Rule 7: every assistant action is visible on the dashboard. Rule 8 is the six-step contract (resolve from live reads, validate, preview, execute one command in one transaction, return a result, leave an audit trail). Rule 10: the assistant rail is a persistent shell region. Rule 16 is "Auditability before automation". The first compliance audit found 5 rules compliant, 2 gaps fixed and 3 left open (prose-claim grounding, structural exact-match, the preview step; the preview step was later built for the batch case). — [taskplans/81_erpclaw_ai_operating_rules.md:7-13, 60-126, 222-230](file:///D:/Code/verity/taskplans/81_erpclaw_ai_operating_rules.md)
- **Task 95** (PENDING, "aspirational north star, not a build plan"):
  - Six phases: Grounded Ask, Safe Actions, Business Reasoning, Proactive AI, Multimodal India (voice, Hindi/Hinglish, documents, WhatsApp), and Autonomous Operations.
  - "Plans before execution" is described as Task 84 area 2 plus Task 91 at conversation scale, "not a new execution model".
  - "Everything AI does is a Job": `Request → Plan → Approval → Job → Commands → Results → Audit`, inspectable and cancelable.
  - Memory is split into four kinds, warning against "stuffing all of them into one vector store".
  - Phase 6 "should not be treated as pre-authorized" and needs its own ADR.
  - Source: [taskplans/95_verity_ai_long_term_vision.md:8-17, 98-104, 150-166, 228-259](file:///D:/Code/verity/taskplans/95_verity_ai_long_term_vision.md)
- **Task 113** (CLOSED): phases 1 and 2 BUILT, phases 3 and 4 not built (they depend on Tasks 88/90), phases 5 and 6 untouched. `toolKeys` narrowing is generic and reusable by any capability. — [taskplans/113…md:166-198](file:///D:/Code/verity/taskplans/113_ai_implementation_audit_all_clients_and_global_agent.md); closure in [taskplans/handoffs/README.md:257-267](file:///D:/Code/verity/taskplans/handoffs/README.md)
- **Jev / Task 119**: Jev is TypeSafe AI's structured-decision model. It takes `state` plus typed `questions` and returns typed probabilistic answers, with no prose. It is hosted on Vercel AI Gateway and OpenRouter, at `POST https://api.typesafe.ai/v1/systemone`. Status: "BUILT 2026-09-30 (unit-proven; NOT live-verified)". `decision.ts` is the workflow node type `verity.decision.ask`, gated on `verity.capability.decision_egress`, and supports Laya as the preferred self-hosted backend. Still to do: apply the migration, obtain a real API key, make one real call, and calibrate. — [taskplans/119_jev_decision_model_future_capability.md:7-48, 66-68](file:///D:/Code/verity/taskplans/119_jev_decision_model_future_capability.md); [src/server/platform/decision.ts:1-30](file:///D:/Code/verity/src/server/platform/decision.ts)
- **Relay / Task 120**: Relay is a separate product (`D:\Code\relay`), described as a "horizontal comms platform across WhatsApp/email/SMS/Instagram/voice/API". Inbound messages become a Signal, then a Flow, then an Action, then an Outcome, with its own Tool Registry, Action Engine, Policy Engine and Action Ledger. It is pre-launch and has no backend. Verity's side (inbound `POST /api/tools/invoke`) is BUILT and dark. The outbound Verity-to-Relay adapter is NOT built because Relay has no contract. — [taskplans/120_relay_verity_integration.md:9-20, 45-48, 80-93](file:///D:/Code/verity/taskplans/120_relay_verity_integration.md)
- Task 120 notes "Relay's own 'Tool Registry' / 'Action Engine' concept is architecturally the same shape as Verity's already-built `tool-manifest.ts`." — [120…md:90-93](file:///D:/Code/verity/taskplans/120_relay_verity_integration.md)
- The 2026-09-30 scope note authorizes Tasks 118, 119 and 120 only. "No new business capability outside those three is authorized." New capability work needs the owner's authorization (CLAUDE.md, project scope section).

### Inferences
- In-repo, the WhatsApp and conversational-commerce agent role is assigned to Relay, a separate product that calls Verity's tool surface, not to a framework inside Verity. A WhatsApp agent built on Mastra or Dify would overlap with Relay's planned Action Engine. **(inferred)**
- Task 95 Phase 3/4 ("Business Reasoning", "Proactive AI": morning brief, anomaly detection) are the nearest planned items where multi-step or scheduled agent orchestration could help. They are gated on Tasks 88 and 90, which have not been built. **(inferred)**

### Gaps
- Tasks 88, 90 and 91 were not read in full. Their trigger status is cited only via Task 113.

## Q5. Active AI/agent items in handoffs

### Takeaway
There is no active AI or agent build item. The remaining AI-adjacent items are blocked on people: Task 119 needs an API key and a migration from the owner, and Task 120 needs Relay's contract.

### Cited Findings
- README: "Task 120 — Verity side BUILT 2026-09-30, dark by default… Relay adapter waits on Relay's contract." — [taskplans/handoffs/README.md:160-165](file:///D:/Code/verity/taskplans/handoffs/README.md)
- FINISHER, items needing a person: "API key and migration for Task 119 (P1-3). Product owner." "Relay's contract for the Task 120 adapter… External." — [taskplans/handoffs/FINISHER.md:555-560](file:///D:/Code/verity/taskplans/handoffs/FINISHER.md)
- Grepping FINISHER and README for agent, assistant, LLM and AI found no other open agent work. Task 113 is listed under "Closed loops". — [README.md:255-267](file:///D:/Code/verity/taskplans/handoffs/README.md)

### Inferences
- A framework adoption would be new, unplanned work. Under CLAUDE.md's scope rules it needs owner authorization, and likely an ADR, because it would add a new platform primitive. **(inferred)**

### Gaps
- None.

## Q6. Runtime substrate overlapping with framework features (durable workflows, HITL, idempotency, outbox, jobs)

### Takeaway
Verity has its own workflow DAG engine, with per-step transactions, step-run records and idempotency keys. It also has role-based approval chains, an event outbox, a cron scheduler and an idempotency store for external calls. What it lacks is suspend/resume: `WorkflowRunStatus` has only Running, Succeeded and Failed. The background-job runner is synchronous by design, and there is no queue. Durable suspend/resume for human-in-the-loop is therefore the one genuine capability gap, and Mastra and LangGraph both offer it.

### Cited Findings
- **Command pipeline**: "An Action is the exclusive mechanism for mutating an Entity; direct table writes that bypass this registry are prohibited." Five ordered steps run in one transaction, and events go to the outbox inside it. — [src/server/platform/command.ts:14-33](file:///D:/Code/verity/src/server/platform/command.ts)
- **Batch runner** (Task 91): sequences N commands, each in its own transaction, and reports outcomes per item (`succeeded`/`failed`/`needs_approval`). — [src/server/platform/batch.ts:6-95](file:///D:/Code/verity/src/server/platform/batch.ts)
- **Workflow engine**: "Workflows are data; node types are code registered here." `registerNodeHandler` is the extension point. Each node runs in its own transaction and progress is recorded in `workflow_step_run`. "`idempotencyKey` deduplicates: the same trigger fact must not start two runs." The engine returns only `"Succeeded" | "Failed"`. — [src/server/platform/workflow.ts:1-45, 108-210](file:///D:/Code/verity/src/server/platform/workflow.ts)
- The comment says "a workflow may span external calls and wait states". However, `enum WorkflowRunStatus { Running Succeeded Failed }` has no Waiting or Suspended state, and `WorkflowRun` has `@@unique([tenantId, idempotencyKey])`. — [prisma/schema.prisma:933-937, 1013-1031](file:///D:/Code/verity/prisma/schema.prisma); [workflow.ts:~113-115](file:///D:/Code/verity/src/server/platform/workflow.ts)
- **Approvals**: `ApprovalRequest` plus ordered `ApprovalStep` rows, each naming an approver **role** ("so a chain survives someone leaving"), with decisions Pending, Approved, Rejected or Skipped. These are tenant-scoped tables in the `verity.capability.approval` capability. — [prisma/schema.prisma:2005-2052](file:///D:/Code/verity/prisma/schema.prisma); [src/server/capabilities/approval/index.ts](file:///D:/Code/verity/src/server/capabilities/approval/index.ts)
- **Jobs**: `job.ts` is a provider-neutral `JobRunner`. "WHY THE ACTIVE RUNNER IS SYNCHRONOUS, NOT A QUEUE… Introducing Redis/BullMQ/a worker process now would be exactly the 'researched, so adopt it' mistake." — [src/server/platform/job.ts:1-37](file:///D:/Code/verity/src/server/platform/job.ts)
- **Scheduler**: `runDueWork` runs each unit in its own `withTenant` transaction, and one failure does not abort the rest. `registerPlatformSchedule` exists. The Vercel cron calls `/api/scheduled?tenant=all&cadence=daily` once a day (region `bom1`). — [src/server/platform/contribution.ts:228, 355-375](file:///D:/Code/verity/src/server/platform/contribution.ts); [vercel.json](file:///D:/Code/verity/vercel.json)
- **Outbox**: ADR-039 (above), with an in-app channel built.
- **Idempotency stores**: `WorkflowRun.idempotencyKey`, `ExternalIdempotency` (`@@unique([tenantId, keyId, idempotencyKey])`) used by `/api/tools/invoke` (claim/complete/release, mismatch detection), and the self-order submission. — [prisma/schema.prisma:1020-1031, 2575-2588, 6900-6911](file:///D:/Code/verity/prisma/schema.prisma); [src/app/api/tools/invoke/route.ts:95-137](file:///D:/Code/verity/src/app/api/tools/invoke/route.ts)
- **Transaction budget**: the manifest note records a "15s interactive transaction" timeout. — [tool-manifest.ts:30-36](file:///D:/Code/verity/src/server/platform/tool-manifest.ts)
- **Hosting**: `DATABASE_URL` uses the pooler in transaction mode. "Do not reintroduce session state that outlives a transaction." (CLAUDE.md, Database connection roles.)

### Inferences
- What Verity already covers: tools, authorization, audit, the confirm gate, idempotent triggers, per-step transactional workflow runs, role-based approval chains, an outbox and cron. A framework would duplicate these and, under ADR-019, must not become a second authority over them. **(inferred)**
- What Verity lacks: durable suspend/resume (a run waiting on human approval for hours or days), a queue or worker for long agent runs beyond a serverless request, streaming, conversation/thread memory, and evals/tracing. These are the parts where a framework adds value. **(inferred)**
- Any framework storage for suspended runs would have to sit in tenant-scoped, RLS-protected tables reachable through `verity_app` in pooler transaction mode, or be stateless with Verity owning the state. Frameworks that hold long sessions or use their own DB adapters conflict with the transaction-mode rule. **(inferred)**

### Gaps
- I did not read `executeWorkflow`'s failure path in full or the trigger wiring from events to workflows (`sync.ts`, `sla.ts`).

## Q7. On-prem / low-end server AI for DSEW, and the source of "no local LLM on-prem"

### Takeaway
"No local LLM on the DSEW host" comes from Task 129 decision D3 (2026-10-22), which ADR-054 clause 6 (PROPOSED) restates. Mode B ships with AI off and zero egress. If DSEW opts in, the existing agent calls a hosted OpenAI-compatible endpoint through one allow-listed route. A local model is considered only on a separate GPU machine, and only if asked. AI is deferred in DSEW's scope and has been removed from the recalculated quote.

### Cited Findings
- Task 129 D3: "Never run a language model on the DSEW host. Mode B ships with AI **off** and zero egress. If DSEW opts in, the existing agent channel calls a hosted OpenAI-compatible endpoint (`OPENAI_BASE_URL`) from one allow-listed egress route, per tenant, as the caller's own `ActorContext` (ADR-017). A local model is considered only on a separate GPU machine, and only if asked. Basis: server CPU/RAM unknown (survey unanswered), local model quality on commodity hardware is poor, and the no-egress test (B5) is the client's trust story." — [taskplans/129_architecture_honesty_demo_readiness_and_dsew_onprem.md:41-45](file:///D:/Code/verity/taskplans/129_architecture_honesty_demo_readiness_and_dsew_onprem.md); also line 113 ("No local language model on the DSEW host").
- ADR-054 clause 6 (PROPOSED) says the same. — [adr-054.md:33-35](file:///D:/Code/verity/verity-spec/17_decisions/adr/adr-054.md)
- On-prem network design: outbound traffic is denied by default. Explicitly off: the decision endpoint, "the agent chat provider (`OPENAI_API_KEY` and `OPENAI_BASE_URL` unset, or a local model endpoint later)", and `EXTERNAL_TOOLS_ENABLED`. — [clients/dsew/onprem-stage2-design.md:108-116](file:///D:/Code/verity/clients/dsew/onprem-stage2-design.md)
- DSEW D7: "Full Hindi localisation, payroll and local AI are **outside the initial release** unless DSEW names one as a go-live requirement." Status PROPOSED. — [clients/dsew/decisions.md:75-82](file:///D:/Code/verity/clients/dsew/decisions.md); gap matrix "AI, Hindi | Optional | Missing | D7" — [clients/dsew/gap-matrix.md:69](file:///D:/Code/verity/clients/dsew/gap-matrix.md)
- The readiness audit lists `agent-chat.ts` posting to `OPENAI_BASE_URL` as an optional outbound call; "a local model server is plausible but **UNKNOWN**". — [clients/dsew/deployment-readiness-audit.md:140-142](file:///D:/Code/verity/clients/dsew/deployment-readiness-audit.md)
- Commercial terms: the standard edition had "AI adapters inside every module" (VM 32 GB "with AI search"). The recalculated edition (owner brief 2026-10-23) has AI "None; deferred, quoted on request" and a VM of 4 vCPU / 16 GB. AI lines removed: ₹45,000 (MVP), ₹75,000 + 5,000 + 15,000 (Complete). — [clients/dsew/proposal/README.md:20-42](file:///D:/Code/verity/clients/dsew/proposal/README.md)
- The DSEW host is Windows Server 2019. — [adr-054.md:14](file:///D:/Code/verity/verity-spec/17_decisions/adr/adr-054.md)

### Inferences
- A framework that needs its own runtime service on the DSEW host (Dify's Docker stack, a Python CrewAI or LangGraph server) adds install, support and egress surface to a 4 vCPU / 16 GB Windows Server Mode B target that currently ships with AI off. That fits poorly with D3 and ADR-054. **(inferred)**

### Gaps
- The DSEW server survey (CPU/RAM) is unanswered, per Task 129 D3. The meeting materials (docx/pptx/mp4) mention AI, but they are binary and were not read.

## Q8. What DSEW and Stylified do in Verity

### Takeaway
DSEW is a project and manufacturing ERP for an engineer-to-order transformer and electromagnet maker, hosted now with Mode B on-premises pending. Stylified is a garment piece-rate shop-floor flow: rolls, lots, bundles, scan in and out, karigar wages. Neither has an AI requirement in scope.

### Cited Findings
- **DSEW (D & S Electric Works, Indore)** makes dry-type transformers, electromagnets, calibration systems and control systems. It is ISO 9001 with 10+ staff. The unit of management is the **Job** (a Project in the UI), running "Enquiry -> Technical quote -> Customer approval -> Order/Job opened -> Design and BOM -> Procurement -> Winding / VPI / assembly stages -> Test and QC (test report) -> Dispatch -> Invoice -> Payment -> Job margin (quoted vs actual)". Named exceptions: a revised or lost quote, a mid-job spec change, rejected material, a test failure leading to a rework child job, part dispatch, and retention or advance payments. — [clients/dsew/prd.md:1-37](file:///D:/Code/verity/clients/dsew/prd.md)
- DSEW gaps include Tally sync (blocked on a client decision), testing/calibration, contracts, and notifications ("Outbox (ADR-039) and approval exist, DSEW triggers not wired"), Hindi/English Android labels for the shop floor, and attendance. — [clients/dsew/gap-matrix.md:62-90](file:///D:/Code/verity/clients/dsew/gap-matrix.md); [clients/dsew/decisions.md:70-82](file:///D:/Code/verity/clients/dsew/decisions.md)
- **Stylified** (garment maker) follows seven bundle-level steps: receive rolls (QR labels); make a lot (design, quantity, rate card per stage); cut into numbered QR bundles; give out by scanning a bundle and picking a worker, which prints a challan ("the worker has no phone"); take back by scanning and counting good, rejected, rework and short pieces ("the receiver's count is the truth"), where a shortage opens a case and a charge request against the worker; move to the next stage; and pay wages as rate card × accepted pieces, with advances and balances. It ends at ready garments, with no dispatch. A supervisor operates on behalf of workers without phones. — [clients/stylified/flow.md:1-24](file:///D:/Code/verity/clients/stylified/flow.md)
- Stylified client docs (`clients/stylified/*.md`) contain no mention of AI, LLM, assistant or agent (grep returned nothing).

### Inferences
- Both clients' workflows are deterministic, scan- and command-driven operations. Possible agent use cases are general: the existing dock ("what's overdue", "lot cost summary"), and for DSEW, later notification and escalation triggers (ADR-039) or advisory decision nodes (ADR-027). Neither client has asked for one, and DSEW's quote removed AI. **(inferred)**
- Stylified's shop-floor workers have no phones. Any conversational agent would serve the owner or supervisor, not workers. **(inferred, from flow.md:13, 19)**

### Gaps
- I did not read Stylified's PRD (docx), its requirements xlsx, or the DSEW meeting deck for any AI asks.
