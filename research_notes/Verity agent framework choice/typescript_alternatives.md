# TypeScript-native alternatives to Mastra for a permission-gated business agent in Verity (Next.js 16, Postgres + RLS)

Research date: 2026-10-24. Version, licence and publish-date facts for npm packages come from the public npm registry (`registry.npmjs.org/<pkg>/latest` and `/<pkg>`), queried on 2026-10-24. "Unpacked" is the npm `dist.unpackedSize` of the package alone, without transitive dependencies, so it is a rough weight signal and not install size.

## 1. Per option: licence, maturity, maintainer, what it owns, storage, dependency weight

### Takeaway
All realistic options use permissive licences (MIT or Apache-2.0) **except the Claude Agent SDK**, which falls under Anthropic's Commercial Terms. They split into three layers: (a) **model + loop libraries** (Vercel AI SDK, Anthropic SDK tool runner, OpenAI Agents JS), (b) **graph/state runtimes with their own persistence** (LangGraph.js), and (c) **durable-execution engines** (Vercel Workflow SDK, Inngest, Temporal), which own neither the model nor the agent and only make long-running code survive restarts. MCP is a tool *protocol*, not an agent framework. Only LangGraph.js and the durable engines bring their own storage. The provider SDKs and the AI SDK keep state in a plain message array that the application persists itself.

### Cited Findings

