# Mastra (TypeScript agent framework) — maturity, licence, architecture and fit for Verity (researched 2026-10-24)

Scope: github.com/mastra-ai/mastra and mastra.ai as of late October 2026, judged for embedding in a multi-tenant Next.js 16 + Supabase Postgres (RLS, per-transaction tenant GUC via `set_config`) ERP whose agent must act under the calling human's own permissions (Verity ADR-017).

Method note: primary sources are the GitHub repo, the LICENSE.md and ee/LICENSE files, the mastra.ai docs and the npm registry JSON (pulled with curl on 2026-10-24). Third-party write-ups are marked as such. Several fetches failed (Snyk blog, the HN thread mirror, OSV page, npmjs.com HTML returned 403), so some points rest on search snippets and are flagged.

## 1. Maturity: version, cadence, popularity, backing, 1.0 status, breaking changes

### Takeaway
Mastra is a fast-moving, well-funded (about $35M, YC W25, Spark Capital-led Series A), widely downloaded (about 1.44M weekly downloads for `@mastra/core`) framework that went 1.0 in January 2026 and has shipped a minor release roughly every three days since, reaching `@mastra/core` 1.79.0 on 2026-10-21. "1.x" has not meant a slow API: a minor bump arrives every few days, and some of them have breaking side effects.

