# DSEW decision records

Status of this file: PROPOSED, 2026-10-18. These are **client-scoped records**, not Verity ADRs. Any that adds a
platform primitive or a security boundary needs a numbered ADR in `verity-spec/17_decisions/adr/` before code,
as `CLAUDE.md` requires. Where DSEW has to answer, the record says **BLOCKED — CLIENT DECISION** and no answer is
invented. Nothing below has been approved by DSEW.

---

## D1 — Ownership of code, data and configuration

- **Proposed:** Verity owns its core platform and reusable capabilities. DSEW owns its business data, its
  provided documents, and the configuration Verity builds for it (numbering rules, templates, workflows, forms).
  Bespoke code written only for DSEW is covered by explicit contract wording. Source-code escrow is offered only
  as a separately priced arrangement.
- **Why:** the RFP section 5 asks for full source delivery and independence. A multi-tenant platform serving other
  clients cannot hand over its core. DSEW-specific packs can be licensed to DSEW.
- **Consequences:** contract, not engineering, decides bespoke rights. Data export in an open format (ADR-037 is
  the existing client-owned export) is the practical independence guarantee.
- **Status:** BLOCKED — CLIENT DECISION. Product owner must also approve before any proposal states it.

## D2 — Traceability baseline

- **Proposed baseline:** record lot or heat number and supplier certificate reference for applicable raw
  materials on goods receipt; record which lots were issued to which order; give finished units a unique identity
  (the manufacturing passport already provides one). Full component genealogy (every sub-assembly part) is
  **not** in the baseline.
- **Why:** today stock movements carry no lot or heat (verified in `inventory/ledger.ts` and the schema), so
  traceability from raw material to job does not exist. Lot/heat on movement rows is a schema change to the
  ledger, which makes it a Phase 2 item with a design now.
- **Status:** baseline PROPOSED. Depth (stock only, lot/heat, serial, certificates, full genealogy) is
  **BLOCKED — CLIENT DECISION**; it changes cost.

## D3 — Windows Server 2019 on premises

- **Proposed supported runtime (unproven):** a Linux VM (Hyper-V on the Windows host) or a separate Linux host
  running the Verity application, PostgreSQL and file storage, with Keycloak for identity (ADR-031 Mode B).
- **Prerequisites:** host CPU/RAM/disk and free space, Hyper-V enabled and licensed, an administrator, an
  independent backup destination, UPS, LAN reachability for all workstations and the shop-floor network.
- **Spike (before any promise):** build the package in Verity's own environment; then a survey visit that changes
  nothing; then install into a test VM; run smoke test; take a backup; restore it into a second location;
  record times. Rollback = power off and delete the VM, because nothing on the host is modified.
- **Status:** NOT PROMISED. All infrastructure facts are **BLOCKED — CLIENT DECISION** until surveyed.

## D4 — Testing and quality model comes from real DSEW samples

- **Proposed:** model test templates, readings (value, unit, tolerance, instrument, approver) and printable
  reports only after reading DSEW's actual QAP, ITP, FAT report and test certificate samples. QAP/ITP in Phase 1
  is limited to what those samples require and what the signed scope names.
- **Status:** BLOCKED — CLIENT DECISION (samples not received). The design in `phase1-design.md` is a
  provisional shape, expected to change.

## D5 — One purchasing workflow for DSEW

- **Proposed:** use the **inventory** procurement workflow (vendor, purchase order with approval, receive goods
  into stock, vendor payments) as the operational purchasing source, because BOM components are inventory items
  and receipt must land in the same stock ledger the production issue reads.
- **Not used for DSEW:** the trading purchase workflow (purchase bills, GST purchase invoice matching). Financial
  purchase booking belongs to Tally Prime (D6).
- **Gaps to add later (not Phase 1):** purchase requisition, supplier quote comparison, job-wise demand.
- **Status:** PROPOSED. Needs product-owner confirmation that DSEW's tenant does not install the trading
  capability for purchasing.

## D6 — System of record split with Tally Prime

- **Proposed:** Tally Prime is the financial system of record; Verity is the system of record for jobs,
  manufacturing, stock quantities and quality evidence. The RFP names Tally Prime, so the accounting-product
  question is closed.