**Registry snapshot (2026-10-24)** — all from npm registry: [ai](https://registry.npmjs.org/ai), [@langchain/langgraph](https://registry.npmjs.org/@langchain/langgraph), [@openai/agents](https://registry.npmjs.org/@openai/agents), [@anthropic-ai/claude-agent-sdk](https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk), [@modelcontextprotocol/sdk](https://registry.npmjs.org/@modelcontextprotocol/sdk), [@inngest/agent-kit](https://registry.npmjs.org/@inngest/agent-kit), [workflow](https://registry.npmjs.org/workflow)

| Package | Latest | Licence | Direct deps | Peer deps | Unpacked | Latest publish |
|---|---|---|---|---|---|---|
| `ai` (Vercel AI SDK) | 7.0.152 (v6 line still tagged `ai-v6` 6.0.315) | Apache-2.0 | 3 | zod | 8.4 MB | 2026-10-23 |
| `@ai-sdk/openai-compatible` | 3.0.77 | Apache-2.0 | 2 | zod | 0.4 MB | — |
| `@langchain/langgraph` | 1.5.2 | MIT | 4 | zod, @langchain/core | 4.6 MB | 2026-10-21 |
| `@langchain/langgraph-checkpoint-postgres` | 1.1.2 | MIT | 2 | @langchain/core, @langchain/langgraph-checkpoint | 0.4 MB | — |
| `@openai/agents` | 0.21.0 (still 0.x) | MIT | 4 | zod | 24 KB (meta-package) | 2026-10-20 |
| `@anthropic-ai/sdk` | 1.3.0 | Apache-2.0 | 3 | zod | 15.7 MB | — |
| `@anthropic-ai/claude-agent-sdk` | 0.3.310 (0.x) | "SEE LICENSE IN README.md" | 0 | zod, @anthropic-ai/sdk, @modelcontextprotocol/sdk | 4.9 MB | 2026-10-23 |
| `@modelcontextprotocol/sdk` | 1.32.2 | MIT | 17 | zod, @cfworker/json-schema | 4.5 MB | 2026-10-23 |
| `@inngest/agent-kit` | 0.13.2 (0.x) | Apache-2.0 | 6 | zod, inngest | 0.8 MB | **2025-11-13** (no stable release for about 11 months) |
| `inngest` | 4.26.0 | Apache-2.0 | 23 | many framework peers incl. next | 6.9 MB | — |
| `@temporalio/workflow` | 1.24.0 | MIT | 3 | — | 0.8 MB | — |
| `workflow` (Vercel Workflow SDK) | 5.2.3 | Apache-2.0 | 13 | @opentelemetry/api | 1.7 MB | 2026-10-20 |
| `@workflow/ai` | 5.0.3 | Apache-2.0 | 4 | ai, workflow, @opentelemetry/api | 0.7 MB | — |
| *(reference)* `@mastra/core` | 1.79.0 | Apache-2.0 | 30 | zod | **82.8 MB** | — |

**Vercel AI SDK (maintainer: Vercel)**
- AI SDK 7 shipped June 25, 2026, with tool approvals, durable `WorkflowAgent` execution (package `@ai-sdk/workflow`), timeouts and sandbox support. — [Vercel blog: AI SDK 7](https://vercel.com/blog/ai-sdk-7); [Vercel changelog](https://vercel.com/changelog/ai-sdk-7)
- Agent class `ToolLoopAgent` accepts `model`, `tools`, `toolApproval`, `toolsContext`, `runtimeContext`, `prepareStep`. Tools can receive a scoped, typed context through `contextSchema`. — [Vercel blog: AI SDK 7](https://vercel.com/blog/ai-sdk-7)
- Loop control: `stopWhen` with `isStepCount(n)` (default `isStepCount(1)`), `hasToolCall(...)`, `isLoopFinished()`. (In v5/v6 the helper was `stepCountIs`, which has since been renamed.) — [AI SDK docs: Tools and tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- Owns: model abstraction across providers, the agent loop, streaming UI (`@ai-sdk/react`), and approvals. Durability comes only through `WorkflowAgent` / Workflow SDK. It needs no storage of its own: state is the `messages` array.
- AI SDK 7 is reported to require Node.js 22+ and ESM only (no CommonJS `require()`). — [noqta.tn guide](https://noqta.tn/en/blog/vercel-ai-sdk-7-durable-agents-voice-developer-guide-2026) (secondary; the official blog does not mention it)
- AI SDK 7 adds MCP Apps support (`experimental_MCPAppRenderer` from `@ai-sdk/react`). — [Vercel blog: AI SDK 7](https://vercel.com/blog/ai-sdk-7)

**LangGraph.js (maintainer: LangChain Inc.)**
- The library is MIT (npm). Version 1.5.2 is current, and the 1.x line has been stable since the `1.0.x` tags. — [npm](https://registry.npmjs.org/@langchain/langgraph)
- Owns: graph-structured agent/workflow runtime, state channels, checkpointing (persistence), interrupts (HITL), and a cross-thread long-term memory `Store`. It needs a checkpointer for anything beyond a single process. — [LangGraph JS persistence docs](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- It requires `@langchain/core` as a peer, so it brings the LangChain message and model abstractions with it. — [npm](https://registry.npmjs.org/@langchain/langgraph)

**OpenAI Agents SDK JS (maintainer: OpenAI)**
- MIT, still at 0.x (0.21.0). First published 2025-06-03. — [npm](https://registry.npmjs.org/@openai/agents)
- Owns: agent loop, handoffs, guardrails, tracing, sessions, HITL approvals with serializable `RunState`. The docs index lists `RunState`, `RunToolApprovalItem`, "Sessions", and an "AI SDK Integration" extension. — [OpenAI Agents JS docs](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)

**Anthropic TypeScript SDK tool runner (maintainer: Anthropic)**
- `client.beta.messages.toolRunner({...})` with tools defined via `betaZodTool()` (from `@anthropic-ai/sdk/helpers/beta/zod`, Zod ≥ 3.25) or `betaTool()` (JSON Schema, from `@anthropic-ai/sdk/helpers/beta/json-schema`). `max_iterations` caps the loop. The runner is iterable (you can `break`), and `setMessagesParams()` / `pushMessages()` let you take over state. **The tool runner is in beta.** — [Claude docs: Tool runner](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-runner)
- Anthropic's own docs: "When you need human-in-the-loop approval, custom logging, or conditional execution, use the manual loop instead." — [Claude docs: Tool runner](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-runner)
- The SDK itself is Apache-2.0 (npm). It owns no storage and no durability.

**Claude Agent SDK (maintainer: Anthropic)**
- "A library that runs the Claude Code binary, with Claude Code's capabilities, such as built-in tools, permissions, sessions, and hooks". Built-in tools read/write/edit files, run commands and search the web. Skills and memory load from `.claude/` and `~/.claude/`. — [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- Licence: "Use of the Claude Agent SDK is governed by Anthropic's Commercial Terms of Service", including when it powers products for your own customers. Not OSI open source. — [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- Third parties may not offer claude.ai login or rate limits. API-key authentication is required. — [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- Anthropic's comparison table separates this from the Client SDK, where "You write the tool loop yourself, or let the client SDK's beta tool runner drive it", and from Managed Agents (an Anthropic-hosted harness). — [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)

**MCP TypeScript SDK (maintainer: Model Context Protocol project; originated at Anthropic)**
- MIT, v1.32.2, 17 direct deps. — [npm](https://registry.npmjs.org/@modelcontextprotocol/sdk)
- Role: a protocol for exposing tools and resources to any MCP client. It is not an agent loop and has no approval semantics of its own. AI SDK 7 consumes MCP servers and MCP Apps. — [Vercel blog: AI SDK 7](https://vercel.com/blog/ai-sdk-7)

**Vercel Workflow SDK / Workflow DevKit (maintainer: Vercel)**
- Package `workflow` 5.2.3, Apache-2.0. Docs moved from useworkflow.dev to workflow-sdk.dev (308 redirect observed 2026-10-24). — [npm](https://registry.npmjs.org/workflow); [workflow-sdk.dev](https://workflow-sdk.dev/docs/deploying)
- `"use workflow"` marks a durable function that resumes after pause, restart or redeploy. `"use step"` marks side-effecting steps that run on separate requests and auto-retry. Workflow code must be deterministic (event-sourced replay), and data passes between steps by value. — [Vercel docs: Workflow](https://blog.vercel.com/docs/workflow); [Vercel examples](https://examples.vercel.com/workflow)
- "Worlds" are pluggable storage/queue/communication adapters. **Local World** (default in development, `.workflow-data/`), **Vercel World** (managed queues and persistence), and **Postgres World** `@workflow/world-postgres`, a third-party World selected with `WORKFLOW_TARGET_WORLD` plus `DATABASE_URL`. Community Worlds are listed at `/worlds`. — [workflow-sdk.dev: Deploying](https://workflow-sdk.dev/docs/deploying)
- Reported as open-sourced 2025-10-23. As of December 2025 Vercel's docs marked it Beta. — [jimmysong.io landscape](https://landscape.jimmysong.io/projects/vercel-workflow/) (secondary); [Vercel docs](https://blog.vercel.com/docs/workflow)

**Inngest AgentKit (maintainer: Inngest)**
- Apache-2.0, 0.13.2, last published 2025-11-13. — [npm](https://registry.npmjs.org/@inngest/agent-kit)
- Durability and HITL come from wrapping the agent network in an Inngest function and using `step.waitForEvent`. Inngest's own SDK (`inngest` 4.26.0, v4 TypeScript SDK) is the active product. — [AgentKit HITL](https://agentkit.inngest.com/advanced-patterns/human-in-the-loop); [Inngest waitForEvent v4](https://www.inngest.com/docs/reference/typescript/v4/functions/step-wait-for-event.md)

**Temporal TypeScript SDK (maintainer: Temporal Technologies)**
- `@temporalio/workflow` 1.24.0, MIT. — [npm](https://registry.npmjs.org/@temporalio/workflow)

### Inferences
- For a lean Verity install, the weight ranking (lightest first) is roughly: Anthropic SDK or AI SDK core + one provider < OpenAI Agents JS < LangGraph.js + `@langchain/core` < Mastra (82.8 MB unpacked for core alone, an order of magnitude larger than `ai`).
- AgentKit's 11-month gap without a stable npm release suggests Inngest's investment has moved to its core SDK. That makes AgentKit a weak foundation to adopt in late 2026, even though the Inngest engine itself is active.
- The Claude Agent SDK is the wrong shape for a multi-tenant ERP agent. It embeds a coding-agent harness (filesystem, shell, `.claude/` config loading) and carries a commercial licence and an Anthropic-only model path. Verity needs a narrow set of business tools behind `enforcePolicy()`, not a general computer-use agent.

### Gaps
- An official statement of AI SDK 7's Node 22 / ESM-only requirement was not found. It comes from a secondary source only.
- Vercel Workflow SDK's current stability label (Beta vs GA) as of October 2026 was not confirmed. The deploying page shows `lastUpdated` 2026-10-21 but no status.
- Temporal's server requirement (Temporal Cloud or a self-hosted cluster backed by Postgres/Cassandra/MySQL) and its signal/update HITL APIs were not re-verified this session. This is general knowledge and should be checked before it is cited.
- The Inngest server's self-hosting licence (the SDK is Apache-2.0) was not verified.

## 2. Human-in-the-loop: pause on a tool call, resume later (new HTTP request / serverless invocation), state persistence

### Takeaway
Every option can support approve-then-resume across requests, but they differ in **where the pending state lives**. In the AI SDK, OpenAI Agents JS and the thin loop, the pending call is data the app persists (messages or a serialized `RunState`). In LangGraph it lives in the checkpointer's Postgres tables. In Workflow, Inngest and Temporal it lives in the engine's event log. For Verity the decisive security point is that **approval state must be held and validated server-side**. AI SDK approvals ride in the client-held message array, which is why AI SDK 7 added HMAC signing and patched a signature flaw.

### Cited Findings
- **AI SDK 7:** `needsApproval` on `tool()` is deprecated in favour of `toolApproval`, accepted by `generateText`, `streamText` and `ToolLoopAgent`. Its value is a per-tool map or a `GenericToolApprovalFunction`, and the statuses are `'not-applicable' | 'approved' | 'denied' | 'user-approval'`. Only `'user-approval'` waits for a person. — [AI SDK docs](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- **AI SDK 7:** The call does not block. It *returns* `tool-approval-request` parts (`approvalId`, `toolCall`, `reason`, `isAutomatic`). The app answers by appending a `tool-approval-response` (`approvalId`, `approved`, optional `reason`) in a `role: 'tool'` message and calling again. A denial becomes an `execution-denied` tool result. `toolApproval` applies only to locally executed tools, and provider-executed tools ignore it. — [AI SDK docs](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- **AI SDK 6** (the earlier API, still on the `ai-v6` tag): `needsApproval: true` or an async function of the input. The UI sees the `approval-requested` state and calls `addToolApprovalResponse`. — [AI SDK 6 beta announcement](https://v6.ai-sdk.dev/docs/announcing-ai-sdk-6-beta); [LayerX write-up](https://zenn.dev/layerx/articles/5538adfc79b14e)
- **AI SDK 7 security:** Opt-in HMAC-signed approvals guard against forged approvals, and tool inputs and policies are revalidated before execution continues. — [Vercel blog: AI SDK 7](https://vercel.com/blog/ai-sdk-7). Patch ai@7.0.36 changed the HMAC payload serialization of `experimental_toolApprovalSecret`, because the old newline-joined format could let a signed approval verify against a *different* tool call. — [newreleases.io: ai@7.0.36](https://newreleases.io/project/github/vercel/ai/release/ai@7.0.36) (release-notes mirror)
- **AI SDK durable path:** `WorkflowAgent` (`@ai-sdk/workflow`) supports durable, resumable execution, including "delayed approvals". — [Vercel blog: AI SDK 7](https://vercel.com/blog/ai-sdk-7)
- **OpenAI Agents JS:** set `needsApproval` (boolean or async function) on a tool. The run pauses and returns pending approvals in `result.interruptions`, including those from nested `agent.asTool()` runs. Resolve with `result.state.approve(item)` / `reject(item)`, which accept options `{ alwaysApprove: true }`, `{ alwaysReject: true }` and `{ message }`. Persist with `result.state.toString()` and restore with `RunState.fromString(agent, serialized)`. Then `run(agent, state)`. The design is "interruptible for longer periods of time without keeping your server running". Store the state "in application-controlled storage, such as a server-side database". **`RunState.fromString()` does not authenticate the snapshot**, so deserialize only trusted snapshots. For long waits across agent-definition changes, the docs suggest storing your own version number and even running two SDK versions side by side via package aliases. — [OpenAI Agents JS: Human-in-the-loop](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)
- **LangGraph.js:** `interrupt(value)` (from `@langchain/langgraph`) pauses and surfaces `value` under `__interrupt__`. Resume with `graph.invoke(new Command({ resume: ... }), { configurable: { thread_id } })`, and the resume value becomes `interrupt()`'s return value. A checkpointer is required. Rules: **the whole node re-runs from the start on resume**, side effects before `interrupt()` must be idempotent, interrupt order must be stable (matching is index-based), payloads must be JSON-serializable, and `interrupt()` must not be wrapped in a bare try/catch (it works by throwing). — [LangGraph JS: Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- **Anthropic SDK:** the tool runner auto-executes tools, and Anthropic directs HITL users to the manual loop. — [Claude docs: Tool runner](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-runner)
- **Claude Agent SDK:** "Permissions: Control which tools run automatically, which need approval". Sessions can be resumed or forked later. — [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- **Inngest:** an AgentKit tool handler calls `step.waitForEvent(id, { event, timeout, match })`, which returns the event or `null` on timeout. The docs example waits up to 4 hours for `developer.response`, pausing the network. The network must be wrapped in an Inngest function. — [AgentKit: Human in the Loop](https://agentkit.inngest.com/advanced-patterns/human-in-the-loop); [Inngest waitForEvent](https://www.inngest.com/docs/reference/functions/step-wait-for-event)
- **Vercel Workflow:** state changes are stored as events and replayed. Workflows resume "exactly where it left off, even after pausing, restarting, or deploying new code". — [Vercel docs: Workflow](https://blog.vercel.com/docs/workflow)

### Inferences
- **Thin own loop (no framework):** a pending approval is just a row, for example `AgentPendingAction { tenantId, actorId, conversationId, toolName, input, inputHash, expiresAt }` under the same RLS as everything else. The approve endpoint re-runs `enforcePolicy()` as the *approving* human (ADR-017), executes the command through the normal write path, appends the `tool_result`, and continues the loop in that request. This matches 12-factor's "Launch/Pause/Resume with simple APIs" and "Unify execution state and business state". It is also the only option where the pending state is automatically under INV-001 without extra work.
- AI SDK message-array approvals are fine for UI rendering. But if Verity trusts a client-posted `tool-approval-response`, a modified client could approve its own call. Either enable HMAC signing on ≥ 7.0.36, or (simpler and stronger) treat the client response as an *intent* and resolve it against a server-side pending-action row. Either way the tool's `execute` must call `enforcePolicy()`, so authorization never depends on the approval flag.
- The same caution applies to OpenAI's `RunState.fromString`: keep it server-side, never round-trip it through the browser.
- LangGraph's node-replay rule fits Verity's command model if the approval-gated tool *is* a node whose effect happens after `interrupt()`. Any pre-interrupt reads simply repeat.

### Gaps
- The AI SDK docs do not explicitly describe resuming an approval in a *separate* HTTP request. It follows from the state living in `messages`, but this is not stated.
- The Vercel Workflow SDK's HITL primitives (hooks/webhooks, e.g. `createHook` / `createWebhook`, `sleep`) were not confirmed on the pages fetched.
- The Claude Agent SDK's exact TS permission API names (`canUseTool`, `permissionMode`, `PreToolUse` hooks) were not quoted from a fetched page this session.

## 3. LangGraph.js specifically: checkpointers, Platform/LangSmith licensing vs OSS library, MIT status, JS vs Python parity

### Takeaway
The **library** (`@langchain/langgraph` 1.5.2) and its **Postgres checkpointer** (`@langchain/langgraph-checkpoint-postgres` 1.1.2) are MIT and fully self-hostable inside a Next.js app with no LangChain service. The paid parts are **LangSmith** (observability) and **LangSmith Deployment** (formerly LangGraph Platform / Agent Server hosting), which are optional. Self-hosted or hybrid deployment of that platform is Enterprise-only, with per-run metering. The Postgres checkpointer writes its own tables via its own `pg` connections, outside Verity's `withTenant()` and RLS.

### Cited Findings
- `@langchain/langgraph` MIT, 1.5.2 (2026-10-21). `@langchain/langgraph-checkpoint-postgres` MIT, 1.1.2. — [npm langgraph](https://registry.npmjs.org/@langchain/langgraph); [npm checkpoint-postgres](https://registry.npmjs.org/@langchain/langgraph-checkpoint-postgres)
- Postgres checkpointer API: `import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres"`, then `PostgresSaver.fromConnString("postgresql://...", { schema: "schema_name" })` (schema defaults to `public`) or `new PostgresSaver(pool, undefined, { schema })` with an existing `pg.Pool`. "You must call `.setup()` the first time you use the checkpointer". It uses node-postgres (`pg`), so raw-TCP-less edge runtimes (e.g. Cloudflare Workers) hang. — [checkpoint-postgres README (npm)](https://registry.npmjs.org/@langchain/langgraph-checkpoint-postgres)
- Checkpointers listed in the JS docs: `MemorySaver` / `InMemorySaver` (RAM), `PostgresSaver` (PostgreSQL), `SqliteSaver` (local development). Threads use `{ configurable: { thread_id } }`, and `thread_id` values should stay under 255 chars. `InMemoryStore` provides long-term cross-thread memory. — [LangGraph JS persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- Production experience: one postmortem reports a checkpoint table reaching 40 GB in six weeks with no retention policy, and says schema changes to state need explicit migration that LangGraph won't handle. The same source warns that `interrupt_before` / `interrupt_after` have undefined behaviour mid-fan-out in parallel subgraphs (Python-oriented article). — [Towards AI postmortem](https://pub.towardsai.net/langgraph-checkpointing-is-not-free-a-production-postmortem-398bc86861f4) (secondary, member-only story; claims unverified)
- LangSmith pricing: Plus is $39/seat/month and includes Deployment access. **Self-hosted and hybrid are Enterprise (custom pricing).** — [LangSmith pricing](https://www.langchain.com/langsmith-pricing)
- The Enterprise pricing page (updated 2026-10-01) lists "Deployment (Self-Managed)" at 0.01 LSU per agent run, drawn from prepaid LangChain Credits. — [LangSmith Enterprise pricing](https://www.langchain.com/enterprise-pricing). Dollar values per LSU are reported inconsistently by third parties ($1.00 per LSU per TrueFoundry, July 2026). — [TrueFoundry](https://www.truefoundry.com/blog/langchain-pricing); [flexprice](https://flexprice.io/pricing-index/langsmith) (unverified)

### Inferences
- Under Verity's DB-role rules, the checkpointer would hold full conversation and tool state (including tenant business data) in tables that RLS does not cover unless Verity adds a `tenant_id` column and policies itself. LangGraph's schema has no tenant column, only `thread_id` / `checkpoint_ns`. The likely mitigations: encode tenant into `thread_id` and enforce it in a wrapper, put the tables in a separate schema, or write a custom `BaseCheckpointSaver` that runs inside `withTenant()`. Each is extra platform work that a thin loop avoids.
- `PostgresSaver` opening its own `pg.Pool` is a second connection consumer against the 15-connection Supabase pool. Whether it behaves correctly behind pgbouncer transaction mode (port 6543) was not verified.
- Licensing risk is low for the library path: nothing forces LangSmith or LangSmith Deployment. The commercial pull is toward hosted observability and deployment, not a licence trap.

### Gaps
- JS-vs-Python parity: no current (2026) authoritative parity statement was found. The JS docs mirror Python's concepts (checkpointers, interrupts, `Command`, stores), but specific features that exist only in Python (e.g. some checkpointer backends, functional API details) were not verified.
- No official statement on how `PostgresSaver` behaves under pgbouncer transaction pooling.
- No official page fetched for the exact current product name and licence of "LangGraph Server / Agent Server" (self-hosted Lite vs Enterprise). Only pricing pages were seen.

## 4. Practitioner views: framework lock-in vs a thin loop over a provider SDK

### Takeaway
Two influential practitioner sources (Anthropic's "Building effective agents" and HumanLayer's "12-factor agents") both advise starting with direct LLM API calls and owning prompts, context and control flow, adding framework abstraction only when it earns its place. Anthropic's own docs repeat this at the API level, telling teams that need HITL to write the manual loop rather than use the tool runner. The argument is strongest exactly where Verity sits: an existing product with its own command, authorization and audit runtime.

### Cited Findings
- Anthropic (published Dec 19, 2024): "We suggest that developers start by using LLM APIs directly: many patterns can be implemented in a few lines of code." Frameworks "often create extra layers of abstraction that can obscure the underlying prompts" and make debugging harder. "we recommend finding the simplest solution possible, and only increasing complexity when needed". The current version of the page names the Claude Agent SDK, Strands Agents SDK (AWS), Rivet and Vellum as example frameworks. — [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- HumanLayer, 12-factor agents: the factors are (1) Natural Language to Tool Calls, (2) Own your prompts, (3) Own your context window, (4) Tools are just structured outputs, (5) Unify execution state and business state, (6) Launch/Pause/Resume with simple APIs, (7) Contact humans with tool calls, (8) Own your control flow, (9) Compact Errors into Context Window, (10) Small, Focused Agents, (11) Trigger from anywhere, meet users where they are, (12) Make your agent a stateless reducer. The author says that builders using frameworks often reach about 70-80% quality and then have to reverse-engineer the framework, that "most of them are rolling the stack themselves", and that "Going all in on a framework and building what is essentially a greenfield rewrite may be counter-productive". He favours adding small, modular agent concepts to an existing product. Code is Apache-2.0, content is CC BY-SA 4.0. — [humanlayer/12-factor-agents](https://github.com/humanlayer/12-factor-agents)
- Anthropic tool runner docs: for "human-in-the-loop approval, custom logging, or conditional execution, use the manual loop instead". — [Claude docs: Tool runner](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-runner)
- Upgrade churn is a real cost even in "thin" libraries. AI SDK went from v5 to v6 to v7 within about a year: `needsApproval` became `toolApproval`, `stepCountIs` became `isStepCount`, and v7 reportedly went ESM-only on Node 22+. — [AI SDK docs](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling); [Vercel blog: AI SDK 7](https://vercel.com/blog/ai-sdk-7). OpenAI's own HITL guide recommends running two SDK versions side by side for long-paused runs. — [OpenAI Agents JS HITL](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)

### Inferences
- For Verity, factors 5, 6, 7 and 8 line up directly with constraints Verity already has: execution state must sit under RLS (INV-001), pause/resume must be a plain row plus endpoint, the human's approval goes through the same command path, and the loop must call `enforcePolicy()` as the actor (ADR-017). A framework that owns state or control flow has to be bent around those rules. A thin loop starts from them.
- A pragmatic middle path is to use the **AI SDK only as the model abstraction and streaming-UI layer** (`streamText` / `generateText` with tools whose `execute` routes through Verity's command runtime) and to keep pending-approval state in Verity's own tables, not in client messages or a framework checkpointer. That keeps provider swapping and React streaming while owning everything security-relevant.
- Durable engines (Workflow SDK, Inngest, Temporal) only become necessary if agent runs must outlive one serverless invocation *between* human interactions, for example multi-hour autonomous jobs. A request-scoped loop plus a pending-action row covers approve-then-continue without one.

### Gaps
- The original Dec 2024 text of "Building effective agents" named LangGraph and Amazon Bedrock's agent framework among its examples (from memory, not re-verified). The fetched current page lists different frameworks, so the article has been edited since publication. The edit date is unknown.
- No rigorous 2025-2026 quantitative study comparing framework vs thin-loop production outcomes was found. The evidence is practitioner opinion.

## 5. Swapping model providers, including local OpenAI-compatible endpoints (Ollama, vLLM, llama.cpp server)

### Takeaway
The **Vercel AI SDK** has the broadest and most direct provider swapping, including `@ai-sdk/openai-compatible` for any OpenAI-compatible server (Ollama, vLLM, llama.cpp server all expose one). **LangGraph.js** is provider-agnostic through LangChain chat-model integrations. **OpenAI Agents JS** supports other providers through a `ModelProvider` interface, a custom OpenAI client and an AI SDK integration extension. The **Anthropic SDK tool runner and the Claude Agent SDK are Claude-only**. A thin loop over the AI SDK keeps swapping cheap, while a thin loop over one provider SDK hard-wires that provider.

### Cited Findings
- `@ai-sdk/openai-compatible` 3.0.77, Apache-2.0, 2 deps: the AI SDK provider for OpenAI-compatible endpoints. — [npm](https://registry.npmjs.org/@ai-sdk/openai-compatible)
- AI SDK works "across any model provider". — [Vercel blog: AI SDK 7](https://vercel.com/blog/ai-sdk-7)
- OpenAI Agents JS exposes `setDefaultOpenAIClient`, `setOpenAIAPI`, `setDefaultModelProvider`, `OpenAIChatCompletionsModel`, `OpenAIProvider`, a `ModelProvider` interface, and an "AI SDK Integration" extension (`/extensions/ai-sdk`). — [OpenAI Agents JS docs index](https://openai.github.io/openai-agents-js/guides/models/)
- The Claude Agent SDK runs "the Claude Code binary". The Client SDK is "direct access to the Claude API". — [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- The AI SDK's `toolApproval` applies only to locally executed tools, and provider-executed tools ignore it. Gating behaviour therefore depends on keeping business tools local, whichever provider is used. — [AI SDK docs](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)

### Inferences
- Local OpenAI-compatible servers vary in how faithfully they implement tool/function calling and streaming tool deltas. A provider swap is cheap in code but needs per-model tool-calling evaluation. (General knowledge, not sourced this session.)
- Task 129 rules out a local LLM on-premises for DSEW (per project memory), so local endpoints matter mainly for development and cost testing, not for a deployment target.
- With OpenAI Agents JS, the usual route to an OpenAI-compatible local server is `setDefaultOpenAIClient(new OpenAI({ baseURL }))` plus `setOpenAIAPI('chat_completions')`, because local servers rarely implement the Responses API. This is inferred from the exported names and not quoted from the fetched page.

### Gaps
- The bodies of the OpenAI Agents JS Models guide and the AI SDK integration page did not load (truncated), so the exact recipes for Ollama/vLLM and any caveats are unverified.
- The LangGraph.js provider packages for local models (`@langchain/openai` `ChatOpenAI` with a `baseURL` / `configuration.baseURL`, `@langchain/ollama`) were not verified this session.
- Whether the Claude Agent SDK can target Bedrock, Vertex or Azure Foundry (still Claude models) via environment flags was not confirmed on a fetched page. In any case it cannot use non-Claude models.
