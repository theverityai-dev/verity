# Review of Shirt_Factory_Developer_Requirement_Sheet.xlsx (v1.0, 2026-10-21)

**Date:** 2026-10-22. Read in full (12 sheets: Read Me, 24 requirements, 18 screens, costing, roles, workflows, reports, 14
decisions, data dictionary, calculations, process master, handover checklist). This note judges it against what is built
(`piecework`, commit `e0dd81bc`, on main and production schema) and against the earlier lot PRD, and sets the build order.

## 1. Verdict

This is the client's real brief, and it is **a different and much larger system** than the lot PRD the demo was built from.
It is a shirt-factory operating system: fabric stock in metres, lots with a status workflow, **bundle-level** slips and
tracking, process movement, a karigar ledger with two wage bases, good / reject / rework / short kept apart, a twelve-category
lot costing with allocation, split and join of bundles and lots, packing, **dispatch**, Hindi and English, PDF and Excel
export, role matrix, audit and backup. What exists covers roughly the lot-and-karigar core, on a **different unit of tracking**
(lot counts, not bundles). Treat the existing build as a foundation to extend and partly re-found, not as nearly done.

The sheet itself is careful: confirmed facts are separated from suggested defaults, every requirement has an acceptance test,
and it names its own open decisions. Its one weak point is that 11 of 14 decisions are still Open (section 4).

## 2. What changed from the lot PRD

| Topic | Lot PRD (earlier) | This sheet | Effect on what is built |
|---|---|---|---|
| Unit of tracking | Lot, per stage and karigar; bundles derived by dividing pieces | **Every bundle is a record** with its own slip (Bundle No, Net Pieces, Lot); every transaction names Lot + Bundle + process + karigar | The ledger must key on bundle. The derived "ready bundles" figure becomes a real count |
| Dispatch | Excluded | In (D-14 asks only whether it is in release one) | Add packing, ready, dispatch |
| Size | Not tracked | Not tracked; bundle may be a mix | Same. The style master stays out |
| Language | Open question | **Hindi + English required** | New cross-cutting build; none exists |
| Lot split / join | Not allowed (assumed) | Required (confirmed) | New, with cost allocation |
| Quality | Short and rework open | Short, reject, rework **separate, confirmed** | New fields and a rework loop |
| Wage basis | One (on pieces returned) | **Both** issue-based and returned/accepted, configurable per process, karigar or transaction | Extend |
| Costing | "To confirm" | **Twelve categories confirmed**, double-counting control, cost per good piece | New (built: wages only) |
| Fabric | A plain record | Inward (type, **metres**, invoice, supplier), stock ledger, issue to lot, return, adjustment | New; needs decimal metres |
| Roles | Munshi and owner | Owner, Manager, Supervisor, Store Manager, server-side | Re-cut role seeds |
| Devices | Open | Mobile and computer; online-first acceptable | Matches built |
| Slip | Not asked | Printed slip per bundle, optional QR | New |

## 3. Requirement by requirement against the repository

BUILT = in the repository and tested; PARTIAL = part of it; NOT YET BUILT. Platform = Verity already provides it.