- **Not assumed:** two-way sync. First integration to specify and prove: direction Verity to Tally for parties and
  invoices (or Tally exports read back for receipts), each record carrying an external id, idempotent import,
  an error queue with retry, and a reconciliation report. Tally edition and interface (XML over HTTP needs
  TallyPrime running with a company loaded) are **unverified**.
- **Status:** PROPOSED. Which records and which direction is **BLOCKED — CLIENT DECISION**. Out of Phase 1.

## D7 — Deferred items

- Full Hindi localisation, payroll and local AI are **outside the initial release** unless DSEW names one as a
  go-live requirement. Keep user-visible text in one place so localisation stays possible; do not promise it.
- Attendance is a separate workstream: raw punches preserved, imported idempotently, calculation by DSEW's
  approved rules. K90 / eTrackTime export or API unverified; nothing is promised or bought before the model and
  edition are confirmed.
- **Status:** PROPOSED; DSEW may override by naming a go-live requirement.

---

## Product-owner review, 2026-10-18

Approved as the **direction for planning**, not as client commitments. The client must still agree the contract
terms and operational details.

| Record | Outcome |
|---|---|
| D1 ownership | Principle approved: Verity keeps its core platform and reusable IP; DSEW owns its business data and agreed client-specific configuration. Rights to bespoke deliverables and source access are defined explicitly in the contract. Escrow is optional and separately negotiated. **Contract wording still BLOCKED — CLIENT DECISION.** |
| D5 purchasing | Approved: the inventory purchase-order workflow serves DSEW's BOM-driven procurement. **To document before building:** how it connects to goods receipt, material issue, job costing and Tally Prime. |
| D6 accounting boundary | Approved: Tally Prime is the financial system of record; Verity is the operational system of record for jobs and manufacturing. **Before the adapter:** which records synchronise, in which direction, and the reconciliation rule. |
| Numbered ADRs | Required. Written as [ADR-047](../../verity-spec/17_decisions/adr/adr-047.md) (BOM revision model, immutability, fail-closed gates) and [ADR-048](../../verity-spec/17_decisions/adr/adr-048.md) (controlled documents). Both PROPOSED until accepted. ADR-045 is reserved for Mode D. |

### Second review, 2026-10-18: ADRs and scope

- **ADR-047** (BOM revisions, fail-closed gate): direction accepted with amendments, written into the ADR. Stays PROPOSED.
- **ADR-048** (controlled documents): direction accepted with scope limits, written into the ADR. Stays PROPOSED.

| Work | Scope decision |
|---|---|
| M1 BOM revision control | Authorised as a bounded extension of manufacturing (Task 118), **only after** the stop/go gate passes. |
| M2 controlled documents | Design and specification only. Build needs a recorded scope amendment. |
| M3 structured test records | Design and specification only. Build needs the same amendment. |
| M4 integration and release gates | In the DSEW plan; not started until its dependencies and acceptance criteria are approved. |

**Proposed `CLAUDE.md` exception (not applied; the product owner edits `CLAUDE.md`).** "Product-owner scope decision,
2026-10-18: business-capability build for the D & S Electric Works engagement is authorised only for Task 118
extensions and the DSEW increments named in `clients/dsew/decisions.md`, each after its stop/go gate passes. All
invariants (INV-001, ADR-017, `enforcePolicy()`) are unchanged. Nothing is authorised by implication; any other
capability needs its own decision."

**Client answers register** (PMs fill in writing; one row per question, no inferred answers):

| Question | Answer | Decision owner | Date | Source (document/email) |
|---|---|---|---|---|
| Document numbering convention and policy owner | | | | |
| Who drafts / reviews / approves / releases drawings, BOMs, test records | | | | |
| Self-approval allowed for critical releases | | | | |
| Traceability depth (lot/heat, serials, genealogy) | | | | |
| Server specification, VM/runtime options, backup target, recovery expectations, access | | | | |
| Samples received (drawing, BOM, QAP, ITP, FAT, certificate, traveler, dispatch pack) | | | | |

### Client call findings, 2026-10-19