### Cited Findings
- `@mastra/core` latest on npm is **1.79.0**, licence field `Apache-2.0` (npm registry JSON, fetched 2026-10-24) — [npm registry](https://registry.npmjs.org/@mastra/core/latest)
- `@mastra/core` had **1,442,185 downloads in the week 2026-10-16 to 2026-10-22** — [npm downloads API](https://api.npmjs.org/downloads/point/last-week/@mastra/core)
- GitHub: **29,044 stars, 3,039 forks**, repo created 2024-08-06; GitHub's licence detector reports `NOASSERTION` (because of the dual licence); contributor pagination (anonymous contributors included) runs to about **700** — GitHub API via `gh api repos/mastra-ai/mastra` (fetched 2026-10-24); [repo](https://github.com/mastra-ai/mastra)
- The repo page shows about 22,029 commits on main, 335 open issues, 268 open PRs, PRs limited to collaborators, and a Y Combinator W25 badge — [GitHub repo](https://github.com/mastra-ai/mastra)
- Release cadence: the 20 most recent `@mastra/core` minors (1.60.0, 2026-08-19, to 1.79.0, 2026-10-21) span about nine weeks, **roughly one minor release every 3 days**. Recent headlines: 1.79.0 "Experimental MCP Events" (Oct 21), 1.78.0 "Agent Scopes" (Oct 15), 1.76.0 "Durable agent run ownership and fencing" (Oct 11), 1.75.0 "Span Query API", 1.71.0 "Eager tool execution", 1.68.0 "MCP v2 architecture (`@mastra/mcp@2.0.0`)" (Sep 22), 1.62.0 "Elasticsearch and Valkey storage backends", 1.60.0 "Durable execution for Agents API" — [releases.sh tracker of GitHub releases](https://releases.sh/mastra/mastra-github-releases)
- A separate tracker snippet cited `@mastra/core` 1.51.0 with "durable agents can discover and recover orphaned RUNNING runs after a restart" (earlier in 2026) — [releases.sh](https://releases.sh/mastra/mastra-github-releases)
- **1.0**: Mastra's own migration guide says v1 shipped in January 2026; you have to move to the latest 0.x before migrating, and new projects should start on v1 — [mastra.ai upgrade-to-v1](https://mastra.ai/reference/migrations/upgrade-to-v1/overview.md). Third-party coverage dates the stable release to **2026-01-21** and says it added no new features, only stable APIs — [Byteiota](https://byteiota.com/mastra-1-0-typescript-ai-framework-reaches-production/). Another profile's metadata lists Jan 29, so the exact day is uncertain — [stork.ai](https://www.stork.ai/de/mastra-1-0)
- The v1 beta was announced 2025-11-14: "all previous experimental APIs are now stable" — [Mastra changelog 2025-11-14](https://mastra.ai/blog/changelog-2025-11-14)
- Breaking or behavioural changes inside 1.x, inferred from release descriptions: 1.68.0 moved `@mastra/mcp` to a major 2.0.0 rebuilt on the MCP 2026-07-28 revision, which drops the initialize handshake; 1.69.0 `ClassifierProcessor` now fails closed by default (opt back in with `errorStrategy: 'warn'`); 1.63.0 and 1.74.0 removed Playground UI APIs — [releases.sh](https://releases.sh/mastra/mastra-github-releases)
- Funding: **$22M Series A led by Spark Capital, about $35M total** ($13M seed plus $22M A; YC, Gradient, 120+ angels). Sources date the round to April 2026; PitchBook lists 15 May 2026 and $36.2M "latest deal amount", which conflicts — [Techleap](https://finder.techleap.nl/news/feed/mastra-raises-22m-series-a-to-help-developers-build-ai-agents); [rywalker.com](https://rywalker.com/research/mastra); [PitchBook](https://pitchbook.com/profiles/company/720731-62)
- The Series A came with a hosted platform launch: Mastra Studio (evals and logging), Mastra Server (deployment) and Memory Gateway — [rywalker.com research note](https://rywalker.com/research/mastra) (secondary)
- The team is ex-Gatsby: Kyle Mathews, Abhi Aiyer, Shane Allen (plus co-founder Sam Bhagwat, "calcsam" on HN) — [Byteiota](https://byteiota.com/mastra-1-0-typescript-ai-framework-reaches-production/)
- The legal entity is **Kepler Software, Inc.** (copyright holder in LICENSE.md) — [LICENSE.md](https://raw.githubusercontent.com/mastra-ai/mastra/main/LICENSE.md)

### Inferences
- About 80 minors in 9 months on 1.x means any pinned version is stale within weeks. Verity would need a deliberate upgrade cadence (pin exact versions, upgrade monthly behind tests), not floating `^1`.
- The jump from 300k weekly downloads at 1.0 (January) to about 1.44M (October) is a strong adoption signal. Part of it may be transitive (CopilotKit, templates); that is unverified.

### Gaps
- Exact count of GitHub releases and a curated breaking-change list for 1.x: not retrieved (GitHub Releases section did not render; no CHANGELOG fetched).
- Whether Mastra publishes a formal semver or deprecation policy for 1.x: not found.

## 2. Licence: Apache 2.0 core versus the enterprise ("ee") licence

### Takeaway
The core is Apache 2.0, but the repo is **dual-licensed**: anything in a directory named `ee/` (notably `@mastra/core/auth/ee`, `@mastra/core/agent-builder/ee`, `@mastra/editor/ee`) is under the source-available **Mastra Enterprise License**. That licence forbids production use without both a signed agreement with Kepler and a valid licence key. Ordinary agents, tools, workflows, memory, storage and MCP are not in `ee/`, but the enterprise auth code ships inside the `@mastra/core` package itself.

### Cited Findings
- LICENSE.md mapping: "Content under any directory named `ee/`", including `@mastra/core/auth/ee`, `@mastra/core/agent-builder/ee` and `@mastra/editor/ee`, is licensed under `ee/LICENSE`; third-party components keep their own licences; "Content outside of the above-mentioned directories or restrictions is" Apache License 2.0; copyright (c) 2025 Kepler Software, Inc. — [LICENSE.md](https://raw.githubusercontent.com/mastra-ai/mastra/main/LICENSE.md)
- ee/LICENSE §3.2: "Production Use of an Enterprise Feature is permitted only if, and only for so long as, both of the following are true": a written agreement with Kepler that expressly permits it, **and** a valid License Key enabling the feature within its scope and expiry — [ee/LICENSE](https://raw.githubusercontent.com/mastra-ai/mastra/main/ee/LICENSE)
- ee/LICENSE §3.1: a "non-exclusive, non-transferable, non-sublicensable, revocable right to use, build, and modify the Enterprise Features" for your own Development and Testing only (non-production, not serving end users, customers or business operations) — [ee/LICENSE](https://raw.githubusercontent.com/mastra-ai/mastra/main/ee/LICENSE)
- ee/LICENSE §3.3: you may modify for dev/test, **Kepler owns your modifications**, and modifying does not grant production rights; §3.5 forbids making any Enterprise Feature available to third parties, including as a hosted service; ee features are "source-available, not open source" (§1.1) — [ee/LICENSE](https://raw.githubusercontent.com/mastra-ai/mastra/main/ee/LICENSE)
- The docs licence page confirms the dual model ("Apache License 2.0 for the majority of the codebase"), names the same three ee paths, and routes enterprise to sales; it lists no features by name and gives no licence history — [mastra.ai/docs/license](https://mastra.ai/docs/license)
- Agent Builder is part of Mastra Enterprise Edition; production needs `MASTRA_EE_LICENSE`, and "the server refuses to start when builder.enabled is truthy without a valid license" — [mastra.ai agent-builder deploying docs](https://mastra.ai/docs/agent-builder/deploying/llms.txt)
- The README states the same: `ee/` code is source-available, production needs an enterprise licence, dev/test is free — [GitHub README](https://github.com/mastra-ai/mastra)

### Inferences
- Earlier Mastra (2024 to early 2025) was widely described as Elastic License 2.0 before moving to Apache 2.0. I could not re-verify that from a primary source in this session, so treat it as unconfirmed history (see Gaps). The 2025 copyright line plus the `ee/` carve-out suggests the current split dates from 2025 to 2026.
- For Verity: the agents, tools, workflows, memory, PostgresStore and MCP paths that Verity would use are Apache 2.0. **Do not import from any `.../ee` path** (enterprise auth/RBAC/SSO, Agent Builder, editor). Verity already has its own auth and `enforcePolicy()`, so the ee auth layer is unnecessary anyway. Add a lint or CI grep guard against `/ee` imports.
- Open-core risk: features may migrate into `ee/` over time. Pinning versions and checking LICENSE.md on each upgrade guards against surprise.

### Gaps
- A primary-source licence-change history (for example a dated commit moving from ELv2 to Apache 2.0, or when `ee/` was introduced): not retrieved.
- A full list of which runtime features sit behind `ee/` (RBAC? SSO? audit?): the docs do not enumerate them.

## 3. Features: agents, tools, workflows, HITL approval, memory, RAG, evals, observability, MCP

### Takeaway
Mastra is batteries-included: agents with a tool loop, graph workflows with suspend/resume, conversation and "observational" memory, RAG, evals/scorers, tracing (with a span query API), MCP client and server (MCP v2 since `@mastra/mcp@2.0.0`), and A2A. Tool approval is a first-class, **storage-backed** mechanism: per-request `requireToolApproval`, per-tool `requireApproval`, then `approveToolCall` / `declineToolCall`, plus in-tool `suspend()` / `resumeStream`. Pending runs can be rediscovered from storage after a restart or on another instance.

### Cited Findings
- README features: model routing across 40+ providers; agents that iterate until a final answer or stop condition; graph workflow engine (`.then()`, `.branch()`, `.parallel()`); human-in-the-loop suspend/resume of agents or workflows with state kept in storage; conversation history, RAG and "Observational Memory"; React/Next.js/Node integrations, Vercel AI SDK UI and CopilotKit; MCP servers exposing agents, tools and resources; built-in evals and observability — [GitHub README](https://github.com/mastra-ai/mastra)
- Two pause mechanisms: **pre-execution approval** (the model picks the tool and arguments, nothing executes until approved) and **runtime suspension** (`suspend()` inside `execute`, resumed with data matching `resumeSchema`) — [mastra.ai agent approval docs](https://mastra.ai/docs/agents/agent-approval)
- `requireToolApproval` (on `stream()`/`generate()`, covering every tool call in that request) can be a boolean or a **function receiving `toolName`, `args`, `requestContext`, `workspace`**. A tool's own `requireApproval` is set in `createTool()`. The two combine with OR; a boolean `false` at request level does not cancel a tool's `requireApproval`. Durable and stored agents accept only a boolean, and a function there falls back to "approve every call" — [agent approval docs](https://mastra.ai/docs/agents/agent-approval)
- APIs: `approveToolCall({ runId, toolCallId? })`, `declineToolCall({ runId, toolCallId?, reason? })` (the reason is returned to the model as the tool result), `approveToolCallGenerate` / `declineToolCallGenerate` (non-streaming, `finishReason: 'suspended'`), `resumeStream(data, { runId })` / `resumeGenerate`, `resumeData` on `context.agent`; the stream emits chunk type `tool-call-approval` — [agent approval docs](https://mastra.ai/docs/agents/agent-approval)
- Approval needs a configured storage provider, or you get "snapshot not found". Agent-run snapshots are minimal and deleted when the run finishes. `listSuspendedRuns({ threadId, resourceId })` and `GET /agents/:agentId/suspended-runs` rediscover pending runs "after a page refresh, a server restart, or on a different server instance". `autoResumeSuspendedTools` never auto-approves `requireApproval` tools — [agent approval docs](https://mastra.ai/docs/agents/agent-approval)
- MCP: `@mastra/mcp` 2.0.0 (core 1.68.0, 2026-09-22) rebuilt on the MCP 2026-07-28 revision; 1.79.0 adds experimental MCP Events — [releases.sh](https://releases.sh/mastra/mastra-github-releases)
- Observability: trace-correlated logging (1.63.0), advanced trace queries (1.65/1.66), Span Query API (1.75.0) — [releases.sh](https://releases.sh/mastra/mastra-github-releases)
- 1.78.0 "Agent Scopes" and 1.76.0 "Durable agent run ownership and fencing" — [releases.sh](https://releases.sh/mastra/mastra-github-releases)
- A tool-input-examples feature (`inputExamples`) arrived in 1.10.0 — [toolnavs](https://toolnavs.com/en/article/1183-mastra-fa-bu-1-1-0-0-gong-ju-shu-ru-shi-li-mcp-shang-xia-wen-zhuan-fa-he-dai-li) (secondary)
- `@mastra/core` runtime dependencies include `@a2a-js/sdk` (v0.3 and v1), `hono`, `hono-openapi`, `croner` (scheduling), `execa`, `ws`, `re2js` and `posthog-node` — [npm registry JSON](https://registry.npmjs.org/@mastra/core/latest)

### Inferences
- The approval flow maps cleanly onto a Verity "agent proposes, human confirms" pattern. The function form of `requireToolApproval` sees `requestContext`, so the decision can come from Verity's own policy, for example "mutating commands always need approval; reads do not". The decision about who may approve must still be enforced in Verity's approve endpoint. Mastra's `approveToolCall({ runId })` checks no permission by itself.
- An approved tool's `execute` should still call Verity's command path (`enforcePolicy()` → command → audit). Approval is a UX gate, not authorization.
- `posthog-node` as a core dependency suggests telemetry; check for an opt-out env var (not verified this session).

### Gaps
- How RAG and vector stores interact with tenant scoping (pgvector via `@mastra/pg`): not researched in depth.
- Eval/scorer storage and cost: not researched.
- Telemetry defaults and opt-out: not verified.

## 4. Storage: what is persisted, where, own tables, RLS/GUC interaction, request context

### Takeaway
Mastra persists threads, messages, resources (working memory), workflow/agent-run snapshots, traces, evals/scorers and notifications into **its own tables** (`mastra_*`), auto-created and migrated by `init()` unless `disableInit` is set. A custom `schemaName` and a caller-supplied `pg.Pool` are supported. The tables carry **no tenant column and no RLS awareness**: Mastra scopes memory by `resourceId` / `threadId`, which the server enforces only when you set the reserved `MASTRA_RESOURCE_ID_KEY` / `MASTRA_THREAD_ID_KEY` in `RequestContext` from authenticated identity. A Verity-style per-transaction `set_config('verity.tenant_id', …, true)` is **not** applied by PostgresStore's own queries.

### Cited Findings
- PostgresStore options: `id` (required), `connectionString` or `host/port/database/user/password`, **`pool` (existing `pg.Pool`)**, **`schemaName` (default `public`)**, `ssl`, `max` (default 20), `idleTimeoutMillis` (default 30000), **`disableInit`** (skips automatic table creation and migrations, for CI/CD-managed migrations), `skipDefaultIndexes`, `indexes` — [mastra.ai PostgresStore reference](https://mastra.ai/reference/storage/postgresql)
- Tables created by `init()` (called automatically when the store is passed to `new Mastra(...)`): `mastra_workflow_snapshot`, `mastra_evals`, `mastra_threads`, `mastra_messages`, `mastra_traces`, `mastra_scorers`, `mastra_resources`, `mastra_notifications`. Without `init()`, "tables won't be created and storage operations will fail silently or throw errors" — [PostgresStore reference](https://mastra.ai/reference/storage/postgresql)
- If you supply the pool, `store.close()` does not close it. The docs mention sharing a pool "for Row Level Security" and show `store.pool.connect()` with `SET LOCAL app.user_id`; direct `store.db` / `store.pool` use "bypasses PostgresStore's built-in logic". The docs say nothing about PgBouncer/transaction-mode pooling or multi-tenancy. For Next.js HMR, keep one PostgresStore on `globalThis` — [PostgresStore reference](https://mastra.ai/reference/storage/postgresql)
- `@mastra/pg` 1.32.0 depends on `pg`, `pg-connection-string`, `async-mutex`, `xxhash-wasm` (no Prisma) — [npm registry](https://registry.npmjs.org/@mastra/pg/latest)
- Other storage backends exist (LibSQL is the dev default per the Next.js guide's `file:` URL; Elasticsearch and Valkey added in 1.62.0) — [Next.js guide](https://mastra.ai/docs/frameworks/web-frameworks/next-js); [releases.sh](https://releases.sh/mastra/mastra-github-releases)
- **RequestContext** (the current name; the docs page does not mention "RuntimeContext") is passed to `agent.generate()`, `network()`, workflow `run.start()` / `run.resume()` and tool `execute()`. Tools read `context?.requestContext?.get('key')`. An optional `requestContextSchema` on a tool validates before `execute()` and returns an error object rather than throwing — [mastra.ai request context docs](https://mastra.ai/docs/server/request-context)
- Reserved keys: `MASTRA_RESOURCE_ID_KEY` (forces the memory resource; the server checks thread ownership and returns 403), `MASTRA_THREAD_ID_KEY` (forces the thread, overriding the client), `MASTRA_SCOPES_KEY` (`<type>:<value>` strings, e.g. `org:${orgId}`), `MASTRA_MESSAGE_AUTHOR_KEY`. Auth config `mapUserToResourceId` sets the resource automatically. "Middleware should set these keys from authenticated identity, not from client input". **Setting `MASTRA_SCOPES_KEY` alone does not trigger the ownership checks**, and older `@mastra/server` versions pass scopes from request bodies through (agents now throw `AGENT_SCOPES_SERVER_OUTDATED`) — [request context docs](https://mastra.ai/docs/server/request-context)

### Inferences
- **RLS interaction (core Verity concern).** Verity's runtime role `verity_app` is `NOBYPASSRLS`, and isolation fails closed when no `verity.tenant_id` GUC is set. Mastra's queries run on their own pooled connections with no GUC. So: (a) if `mastra_*` tables get Verity-style RLS policies keyed on the GUC, every Mastra read returns nothing and every write fails; (b) if they get no RLS, they become a second tenant-isolation surface enforced only by Mastra's application-level `resourceId` checks. That is the same class of risk ADR-019 rejected for Payload. The cleanest option is to put Mastra in its own Postgres schema (`schemaName: 'mastra'`), run its DDL as a migration step (`disableInit: true` in the runtime), and set `resourceId = "<tenantId>:<userId>"` (or `tenantId`-prefixed) via `MASTRA_RESOURCE_ID_KEY` from Verity's authenticated context. Better still, add a tenant column plus RLS through a Verity-side wrapper (a custom storage adapter that runs each Mastra query inside `withTenant()`). Mastra does not provide that wrapper, so it would be Verity code. This needs a Verity ADR (a new persistence surface under INV-001), per CLAUDE.md stop conditions.
- **Transaction-mode pooler (port 6543).** Mastra uses node-postgres with its own pool (default max 20). Pointing it at Supabase's transaction-mode pooler should work for plain queries but is unverified; any session-level state (prepared statements, advisory locks such as durable-run "fencing") may misbehave under pgbouncer transaction mode. Twenty connections per serverless instance against a 15-connection project pool is exactly the `EMAXCONNSESSION` failure Verity already hit, so `max` must be set to 1–2 on serverless or a shared pool passed in.
- **Tool-level tenant enforcement is Verity's job.** Tools should ignore model-supplied tenant/user IDs, read the actor from `requestContext` (set server-side from the authenticated session), and call Verity's existing `withTenant()` + `enforcePolicy()` path. That fits ADR-017 (the agent acts as the calling human) because Mastra has no authority path of its own. Embedding Mastra via direct calls in Verity route handlers, rather than exposing `@mastra/next`'s full HTTP API, avoids depending on Mastra's server-side ownership checks at all.
- Prisma coexistence: Mastra's `mastra_*` tables live outside `schema.prisma`; Prisma migrate drift detection may flag them if they sit in the same schema. Another reason for a separate schema.

### Gaps
- Exact column definitions of `mastra_*` tables (whether any `resourceId` index or tenant-like column exists on traces/snapshots): not retrieved.
- Whether PostgresStore uses prepared statements, advisory locks or LISTEN/NOTIFY, all incompatible with pgbouncer transaction mode: not verified; needs a code read of `stores/pg`.
- Whether a custom/wrapped storage adapter interface is documented and stable: not researched.

## 5. Model layer: Vercel AI SDK relationship and providers

### Takeaway
Mastra runs its own agent loop and model router but builds on the **Vercel AI SDK provider specification** (`@ai-sdk/provider` v5, v6 and v7 interfaces are bundled side by side). It accepts AI SDK provider instances directly and offers `provider/model` strings for a claimed 218 providers. Anthropic and OpenAI are first-class; local models work through an OpenAI-compatible `{ id, url }` endpoint (LM Studio example; Ollama works the same way, though the docs list only "Ollama Cloud" by name).

### Cited Findings
- `@mastra/core` 1.79.0 depends on `@ai-sdk/provider-v5` (= `@ai-sdk/provider@2.0.5`), `@ai-sdk/provider-v6` (= 3.0.19), `@ai-sdk/provider-v7` (= 4.0.29) and `@ai-sdk/provider-utils` v6/v7, but **not** on the `ai` package itself — [npm registry JSON](https://registry.npmjs.org/@mastra/core/latest)
- Third-party view: "Mastra uses the Vercel AI SDK underneath for LLM interactions"; Mastra does orchestration, the AI SDK does model calls and UI — [Byteiota](https://byteiota.com/mastra-1-0-typescript-ai-framework-reaches-production/) (partly contradicted by the dependency list above, which shows provider interfaces only, not the AI SDK runtime)
- Model router: "8207 models from 218 providers"; `provider/model` strings (e.g. `anthropic/claude-sonnet-5-5`); API key read from the matching env var; AI SDK provider modules accepted anywhere a model string is; gateways (`openrouter/...`); custom OpenAI-compatible endpoint via `{ id, url }` (LM Studio `http://localhost:1234/v1`); `api: "responses"` for the OpenAI Responses API; fallback arrays with per-entry retries/headers — [mastra.ai models](https://mastra.ai/models)
- A Mastra maintainer on HN described the AI SDK as "lower-level" with a different architecture — [HN mirror via search snippet](https://hacker-news-clone.nuxt.dev/item/46693959) (fetch failed; snippet only)

### Inferences
- Model choice per tenant (for example a tenant-specific model or key) can be done at runtime because models are plain strings or provider objects chosen from `requestContext`.
- Bundling three AI SDK provider spec versions shows Mastra tracking AI SDK majors closely, which helps compatibility but adds churn whenever the AI SDK moves.

### Gaps
- Exact Ollama-native support (as opposed to the OpenAI-compatible endpoint) and tool-calling reliability with local models: not verified.

## 6. Next.js integration, serverless/Vercel, dependency weight

### Takeaway
Mastra can be **embedded** in Next.js: import the Mastra instance and call agents from route handlers, streaming to `useChat` through `@mastra/ai-sdk`. Alternatively, mount the full Mastra HTTP API on a catch-all route via `@mastra/next`, or run a separate Mastra server or Studio sharing storage. The package is heavy: `@mastra/core` 1.79.0 unpacks to **about 83 MB across 3,475 files with 30 runtime dependencies**, Hono and A2A SDKs included.

### Cited Findings
- Embedded pattern: chat route calls `handleChatStream` from `@mastra/ai-sdk` (`agentId`, `version: 'v7'`) and returns `createUIMessageStreamResponse`; a `GET` handler reads memory history to rehydrate the UI; the client uses `useChat` from `@ai-sdk/react` with `DefaultChatTransport` and AI Elements components — [mastra.ai Next.js guide](https://mastra.ai/docs/frameworks/web-frameworks/next-js)
- Full API: `createNextRouteHandler({ mastra, prefix: '/api/mastra' })` from `@mastra/next` on `app/api/mastra/[...mastra]/route.ts` exposes agents, tools, workflows, memory, MCP and A2A — [Next.js guide](https://mastra.ai/docs/frameworks/web-frameworks/next-js)
- Studio can run beside Next.js on shared storage; LibSQL `file:` URLs must be absolute because `next dev` and `mastra dev` have different working directories — [Next.js guide](https://mastra.ai/docs/frameworks/web-frameworks/next-js)
- The guide gives no `next.config` / `serverExternalPackages` notes and links a separate Vercel deployer guide — [Next.js guide](https://mastra.ai/docs/frameworks/web-frameworks/next-js)
- `@mastra/core` 1.79.0: unpackedSize 82,842,749 bytes, fileCount 3,475, 30 dependencies (incl. `hono`, `hono-openapi`, `ws`, `execa`, `croner`, `posthog-node`, `@a2a-js/sdk` x2, `chat`, `re2js`, `jpeg-js`, `yaml`, `dotenv`), peer `zod ^3.25 || ^4`; npm provenance attestations present — [npm registry JSON](https://registry.npmjs.org/@mastra/core/latest)
- Use a single global PostgresStore under HMR — [PostgresStore reference](https://mastra.ai/reference/storage/postgresql)
- Replit runs "thousands of isolated Mastra agent instances daily" (Agent 3) — [Byteiota](https://byteiota.com/mastra-1-0-typescript-ai-framework-reaches-production/)

### Inferences
- An unpacked size of about 83 MB (much is likely multiple dist formats, types and source maps) matters for Vercel's 250 MB serverless function limit when combined with Prisma engines and Next.js. It is probably fine, but measure the traced function size. Mastra should likely go in `serverExternalPackages` (unverified).
- Approval and suspend state lives in Postgres and can be found with `listSuspendedRuns`, so stateless serverless works in principle. Long-running durable agents or workflows still need a host whose execution time fits Vercel function limits, or Verity's existing cron trigger.
- Embedding only `@mastra/core` + `@mastra/pg` + `@mastra/ai-sdk` in Verity's own route handlers, without the `@mastra/next` catch-all, keeps Verity's auth and policy in front of every call and avoids a second HTTP API surface.

### Gaps
- Measured cold-start impact and traced bundle size on Vercel for a Next.js 16 app: no source found.
- Next.js 16-specific compatibility notes (Turbopack, `serverExternalPackages`): not found in the docs page.

## 7. Production users, criticisms, issues, security advisories

### Takeaway
Named adopters include Replit, PayPal, Adobe, Docker, SoftBank and Marsh McLennan (per a secondary source). The major 2026 risk event was a **supply-chain compromise on 2026-06-17**: about 141–144 `@mastra/*` packages, `@mastra/core` included, were republished through a former contributor's still-privileged npm account, carrying a typosquatted `easy-day-js` postinstall infostealer. That was not a framework code flaw, but it is a real governance signal. Other criticism centres on framework lock-in versus using the AI SDK directly, ecosystem gaps and Windows CLI rough edges.

### Cited Findings
- **2026-06-17 compromise**: malicious versions published about 01:15–02:36 UTC; 141 `@mastra/*` packages including `@mastra/core` (>918K weekly downloads at the time); each a patch bump over the last legitimate release; the injected dependency `easy-day-js` (dayjs typosquat; 1.11.21 clean decoy, 1.11.22 added a `postinstall` running `setup.cjs`); the loader disables TLS validation, fetches a second stage and self-deletes; the implant installs persistence on Windows/macOS/Linux, polls a C2, inventories 166 crypto-wallet extensions, copies Chrome/Edge/Brave history and exfiltrates host reconnaissance; published by npm account `ehindero`, with `easy-day-js` published by `sergey2016` the day before. Remediation: `npm ls easy-day-js`, treat hosts and CI as compromised, rotate npm/cloud/CI/SSH/Git credentials, use `--ignore-scripts`, cooldowns, lockfile enforcement — [Socket](https://www.socket.dev/blog/mastra-npm-packages-compromised)
- Root cause: a **former contributor's npm account kept publish rights** — [Chainguard](https://chainguard.dev/unchained/mastra-npm-scope-takeover-143-packages-backdoored-via-compromised-contributor-account); [Snyk (title)](https://snyk.io/blog/a-forgotten-contributor-account-compromised-the-entire-mastra-npm-package-scope/); RH-ISAC calls it a "maintainer phishing attack" — [RH-ISAC](https://rhisac.org/threat-intelligence/144-mastra-npm-packages-compromised-through-maintainer-phishing-attack/). Counts reported range from 80 to 144; Mastra's remediation covered 142 publishable packages (per a Snyk snippet; fetch failed)
- Microsoft threat intelligence reportedly linked the attack to North Korean actor **Sapphire Sleet**, saying it began after legitimate Mastra credentials were compromised — [Escudo Digital](https://www.escudodigital.com/ciberseguridad/microsoft-ataque-mastra-hackers-norcoreanos-sapphire-sleet.html); [BankInfoSecurity](https://www.bankinfosecurity.com/mastra-ai-framework-poisoned-in-npm-supply-chain-attack-a-32003) (secondary; the Microsoft primary was not fetched)
- OSV/GHSA malware records exist for several packages, e.g. GHSA-89jf-vg4p-9vmj (`@mastra/hono` 1.4.26, MAL-2026-5950), GHSA-mvf4-vg87-q9vm (`mastra`, MAL-2026-5965), GHSA-64qh-859p-w8cf (`@mastra/braintrust`), GHSA-7crh-g7x3-q72f (`@mastra/gcs` ≤0.2.3), GHSA-4jmq-h62h-xhgh (`@mastra/client-js` 1.24.1) — [OSV MAL-2026-5950](https://osv.dev/vulnerability/MAL-2026-5950); [Vulert @mastra/client-js](https://vulert.com/vuln-db/malicious-code-in--mastra-client-js--npm-)
- Conventional vulnerability: **GHSA-xh92-rqrq-227v**, `@mastra/mcp-docs-server` < 0.17.0, directory-listing information exposure (CWE-548), 6.5 Medium, dated 2025-09-24 — [GitLab advisory DB](https://advisories.gitlab.com/pkg/npm/@mastra/mcp-docs-server/GHSA-xh92-rqrq-227v/)
- 1.71.0 fixed a ReDoS in dataset schema validation by moving to the linear-time RE2 engine (`re2js`) — [releases.sh](https://releases.sh/mastra/mastra-github-releases)
- After the incident, `@mastra/core` 1.79.0 carries npm provenance attestations — [npm registry JSON](https://registry.npmjs.org/@mastra/core/latest) (whether provenance predates June 2026 not checked)
- Criticism: HN skeptics ask whether Mastra beats using provider SDKs directly and argue it "shifts lock-in from model providers to the framework itself"; defenders counter that self-built observability, evals and guardrails create their own sunk-cost lock-in — [Byteiota](https://byteiota.com/mastra-1-0-typescript-ai-framework-reaches-production/)
- User reviews (unverified aggregator): "the ecosystem is still catching up... had to write my own integrations"; CLI bugs initialising projects on Windows — [Tooliverse](https://tooliverse.ai/tools/mastra)
- Adopters named: Replit, PayPal, Adobe, Docker, SoftBank, Marsh McLennan — [Byteiota](https://byteiota.com/mastra-1-0-typescript-ai-framework-reaches-production/) (secondary; no primary case studies fetched)

### Inferences
- The June 2026 incident means Verity should consume Mastra only with exact-version pins, a committed lockfile, `npm ci --ignore-scripts` (or an allowlist), a package-age cooldown and provenance verification. Verity's dev machines are Windows, which the implant targets.
- Fast cadence, a broad surface (A2A, MCP, sandboxes, Studio, channels) and about 83 MB unpacked mean a large attack and upgrade surface for a feature Verity may use only a slice of (agent + tools + approval + memory).
- Fit summary for Verity (inference): the pieces Verity needs exist and are Apache 2.0 (agent loop, tool approval with storage-backed resume, `RequestContext` carrying the authenticated actor, PostgresStore with custom schema, an external pool and `disableInit`). The misfit is persistence: Mastra's tables are a second tenant-scoped store without RLS, which under Verity's rules needs an ADR and either a wrapper adapter running inside `withTenant()` or a strict `resourceId` = tenant-prefixed scheme. Authorization must stay entirely in Verity tools (ADR-017); Mastra's own auth (partly `ee/`) should not be used.

### Gaps
- Mastra's own post-incident statement or postmortem (token revocation, trusted publishing adoption, 2FA enforcement): not retrieved.
- The direct HN comment threads (1.0 launch, incident): fetch failed; criticism is via secondary summaries.
- Independent benchmarks or production postmortems of Mastra on Vercel serverless with Postgres: none found.
