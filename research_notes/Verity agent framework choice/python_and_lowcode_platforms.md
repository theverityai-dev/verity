# Python and low-code/visual agent platforms (Pydantic AI, CrewAI, Dify, LangGraph Python, Flowise) for Verity

Research date: 2026-10-24. Verity context: multi-tenant Next.js/TypeScript + Postgres ERP for Indian SMBs, hosted multi-tenant by default, with one on-prem client (DSEW, Mode B) on a low-end server.

Claim verdicts at a glance:

| Brief claim | Verdict |
|---|---|
| "Dify: Modified Apache 2.0; review license before embedding or reselling as a multi-tenant feature" | **VERIFIED**, and understated. The license forbids running a multi-tenant environment (tenant = workspace) without Dify's written authorization. |
| "Flowise upstream repository was archived in August 2026" | **VERIFIED**. Archived by the owner on 13 Aug 2026, after Workday bought it (14 Aug 2025). End of life 31 Aug 2026. |
| "CrewAI: Python, MIT" | **VERIFIED** for the open-source framework. The commercial CrewAI AMP Suite is separate and proprietary. |
| "Pydantic AI: Python, MIT" | **VERIFIED**. |
| "LangGraph: MIT" | **VERIFIED** for the library (PyPI 1.2.17, 24 Oct 2026). LangGraph Platform / LangSmith Deployment is a separate paid product. |

## Q1. Dify license: what the extra conditions actually say (as of Oct 2026)

### Takeaway
VERIFIED, and the brief understates the risk. The LICENSE says you "may not use the Dify source code to operate a multi-tenant environment" unless Dify authorizes it in writing, and it defines one tenant as one workspace. Giving each Verity customer its own Dify workspace on a shared deployment is exactly what that clause forbids. A separate clause stops you removing or changing the Dify logo or copyright in the console or frontend.

