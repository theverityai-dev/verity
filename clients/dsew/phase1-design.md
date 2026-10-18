# DSEW Phase 1 design (no code yet)

Status: PROPOSED for review, 2026-10-18. Nothing here is implemented. Evidence for every "today" statement is in
[gap-matrix.md](gap-matrix.md); decisions are in [decisions.md](decisions.md). Shapes marked *provisional* depend on
DSEW's real QAP/ITP/FAT samples (D4) and will change.

## 1. Scope

In Phase 1, in this order:

1. **Revision-controlled BOM**: states, immutable once released, controlled revision path, effective dates, change reason.
2. **Controlled engineering documents**: numbering, revisions, states, approval, links to jobs/BOMs/orders, audit.
3. **Structured test records**: template, readings with unit and tolerance, instrument, approver, printable report.
4. **Connect to execution**: released BOM and documents shown on the job and order; test records and released
   drawing become part of a mandatory release and dispatch gate, with an audited override.

Preserved without change: the project/job spine, the stock movement ledger, derived cost, the dispatch ledger,
tenant isolation. Not in Phase 1: multi-level BOM, ECR/ECO workflow beyond a revision with reason, transmittals,
lot/heat on stock (Phase 2), NCR/CAPA, calibration scheduling, MRP, Tally, Hindi, payroll, AI, attendance.

## 2. Revision state diagrams

### BOM revision (maps to ADR-009 categories; only Completed and Cancelled may be terminal)

```
            create / revise
                  │
              [draft]  (Draft)  ── edit lines, header, reason
                  │ submit
          [in_review] (Pending) ── reject ──► back to [draft] with comment
                  │ approve (approval chain, separate permission)
            [released] (Active)  ── immutable; usable for new orders
                  │ a newer revision is released
          [superseded] (Completed) ── immutable; existing orders still point here

        any non-released revision may be withdrawn:
          [withdrawn] (Cancelled) ── never used; kept for history
```

Rules: only a `released` revision may create an order; releasing revision B moves A to `superseded` in the same
transaction; no transition ever edits lines; "edit a released BOM" is only "revise": copy to a new `draft`
revision with a mandatory change reason.

### Controlled document revision

```
  [draft] ─submit─► [in_review] ─approve─► [released] ─new revision released─► [superseded]
     ▲                    │ reject                │ withdraw
     └────────────────────┘                       ▼
                                             [obsolete] (Cancelled)
```

Rules: a revision's file is fixed when submitted (checksum frozen, as platform file storage already does); a
released revision is never edited; downloads of a superseded or obsolete revision carry a visible banner and are
logged.

### Test record

```
 [draft] ─submit─► [submitted] ─approve─► [approved]     (result: pass | fail computed from readings)
    ▲                    │ reject
    └────────────────────┘     an approved record is never edited; a re-test is a new record
```

## 3. Data model proposal (provisional; all tables tenant-scoped with RLS enabled and forced)

### 3.1 BOM revisions: extend `manufacturing_bom`, do not add a parallel table

Today one row is one BOM with unique `(tenant_id, code)` and a per-unit line set. Proposal: each **row stays one
revision**, so `ManufacturingOrder.bomId` keeps pinning the exact revision with no order-table change.

