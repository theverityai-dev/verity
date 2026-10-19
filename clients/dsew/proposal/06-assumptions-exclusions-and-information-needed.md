# Assumptions, Exclusions and Information We Need

D & S Electric Works. What we assumed, what is outside Phase 1, and the inputs we need.

> **Status: NEGOTIATION DRAFT, pending company approval.** This document is the master list of dependencies and
> exclusions; it must not contradict documents 1 to 4.

## 1. Assumptions

1. **Users.** Up to 15 named users, one site (Rau, Indore), local network.
2. **Language.** English only in Phase 1.
3. **Scope.** Exactly the Phase 1 list in section 2 of the Commercial Proposal. Anything else is a change request or a
   future phase.
4. **Accounting.** Tally Prime is untouched. Phase 1 has no accounting integration.
5. **Environments.** One Linux VM on a DSEW-provided host, installed in sprint 1, used for UAT and then, after the
   go-live gates pass, as production. The company hosts a separate environment for sprint demonstrations. A second,
   separate production VM is not included and would be a change request. DSEW provides and administers the host
   (Hyper-V role or a small dedicated server); this is confirmed after the survey and **has not been tested on Windows
   Server 2019**. Any new infrastructure figure is an indicative planning estimate until the survey is done.
6. **DSEW provides:** the host resources, TLS certificates, internal DNS, VPN access, backup storage, and a network
   administrator contact.
7. **Data export.** Phase 1 includes one documented export of records (CSV) and files (original form, with an index) at
   handover and once more on request during warranty.
8. **Fixes and changes.** Defects against the signed specification are corrected under the warranty. New features and
   changes are quoted separately and approved in writing before work starts. The warranty period and payment term are
   open company decisions.
9. **Travel.** Remote delivery is assumed apart from the survey visit; other on-site attendance is quoted separately
   unless the company decides otherwise.
10. **DSEW participation.** A product owner and department leads available about three to four hours a week; decisions
   within five working days.
11. **Samples.** DSEW supplies representative documents in week 1.
12. **Numbering.** DSEW supplies its convention; otherwise we propose one and DSEW approves.
13. **Source data.** Customer, supplier and item masters are available as spreadsheets.
14. **Open source.** Third-party components stay available under their open-source licences.

## 2. Exclusions from Phase 1

- **Tally Prime integration: excluded and deferred; DSEW's written acceptance required.**
- Every module or depth marked "future phase" in the Technical Proposal, including AI, Hindi, payroll, MRP,
  traceability, full quality system, contracts and risk, procurement and inventory extensions.
- E-way bill, WhatsApp, attendance-device integration, customer portal.
- Historical transaction migration.
- Hardware, networking, UPS, operating-system licences, barcode devices and the Tally licence.
- GST on fees (18%).
- Support after the warranty period; no AMC or support commitment is included.
- Features, workflow changes and add-ons requested after testing (quoted separately).
- A second production VM or staging environment; travel and on-site days beyond the survey visit unless the company decides otherwise.
- Escrow or source-access arrangements (unresolved; see document 4).
- Independent penetration testing.
- DSEW staff time.

## 3. Dependencies on DSEW

| Dependency | Needed by |
|---|---|
| Nominated product owner and department leads | Start |
| Sample documents and formats | Week 1 |
| Server survey answers and a non-intrusive visit | Week 1 |
| Decisions on numbering, release authority and test templates | End of week 1 |
| Written acceptance of the Tally Prime exclusion | Before the order is confirmed |
| Agreement on source-code, platform-licence and IP terms (document 4 is unresolved) | Before the order is confirmed |
| Host resources, TLS certificates, internal DNS, VPN access, backup storage | Sprint 1 |
| UAT participants and scenarios | Two weeks before go-live |

## 4. Information we need

### Business and process
1. A walk-through of one recent job from enquiry to dispatch.
2. Your document numbering convention for drawings, BOMs, quotations and test reports.
3. Who drafts, reviews, approves and releases drawings, BOMs and test records; is self-approval ever allowed?
4. How revisions are handled today and what has gone wrong.

### Samples (anonymised if needed)
A drawing, a released BOM, a quotation, a manufacturing traveller, a test report or certificate, a packing list and a
delivery challan.

### Quality
1. The tests per product family (up to 3 for Phase 1) and acceptance limits.
2. How test instruments and calibration are tracked today.

### Infrastructure survey (no changes made)
1. Server make, model, OS edition and exact build, CPU, RAM, free storage, current workloads.
2. Is Hyper-V available and licensed, and is a dedicated Linux VM permitted?
3. LAN only, or remote access over VPN; who administers the network.
4. Do shop-floor phones reach the internal server name over HTTPS and trust its certificate?
5. Backup destination, IT owner, acceptable recovery time and data-loss window.
6. Outbound-network policy; UPS capacity.

### Commercial
1. Target start date and any fixed deadline.
2. Contract signatory, NDA process and counsel contact.

## 5. Decisions in week 1

| Decision | Why it matters |
|---|---|
| Document numbering convention | Identifies every record |
| Release authority and separation of duties | Controls who releases BOMs, documents and tests |
| Test templates for up to 3 product families | Sets the structured testing scope |
| Server approach | Determines installation plan |