| Req | Need | State |
|---|---|---|
| FR-001 | Login, users, roles, server-side permission | **BUILT (platform)**: sign-in, memberships, dynamic roles, server-side authorization |
| FR-002 | Hindi + English UI, slips, reports | NOT YET BUILT. No i18n library, no Hindi strings anywhere |
| FR-003 | Role-specific dashboard | PARTIAL: owner dashboard for lots and karigars; no fabric balance, shortage/reject/rework, cost summary or role variants |
| FR-004 | Fabric inward (type, metres, invoice, supplier, duplicate-invoice warning) | NOT YET BUILT as such. Inventory can receive stock but quantities are whole numbers |
| FR-005 | Fabric ledger, issue to lot, return, adjustment | PARTIAL: an append-only stock ledger exists; no decimals; no lot link |
| FR-006 | Lot: name, design, planned qty, fabric type, dates, status Draft/Active/Hold/Completed/Closed | PARTIAL: lot number, design, total pieces, cancel. No status workflow, no dates, no hold or close |
| FR-007 | Bundle with printed slip | NOT YET BUILT. Bundles are derived, not records |
| FR-008, 009 | Split bundle; join bundles or lots | NOT YET BUILT |
| FR-010 | Process movement with from/to, transit, partial receive | PARTIAL: issue and receive per stage and karigar; no transit state, no bundle |
| FR-011 | Karigar / outside unit master | PARTIAL: name, mobile, rates. No in-house/outside, address, default processes |
| FR-012 | Issue with due date, basis, advance reference | PARTIAL: issue exists; no due date, basis or reference |
| FR-013 | Return with good, rejected, rework, short; mismatch alerts | NOT YET BUILT (one received count only) |
| FR-014 | Configurable wage basis | PARTIAL: one basis (pieces returned), rate snapshotted. Not configurable |
| FR-015 | Advances, deductions, payments, ledger | PARTIAL: advance, payment, reversal, balance. No deduction, mode, reference, recovery policy |
| FR-016 | Reject and rework loop | NOT YET BUILT |
| FR-017, 018 | Twelve-category lot costing; allocation on split/join | NOT YET BUILT (wages only, shown as such) |
| FR-019 | Ready stock and packing | PARTIAL: ready derived; no packing |
| FR-020 | Dispatch | NOT YET BUILT for lots (the order-based dispatch in `manufacturing` is unrelated) |
| FR-021 | Reports with Excel and PDF export | PARTIAL: four reports, CSV only |
| FR-022 | Audit log with old/new values, no hard delete | PARTIAL: ledgers are append-only with reversal; platform audit records commands; no old/new-value viewer for the owner |
| FR-023 | Backups, restore test, session control | NOT YET BUILT here (deployment concern, documented elsewhere for Verity). The sheet asks for a demonstrated restore |
| FR-024 | Search and exception alerts | PARTIAL: table filter; one "days since moved" list; no thresholds or alerts |

Counts: 1 BUILT (platform), 12 PARTIAL, 11 NOT YET BUILT out of 24.

## 4. The fourteen decisions, decided from the data (basis recorded)

Per the standing rule, open questions are decided from the sheet's own suggested defaults and made configurable where the sheet
says the factory may choose; each is reversible by configuration, not a rebuild. The client still confirms them in UAT.

| ID | Decision for the build | Basis |
|---|---|---|
| D-01 | Bundle quantity is variable per bundle; no mandatory size split; free "size mix" note | Sheet default; client asked not to track size |
| D-02 | Wage basis is a setting on the karigar and process, overridable on each issue; options: issued, returned, accepted good | Sheet: "configurable per karigar/process/transaction" |
| D-03 | No automatic wage deduction for short or reject; the system flags it for approved deduction | Sheet default |
| D-04 | Advance is recorded and recovered only by an explicit deduction entry of a chosen amount | Sheet default: "never silently auto-deduct" |
| D-05 | Each cost category is a separate entry with an "included in another rate" flag per rate to stop double counting; material and labour are subcategories | Sheet default |
| D-06, 07 | Labels "Thread" and "Side Feed Up" are tenant data, changeable without code | Sheet default |
| D-08 | A movement carries process plus named karigar, unit or place; no separate floor or table master yet | Sheet default |
| D-09 | Split and join allocate cost by quantity, or by an approved manual percentage, always summing to 100 percent | Sheet default |
| D-10 | Fabric inward takes date, rate and amount as optional fields; lot fabric cost is metres consumed x the inward rate | Sheet default |
| D-11 | Online-first web app; no offline in phase one | Confirmed in the sheet |
| D-12 | Opening fabric and ready stock can be entered on launch day as an opening adjustment | Sheet default |
| D-13 | Owner full; Manager limited by configurable approval limits; Supervisor and Store Manager scoped per the matrix | Sheet matrix |
| D-14 | Dispatch is built (lot, packet, quantity, party, transport reference); it can be switched off per tenant | The sheet lists it as a requirement (FR-020, SC-15, RP-10) |

## 5. Design consequences worth stating before any build

1. **The ledger moves from lot to bundle.** Today an entry is (lot, stage, karigar, kind, pieces). The sheet wants
   (lot, bundle, stage, karigar, kind, good/reject/rework/short). The append-only, reversal-not-edit, derive-everything design
   carries over unchanged; only the key widens. Lot figures become sums over bundles. This is the largest single change and is
   done first, because everything else (wages, quality, split, slips) hangs on it.
