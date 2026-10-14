# D & S Electric Works — Phase Plan

**Status:** Draft v1. **Date:** 2026-10-14. Companion to `clients/dsew/prd.md`.

Rule 2026-10-05: the reference-parity document (Phase 0) comes before building modules.

| Phase | Deliverable | Reuses | New |
|---|---|---|---|
| 0 | Reference-parity docs in `clients/dsew/reference-parity/`: Odoo `project`, `project_mrp`, `sale_project`, `mrp`, `quality`; ERPNext `projects` (project, task, timesheet, project_update); manager.io page set | `docs/reference/odoo-prd/`, `taskplans/archive/05_erpnext_audit.md` | Docs only |
| 1 | D&S tenant bootstrap and seed: transformer/electromagnet items, BOMs, stage routes (core, winding, VPI, assembly, test), customers, suppliers | `seed-colonel-kebabz.ts` pattern, `manufacturing`, `inventory`, `trading` | `prisma/seed-dsew.ts`, `npm run seed:dsew` |
| 2 | `project` capability: Job, milestones, tasks, timesheets, cost lines, quoted-vs-actual | `asset` as skeleton, `hr` employees | Tables with RLS, commands, queries, state machine |
| 3 | Quotation with revisions and structured lost reason; approve snapshots onto the Job | `trading` sales order, `approval` | Quote tables and screens |
| 4 | Test report per unit; stage cannot complete without a passed report; failure spawns rework child | `manufacturing` checklist and operations | Test report record and printable page |
| 5 | manager.io-structured shell: Summary home, tab list show/hide/reorder, per-module list + New | navigation contributions, `DataTable` | Workspace preference, Summary queries |
| 6 | Customer job-status page (read-only, hashed token) | ADR-030 passport | Job status snapshot |
| 7 | Verification: DB tests, obvious-basics checklist, live click-through at 390px and desktop | `verity-usage-qa` | Evidence in taskplan |

Each phase ends with BUILT / PROVEN / NOT YET BUILT stated separately. Nothing is called complete
before Phase 7.