New columns on `manufacturing_bom`: `family_code` (the product's BOM identity), `revision` (text, A, B, C…),
`status` (draft | in_review | released | superseded | withdrawn), `effective_from` (date, set at release),
`change_reason` (required for any revision after the first), `supersedes_id` (self FK), `released_at`,
`released_by_id`, `submitted_by_id`. Unique `(tenant_id, family_code, revision)`; at most one `released` row per
family (partial unique index). `code` remains the human reference (`family_code` + `-` + `revision`) so existing
screens and orders keep working.

Backfill: every existing BOM becomes revision `A`, `status = released`, `family_code = code`.

Immutability enforced twice: in the commands (preconditions) and by a database trigger that rejects UPDATE or
DELETE on `manufacturing_bom_line` and on the header's structural columns unless the parent row is `draft`
(same defence-in-depth idea as the append-only checkpoint trigger).

Optional per-family flags (Phase 1): `requires_route` and `required_checkpoint_keys` live on the family's
released revision, so the QC gate stops depending on someone remembering to plan a route (gap-matrix: "QC gate is
optional").

### 3.2 Controlled documents: a new capability `verity.capability.document`

- `document_type` (key, label, numbering pattern, requires_approval): tenant data.
- `document_number_counter` (type, year, next value): advisory-lock allocation, the same way job numbers are
  assigned today.
- `document` (id, number, type, title, job_id nullable, customer_id nullable, created_by, current_revision_id).
- `document_revision` (document_id, revision, status, stored_file_id, change_reason, effective_from, authored_by,
  reviewed_by, approved_by, released_at). The file is a platform stored file, so its checksum is frozen.
- `document_link` (document_id, entity_key, entity_id): polymorphic link to a job, BOM revision, order or test
  record (the same keyed-reference style `Evidence` uses).
- `document_access_log` (append-only: who opened or downloaded which revision, when). Required by RFP E.

Numbering is configurable by an administrator through `document_type.numbering pattern` (tokens such as
`{TYPE}`, `{YEAR}`, `{SEQ:4}`, `{JOB}`). DSEW's existing convention is **unknown**: BLOCKED — CLIENT DECISION.

`Evidence` stays as it is: immutable captured field data. A document is not an evidence row and vice versa.

### 3.3 Structured test records (provisional)

- `test_template` (key, name, version, status; items: key, label, kind `numeric | pass_fail | text`, unit,
  min, max, instrument_required). A template is versioned the same way (draft/released/superseded).
- `test_record` (id, template_id and a **frozen copy** of the template, order_id or job_id, unit_ref, status,
  result `pass | fail | null`, submitted_by, approved_by, approved_at).
- `test_reading` (append-only, trigger-protected like `manufacturing_checkpoint_result`: test_record_id, item_key,
  value, unit, `within_tolerance` computed and stored at write, instrument_asset_id, recorded_by, recorded_at,
  evidence_id optional).
- Instrument: the existing `Asset` capability row; calibration due date held as an Asset custom field in Phase 1
  (reading refused if the instrument's calibration has expired). A proper calibration table is Phase 2.
- Report: a printable page in the style of the existing quote and invoice print pages.

### 3.4 Gates and override

- `gate_override` (append-only: entity_key, entity_id, gate_key, reason, overridden_by, at). Written only by one
  command, `verity.manufacturing.override_gate`, verb `ActionExecute` (the verb set is closed), reason
  at least 10 characters, restricted to a dedicated permission, and always audited.

## 4. Migration sequence (each is additive and independently shippable)

| # | Migration | Content | Rollback note |
|---|---|---|---|
| M1 | `bom_revisions` | New columns with defaults, backfill to revision A released, partial unique index, immutability trigger, state and transition rows | Drop trigger and columns; backfill is derived, nothing lost. Production: take a backup first, apply in a maintenance window. |
| M2 | `capability_document` | document tables, numbering counter, access log, RLS, entity/state/transition rows, nav contribution | Drop the new tables; no existing table touched. |
| M3 | `capability_test_records` | template, record, reading (append-only trigger), RLS, entity rows | Drop the new tables. |
| M4 | `release_gates` | per-family `requires_route`, required checkpoints, `gate_override` table, link tables | Drop new columns and table. |

Every migration: `ENABLE` and `FORCE ROW LEVEL SECURITY` with the tenant policy, grants follow the project's
default privileges, and a negative cross-tenant test per table (reading or writing another tenant's row fails).
No destructive migration or production deploy without approval and a verified backup.

## 5. Permissions and audit

New entity keys: `verity.manufacturing.bom` (existing, new verbs used), `verity.document.document`,
`verity.document.revision`, `verity.test.template`, `verity.test.record`, `verity.manufacturing.gate_override`.

| Action | Verb on entity | Proposed role |
|---|---|---|
| Draft BOM / document / test record | Create, Edit | engineering, quality |
| Submit for review | ActionExecute | author |
| Approve and release BOM or document | ActionExecute (separate permission) | engineering lead |
| Approve test record | ActionExecute | quality |
| Override a gate | ActionExecute (dedicated) | owner only |
| Read documents / download | Read, logged | per document classification |

Whether the author may approve their own release is **BLOCKED — CLIENT DECISION**: a 10-person firm may not have
a second approver. Default proposed: refuse self-approval, owner may override with a recorded reason.

Audit: every transition writes the existing activity record (actor, command, before/after) through
`recordActivity`; document downloads write `document_access_log`; overrides write `gate_override` and activity.
The assistant channel acts as the calling user only (ADR-017); no new authority.

## 6. Acceptance criteria and negative tests

Positive:

1. Create BOM family, add revision A lines, submit, approve: status `released`, order creation works.
2. Create an order from A; revise to B with a reason, release B: A becomes `superseded`; **the existing order still
   shows revision A and its original lines**; a new order uses B.
3. Documents: create with generated number, attach file, release revision A then B with a reason; revision A is
   marked superseded and still downloadable with a banner; the job page lists the current released set.
4. Test record: all readings within tolerance and approved gives `pass`; the printed report shows values, units,
   instrument and approver.
5. Dispatch: refused until the order's required test record is approved and the required drawing is released;
   allowed after, and the dispatch shows which revisions it relied on.
6. Override: owner overrides a gate with a reason; the audit trail shows it; a non-owner cannot.

Negative (each must fail with a clear error):

- Edit, delete or add lines on a released, superseded or withdrawn BOM revision (command and direct SQL through the
  trigger); release without approval; release a revision that has no change reason (when not the first); two released
  revisions in one family; create an order from a draft or superseded revision.
- Edit a released document revision; delete a revision; re-use a document number; concurrent numbering gives two
  different numbers (advisory lock).
- Record a reading with a mismatched unit; with an expired instrument; edit or delete an existing reading (trigger);
  approve your own record when self-approval is off; approve a failed record as a pass.
- Any of the above on another tenant's id (RLS), for every new table.
- Override without a reason, or without the dedicated permission.

Regression: the existing manufacturing, inventory, project and tenant-isolation suites keep passing.

## 7. UI and workflow outline

- BOM page: revision strip (A ▸ B ▸ C) with status pills, "Revise" and "Submit", change-reason box, diff against the
  previous revision (lines added, removed, quantity changed), who released and when.
- Documents: a register (filter by type, job, customer, status, keyword) and a detail page with the revision history;
  a job tab "Documents" and a "Release pack" panel on the job and order.
- Test record: tablet-friendly entry (one reading per row, unit and tolerance shown, red when out of tolerance),
  submit and approve actions, print page.
- Dispatch panel: lists each gate (required drawing released, test approved) as met or not met, with the override
  action visible only to the permitted role.
- Style: existing iOS system (ADR-033); status pills use the semantic colours already defined.

## 8. Deployment and backup/restore test plan

1. Build a repeatable package (application, PostgreSQL, file storage, identity) in Verity's own environment; pin
   versions; keep secrets out of the repository.
2. Survey visit that changes nothing: record host, Hyper-V, resources, network, UPS, backup, remote access.
3. Install in a test VM; smoke test each role: sign in, create a job, upload a document, release a BOM revision, run a
   test record, produce a report, read the audit log.
4. Backup: database dump plus file store, encrypted, to a separate destination. **Restore into a clean location and
   verify the application and documents work together.** Record backup size and restore time.
5. Rollback: documented per release (database backup before migration; revert package; restore).
6. Go-live is not declared until a restore has actually been demonstrated and signed by the owner.

All server facts are unknown today (D3). Nothing is promised.

## 9. Risks, dependencies and estimate boundaries

| Risk | Mitigation |
|---|---|
| DSEW samples change the test model (D4) | Build BOM revisions and documents first; hold test-record schema until samples arrive |
| Approval separation impossible in a small team | Make self-approval a tenant setting with an audited owner override |
| Immutability trigger breaks an existing flow | Run the full manufacturing suite after M1; backfill checked on a copy of the demo data |
| Two purchase models confuse scope | D5 fixed before any procurement work |
| Windows Server unsuitable | D3 spike before commitment |
| Scope creep into ECR/ECO, multi-level BOM, e-signature, OCR search | Each is a separately estimated item below |

Items that would **materially change cost or schedule** and are *not* included until estimated and approved:
multi-level BOM and sub-assemblies; formal ECR/ECO with its own approval path; electronic signatures; per-customer
report layouts; document OCR and full-text search; CAD file preview; transmittals and customer-facing portal;
lot/heat on stock (Phase 2); calibration scheduling; NCR/CAPA.

## 10. Needed before implementation

Client decisions: D1 ownership wording; D2 traceability depth; D3 server facts and whether a Linux VM is allowed;
numbering convention for drawings and documents; who releases drawings, approves tests and may override; whether
self-approval is acceptable; whether DSEW requires a customer-facing traveler in the first release.

Technical checks: confirm nothing else mutates BOM lines or custom fields; confirm stock movement protection;
dry-run M1 backfill on a copy of the demo tenant; confirm numbering allocation reuses the job-number lock pattern.

Sample documents (anonymised): a drawing with its numbering, a released BOM, a QAP, an ITP, a FAT report, a test
certificate, a traveler/job card, a dispatch pack.

Product-owner decisions: approval of D1, D5, D6; whether `verity.capability.document` and the revision model need
a numbered ADR (they add reusable platform behaviour, so an ADR before code is recommended).

## 11. Next step

Stop for review. After approval, implement M1 (revision-controlled BOM) first, test-first, then M2, M3, M4.
