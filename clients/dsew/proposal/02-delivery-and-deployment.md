# Delivery, Deployment and What We Need

D & S Electric Works. How Phase 1 is delivered, how it runs on your premises, and what we need from you.

> **Status: NEGOTIATION DRAFT, pending company approval.**

## 1. Timeline: about 11 weeks

The **effective date** is the latest of: signed order; written acceptance of the Tally exclusion; product owner named;
week-1 inputs delivered (sample documents, server survey answers, access). Each day DSEW is late with samples,
decisions, approvals, host access or UAT moves the schedule by the same number of days.

| When | What you can try |
|---|---|
| Week 1 | Workshops, sample documents, server survey. Output: signed specification, numbering convention, test templates for up to 3 product families |
| Sprint 1 (weeks 2-3) | Workspace, roles, CSV import. **First install on the DSEW VM, HTTPS access, real-phone upload test** |
| Sprint 2 (weeks 4-5) | Enquiry, quotation with revisions, order and project job |
| Sprint 3 (weeks 6-7) | Controlled documents, revision-controlled BOM. **First backup and restore rehearsal.** Mid-point milestone |
| Sprint 4 (weeks 8-9) | Manufacturing order, traveller, test records, instrument register, quality gates and override |
| Sprint 5 (weeks 10-11) | Dispatch pack, four dashboards, data export, training, **final restore test and UAT** |

Each sprint ends with a demonstration on a company-hosted test environment. DSEW has **5 working days** to accept it or
report reproducible failures against the agreed criteria; a failure is corrected and shown again; no report means
accepted. Sprint 5 is the heaviest, so the install and restore rehearsal are done early. **The go-live date depends on
the gates in section 3 and is not promised until they pass.**

## 2. Environments

- **Company-hosted test environment:** sprint demonstrations and early hands-on use.
- **One DSEW Linux VM:** installed in sprint 1, used for UAT, and used as production only after the gates pass. A second
  production VM is not included. If the surveyed host cannot support this, a different arrangement is quoted separately.

## 3. Go-live gates (none completed yet)

1. Server survey complete and the DSEW host confirmed suitable.
2. Installation and HTTPS access work on the DSEW host, including a real-phone upload.
3. **Combined backup and restore** of database, files and identity configuration onto a clean environment passes.
4. Identity-provider and object-store outage behaviour tested: existing sessions keep working, new sign-ins or uploads
   fail clearly, quality gates stay enforced.
5. UAT scripts pass (up to 5 working days). Critical and High defects block go-live.
6. The data export reconciles with the system.

## 4. Running on Windows Server 2019

Verity runs on Linux. We do **not** propose running it natively on Windows Server 2019, and we do not recommend Docker
Desktop or WSL for production there. The plan is one Ubuntu Server VM under the Hyper-V role on your server, or a small
dedicated host. **This has not been tested on your server.** Licensing of the Windows host is for your Microsoft partner.

## 5. Your 15 questions, briefly

| # | Question | Answer |
|---|---|---|
| 1 | Stack | TypeScript, Next.js, React, PostgreSQL 16, Keycloak, S3-compatible file storage, Docker |
| 2 | Direct on Windows Server 2019? | No: Linux VM under Hyper-V or a small separate host |
| 3 | Hardware | For 15 users: 4 vCPU, 16 GB RAM, 500 GB mirrored SSD, separate backup target, UPS. Confirmed after survey |
| 4 | Database licence | PostgreSQL, no fee |
| 5 | Browsers | Current Chrome, Edge, Firefox; Android and iOS for shop floor |
| 6 | Network, remote access | LAN; remote only through your VPN |
| 7 | Backup and recovery | Scripts exist; combined restore is a go-live gate. Recovery targets agreed with you |
| 8 | Security | TLS, role-based permissions, per-company data isolation in the database, audit trail the application cannot change or delete, MFA available in Keycloak and enabled if you ask |
| 9 | Encryption | TLS in transit; encrypted backups and disk encryption recommended, confirmed at acceptance |
| 10 | Performance | Designed for 15 named users; load test is part of acceptance |
| 11 | Offline | In-LAN use needs no internet after install; installs and upgrades need controlled internet or offline media |
| 12 | Integration, API | Permissioned REST API; no external integrations in Phase 1 |
| 13 | Source code and repository | Not delivered: Verity is proprietary (document 3) |
| 14 | Test, staging, production | See section 2 |
| - | Where Windows Server 2019 comes in | Section 4 |
| 15 | Upgrades, support | Versioned releases with tested upgrade and rollback; support after warranty is agreed separately |

## 6. Assumptions and exclusions

**Assumed:** up to 15 named users, one site, English only; DSEW supplies samples, decisions and a numbering
convention; DSEW provides the host, TLS certificates, internal DNS, VPN access, backup storage and a network contact.

**Excluded:** everything marked "later" in document 1; Tally Prime integration; historical transaction migration;
hardware and networking; GST on fees; support after warranty; a second VM; travel beyond the survey visit unless the
company decides otherwise; independent penetration testing; DSEW staff time.

**DSEW's own costs (planning estimates, not quotations):** backup target and UPS ₹0.8 to 1.2 lakh; a new server only
if the existing one cannot run the VM, ₹3.5 to 4.5 lakh; platform software licences: none beyond this proposal.

## 7. What we need from you

1. A named product owner (about 3 to 4 hours a week) and leads for quality, engineering and stores.
2. A walk-through of one recent job from enquiry to dispatch, and your numbering convention.
3. Who drafts, reviews, approves and releases drawings, BOMs and test records; is self-approval ever allowed?
4. Samples: drawing, released BOM, quotation, traveller, test report or certificate, packing list, delivery challan.
5. The tests per product family (up to 3) and acceptance limits; how instruments and calibration are tracked.
6. Server make, OS build, CPU, RAM, free storage, Hyper-V status, network and VPN set-up, backup destination, IT owner,
   recovery time and data-loss window you accept, outbound-network policy, UPS.
7. Written acceptance of the Tally exclusion, and agreement to the licence terms in document 3, before the order.
