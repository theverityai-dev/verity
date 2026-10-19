# Company, Platform and Experience

D & S Electric Works. Who we are, what Verity already is, and what is built for DSEW.

> **Status: DRAFT FOR FINAL REVIEW.** This document states only facts the company has supplied. It makes no claim
> about clients, references or credentials beyond those listed.

## 1. Company

| | |
|---|---|
| Name | PlotArmour |
| Registered address | 31/44 St 3, Block 17, Vishwas Nagar, Delhi, India – 110032 |
| GSTIN | 07TQDPS9711L1ZT |
| Phone | +91 87440 69597 |
| Email | team@plotarmour.in |

PlotArmour owns and develops **Verity**, an operations platform for service and manufacturing organisations. Verity is
the platform proposed for DSEW.

## 2. Why Verity suits DSEW, and how much is customised

Verity is a modular platform: the same foundation (data isolation per company, role-based permissions, audit trail,
stock ledger, approvals, manufacturing orders, project jobs) carries every module, so new departments, product families
and users are added without redeveloping it. DSEW's needs here are engineered, one-off products traced from approved
drawing to tested unit, which is what the project configures and extends.

| Capability | Exists in Verity today | Built or configured for DSEW in this project |
|---|---|---|
| Per-company data isolation, role and permission model, audit trail | Yes | DSEW role set |
| Sign-in through an identity provider, with an on-premises mode | Yes, tested on our test environments | DSEW configuration |
| Stock ledger with reversal-only corrections; items, balances, counts | Yes | Used as is |
| Manufacturing orders from a BOM, route stages, operations, hold and resume, quality checkpoints with evidence, dispatch, reservations | Yes | BOM revisions, measured values, quality gates |
| Project jobs with milestones, tasks, timesheets, cost lines, quote revisions and approval | Yes | DSEW templates and print formats |
| Approvals, evidence storage, QR identity for finished units | Yes | DSEW workflows |
| Install, backup, restore and upgrade scripts, containerised package | Scripts and package exist. A combined database, files and identity restore has **not yet** been rehearsed end to end, and nothing has been tested on DSEW's host | Pre-deployment compatibility check, then rehearsal and acceptance on DSEW's host |
| Revision-controlled BOM, controlled documents, structured test records | No | Built in both options |
| Procurement and inventory depth, planning and MRP, traceability, full quality system, finance, HR and payroll, dispatch, contracts, dashboards, documented AI use cases | Partly (stock, purchasing, approvals), not at DSEW depth | Option 2 (Complete ERP); the MVP has the basic procurement, inventory and quality layers only |

## 3. Experience

PlotArmour has completed **10+ past projects, with values from ₹1 lakh to ₹20 lakh**.

We do not claim, in this document, previous deployments specific to ERP, MES, QMS or document-management systems,
electrical or project-based manufacturing, Windows Server hosting, barcode-based traceability, or local AI and document
intelligence. The platform's manufacturing, quality and document foundations are our own product (section 2). Further
detail on past work can be discussed under the confidentiality agreement in section 6.

## 4. Leadership, teams, duration and support

| Name | Role | Based in |
|---|---|---|
| Divyom Sharma | Co-Founder & CEO | Delhi |
| Nakshatra Aggarwal | Co-Founder & CEO | Edinburgh, UK |
| Shubhankar Rakshit | CFO | Delhi |
| Ayushmaan Gaur | COO | Chennai |

| Team | Members |
|---|---|
| Product Management | Himanshu, Arav and Akshat |
| Sales & Outreach | Radhika, Kulsoom and Mannat |
| Marketing | Alvina (Head) |

The people and allocation for this project's delivery (project management, technical lead, development, testing and
deployment) are confirmed in writing at kickoff.

**Estimated duration:** about 6 to 8 weeks for the MVP and about 8 to 12 weeks for the Complete ERP, from kickoff
(document 2), then the 12-month support period. These are estimates subject to timely DSEW inputs, testing and agreed
acceptance criteria.

**Support and escalation:** during the 12-month period, contact team@plotarmour.in or +91 87440 69597. The service
terms (hours, included time and response targets) are in document 1, section 7. **Escalation contact:** Shubhankar
Rakshit, CFO.

## 5. Demonstration

We can demonstrate the existing platform on fictional manufacturing data at your premises or remotely: a project job
with quote revisions and approval, a manufacturing order with route stages and quality checkpoints that block
completion, a printable traveller, a dispatch pack and a QR identity for a finished unit. We will say clearly which
parts exist today and which are built in the project.

## 6. Confidentiality

We will sign a mutual confidentiality agreement before DSEW shares sensitive documents, and we treat DSEW's
requirements and technical information as confidential. DSEW's data is processed on DSEW's own server; any support
access is audited and time-limited. At the end of the engagement we delete or return DSEW material we hold.