### Cited Findings
- The base license is "a modified version of the Apache License 2.0" (also called the "Dify Open Source License, based on Apache 2.0 with additional conditions"). — [Dify LICENSE](https://github.com/langgenius/dify/blob/main/LICENSE); [Dify README](https://github.com/langgenius/dify)
- **Multi-tenant clause (verbatim):** "Unless explicitly authorized by Dify in writing, you may not use the Dify source code to operate a multi-tenant environment." Tenant definition: "Within the context of Dify, one tenant corresponds to one workspace." — [Dify LICENSE](https://github.com/langgenius/dify/blob/main/LICENSE)
- **LOGO/copyright clause (verbatim):** "you may not remove or modify the LOGO or copyright information in the Dify console or applications." This does not apply to uses that don't involve the frontend, and "frontend" means the `web/` directory or the "web" Docker image. — [Dify LICENSE](https://github.com/langgenius/dify/blob/main/LICENSE); [Dify open-source policy page](https://docs.dify.ai/policies/open-source)
- **Contributor clauses:** "The producer can adjust the open-source agreement to be more strict or relaxed as deemed necessary," and "Your contributed code may be used for commercial purposes, including but not limited to its cloud business operations." — [Dify LICENSE](https://github.com/langgenius/dify/blob/main/LICENSE)
- **The wording has widened.** Older text restricted only a "multi-tenant SaaS service that is similar to the Dify.AI service edition." The current text restricts any "multi-tenant environment." — [mirror commit showing the change](https://code.gitlink.org.cn/dnrops/dify/commit/83a6b0c6260163afeefc24df1dac59b0b2f7f30c); [Dify policies (legacy docs)](https://legacy-docs.dify.ai/policies)
- Other commercial use is allowed, including using Dify as a backend service for other applications. Licensing questions go to business@dify.ai. — [Dify open-source policy page](https://docs.dify.ai/policies/open-source)
- The LICENSE file shows no revision date, only "© 2025 LangGenius, Inc." — [Dify LICENSE](https://github.com/langgenius/dify/blob/main/LICENSE)
- **Open-source status is disputed.** An October 2025 thread on the OSI license-discuss list argued that the terms effectively prohibit SaaS use, that the logo rule goes further than normal attribution, and that the Apache-derived name may conflict with Apache Foundation naming rules. — [OSI license-discuss, Oct 2025](https://lists.opensource.org/pipermail/license-discuss_lists.opensource.org/2025-October/022423.html); [follow-up](https://lists.opensource.org/pipermail/license-discuss_lists.opensource.org/2025-October/022425.html)
- Self-hosting with SSO, RBAC and SLAs is sold as Dify Enterprise through a sales form. — [Dify README](https://github.com/langgenius/dify)

### Inferences
- **Hosted Verity:** embedding Dify with a workspace per Verity tenant needs a written commercial license from LangGenius. A single shared workspace for all tenants would avoid the license clause, but it would break INV-001: Dify would become a second tenant-isolation surface outside Verity's RLS. That is the same objection ADR-019 raised against Payload. Either way, Dify does not fit as an embedded multi-tenant feature.
- **DSEW on-prem (single tenant, one workspace):** probably allowed under the license. But if Dify's web UI is shown to users, its logo and copyright must stay. White-labelling it inside Verity's interface is not allowed.
- Contributors accept that LangGenius may change the license terms later ("more strict or relaxed"), so there is a risk of future relicensing.

### Gaps
- I found no official Dify FAQ or legal guidance on whether "workspace = tenant" covers one workspace serving many end customers through API calls only. Only Dify's written confirmation settles that.
- No public price for a Dify commercial or multi-tenant license.

## Q2. Flowise: archived? Workday acquisition and what followed

### Takeaway
VERIFIED. Workday acquired Flowise on 14 Aug 2025. The maintainers announced a wind-down and code freeze on 29 Jul 2026, archived the repository on 13 Aug 2026 (now read-only), and reached end of life on 31 Aug 2026. The final release is 3.1.4. Six security advisories published on 10 Sep 2026 will never get an official patch.

### Cited Findings
- The GitHub page for FlowiseAI/Flowise reads: "This repository was archived by the owner on Aug 13, 2026. It is now read-only." Notice: "Flowise has been archived. Refer to Future of Flowise." The repo has about 55.5k stars and is licensed Apache 2.0. — [GitHub FlowiseAI/Flowise](https://github.com/FlowiseAI/Flowise)
- **"The Future of Flowise" (Discussion #6727, by HenryHengZJ):**
  - Timeline: 29 Jul 2026 announcement and code freeze ("Active feature development ceases immediately"); 13 Aug 2026 public archive with issues and PRs locked; 31 Aug 2026 end of life, when the core team leaves Discord and GitHub.
  - Stated reason: coding agents and stronger model reasoning make rigid low-code workflows hit their limits.
  - The code stays under Apache 2.0 and the team encourages forks. npm packages and Docker images are to be marked deprecated.
  - Neither Workday nor Flowise Cloud is mentioned.

  — [Discussion #6727](https://github.com/FlowiseAI/Flowise/discussions/6727)
- **Acquisition:** Workday announced on 14 Aug 2025 that it had acquired Flowise, to bring its agent builder to the Workday platform for HR and finance agents. Terms were not disclosed. At the time Flowise had 42,000+ stars. — [Workday press release (PDF)](https://s21.q4cdn.com/950027458/files/doc_news/Workday-Acquires-Flowise-Bringing-Powerful-AI-Agent-Builder-Capabilities-to-the-Workday-Platform-08-14-2025-2025.pdf); [Nasdaq press release](https://www.nasdaq.com/press-release/workday-acquires-flowise-bringing-powerful-ai-agent-builder-capabilities-workday); [SiliconANGLE, 15 Aug 2025](https://siliconangle.com/2025/08/15/workday-acquires-flowise-boost-ai-powered-workflows/); [diginomica](https://diginomica.com/workday-acquires-flowise-build-ai-agents-people-dont-want-ai-bosses)
- **After the archive:**
  - 3.1.4 (29 Jul 2026) is the final npm release and `flowiseai/flowise:latest` image.
  - Six advisories published on 10 Sep 2026 affect all versions up to 3.1.4, with no patched version and no CVE IDs, so `npm audit`, Dependabot and OSV may show 3.1.4 as clean. Two are critical (Enterprise SSO matches users by email only; invitation takeover). Four are high: missing workspace authorization on credentials, chat history and document-store history, plus an exposed BullMQ `/admin/queues` dashboard that shows every tenant's job payloads.
  - Ten commits on archived `main` after 3.1.4 were never released, including two that appear to fix advisories.
  - Suggested alternatives are Langflow, Dify and n8n, but none imports Flowise flows.

  — [DEV Community: "Flowise is archived, and its six September advisories will never get an official fix"](https://dev.to/munimv2/flowise-is-archived-and-its-six-september-advisories-will-never-get-an-official-fix-what-3j73) (secondary, but specific)
- Community snapshot forks exist, for example AonzOG/Flowise-9291856, imported 13 Oct 2026 from a 14 Aug 2026 commit. — [GitHub fork](https://github.com/AonzOG/Flowise-9291856)
- One blog gives a planned archive date of 10 Aug. GitHub itself shows 13 Aug, so treat 13 Aug as authoritative. — [jahanzaib.ai](https://www.jahanzaib.ai/blog/flowise-vs-dify-vs-n8n-ai-agents) vs [GitHub](https://github.com/FlowiseAI/Flowise)

### Inferences
- Flowise is disqualified for Verity: no upstream, unpatched multi-tenant authorization flaws, and a history of workspace-isolation bugs, which matter directly for INV-001.
- The project's own stated reason (coding agents beat rigid low-code flows) argues against visual flow builders as Verity's agent substrate generally.

### Gaps
- Whether Workday still runs Flowise internally or in Workday products after the open-source wind-down is not stated in the sources I found.

## Q3. CrewAI, Pydantic AI and LangGraph: licenses and commercial splits

### Takeaway
All three brief claims are VERIFIED: each framework is MIT. CrewAI and LangGraph both sell a separate proprietary layer for deployment, observability and governance (CrewAI AMP Suite; LangGraph Platform / LangSmith Deployment). Pydantic AI's paid add-on is Logfire, an observability product; the framework itself is MIT.

### Cited Findings
**CrewAI**
- MIT, about 60.0k stars, 8.9k forks. Describes itself as "a standalone Python framework with its own primitives" (independent of LangChain). Claims "over 100,000 certified developers."
- The commercial **CrewAI AMP Suite** adds managed deployment, observability, governance, security, on-prem or cloud deployment and 24/7 support. A "Crew Control Plane" can be tried free.

— [GitHub crewAIInc/crewAI](https://github.com/crewAIInc/crewAI)
- Latest stable is 1.15.22, released 16 Sep 2026 per Wikipedia. Not confirmed against PyPI, which timed out. — [Wikipedia: CrewAI](https://en.wikipedia.org/wiki/CrewAI)

**Pydantic AI**
- MIT (PyPI `license_expression`: MIT); about 20.8k stars; "Built by the Pydantic team."
- Features: typed and validated structured outputs; durable execution on eight engines (Temporal, DBOS, Prefect and others) via, for example, `TemporalDurability`; one-line Logfire (OpenTelemetry) observability.

— [GitHub pydantic/pydantic-ai](https://github.com/pydantic/pydantic-ai)
- The latest PyPI version is 2.61.0. Its upload date was not visible in the fetched portion. — [PyPI JSON](https://pypi.org/pypi/pydantic-ai/json)

**LangGraph (Python)**
- MIT; about 43.8k stars. Lists Klarna, Replit and Elastic as users. Points to LangSmith Deployment for long-running, stateful workflows. A JS/TS port exists (LangGraph.js). — [GitHub langchain-ai/langgraph](https://github.com/langchain-ai/langgraph)
- The latest PyPI version is 1.2.17, released 24 Oct 2026, MIT. — [PyPI langgraph](https://pypi.org/project/langgraph/)
- **LangGraph Platform plans:**
  - Developer: free, one seat, self-hosted core usage.
  - Plus: $39 per seat per month, up to 10 seats, plus $0.001 per node executed with 100k nodes free per month.
  - Enterprise: cloud, hybrid (SaaS control plane with a self-hosted data plane) or fully self-hosted; contact sales.

  — [LangChain: LangGraph Platform plans](https://www.langchain.com/langgraph-platform-pricing)
- Third-party pricing guides (2026) disagree on the entry price ($35 vs $39). Treat the official page as authoritative. — [TrueFoundry](https://www.truefoundry.com/blog/langgraph-pricing); [costbench](https://costbench.com/software/ai-agent-platforms/langgraph-platform/)

**Dify (for comparison)**
- About 159.4k stars. Latest release v1.18.0, tagged "Latest" and published 23 Oct (year not shown; 2026 inferred because it is tagged Latest on 2026-10-24).
- Its release notes add sandbox auth tokens, a `PASSWORD_PEPPER` caution, an Nginx X-Forwarded-For change, and KnowledgeFS off by default.

— [Dify README](https://github.com/langgenius/dify); [Dify releases](https://github.com/langgenius/dify/releases)

### Inferences
- The MIT framework tier is safe to embed in a multi-tenant product. The licensing risk sits only in the optional hosted or enterprise layers, which Verity does not need.
- LangGraph is the only one of the three with a first-party TypeScript port (LangGraph.js). For Verity, the LangGraph programming model is reachable without Python.

### Gaps
- CrewAI's current PyPI version was not confirmed from a primary source. AMP pricing is not public.
- The license terms for self-hosted LangGraph Platform Enterprise are not public.
- Pydantic AI 2.61.0's release date was not found.

## Q4. Cost of adding a separate Python service to a TypeScript/Next.js stack

### Takeaway
I found no rigorous practitioner write-up specific to auth and tenant propagation across a TypeScript-to-Python agent boundary. The available sources cover only repo layout and type drift. The costs below are inferences from Verity's own architecture, not sourced practitioner reports.

### Cited Findings
- LangSmith supports deploying from mixed monorepos where a Python agent depends on shared packages elsewhere in the repo. Each language keeps its own dependency and config files. — [LangSmith monorepo support docs](https://docs.langchain.com/langsmith/monorepo-support)
- A general monorepo pain reported: "Shared types drift out of sync, duplicated config everywhere, and running everything together for local development becomes a chore." — [DEV: Turborepo monorepo guide](https://dev.to/ahmad09/setting-up-a-monorepo-workspace-with-turborepo-a-complete-guide-3ofd)
- A real multi-language example (proompteng/lab) keeps agent and control-plane services under `services/` alongside shared TypeScript packages. — [pkg.go.dev proompteng/lab](https://pkg.go.dev/github.com/proompteng/lab)
- Pydantic positions Pydantic AI as the Python back end behind a TypeScript UI, with a Vercel AI stream adapter so `useChat` can render its agents (vendor source). — [Pydantic AI vs Vercel AI SDK](https://pydantic.dev/docs/ai/comparisons/vs-vercel-ai-sdk/)

### Inferences (not sourced; derived from Verity's CLAUDE.md constraints)
- **Second enforcement surface.**
  - ADR-017 requires every agent action to run as the calling human's `ActorContext` through `enforcePolicy()`.
  - A Python service would either call back into Verity's TypeScript command API for every read and write (so it is an orchestrator only, holds no DB credentials, and policy stays single), or reimplement tenancy and policy in Python. The second route is the same objection ADR-019 raised against Payload.
  - Only the first route is compatible with INV-001 and ADR-017.
- **Tenant context.** The tenant must come from the authenticated context, never from the payload (PLA-TEN-006). The Python service would need to forward and verify a signed per-request token, such as a short-lived JWT carrying the actor, rather than accept a `tenantId` field.
- **Deploy and ops.**
  - Vercel serverless hosts Next.js. A long-lived Python agent service (especially with durable execution: Temporal, DBOS) means a second runtime, container host, CI pipeline, secret set, observability stack and dependency-security feed.
  - For the DSEW on-prem target, that is one more process on a low-end box.
- **Type drift.** Zod schemas in TypeScript and Pydantic models in Python must be kept in sync, for example generated from a shared JSON Schema or OpenAPI.

### Gaps
- No sourced numbers on latency added by an internal TypeScript-to-Python hop, or on operational cost.
- No HN or Reddit threads found specifically on this pattern within the search budget.

## Q5. Does any of these offer something a TypeScript stack cannot get?

### Takeaway
Mostly no. Pydantic AI's validated structured output, with the validation error fed back to the model for a retry, matches what TypeScript SDKs do with Zod schemas. Python's real advantages are ecosystem breadth (data science, document parsing, eval tooling) and Pydantic AI's integrated durable-execution adapters, not anything unique to agents. LangGraph has a TypeScript port.

### Cited Findings
- Pydantic AI: "Typed outputs, so runs return validated results." Durable execution across Temporal, DBOS, Prefect and others. — [GitHub pydantic/pydantic-ai](https://github.com/pydantic/pydantic-ai)
- Secondary comparisons credit Pydantic AI with stronger end-to-end typing ("every function parameter, return value, and LLM output is automatically validated") and suggest it for regulated or data-heavy work. They credit the Vercel AI SDK with better UI and streaming integration (React hooks), as the default for TypeScript stacks. These are opinion pieces and partly vendor-written. — [DEV: AI SDK by Vercel vs Pydantic AI](https://dev.to/simplr_sh/ai-sdk-by-vercel-vs-pydantic-ai-a-tale-of-two-frameworks-for-modern-ai-development-4cli); [Respan comparison](https://www.respan.ai/market-map/compare/pydantic-ai-vs-vercel-ai-sdk); [Pydantic AI vs Vercel AI SDK](https://pydantic.dev/docs/ai/comparisons/vs-vercel-ai-sdk/)
- One review notes Pydantic AI's pre-built tool ecosystem is thinner than LangChain's. — [Respan comparison](https://www.respan.ai/market-map/compare/pydantic-ai-vs-vercel-ai-sdk)
- LangGraph.js exists, with JS docs. — [GitHub langchain-ai/langgraph](https://github.com/langchain-ai/langgraph)

### Inferences
- Zod plus a TypeScript SDK's structured-output or `generateObject`-style call gives schema-validated output in Verity's own language. For an ERP whose types already live in TypeScript, Pydantic adds a second schema language rather than new capability.
- Durable or long-running agents are the one area where Python has more turnkey options. TypeScript has Temporal's TypeScript SDK and LangGraph.js checkpointers, but I did not verify their parity here.

### Gaps
- Could not fetch the full Pydantic-authored comparison page (domain blocked). No benchmark comparing structured-output failure or retry rates between Zod-based and Pydantic-based validation.

## Q6. Dify self-hosting footprint (for a low-end on-prem server)

### Takeaway
The official minimum is 2 CPU cores and 4 GiB RAM, before any local LLM. The default Compose stack runs roughly 9 to 11 containers: api, worker, worker_beat, web, Postgres, Redis, a vector store (Weaviate by default, or pgvector), sandbox, ssrf_proxy, plugin_daemon and nginx. Most memory goes to the database and vector store.

### Cited Findings
- Minimum 2 CPU cores and 4 GiB RAM. Requires Docker plus Docker Compose v2.24.0 or later; run `docker compose up -d` from `docker/`, then go to `/install`. — [Dify README](https://github.com/langgenius/dify)
- The 4 GiB figure excludes a same-machine local LLM such as Ollama. Dify Enterprise Docker Compose is quoted at 4 cores, 16 GB and 100 GB (vendor or secondary page). — [ZimaSpace: Dify hardware requirements](https://shop.zimaspace.com/de/pages/dify-hardware-requirements)
- About 20 GB of disk is a practical start (images, Postgres, Redis, vectors, uploads, plugin and sandbox state, logs). Memory pressure comes mainly from the DB and vector store. — [ZimaSpace](https://shop.zimaspace.com/de/pages/dify-hardware-requirements); [SSD Nodes: self-host Dify on a VPS](https://www.ssdnodes.com/learn/lang/vi/self-host-dify-vps)
- **Services in different versions:**
  - Official self-host docs show ssrf_proxy, weaviate, worker_beat, api, worker, plugin_daemon, nginx, redis (redis:6-alpine), sandbox (dify-sandbox:0.2.12) and weaviate 1.27.0 starting.
  - A 1.15.0-derived template runs api, worker, worker_beat, web, postgres (pgvector reused as the vector store), redis, sandbox, ssrf_proxy and plugin_daemon behind an nginx gateway.
  - The older 0.6.9 layout was api, worker, web, db, redis, weaviate, sandbox, ssrf_proxy and nginx.

  — [Dify self-host docs](https://docs.dify.ai/en/self-host); [Dokploy Dify template](https://docs.dokploy.com/docs/templates/dify); [Feishu guide (0.6.9)](https://docs.feishu.cn/v/wiki/NYjPwXIaUiVtc4knC5Ccv0SsnHe/a7)
- v1.18.0 adds agent sandbox images that require auth tokens, and an optional KnowledgeFS that needs a separate database, migrations and signing keys. — [Dify releases](https://github.com/langgenius/dify/releases)

### Inferences
- On a low-end DSEW server already running Verity (Next.js plus Postgres), Dify would add about 10 containers and at least 4 GiB, roughly doubling the operational surface. That is a poor fit, separate from the license and logo constraints.
- Using pgvector instead of Weaviate cuts one container, but Dify would still need its own Postgres schema and Redis.

### Gaps
- No per-container RAM measurements found. The official current `docker/docker-compose.yaml` could not be fetched directly (domain blocked), so the exact v1.18.0 service list is unconfirmed.