Source: `Video Project 4.srt` and `Video Project 5.srt` (auto-captioned call transcripts, noisy Hinglish; the
statements below are the client's words as read from them, **client-stated, not client-validated**). Nothing here is
approved by the product owner or agreed in a contract.

**Register rows partly answered** (the rows above stay open until the PMs confirm in writing):

| Question | Client-stated answer | Still open |
|---|---|---|
| Document numbering convention | Positions: country/region, organization, division, detail/section, document type. Characters 0-9 and A-Z. Drawings use a decimal sub-part scheme (assembly `B4000`, parts `4001.1`, `4001.2`) with `R01`/`R02` revisions. Part and assembly numbers may be plain references (`AP001`, `SA001`). | The exact scheme: the client will send it. Policy owner not named. |
| Traceability depth | Per-component traceability to origin, including sub-components of an assembly. | Conflicts with D2 (genealogy is outside the baseline). Cost impact undecided. |
| Samples | Client will send documents and has shared a CRM/document-manager trial; asked us for SOP, challan and invoice samples. | None received by us. |
| Server and access | Billing and invoicing already run on his own server; confidential data must stay there. Website and CRM are in the cloud. | Specification, backup target, access: unchanged, still blocked. |

**Conflicts with decisions above (resolve before the proposal is final):**

- **D1 ownership.** The client wants full source code and independence because an earlier vendor delivered none.
  This is the largest contract risk. D1 stands (principle approved), but the proposal wording must address it head
  on; nothing is promised.
- **D7 Hindi.** He wants Hindi and English labels for shop-floor workers on Android. D7 lets DSEW override by naming a
  go-live requirement; the call arguably does. Needs a written answer from DSEW and a product-owner call.
- **D7 attendance feeding payroll.** His pain is re-entering attendance into the payroll software for salary slips.
  Payroll stays outside the initial release until DSEW names it; attendance import remains unverified (K90 model
  and export or API not confirmed).
- **D2 traceability.** See table above.
- **PRD customer portal.** The PRD (`prd.md`) says read-only. The client expects client accounts (3-4 users per
  project) that raise tickets, start discussions and see which files and drawings are shared with them.

**New requirements surfaced (none decided; each needs scope and cost before it is quoted):**

- **Controlled document validity.** Documents such as the Traveller are issued for a limited period (3, 6 or 12
  months). `phase1-design.md` has no expiry or validity window.
- **Per-client, per-product checklists** that the client builds himself, with photo and video approval fields.
- **Test report summary plus detail.** Clients read a summary first and open the detail only on a failure. Each
  result carries its test condition (for example before casting, on magnet). Unit correctness is critical: a
  mH/H mix-up reached a client. Entry must produce a print-ready report. This sharpens D4.
- **Export Project Data PDF.** One action bundles photos, drawings and records into the stamped manufacturing and
  inspection file submitted at project end. The client called it very important.
- **Drawings shared with the client before manufacturing**, so a mistake is caught early.
- **Returnable material** sent out for cutting: tracking and a receipt stamp.
- **Attendance constraints.** Mobile phones are banned on the shop floor, so geofenced phone attendance is out.
  Chemical-covered hands break thumbprints (RFID cards were added; cards get swapped). A shop-floor tablet with face
  scan was floated and left open. Needs a client decision.
- **Usability bar.** He dropped ERPNext on UI complexity. Data-entry staff are non-technical and the shop floor
  uses Android phones.
- **Hosting split.** Confidential client data under NDA stays on his server; a cloud-only design will not pass. This
  is consistent with D3 and the on-prem work and changes nothing there.

Distinctions that must stay explicit: **approved in principle** D1, D5, D6; **not agreed with the client** contract
wording and the Tally synchronisation specification; **not proven** Windows Server 2019 compatibility and the K90
attendance integration. Docker Desktop running local tests proves nothing about the client's server.

**M1 does not start** until the stop/go checks in `phase1-design.md` section 12 are closed and the ADRs are
accepted. These client answers stay **BLOCKED — CLIENT DECISION** and are not to be invented: document numbering
convention and who owns the policy; release authority for drawings, BOMs and test records; self-approval
(default recommendation: separate duties for critical releases, audited exception where staffing requires);
traceability depth; server specification, VM/runtime options, backup target, recovery expectations and access;
anonymised samples (drawing, released BOM, QAP, ITP, FAT report, test certificate, traveler, dispatch pack).