2. **Quantities in metres need decimals.** Pieces are whole numbers; fabric is not. The integer-in-a-smaller-unit design written
   in `demo-plan.md` section 2a (store millimetres or grams, display metres) is now required, not optional.
3. **Reconciliation is a rule, not a screen.** Issued = good + rejected + rework + short + still open, per issue line. The sheet's
   example (100 = 94 + 2 + 1 + 2 + 1) becomes a database test. Rework is a distinct state that returns to a process and never
   counts as good output until accepted.
4. **Split and join must never lose lineage.** A bundle or lot split creates children that reference the parent; cost allocation
   rows reference both. Sources are never edited or deleted.
5. **Bilingual is a platform concern.** Hindi and English on screens, errors, slips and reports needs one message catalogue and a
   per-user language, not per-screen strings. It touches every screen built so far. It should be designed once and ADR'd before
   it spreads.
6. **Costing needs a defined denominator.** Cost per good piece = allocated cost / good finished pieces, with originals,
   rejects, rework and short shown beside it; blank, not zero, when there are no good pieces.

## 6. Build order (replaces the stage list in `prd-review-and-replan.md` section 5)

| Stage | Content | Requirements |
|---|---|---|
| 1 | Bundles as records and the bundle-level ledger; slip (print, QR-ready); process movement with partial receive and transit | FR-007, FR-010, FR-012 |
| 2 | Return categories good / rejected / rework / short, mismatch flags, the rework loop; wage basis setting and deductions; money ledger completed | FR-013, FR-014, FR-015, FR-016 |
| 3 | Fabric: decimal quantities, inward, ledger, issue to lot, return, adjustment; lot status workflow, dates, plan vs actual | FR-004, FR-005, FR-006 |
| 4 | Costing: twelve categories, double-counting flag, cost per good piece | FR-017 |
| 5 | Packing, ready stock, dispatch | FR-019, FR-020 |
| 6 | Bundle split and join, lot split and join, cost allocation | FR-008, FR-009, FR-018 |
| 7 | Bilingual platform layer and re-skin of the built screens | FR-002 |
| 8 | Role matrix seeds, dashboard by role, alerts and thresholds, audit viewer, Excel and PDF export, backup and restore evidence | FR-001, 003, 021, 022, 023, 024 |
| 9 | Seed from the sheet's own samples, walkthrough, formal completeness gate, handover checklist | all |

Each stage lands with database tests, in its own commit, with this table updated. Nothing is reported built until it is.

### Progress (2026-10-22)

| Stage | State |
|---|---|
| 1 | **BUILT and PROVEN** (bundles as records, gapless B-0001 numbering, bundle-level append-only ledger, bilingual slip with QR, per-bundle issue and partial return, location per bundle). Slip is printable; the QR opens the bundle. |
| 2 | **BUILT and PROVEN** (return split good / rejected / rework / short with a database CHECK, rework pool and reissue, wage basis issued / good / returned per karigar rate and per issue, advance / recovery / deduction / payment with mode and reference, quality and wage reports). Mismatch flags are the live "accounted for X of Y, Z stay open" line plus the Short, reject and rework report; no alert thresholds yet (Stage 8). |
| 3 | PARTLY: lot status workflow (draft, active, hold, completed, closed), dates and plan vs cut are built. **Fabric inward, decimal-metre ledger, issue to lot are NOT YET BUILT.** |
| 4 to 9 | NOT YET BUILT. Costing shows wages only and says so. |

Verified in a browser on the local stack on 2026-10-22: Lots, lot detail, bundle slip, Daily entry (a return was saved through
the screen), Owner dashboard, all reports, Karigar card. Not yet clicked through: New lot, Cut a bundle, status buttons, Record
money forms, owner login against the v2 screens (the owner write refusal is proven by database test).

## 7. What this does not claim

- Stages 3 (fabric), 4 to 9 are NOT YET BUILT. Stages 1 and 2 are built; see the progress table above.
- The first lot-level demo is superseded: `demo-guide.md` now describes the bundle-level build.
- The workbook's role limits, approval thresholds and the thread and side-feed spellings are the client's to confirm in UAT.
