# Assumptions, Exclusions and Information We Need

D & S Electric Works. This document keeps the proposal honest: what we assumed, what is outside it, and the short
list of inputs that lets us fix dates and prices.

## 1. Assumptions

1. **Users.** Up to 50 named users and 20 concurrent, one site (Rau, Indore), on the local network.
2. **Languages.** English in Phases 1 to 4. Hindi labels and Devanagari print templates in Phase 5.
3. **Scope.** The 19 modules A to S in your enquiry. Depth within each module is fixed by the signed SRS.
4. **Traceability depth.** Baseline: lot or heat number and supplier certificate on materials, which lots were issued
   to which job, a unique identity per finished unit, and key coil, conductor, winding, impregnation, assembly and
   test records. Complete sub-component genealogy of every part is outside the baseline and is quoted if you want it.
5. **Accounting.** Tally Prime remains the accounting system. Verity records operational data and statuses and
   never posts into your ledgers directly. GST computation stays in Tally.
6. **Server.** A Linux VM under Hyper-V on Windows Server 2019, or a small dedicated host. To be confirmed after the survey.
7. **Network.** Gigabit LAN, a reachable time source and DNS; remote access through your VPN.
8. **DSEW participation.** A product owner and department leads available about three to four hours a week; decisions within five working days.
9. **Samples.** DSEW supplies representative samples of its documents and formats during Phase 0.
10. **Numbering conventions.** DSEW supplies its existing conventions; where none exist, we propose and DSEW approves.
11. **Existing data.** Customer, supplier, item and employee masters are available as spreadsheets.
12. **Open source.** Third-party components remain available under their open-source licences.
13. **Change control.** Work outside the SRS follows the change-request process.

## 2. Exclusions

- Hardware, operating-system licences, networking, UPS, barcode scanners, label printers and the Tally licence.
- GST on our fees (18%).
- Migration of historical transactions beyond agreed master data.
- Direct filing with statutory portals; payroll output is exported in required formats.
- Attendance-device integration, e-way bill, WhatsApp Business, source-code escrow, extra environments, and deeper
  traceability (all priced as add-ons).
- External AI services and their usage charges (local models are included).
- Cybersecurity penetration testing by an independent firm (available on request).
- DSEW staff time and any DSEW third-party consultant fees.
- Anything not in the signed SRS.

## 3. Dependencies on DSEW

| Dependency | Needed by |
|---|---|
| Nominated product owner and department leads | Start of Phase 0 |
| Sample documents and formats | Week 1 of Phase 0 |
| Server survey answers and access for a non-intrusive visit | Week 1 of Phase 0 |
| TallyPrime release, licence mode, company details, and a nominated Tally contact | Before Phase 3 spike |
| Attendance device make, model and export method (if integration is wanted) | Before Phase 4 |
| Decisions on numbering, approval authority and traceability depth | End of Phase 0 |
| UAT participants and scenarios | Two weeks before each go-live |

## 4. Information we need from you

### 4.1 Business and process
1. A walk-through of one recent job from enquiry to dispatch, with the people who did each step.
2. Your document numbering convention for drawings, BOMs, quotations, POs, QAPs, ITPs and test reports.
3. Who drafts, reviews, approves and releases drawings, BOMs and test records. Is self-approval ever allowed?
4. Which customers require customer-specific quality plans, certificates or traveller formats.
5. How you handle revisions today and what has gone wrong with them.
6. Your product families and which are repeat versus one-off.

### 4.2 Samples (anonymised if needed)
A drawing, a released BOM, a QAP, an ITP, a FAT report, a test certificate, a manufacturing traveller, a dispatch
pack, a quotation, a purchase order, and a typical delivery challan.

### 4.3 Quality and traceability
1. Which materials must carry lot or heat numbers and certificates.
2. Which components need serial numbers or winding-level records.
3. How you manage test instruments and calibration today.
4. The tests you run per product family and the acceptance limits you apply.

### 4.4 Infrastructure survey (no changes will be made)
1. Server make, model, OS edition and exact build, CPU, installed and free RAM, free storage, current workloads.
2. Is Hyper-V available and licensed, and is a dedicated Linux VM permitted?
3. LAN only, or also remote access over VPN? Who is your network administrator?
4. Do shop-floor phones and tablets reach the internal server name over HTTPS, and can they trust its certificate?
5. Backup destination, IT owner, acceptable recovery time and data-loss window.
6. Outbound-network policy for production systems.
7. UPS capacity and runtime.

### 4.5 Finance and HR
1. TallyPrime release, single or multi-user, and which vouchers and masters you want exchanged.
2. Whether payroll is in scope for the first year, and which statutory components apply.
3. Attendance device make and model, if integration is wanted.
4. Whether e-way bill and WhatsApp notifications are wanted.

### 4.6 Commercial
1. Preferred option (1, 2 or 3) or a combination.
2. Target start date and any fixed external deadline.
3. Contract signatory, NDA process and counsel contact.

## 5. Decisions we will ask you to make in Phase 0

| Decision | Why it matters |
|---|---|
| Document numbering convention | Sets how every record is identified |
| Release authority and separation of duties | Controls who can release BOMs, drawings and tests |
| Traceability depth | Changes cost and screens |
| Tally direction and records | Prevents duplicate or conflicting accounting data |
| Server approach | Determines installation plan |
| Source access choice (A or B) | Determines the contract wording |
| Phase order, if you choose Option 3 | Determines what you use first |

Once these inputs arrive, we confirm the Phase 1 fixed price, the sprint calendar and the go-live date in writing.
