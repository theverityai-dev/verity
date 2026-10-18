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
