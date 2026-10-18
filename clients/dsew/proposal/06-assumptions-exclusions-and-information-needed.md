# Assumptions, Exclusions and Information We Need

D & S Electric Works. What we assumed, what is outside Phase 1, and the inputs we need.

> **Status: DRAFT, pending company approval.**

## 1. Assumptions

1. **Users.** Up to 15 named users, one site (Rau, Indore), local network.
2. **Language.** English only in Phase 1.
3. **Scope.** Exactly the Phase 1 list in section 2 of the Commercial Proposal. Anything else is a change request or a
   future phase.
4. **Accounting.** Tally Prime is untouched. Phase 1 has no accounting integration.
5. **Server.** A Linux VM under Hyper-V on Windows Server 2019, or a small dedicated host, confirmed after the survey.
6. **Network.** Gigabit LAN, reachable time source and DNS; remote access through DSEW's VPN.
7. **DSEW participation.** A product owner and department leads available about three to four hours a week; decisions
   within five working days.
8. **Samples.** DSEW supplies representative documents in week 1.
9. **Numbering.** DSEW supplies its convention; otherwise we propose one and DSEW approves.
10. **Data.** Customer, supplier and item masters are available as spreadsheets.
11. **Open source.** Third-party components stay available under their open-source licences.

## 2. Exclusions from Phase 1

- **Tally Prime integration: excluded and deferred; DSEW's written acceptance required.**
- Every module or depth marked "future phase" in the Technical Proposal, including AI, Hindi, payroll, MRP,
  traceability, full quality system, contracts and risk, procurement and inventory extensions.
- E-way bill, WhatsApp, attendance-device integration, customer portal.
- Historical transaction migration.
- Hardware, networking, UPS, operating-system licences, barcode devices and the Tally licence.
- GST on fees (18%).
- Support after the warranty period (an AMC is quoted separately).
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
