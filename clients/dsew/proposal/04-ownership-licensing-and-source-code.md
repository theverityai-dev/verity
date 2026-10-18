# Ownership, Licensing and Source Code

D & S Electric Works. Direct answers to section 5 of your enquiry.

> **Status of this document.** This states the principles we propose to write into the contract. The final wording
> is agreed with DSEW's counsel and ours. Where we offer a choice, we say so.

## 1. The short version

- **Your data is yours**, always, and you can export all of it in open formats at any time.
- **What we build specifically for DSEW is yours**: your configuration, numbering rules, templates, workflows,
  forms, reports, and the DSEW-specific code written under this contract.
- **The Verity platform** underneath (tenant isolation, permissions, audit, stock ledger, approvals, manufacturing
  and project foundations) is our product and is licensed to you, perpetually, for DSEW's use, with source access
  and continuity protections described below.
- **Nothing in the stack needs a paid licence.** The only recurring cost is the optional AMC.
- We do not use your confidential specifications, formats, prices or process knowledge for anyone else.

## 2. Who owns what

| Component | Owner | DSEW's rights |
|---|---|---|
| DSEW business data and uploaded documents | DSEW | Full ownership; export any time in open formats (structured data as JSON and CSV, files as original files) |
| DSEW configuration: numbering rules, templates, workflows, forms, roles, test and traveller formats, report layouts | DSEW | Full ownership, with documentation |
| DSEW-specific code written under this contract | DSEW | Ownership of the code and the right to modify it or have another developer do so |
| Verity platform core and reusable capabilities | [Company legal name] | Perpetual, non-exclusive licence to run and use for DSEW's own business at its sites; source access as in section 4 |
| Third-party open-source components | Their authors | Used under their own open-source licences, listed in a licence inventory delivered at handover |

**What "reusable capability" means.** If DSEW funds a capability that is general to manufacturers (for example,
a revision-controlled BOM), it becomes part of the platform and we may offer it to others. What we do not reuse,
copy or disclose is DSEW's data, drawings, specifications, prices, numbering and quality formats, and process
know-how. Those are covered by a mutual confidentiality agreement, which we will sign before receiving sensitive
material.

## 3. Your nine questions

| # | Your question | Our answer |
|---|---|---|
| 1 | Will the complete application source code be delivered to DSEW? | The DSEW-specific code, configuration and scripts are delivered in full. The platform source is available to DSEW under the source-access terms in section 4. |
| 2 | Will DSEW own the custom-developed code and IP? | Yes for DSEW-specific code and configuration. The platform core remains ours, licensed to you as above. |
| 3 | Can DSEW or another developer modify the code? | Yes for DSEW-owned code. For the platform, DSEW or a developer it appoints may modify it for maintaining DSEW's deployment under the source-access licence (section 4). |
| 4 | Can it be deployed and maintained without mandatory dependence on you? | Yes. Runbooks, scripts and documentation allow DSEW or another provider to install, back up, restore and operate it. You may choose our AMC but are not forced to. |
| 5 | Any proprietary frameworks, paid components or recurring licences? | No paid components. The stack is open source (for example PostgreSQL, Keycloak, Next.js, React and an S3-compatible store). A licence inventory is part of the handover. Optional external services (WhatsApp Business API, e-way bill provider, external AI services) have their own charges and are off unless you enable them. |
| 6 | Will you provide the schema, API docs, deployment scripts, config files and technical documentation? | Yes, all of them, versioned with each release. |
| 7 | Will the source be in a repository DSEW can access from the beginning? | Yes. A private repository for DSEW-specific work is shared with DSEW from day one, hosted on your organisation's account or an on-premises Git server if you prefer. |
| 8 | Will you hand over administrator credentials, deployment instructions and backup procedures? | Yes, using a signed handover checklist. Credentials are rotated at handover so we do not retain access you have not granted. |
| 9 | Do the licensing terms restrict the use of the solution to DSEW and prohibit resale of DSEW-specific implementation and confidential information? | Yes. DSEW's licence is for its own business. We will not resell or disclose DSEW-specific implementation or confidential information. The licence does not permit DSEW to resell the platform core to third parties. |

## 4. Source access and continuity for the platform

Because Verity serves other companies, we cannot transfer ownership of the platform core. We offer the following
protections so that DSEW is never stranded:

**Option A: source-access licence (included).** DSEW receives the platform source for the version it runs, with the
right to compile, modify and maintain it for its own deployment, and to have a contractor do so under
confidentiality. It may not redistribute or resell it.

**Option B: independent escrow (optional, indicative ₹1.5 lakh setup and ₹0.4 lakh a year).** The same material is
deposited with an independent escrow agent and released to DSEW if we cease trading, stop supporting the product, or
fail to cure a material breach within an agreed period.

We recommend Option A for DSEW because it gives the practical independence you asked for without an extra annual
fee. Option B is available if your counsel prefers a third-party release mechanism.

## 5. Continuity in practice

- Open-format export of all data and files at any time, including audit history.
- Runbooks for install, upgrade, backup, restore and troubleshooting, tested before handover.
- Database schema documentation, API documentation for interfaces implemented, and an architecture document.
- Another competent provider can take over using these materials.

## 6. Confidentiality and data protection

- Mutual NDA before any sensitive document is shared.
- DSEW data is processed on DSEW's own server. We do not copy it to our systems; any support access is by an
  audited, time-limited session with a stated reason that you can see.
- Personnel who work on DSEW data are bound by confidentiality.
- At the end of an engagement, we delete or return any DSEW material we hold and certify it.
