<!-- converted from DSEW-Minutes-of-Meeting.docx -->

MINUTES OF MEETING
DSEW requirements discovery: two calls
Verity for D & S Electric Works  ·  Prepared by PlotArmour  ·  Issued 21 October 2026

1. Summary
DSEW makes engineered, one-off electrical equipment for customers with strict quality and confidentiality terms. The owner is technical, wants to customise the system himself without calling a vendor for each new product, and wants full independence, after an earlier vendor delivered a trial that ran on the vendor's domain and no source code. He dropped ERPNext because its screens were too complex for data-entry staff. PlotArmour will send a written proposal with options and pricing. DSEW said it would discuss price once it is convinced the system fits.
2. What was discussed
Call 1: documents, numbering, checklists, hosting
- Document numbering. DSEW wants to define its own document numbers and categories. The number is built from positions: country or region, organisation, division, section or detail, document type. Characters 0 to 9 and A to Z. DSEW will send the exact scheme.
- Drawings and revisions. Drawings use a decimal sub-part scheme (assembly B4000, parts 4001.1, 4001.2) with revisions R01, R02. Part and assembly numbers may also be plain references such as AP001 and SA001.
- Traceability. Each component should be traceable to its origin, including the sub-components of an assembly, so the team can see which drawing and revision a job used.
- Checklists. DSEW wants to build its own checklists, per client and per product, like a form builder: short and long answers, remarks, photo and video approval, checkboxes. Clients differ (for example an atomic-research centre has its own checklist).
- Document validity. Some documents are issued for a limited period, for example a traveller valid for 3, 6 or 12 months.
- Test reports. Client-facing test reports show a summary first and the detail only when a test fails. Each result needs its test condition. Units must be right: a mH and H mix-up once reached a client.
- Project data export. At project end DSEW submits a stamped manufacturing and inspection file with photos, drawings and records. The owner called an export of this very important. Drawings should also be shared with the client before manufacturing so mistakes are caught early.
- Returnable material. Material sent out for cutting needs to be tracked, with a receipt stamp on return.
- Earlier vendor. The owner showed the CRM and document-manager trial an earlier vendor built. It had good project and document views but ran on the vendor's domain and came with no source code. DSEW wants source code and the database in its own hands.
- Hosting and confidentiality. Billing and invoicing already run on DSEW's own server (manager.io). Client data is under NDA and must stay there. The website and CRM are in the cloud. A cloud-only design will not pass.
- Usability. Shop-floor staff use Android phones. Data-entry staff are not technical. The owner liked the structure of manager.io.
Call 2: attendance and payroll
- Today. Attendance comes from an eSSL biometric device (model around K90, to be confirmed) with eTimeTrackLite software. Staff download it, recalculate attendance, then re-enter data into the payroll software to produce salary slips. DSEW calls this cumbersome.
- Constraints. Mobile phones are banned on the shop floor, so geofenced phone attendance is out. Chemicals on hands break thumbprints, so RFID cards were added, but cards can be swapped. A shop-floor tablet with face scan was floated and left open.
- Preference. DSEW would prefer attendance in the same system if the device can be configured to feed it. If the device is a problem, DSEW is open to changing it.
3. Agreed in the calls
- PlotArmour will check how the attendance device can connect to Verity. DSEW will send the device model and its details.
- DSEW will send its numbering scheme, documents and samples. DSEW asked PlotArmour for SOP, challan and invoice samples.
- PlotArmour will map the full requirement and send a written proposal. Product managers will coordinate with DSEW through a shared chat group and further meetings.
No pricing, scope or contract term was agreed on either call.
4. Action items


5. Open decisions for DSEW
These change scope or cost. PlotArmour will not assume an answer.

6. Proposal meeting, 21 October 2026: to complete on the day

Prepared by PlotArmour, team@plotarmour.in, +91 87440 69597. Confidential: contains DSEW business information.
| Meetings | Two calls held on 19 October 2026: (1) documents, numbering, checklists, hosting; (2) attendance and payroll |
| --- | --- |
| Purpose | Understand how DSEW works and what it needs from an operations system, ahead of the proposal |
| DSEW | Owner of D & S Electric Works, Rau, Indore (names to be added by attendees) |
| PlotArmour | Product management and delivery team (names to be added by attendees) |
| Basis of these minutes | Auto-captioned call recordings, which are noisy and mix Hindi and English. Statements below are the client's, as read from them. They are not yet confirmed in writing by DSEW. |
| Status | DRAFT for attendee confirmation. Please reply with corrections within 3 business days. |
| # | Action | Owner | Status |
| --- | --- | --- | --- |
| 1 | Send the exact document numbering scheme and who owns it | DSEW | Open |
| 2 | Send anonymised samples: drawing, BOM, QAP/ITP, test report or certificate, traveller, packing list, challan | DSEW | Open |
| 3 | Send attendance device model (K90 or similar) and export details | DSEW | Open |
| 4 | Send SOP, challan and invoice samples that DSEW asked for | PlotArmour | Open |
| 5 | Check the attendance device against Verity and report whether import is possible | PlotArmour | Open |
| 6 | Issue the written proposal with options, pricing and delivery plan | PlotArmour | Done: proposal dated 20 October 2026 |
| 7 | Create the coordination group of product managers and DSEW contacts | Both | Open |
| Topic | Question | Why it matters |
| --- | --- | --- |
| Traceability depth | Lot or heat on receipt, serial numbers, or full sub-component genealogy? | Full genealogy costs more than the baseline |
| Hindi labels | Is Hindi and English on the shop floor a go-live requirement? | Not in the current scope |
| Attendance and payroll | Which device, and which approach on the shop floor (card, tablet face scan)? | Device integration is not included until confirmed |
| Client accounts | Should 3 to 4 customer users per project raise tickets and see shared files? | Not in the current module list |
| Checklist builder | Must DSEW build its own checklists without PlotArmour? | To be confirmed in the specification |
| Release authority | Who drafts, reviews, approves and releases drawings, BOMs and test records? Is self-approval allowed? | Sets the approval workflow |
| Server | Specification, backup target, recovery expectations, access, IT contact | Needed before any install |
| Ownership wording | DSEW's counsel to review the source code and licence terms (document 3) | Largest contract risk |
| Item | Outcome |
| --- | --- |
| Attendees |  |
| Option chosen (1 MVP, 2 Complete, 3 Phased) |  |
| Answers to the open decisions above |  |
| Date for samples and server details |  |
| Next meeting or kickoff date |  |