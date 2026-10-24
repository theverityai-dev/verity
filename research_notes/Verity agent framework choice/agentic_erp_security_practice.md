# In-product AI agents in ERP/business software: what vendors ship, security patterns, India data law, on-prem model feasibility, and reliability evidence (as of 2026-10-24)

Research scope: comparable products (Odoo, ERPNext/Frappe, SAP Joule, Microsoft Dynamics 365 / Copilot Studio, Zoho Zia, NetSuite); OWASP LLM / agentic guidance; India DPDP Act 2023 + DPDP Rules 2025; CPU-only local models; agent reliability benchmarks. Written for Verity (multi-tenant Indian SMB ERP; garment piece-rate client; engineering/fabrication client with a low-end on-prem server).

Source-quality note: several primary pages (odoo.com server-actions page, genai.owasp.org LLM01 page, anthropic.com) could not be fetched from this environment on a second attempt; where that happened the finding rests on search-result excerpts and is marked. Much vendor coverage is partner or press material, flagged inline.

---

## 1. What comparable products ship, and whether they act or only answer

### Takeaway
By late 2026 every major vendor ships something that **takes actions**, but the actions are narrow and controlled. The common pattern is: the agent runs **as the signed-in user, within that user's existing roles** (Frappe Assistant Core, NetSuite AI Connector, Copilot Studio "end-user credentials", SAP's "principal delegation" direction). Writes are either limited to specific tools (Odoo "Create Leads" topic) or **proposed for a human to approve** (Dynamics 365 Supplier Communications Agent, SAP, Zoho sensitive actions). Service or "maker" identities exist and are treated as a known oversharing risk that admins can switch off.

### Cited Findings

**Odoo 19 (released 2025)**
- Odoo 19 docs: the standard *Ask AI* agent "can answer questions, open views, and improve content"; responses can be sent as email, logged as a chatter note, or copied. The page says the default agent "cannot make changes to the database." — [Odoo 19 docs: AI](https://www.odoo.com/documentation/19.0/applications/productivity/ai.html)
- Custom agents are built from a System Prompt, **Topics** ("a collection of instructions and tools that define how an agent behaves within a specific context") and **Sources** (PDFs, web links, Documents files, Knowledge articles). Preconfigured topics: Natural Language Search, Information retrieval, and **Create Leads** (only when CRM is installed). "Tools extend the purpose of the agent beyond conversations, they enable real actions." An agent with no topics can only give information and cannot change the database. — [Odoo 19 docs: AI agents](https://www.odoo.com/documentation/19.0/applications/productivity/ai/agents.html)
- LLM providers: "Odoo supports multiple versions of both ChatGPT and Gemini"; the model is chosen per agent. An option, "Restrict to Sources", limits answers to uploaded sources. — [Odoo 19 docs: AI agents](https://www.odoo.com/documentation/19.0/applications/productivity/ai/agents.html)
- The agents page does **not** say how access rights apply to agent actions (gap below). Partner blogs describe AI server actions that run from a prompt (e.g., "Set status to 'Pending' if customer has not paid within 7 days"), AI fields in Studio, and AI-based lead creation from business cards. These are third-party descriptions, not Odoo documentation. — [Odoo Experts NL](https://www.odooexperts.nl/en_US/blog/blog-70/whats-new-in-odoo-19-296); [Silent Infotech](https://silentinfotech.com/blog/odoo-1/odoo-19-upgrade-guide-ai-features-latest-updates-release-plan-256)
- A third-party Odoo MCP vendor argues that Odoo's raw XML-RPC/JSON-RPC endpoints give an external agent "full CRUD over every model the connecting user can touch, with no per-agent scoping or human approval step", and sells a module with per-tool scoped permissions on top of Odoo access rights and record rules. This is vendor marketing. — [ECOSIRE Odoo AI agent MCP](https://ecosire.com/apps/odoo/odoo-ai-agent-mcp)

**ERPNext / Frappe**
- **Frappe Assistant Core (FAC)**, a community app (buildswithpaul), not a first-party Frappe Technologies product: an MCP server exposing about 22–24 tools. These include **write tools** (`create_document`, `update_document`, `delete_document`, `document_action`) and read tools (`get_document`, `list_documents`, `search_documents`, `generate_report`, `get_doctype_info`). — [GitHub: Frappe_Assistant_Core](https://github.com/buildswithpaul/Frappe_Assistant_Core)
- FAC authentication is OAuth 2.0 with PKCE ("the LLM never sees the user's Frappe password"). Each call is "scoped to the calling user's Frappe and ERPNext roles and permissions", and permissions are checked per call rather than cached. Every call goes to an **Assistant Audit Log** (caller, tool, arguments, result status). The README describes **no confirmation step before writes or deletes**. Licence AGPL-3.0 (dual licence available). Supports Frappe v15/v16. — [GitHub: Frappe_Assistant_Core](https://github.com/buildswithpaul/Frappe_Assistant_Core); [Frappe Cloud marketplace](https://cloud.frappe.io/marketplace/apps/frappe_assistant_core)
- No clearly official Frappe-branded ERPNext AI assistant turned up. A community announcement is titled "Raven v2: now with AI Agents" (Jan 2026; only the title was seen). Third-party apps include ChatNext, Caffyne and a 120-tool MCP server. — [discuss.frappe.io announcements](https://discuss.frappe.io/c/announcement/20); [Frappe Cloud: nextai](https://cloud.frappe.io/marketplace/apps/nextai)
- A separate "ERPNext MCP Server" project (different author) has its own doctype-, field- and operation-level permission manager in config files, so its model is not the same as FAC's act-as-user model. — [Glama: ERPNext MCP Server](https://glama.ai/mcp/servers/Sheikh-Muhammad-Mujtaba/ERP_Next-MCP)

**Microsoft Dynamics 365 / Copilot Studio**
- **Supplier Communications Agent (D365 Supply Chain Management)** reads supplier emails and PDF attachments. It detects quantity changes, line or full cancellations and unit-price changes, then matches each to the PO and line. It "summarizes the requested change, identifies the impacted purchase order and purchase order line, and flags it for approval when needed." The buyer "review[s] what the agent suggests, make[s] adjustments if needed, and approve[s] the action." Needs SCM 10.0.44+. A June 2026 partner post calls it a production-ready preview. — [Microsoft Learn: procurement agent overview](https://learn.microsoft.com/en-us/dynamics365/supply-chain/procurement/procurement-agent-supplier-com-overview); [Sikich](https://www.sikich.com/insight/from-inbox-chaos-to-proactive-procurement-meet-the-d365-finance-supply-chain-management-supplier-communications-agent/); [Logan Consulting](https://www.loganconsulting.com/blog/procurement-agent-in-dynamics-365-where-supplier-emails-stop-becoming-a-second-erp/)
  - This is the closest product analogue to the "supplier quote PDF" scenario: an untrusted document drives a proposed ERP change, and a human approves it before commit.
- Copilot Studio credentials: a maker can attach tools using **their own** credentials, so the agent then uses the maker's identity for every end user. Microsoft says this "could lead to oversharing of data or capabilities." Admins can restrict an environment to **End-user credentials** only. — [Microsoft Learn: configure no maker authentication](https://learn.microsoft.com/en-us/microsoft-copilot-studio/configure-no-maker-authentication)
  - GA dates for that control conflict across message-center notices (Sept 2025, Oct 2025, Aug 2026). — [RM566997](https://mc.merill.net/message/RM566997); [itelio MC1446172](https://www.itelio.com/en/microsoft-message-center/mc1446172)
- Roadmap RM570434: makers can require a human to **approve, approve for the session, or deny** specific tool calls, with requests shown in Teams/M365 Copilot; GA listed as **September CY2026** (not verified as shipped). — [RM570434](https://mc.merill.net/message/RM570434)

**SAP Joule**
- An SAP user-group security webcast (June/July 2026) describes two modes, agent acting **in the name of the human** and agent acting **on its own**. Its scoped authorization **intersects agent identity with human access** in the token (SAP Cloud Identity Services). Parts are labelled roadmap. — [SAP user group webcast PDF](https://assets.dm.ux.sap.com/sap-user-groups/pdfs/260616_security_webcast_in_july_sap_cloud_identity_services.pdf)
- A practitioner post reports that a Joule agent calling an MCP server today runs under a **service identity**, not the initiating user's. It says this weakens audit and authorization, and that identity propagation through agent layers "is still an open problem across the industry". The team requires explicit human approval for agent-initiated writes. — [Mindset Consulting](https://www.mindsetconsulting.com/building-joule-agents-that-actually-ship/)
- Sapphire coverage describes "Principal Delegation" (the agent works inside user permission boundaries, with read and write segmented) and says actions such as emailing a customer need human approval. — [SAPinsider](https://sapinsider.org/articles/sap-sapphire-joule-ai-agent-announcement-use-case/)
- SAPinsider frames the move from human-in-the-loop to "human-on-the-loop" supervision as needing "a significantly higher degree of organizational trust." — [SAPinsider roadmap](https://sapinsider.org/map/beyond-assistance-why-agentic-ai-is-the-definitive-roadmap-for-sap-joule/)

**Zoho Zia**
- Zia Agents and Agent Studio (no-code builder) were announced Feb 2025, with 25+ prebuilt agents in an Agent Marketplace by Zoho Day 2025. July 2025 added Zia LLM (Zoho's own model), MCP and a custom agent builder. — [YourStory, Feb 2025](https://yourstory.com/2025/02/zoho-launches-zia-agents-fuel-autonomous-ai-across-product-suite); [BusinessWire, Jul 2025](https://secure.businesswire.com/news/home/20250717118204/en/Zoho-Launches-Zia-LLM-and-Deepens-AI-Portfolio-with-Prebuilt-Agents-Custom-Agent-Builder-MCP-and-Marketplace)
- In Zoho CRM, an agent deployed as a **"Digital Employee"** has its own identity: "every action the Digital Employee takes, whether updating records, assigning owners, or sending emails, is tracked under its identity." This is a **service-identity** model, the opposite of act-as-user. — [Zoho community](https://help.zoho.com/portal/ja/community/topic/zia-agents-in-zoho-crm-a-better-way-to-set-up-digital-employees?page=1)
- A third-party guide says permissions decide which actions run automatically and which need human approval; Zoho's own documentation was not found. — [CRMOZ](https://www.crmoz.com/blogs/post/zoho-crm-ai-automation-in-2026-build-your-first-zia-agent-step-by-step)
- India relevance: Zoho is an Indian vendor with its own LLM, so it is a direct competitor for Indian SMB buyers (inference, not sourced beyond the launch release).

**Oracle NetSuite**
- The NetSuite AI Connector Service / MCP **blocks the Administrator role and other full-access roles**: "You cannot use the AI Connector Service while signed in with one of those roles." A dedicated role needs MCP Server Connection, OAuth 2.0 access tokens, REST Web Services and Perform Search. The AI "inherits the limits of the connected role", and each user authenticates with their own NetSuite account. — [Oracle developers blog](https://blogs.oracle.com/developers/post/talking-to-your-erp-netsuite-meets-claude-via-mcp); [Dust docs: NetSuite](https://docs.dust.tt/docs/netsuite); [Anchor Group](https://www.anchorgroup.tech/blog/netsuite-mcp-connector)

### Inferences
- Two identity models compete. **Act-as-user**: Frappe FAC, NetSuite, Copilot Studio end-user credentials, SAP's direction. **Agent-as-its-own-principal**: Zoho Digital Employee, the current SAP MCP path, Copilot maker credentials. Security-minded vendors (Microsoft, NetSuite, SAP) are adding controls that **push toward act-as-user**, or toward an intersection of agent scope and user scope. Verity's ADR-017 (agent executes as the calling human's own `ActorContext`, no agent-specific authority path) matches the safer end of the market.
- Products that write data either keep writes to a small set of named tools (Odoo topics) or produce a **proposal a human approves** (D365 supplier agent). None of the sources shows a mainstream ERP letting an agent post financial or production transactions autonomously by default.
- FAC shows the minimum bar: act-as-user, per-call permission check, an audit row per call. It also shows a common gap, **no write confirmation**, which Verity should not copy.

### Gaps
- Odoo 19: how access rights and record rules apply to agent tools and AI server actions. The server-actions page could not be fetched, and the agents page does not say.
- NetSuite's first-party "NetSuite Next" / in-product AI agents (not just the MCP connector): no primary source found.
- Zoho Zia approval configuration: no first-party documentation found.
- SAP Joule: whether principal propagation to MCP has reached GA (sources call it roadmap).

---

## 2. Security and authorization patterns for tool-using agents

### Takeaway
OWASP's guidance (LLM Top 10 2025, plus the agentic Top 10 / threats work) agrees with vendor practice. **Prompt injection cannot be reliably prevented, so you limit what an injected model can do.** That means minimal and granular tools, execution in the user's own context, **authorization enforced in the downstream system and never decided by the LLM**, human approval for high-impact actions, and logging and rate limits as damage control. Real exploits (EchoLeak in M365 Copilot, ForcedLeak in Salesforce Agentforce) came from **untrusted business data** (an email, a web-to-case form) steering an agent that held privileged access.

### Cited Findings

**OWASP LLM06:2025 Excessive Agency (primary page)**
- Definition: the vulnerability that "enables damaging actions to be performed in response to unexpected, ambiguous or manipulated outputs" from an LLM. Root causes: **excessive functionality, excessive permissions, excessive autonomy**. — [OWASP LLM06:2025](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)
- Example scenarios: a read-only use case wired to an extension that can also modify or delete; an extension that acts for users but "uses a generic high-privileged identity" that can reach all users' files; deletion without confirmation; and an email assistant whose send function is triggered by a **malicious inbound email** (indirect prompt injection). — [OWASP LLM06:2025](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)
- Mitigations, verbatim headings:
  1. Minimize extensions.
  2. Minimize extension functionality.
  3. "Avoid open-ended extensions" (e.g., a file-write tool rather than a shell).
  4. Minimize extension permissions.
  5. **"Execute extensions in user's context"**: actions run "on downstream systems in the context of that specific user", with minimum-scope OAuth.
  6. **"Require user approval"**: "Utilise human-in-the-loop control to require a human to approve high-impact actions before they are taken."
  7. **"Complete mediation"**: implement authorization in downstream systems "rather than relying on an LLM to decide if an action is allowed or not."
  8. Sanitise inputs and outputs (ASVS, SAST/DAST/IAST).

  Damage-limiting measures that do not prevent the problem: logging and monitoring, and rate limiting. — [OWASP LLM06:2025](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)
- Secondary sources map LLM06 to CWE-250/CWE-269 and to A01 Broken Access Control. — [ByteHide](https://docs.bytehide.com/products/radar/sast/owasp/llm06-2025); [Openlayer, Jul 2026](https://www.openlayer.com/blog/post/owasp-llm-application-security-testing)

**OWASP LLM01:2025 Prompt Injection** (primary page not fetchable here; content from training knowledge, corroborated only by secondary sources)
- Secondary coverage: prompt injection (LLM01) is the trigger and excessive agency (LLM06) the amplifier. "When agents operate with overly broad permissions, or without approval gates for sensitive operations, a single prompt injection, hallucination, or unexpected output can trigger destructive actions at scale." — [Invicti](https://www.invicti.com/blog/web-security/owasp-top-10-risks-llm-security-2025); [Aembit](https://aembit.io/blog/owasp-top-10-llm-risks-explained/)

**OWASP agentic guidance (Agentic AI Threats & Mitigations; Top 10 for Agentic Applications, ASI01–ASI10)** (secondary sources only)
- **Tool misuse (T2 / ASI02)**: legitimate tools used in unsafe ways, leading to data leakage or workflow compromise. **Identity & privilege abuse (T3 / ASI03)**: credential reuse from memory, **confused-deputy** trust exploitation, access through delegation chains, and a low-privileged agent used to drive a high-privileged one. **ASI07** covers insecure inter-agent communication (spoofing, tampering). — [Kratikal](https://kratikal.com/blog/top-ten-owasp-risk-for-agentic-applications/); [HUMAN Security](https://www.humansecurity.com/learn/blog/owasp-top-10-agentic-applications/); [Palo Alto Networks](https://www.paloaltonetworks.com/blog/network-security/palo-alto-networks-owasp-collaborate-to-secure-ai-agents.md)
- Recommended controls: scoped credentials, **per-action authorization**, sandboxing, runtime monitoring, and containing how far one bad decision can spread. — [Fidelis Security](https://fidelissecurity.com/cybersecurity-101/threats-and-vulnerabilities/owasp-agentic-ai-threats/)

**Real incidents: injection through business data**
- **EchoLeak (CVE-2025-32711, M365 Copilot)**: a zero-click prompt injection through "a single crafted email" enabled remote, unauthenticated data exfiltration. It bypassed Microsoft's XPIA classifier, evaded link redaction with reference-style Markdown, abused automatic image pre-fetch, and routed data through an allow-listed Teams preview API. Microsoft patched it server-side; no in-the-wild exploitation was reported. — [arXiv 2509.10540](https://arxiv.org/html/2509.10540v1)
- **ForcedLeak (Salesforce Agentforce, patched Sept 2025)**: a Salesforce-specific variant built on EchoLeak primitives. Related Zenity research shows attackers planting instructions through **unauthenticated Web-to-Case / Email-to-Case forms** that become CRM records. — [The Hacker News](https://thehackernews.com/2025/09/salesforce-patches-critical-forcedleak.html); [Zenity](https://zenity.io/blog/security/zero-click-attacks-when-ttps-resurface-across-platforms)
- Sentra argues the attack class is not eliminated by patching one CVE. — [Sentra](https://sentra.io/blog/copilot-echoleak-prompt-injection)

**Protocol-level confirmation (MCP)**
- MCP tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) are **hints, not enforcement**: "Not all clients read or respect them. They complement—but do not replace—the access control and human-in-the-loop strategies." With no annotations, a tool is assumed potentially destructive (`destructiveHint` defaults true). — [Stanza MCP fundamentals](https://www.stanza.dev/courses/mcp-fundamentals/tools/mcp-fundamentals-tool-annotations); [Nuxt MCP toolkit](https://mcp-toolkit.nuxt.dev/tools/annotations)
- LangChain's MCP adapter can interrupt a run for approval before a flagged call executes. — [LangChain docs](https://docs.langchain.com/oss/python/langchain/mcp/tools)

**Vendor control patterns (from section 1)**
- NetSuite refuses admin/full-access roles for AI. Copilot Studio can force end-user credentials. D365 supplier agent proposes and the buyer approves. FAC logs every call with arguments. — sources in section 1.

**Confidentiality behaviour of agents**
- CRMArena-Pro found leading agents have "almost no built-in confidentiality awareness". Prompting improved refusal of sensitive data "often at the expense of task success". — [The Register](https://www.theregister.com/2025/06/16/salesforce_llm_agents_benchmark/); [LessWrong abstract repost](https://www.lesswrong.com/posts/gmYaYqeFBJHqgmnJh/crmarena-pro-holistic-assessment-of-llm-agents-across)

### Inferences
- Mapping to the controls requested for Verity:
  - **Act with the user's own permissions**: OWASP LLM06 #5 and NetSuite/FAC/Copilot practice. Already constitutional in Verity (ADR-017, `enforcePolicy()`).
  - **Server-side tenant context, never from the model**: this is OWASP "complete mediation" (#7) applied to tenancy. It matches Verity's PLA-TEN-006. Tool schemas exposed to the model should not include `tenantId`/`organizationId` parameters at all, so there is nothing to inject.
  - **Human confirmation for consequential actions**: OWASP #6, D365 supplier agent, SAP, MS RM570434. Natural Verity shape: the agent produces a *proposed Command*, the user confirms it in the UI, and the existing Command path executes it.
  - **Audit**: OWASP lists logging only as damage control, not prevention. Recording `channel: "agent"` plus prompt or tool-call provenance (as FAC logs tool arguments) is the norm.
  - **Prompt injection via supplier PDFs, emails or WhatsApp text** is the realistic threat for Indian SMB manufacturing. EchoLeak and ForcedLeak both entered through ordinary inbound business content. Any agent that reads supplier quotes, challans or customer messages should hold **no write tools in the same turn without confirmation**, and **no outbound channel** (email/URL/image rendering) that could leak data.
  - **Idempotency keys** are not mentioned in the OWASP excerpts retrieved. They are a general distributed-systems control (LLM retries and duplicate tool calls). See gaps.
- Granular, purpose-built tools (e.g., `propose_lot_receipt(lotId, qty)`) beat a generic `update_document` / CRUD tool (FAC's design) under OWASP #2/#3 ("avoid open-ended extensions").

### Gaps
- OWASP LLM01:2025 primary text was not fetched (domain blocked on second request). Mitigation wording for LLM01 (segregate external content, privilege control, human approval, adversarial testing) is from training knowledge and should be verified at genai.owasp.org/llmrisk/llm01-prompt-injection/.
- The exact T-numbered OWASP *Agentic AI Threats and Mitigations* document (T1–T15) was not retrieved; only secondary ASI-numbered summaries were.
- No authoritative source found tying **idempotency keys** to LLM-agent tool calls specifically. The recommendation is engineering practice, not OWASP-sourced.

---

## 3. India: DPDP Act 2023 and DPDP Rules 2025 (external LLM APIs, residency)

### Takeaway
The DPDP Rules were notified **13 November 2025** with a staggered start. Most fiduciary obligations (notice, security safeguards, breach response, and per most sources the cross-border rules) apply from **13 May 2027**. Cross-border transfer is **permissive by default** (allowed unless the government blacklists a country), so sending employee or business personal data to a foreign LLM API is not prohibited per se. The fiduciary (Verity's client, with Verity likely a processor) stays liable, and the LLM vendor must be engaged under a valid processor contract. India-region options now exist (OpenAI storage residency since May 2025; Claude in-country inference via Amazon Bedrock reported Aug–Oct 2026).

### Cited Findings
- DPDP Rules 2025 notified 13 Nov 2025. Consent-manager rules (Rule 4) apply from 13 Nov 2026. The main obligations have an 18-month runway to **13 May 2027**. — [SS Rana](https://ssrana.in/articles/meity-notifies-final-digital-personal-data-protection-rules-2025/); [Hogan Lovells](https://www.hoganlovells.com/en/publications/indias-digital-personal-data-protection-act-2023-brought-into-force-); [BDO India PDF](https://www.bdo.in/getmedia/87552494-85d2-4edb-95da-0f118fdb3052/The-DPDP-Rules_BDO-India_2025.pdf); [Wikipedia: DPDP Rules 2025](https://en.wikipedia.org/wiki/Digital_Personal_Data_Protection_Rules,_2025)
  - **Conflict**: one Mondaq item says cross-border provisions applied immediately on 13 Nov 2025. Hogan Lovells and BDO place them in the May 2027 phase. The latter is more consistent; verify against the Gazette. — [Mondaq](https://www.mondaq.com/india/data-protection/1708164/digital-personal-data-protection-rules-2025-notified)
- Cross-border: transfers are generally allowed. The Central Government may restrict transfer to specified countries by notification (Rule 15 per one source). **Significant Data Fiduciaries** have an extra limit (Rule 13(4), traffic data), and stricter sectoral laws still apply. — [Truyo](https://truyo.com/?p=8832); [TCSA roadmap](https://www.tcsa.in/resources/dpdp-rules-2025-implementation-roadmap)
- Section 8(1): the Data Fiduciary is responsible for processing done on its behalf "regardless of any agreement to the contrary". Section 8(2) requires a valid contract before engaging a processor. Suggested terms: security safeguards, breach notification, data-principal requests, **sub-processors, retention, erasure**. — [Captain Legal](https://www.captain.legal/in/blog/dpdp-data-protection-clauses-india/); [miniOrange](https://www.miniorange.com/blog/data-fiduciary-obligations-dpdp-act/)
- Section 7(i) "employment purposes" is a legitimate use, but commentators read it narrowly (e.g., background verification is not automatically covered; blanket monitoring clauses may be void). The Act does not recognise "contractual necessity" as a basis. — [Khurana & Khurana](https://khuranaandkhurana.com/?p=14660); [LiveLaw](https://www.livelaw.in/articles/employment-surveillance-clauses-void-dpdp-regime-539957); [ELP Law PDF, Mar 2026](https://elplaw.in/wp-content/uploads/2026/03/Your-contract-is-not-a-consent-form-DPDP-Act-and-the-deliberate-rejection-of-contractual-necessity.pdf)
- **OpenAI** extended data residency to India in **May 2025** for ChatGPT Enterprise/Edu and the API. API users pick the storage country when creating a project. Reports describe storage; they do not clearly say inference runs in India. — [Inc42](https://inc42.com/buzz/openai-enables-local-data-storage-in-india); [ICAI AI article](https://ai.icai.org/articles_details.php?id=235)
- **Anthropic Claude**: in-country inference in India via **Amazon Bedrock** India endpoint ("processed on servers located within the country"), reported available Aug 2026 and launched per a 5 Oct 2026 report. Reliance and CRED were named as private-preview customers. Sources disagree on exact timing. — [Business Today, 4 Aug 2026](https://www.businesstoday.in/technology/artificial-intelligence/story/anthropics-claude-ai-is-now-built-for-india-ai-model-now-supports-local-data-processing-why-it-matters-547033-2026-08-04); [NewsBytes](https://www.newsbytesapp.com/news/science/anthropic-starts-processing-claude-ai-requests-within-india/story); [YourStory](https://yourstory.com/ai-story/claude-ai-runs-locally-india-amazon-bedrock)
- One press report claims DPDP "mandates that certain categories of personal data be stored and processed within the country". **This conflicts** with the blacklist-based transfer rule described by law-firm sources, and is probably conflating DPDP with sectoral rules (e.g., RBI payment-data localisation). — [Outlook Business](https://www.outlookbusiness.com/deeptech/anthropics-claude-ai-to-process-data-within-india-why-it-matters-for-banks-govt-and-businesses) vs [Truyo](https://truyo.com/?p=8832)

### Inferences
- For Verity's clients (garment piece-rate workers' names, wages, attendance; engineering firm employees), employee personal data sent to an LLM API is DPDP-covered processing. Verity probably acts as the client's **processor**, and the LLM vendor becomes a **sub-processor**. That needs contract terms (no training on data, retention, deletion, breach notice) and disclosure in the client's notice from May 2027.
- **Data minimisation to the model** (send IDs, quantities and aggregates; resolve names server-side; do not send Aadhaar, phone or bank details) cuts DPDP exposure without needing residency. India-region endpoints are a further, procurement-level option.
- Purely business data (lot quantities, BOMs, rates without names) is not personal data under DPDP, though client confidentiality still matters.

### Gaps
- MeitY's Gazette text and FAQs were not fetched directly. Rule numbers (13(4), 15) and the cross-border phase date come from law-firm summaries.
- No source found addressing LLM API vendors specifically under DPDP (training-on-data, model-provider-as-processor). Secondary commentary searched returned nothing AI-specific.
- Primary OpenAI/Anthropic/AWS documentation on India residency scope (storage vs inference, which endpoints) was not retrieved; press only.

---

## 4. Local/on-prem models on modest hardware (CPU-only, 16–32 GB RAM)

### Takeaway
A CPU-only server with 16–32 GB RAM can run **3–4B models at about 7–20 tokens/s** and **8–12B models at about 5–10 tokens/s** (Q4 quantisation, llama.cpp/Ollama). Measured and estimated figures vary by roughly 2–3x with build, CPU and memory bandwidth. RAM is not the binding constraint (4B ≈ 4–5 GB, 12B ≈ 9–12 GB); **speed and multi-turn tool-calling reliability are**. Small Qwen3 models score in the mid-90s on simple single-call function-calling tests but around **20% on BFCL multi-turn**. A local model is therefore viable for drafting, extraction and classification behind a deterministic workflow, not for autonomous multi-step agents.

### Cited Findings
- Intel i5-12400 + DDR4-3200, Ollama, Q4_K_M (third-party guide, ±20%): ~15 tok/s Qwen 3.5 4B; ~8 tok/s Granite 4.2 8B; ~6 tok/s Qwen 3.5 9B. Note these are Qwen 3.5, not Qwen3. — [bestllmfor.com CPU guide](https://bestllmfor.com/guide/llm-local-cpu-sans-gpu/)
- OpenBenchmarking.org llama.cpp CPU BLAS, **Qwen3-8B Q8_0** text generation: ~7.2 tok/s on build b6401 vs ~19.7–19.9 tok/s on build b7083. The hardware is not named in the snippet, and the jump between builds is large. — [OpenBenchmarking 2511187](https://mail.openbenchmarking.org/result/2511187-PTS-LLAMACPP54); [OpenBenchmarking 2509066](https://mail.openbenchmarking.org/result/2509066-NE-LLAMACPPW32&grr&export=html)
- Measured on Linux CPU-only with Ollama: Phi-4 Mini 3.8B **6.90 tok/s**; Qwen3 0.6B ~34–36 tok/s. — [It's FOSS](https://itsfoss.com/testing-local-llms-without-gpu)
- Gemma 3 Ollama download sizes: 4B 3.3 GB, 12B 8.1 GB. Calculator estimates with 8K context: 4B ~4.4 GB RAM / ~21 tok/s; 12B ~11.1 GB / ~7.5 tok/s (estimates). Another guide says "several seconds per token" for 12B on CPU, which **contradicts** that estimate. — [zazencodes Gemma 3 guide](https://zazencodes.substack.com/p/ultimate-gemma-3-guide-testing-1b); [llmconfigurator 32 GB](https://llmconfigurator.com/en/can-i-run/gemma-3-on-32gb-ram)
- Low-end ARM reference: Qwen3-32B on an Orion O6 board CPU ≈ 4 tok/s prompt processing / 2 tok/s generation, so large models are impractical on CPU. — [Radxa forum](https://forum.radxa.com/t/llama-cpp-benchmarks/27813)
- Tool calling: an arXiv paper (Aug 2026) reports Qwen3-4B and Qwen3-8B in thinking mode at ~96% on BFCL non-live parallel categories, with non-thinking slightly lower. — [arXiv 2608.22472](https://arxiv.org/pdf/2608.22472)
- Qwen3-4B-Instruct-2507 (prompt mode): BFCL Non-Live AST **86.4%** vs **multi-turn 20.5%**. — [benchmarklist: Qwen3-4B-Instruct-2507](https://benchmarklist.com/models/qwen3-4b-instruct-2507-2/); [benchmarklist BFCL v3 multi-turn](https://benchmarklist.com/benchmarks/bfcl_v3_multiturn/)
- Failure modes of models without tool-call training: skipped required parameters, invented functions, broken JSON (blog claim, not a controlled study). — [jacar.es](https://jacar.es/en/open-models-with-tool-calling/)

### Inferences
- On a fabrication firm's low-end on-prem server, a 4B model at ~10–15 tok/s produces a 150-token draft (e.g., a job summary, a reply to a supplier) in about 10–15 s, plus prompt processing, which is slower again on CPU for long contexts. That is acceptable for a single-shot "draft/explain" button and poor for multi-turn agents that loop over tools.
- Multi-turn tool-call accuracy of ~20% for a 4B model means it should not choose and sequence ERP commands. Constrain it to one structured output (JSON schema / grammar-constrained decoding in llama.cpp) feeding a deterministic Verity command proposal.
- **Hybrid** (data stays on-prem, minimised or redacted context goes to an external API for harder reasoning) is the obvious pattern, but no source in this pass measured how common it is (gap). Project memory records an owner decision of "no local LLM on-prem" for DSEW Mode B (Task 129). This research supports that decision on cost and reliability grounds, but the caller should reconcile it with the brief rather than reopen it silently.

### Gaps
- No clean, same-hardware CPU-only benchmark of Qwen3-4B/8B or Gemma 3 4B/12B on a typical low-end Xeon/i3 server with DDR4 was found. All figures are mixed-hardware or estimated. Run `llama-bench` on the actual DSEW server.
- No same-setup 4B vs 8B **multi-turn** BFCL comparison found; no tau-bench numbers for small local models found.
- Prompt-processing (prefill) speed on CPU for long ERP contexts (e.g., a 4K-token supplier PDF) was not measured in any source found. It is often the real bottleneck on CPU.
- How common hybrid on-prem + external-API deployments are in SMB ERP: no survey or vendor data found.

---

## 5. Reliability evidence, and the case for deterministic workflow + LLM drafting

### Takeaway
Benchmarks of agents on realistic business tasks show **mediocre single-run success and much worse consistency**. In tau-bench, GPT-4o's pass^1 was ~61% on retail but pass^8 only ~25%. In CRMArena-Pro, leading agents reached ~58% single-turn and ~35% multi-turn success, with almost no confidentiality awareness. Anthropic's widely cited guidance is to use the simplest solution, prefer predefined workflows for well-defined tasks, and add agents only where flexibility pays for the extra cost and compounding errors. Together these support "deterministic workflow, with the LLM drafting, extracting and explaining" for ERP actions.

### Cited Findings
- **tau-bench** (Sierra, arXiv 2406.12045, June 2024): the best agent (GPT-4o) achieved "under 50% average success rate across the two domains". Retail pass^1 **61.2%**, pass^2 ~49%, pass^4 ~37%, **pass^8 ~25%**. Airline pass^1 35.2% in the paper (leaderboard later lists 42.0%). pass^k = probability that all k i.i.d. trials of the same task succeed. The leaderboard is frozen at late-2024 models; tau2-bench is the successor. — [Sierra blog](https://sierra.ai/de/blog/tau-bench-shaping-development-evaluation-agents); [benchmarkingagents.com](https://benchmarkingagents.com/tau-bench-retail-airline); [Steel leaderboard](https://leaderboard.steel.dev/registry/benchmarks/tau-bench)
- **CRMArena-Pro** (Salesforce AI Research, mid-2025): 4,280 tasks, 19 business activity types, 3 data-protection categories. Leading agents ~**58% single-turn**, **~35% multi-turn**. Workflow execution was the strongest skill (Gemini 2.5 Pro **83%** on case routing). Nearly half of Gemini 2.5 Pro's multi-turn failures came from not asking for crucial information. Confidentiality improved only with explicit prompting, at a cost to task success. o3 was not evaluated. — [The Register, 16 Jun 2025](https://www.theregister.com/2025/06/16/salesforce_llm_agents_benchmark/); [LessWrong abstract](https://www.lesswrong.com/posts/gmYaYqeFBJHqgmnJh/crmarena-pro-holistic-assessment-of-llm-agents-across); [The Decoder](https://the-decoder.com/salesforces-crm-benchmark-finds-ai-agents-struggle-in-real-world-business-scenarios/); [ppc.land](https://ppc.land/salesforce-study-reveals-enterprise-ai-agents-fail-65-of-multiturn-tasks/)
- **Anthropic, "Building effective agents"** (Dec 2024): distinguishes **workflows** ("LLMs and tools are orchestrated through predefined code paths") from **agents** (the LLM "dynamically direct[s] [its] own processes and tool usage"). It advises "finding the simplest solution possible, and only increasing complexity when needed", which "might mean not building agentic systems at all". Agentic systems "trade latency and cost for better task performance". Workflows offer "predictability and consistency for well-defined tasks". Start with direct LLM APIs before frameworks. (Primary page not fetchable here; wording from search excerpts and summaries.) — [Anthropic](https://www.anthropic.com/research/building-effective-agents); [mer.vin summary, May 2026](https://mer.vin/2026/05/when-not-to-build-ai-agents-anthropics-workflow-vs-agent-playbook/); [Cobus Greyling](https://cobusgreyling.substack.com/p/anthropics-research-on-genai-building)
- Practitioner reading of tau-bench: structure agent systems around **irreversible actions** (blog). — [Medium, S. Dutta](https://medium.com/@duttasaswata7/structuring-multi-agent-systems-around-irreversible-actions-lessons-from-tau-bench-defe0f139eda)
- Vendor practice matches this. The D365 supplier agent's job is **extraction, matching and proposal**, with the buyer approving. SAP and practitioners require approval for agent writes. — sources in section 1.

### Inferences
- pass^k is the right lens for ERP. A wage posting or lot handover that is right 61% of the time on one attempt and consistent across 8 runs only 25% of the time cannot be autonomous. Verity's deterministic Command/State runtime (preconditions, state machines, `enforcePolicy()`) should do the doing. The LLM's role is: (a) turn a supplier PDF, voice note or chat message into a **proposed** structured command; (b) explain state ("why is lot 42 blocked?") from read-only queries; (c) draft text (challan notes, supplier replies) for human send.
- CRMArena-Pro's best score was on workflow execution (83% for routing): LLMs do best on narrow, well-scoped steps inside a known workflow. That again favours LLM-inside-workflow over open-ended multi-agent setups.
- These benchmarks use frontier models. Small local models (section 4) would score lower, which strengthens the case for the deterministic-workflow shape on the on-prem client.

### Gaps
- No 2026 enterprise-agent benchmark results were found (e.g., tau2-bench or CRMArena-Pro with 2026 frontier models). The figures above are 2024–2025 models, and current models likely score higher. Date them when citing.
- No published success-rate evidence specific to manufacturing ERP tasks (production, piece-rate wages, inventory) was found.
- No controlled study directly comparing "deterministic workflow + LLM" against autonomous multi-agent on the same ERP tasks was found. The argument rests on benchmark failure rates, vendor practice and Anthropic's guidance.
