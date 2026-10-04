# Taskplans status index

**For "what's being worked on right now, in what order," read
[`taskplans/handoffs/README.md`](./handoffs/README.md) instead — this file
is the full historical register (every taskplan, Done and Pending), not a
live work order.**

Classification of every file in `taskplans/`, regenerated 2026-09-08
(previously 2026-09-04, originally 2026-09-02) against current `git log`,
`src/`, `prisma/schema.prisma`, and each file's own closing/status
section. No existing file was moved, renamed, or edited — this is a
pointer, not a reorganization. Numbers 61–63 do not exist (gap in the
original sequence).

This regeneration moves 5 more items Pending -> Done since 2026-09-04,
per commits `e502208`/`e7b997b`/`897ed08`/`b98a7e2`/`7fb4af1`/`e92dbee`
(Tasks 81, 86, 92-extension, 99 Skills 2/3, 100). `101_remaining_work_
master_plan.md` itself now predates all six of those commits — its
Category 1 ("buildable now") is fully executed; its Categories 2-5 are
still accurate (checked directly, not assumed) as of this regeneration.
Tasks 103/104 are new since the last regeneration (Payload CMS control-
plane ADR analysis) and are listed Pending — both PROPOSED/DRAFT,
awaiting product-owner ratification, not a build gap.

Re-derive this index (don't trust it blindly) if it's more than a few weeks
stale — re-run against current `git log` and `src/`. `taskplans/101_
remaining_work_master_plan.md` sequences everything still open as of this
regeneration — read that instead of re-deriving triage from scratch.

> **2026-10-04 — archive move.** The 68 closed taskplans in the Done table below (Tasks 00–13, 17, 24–26A,
> 28–60, 64, 66, 68–71, 102) now live in [`taskplans/archive/`](./archive/README.md); their rows are marked
> `archive/<file>`. Everything cited as authority (17A, 18–23, 27), the living references (14–16, 65, 67) and every
> task from 72 onward stayed in place. Evidence columns below were not re-derived; treat them as of the date above.

## Current priority order — 2026-09-18 correction

This short list supersedes older "next" wording elsewhere in this historical
index. It reflects the product-owner decision to launch Outreach as a manual,
team-operated system of record before any external prospecting integrations.

1. **Launch verification (Outreach):** run the real-role smoke path against a
   valid production-like database before issuing credentials. The implementation
   scope is complete; the outstanding work is proof of the deployed workflow,
   not new enrichment or cadence code.
2. **Interaction-system enforcement (Task 115 extension):** use the new
   Apple/Odoo operational grammar in `verity-spec/09_experience/` for every new
   form, dropdown, table, record view, and state. Remove shared-primitive
   exceptions when encountered; do not start a page-local control system.
3. **Deferred, not blocking launch:** external enrichment, automated sending,
   and third-party sequence/cadence execution from Task 114 P2. Manual prospect
   creation and relationship documentation are the chosen launch workflow.
4. **Gated follow-up:** Task 113's live-database AI persistence proof and Task
   90's Attention concept remain separate gates. Neither should delay manual
   Outreach operations; neither can be declared complete without its stated
   live evidence or trigger.

## Done

| File | Evidence |
|---|---|
| archive/00_CLAUDE_CODE_HANDOFF.md | handoff doc for Phase 7; all listed research artifacts exist, its one flagged gap (Task 26) later shipped |
| archive/00_research_program_ledger.md | ledger's own checklist through Task 35, all files present |
| archive/01_rd_and_spec_upgrade_plan.md | plan executed — all 7 R&D audits (02–13) exist |
| archive/01_rd_clone_and_freeze.md | freeze manifest, static record, all 12 repos audited per ledger |
| archive/02_digit_works_audit.md | "Current Status: Complete" |
| archive/02_enterprise_rd_research_manifest.md | superseded by 01_rd_clone_and_freeze's 12-repo scope, itself fulfilled |
| archive/03_payload_audit.md | "Current Status: Complete" |
| archive/04_twenty_audit.md | "Current Status: Complete" |
| archive/05_erpnext_audit.md | "Current Status: Complete" |
| archive/06_plane_audit.md | "Current Status: Complete" |
| archive/07_keycloak_audit.md | "Current Status: Complete" |
| archive/08_temporal_audit.md | "Current Status: Complete" |
| archive/09_tooljet_audit.md | "Current Status: Complete" |
| archive/10_opensearch_audit.md | "Current Status: Complete" |
| archive/11_formbricks_audit.md | "Current Status: Complete" |
| archive/12_cal_diy_audit.md | "Current Status: Complete" |
| archive/13_seaweedfs_audit.md | "Current Status: Complete" |
| 14_capability_matrix.md | synthesis of the 12 completed audits, living reference cited elsewhere |
| 15_architecture_pattern_catalogue.md | synthesis doc, living reference |
| 16_cross_repo_comparison.md | synthesis doc, living reference |
| archive/17_verity_gap_analysis.md | ledger marks Completed; superseded content, kept as historical record |
| 17A_verity_architecture_decisions.md | ADR register, actively cited as Authority throughout CLAUDE.md |
| 17B_verity_architecture_scorecard.md | scorecard produced per ledger |
| 18_combined_verity_prd.md | cited as Active Canonical Document in CLAUDE.md Authority order |
| 19_verity_bible_v2.md | "STATUS: CANONICAL", primary cited authority repo-wide |
| 20_verity_spec_v2.md | "STATUS: CANONICAL", primary cited authority repo-wide |
| 21_implementation_roadmap_v2.md | roadmap produced per ledger (extended by 65_verity_roadmap_v3) |
| 22_spec_consistency_audit.md | cited in CLAUDE.md as "Active verification gates" |
| 23_portable_runtime_v2.md | ledger: Completed |
| archive/24_current_runtime_baseline.md | ledger: Completed |
| archive/25_postgres_portability.md | ledger: Completed |
| archive/26_runtime_configuration.md | commit `0bab3a0` "Task 26 — runtime configuration boundary" |
| archive/26A_v1_to_v2_authority_transition.md | ledger: Completed |
| 27_storage_abstraction.md | commit `3a5d0d2` "Task 27 — storage abstraction" |
| archive/28_auth_provider_abstraction.md | commit `c6d6258` "Task 28 — auth provider abstraction" |
| archive/29_background_job_abstraction.md | commit `6c98017` "Task 29 — background job abstraction" |
| archive/30_containerized_runtime.md | commit `b5e7c18` "Task 30 — containerized runtime" |
| archive/31_migration_and_bootstrap.md | commit `6b79428` "Task 31 — migration and bootstrap" |
| archive/32_health_readiness.md | commit `63976f1` "Task 32 — health and readiness checks" |
| archive/33_backup_restore_verification.md | commit `8fc3412` "Task 33 — backup and restore runbook, proven live" |
| archive/34_portable_runtime_acceptance.md | commit `e48e7b9`; caveat: 5/8 acceptance criteria live-passed, 2 blocked on Docker daemon |
| archive/35_phase7_closeout.md | "Status: COMPLETE" |
| archive/35A_phase8_execution_program.md | "Status: COMPLETE (2026-08-31)" |
| archive/36_enterprise_identity_oidc.md | "Status: COMPLETE — BUILT and PROVEN"; commit `fc7e5a4` (verified) |
| archive/37_enterprise_rbac_policy.md | "Status: COMPLETE — BUILT and PROVEN"; commit `4a9b57f` |
| archive/38_audit_business_history.md | "Status: COMPLETE — BUILT and PROVEN"; commit `8398ba9` |
| archive/39_integration_framework.md | "Status: COMPLETE — BUILT and PROVEN"; commit `18ec5c5` |
| archive/40_enterprise_observability.md | "Status: COMPLETE — BUILT and PROVEN"; commit `a45b317` |
| archive/41_s3_storage_implementation.md | "Status: COMPLETE — BUILT and PROVEN, including live"; commit `d6f16ac` |
| archive/42_deployment_hardening.md | "Status: COMPLETE — BUILT"; commit `84af572` (verified) |
| archive/43_docker_acceptance_rerun.md | "Status: COMPLETE — EXECUTED"; commit `9e71e42` |
| archive/44_enterprise_readiness_certification.md | "Status: COMPLETE — CERTIFIED WITH STATED LIMITATIONS"; commit `3911a21` |
| archive/45_plywood_workflow_program.md | program plan; every named next-step landed in Tasks 46–71 |
| archive/46_enterprise_codebase_audit.md | audit doc producing deploy-readiness verdicts, referenced by 46A–C |
| archive/46_plywood_integrity_foundation.md | commit `5d7a6ee` "Task 46 — integrity foundation (slice 1)" |
| archive/46A_api_inventory.md | commit `b10bdc7` "complete Task 46A and 46B" |
| archive/46B_sensitive_data_flow.md | commit `b10bdc7` (same) |
| archive/46C_findings_ledger.md | findings ledger opened and populated per `b10bdc7` |
| archive/47_nextjs_security_upgrade.md | typecheck/lint/test/build "clean" per file; caveat: Docker acceptance not re-run against 16.3.3 |
| archive/47_plywood_business_identity.md | commit `058711e` "Task 47 — business identity, navigation, Logistics removal" |
| archive/48_plywood_purchase_chain.md | commit `df6a0b0` "Task 48 — Goods Receipt document and three-way match" (verified) |
| archive/49_plywood_sales_chain.md | commit `d75d929` "Task 49 — Goods Issue document and invoice eligibility" |
| archive/50_plywood_returns_and_notes.md | commit `043ffb3` "Task 50 — returns and credit/debit notes" |
| archive/51_plywood_tax.md | commit `9095a09` "Task 51 — effective-dated tax rules and returns working" (verified) |
| archive/52_plywood_close_reports.md | commit `116df06` "Task 52 — period close and real reports" |
| archive/53_plywood_connected_experience.md | commit `f0e9459`, program plan executed by Tasks 54–60 |
| archive/54_plywood_party_workspaces.md | commit `9cc3022` "Task 54 — supplier and customer workspaces" |
| archive/55_plywood_inventory_drilldown.md | commit `c6eccf5` "Task 55 — product, godown and movement-ledger drill-down" (verified) |
| archive/56_plywood_order_lifecycle.md | commit `0558962` "Task 56 — purchase and sales order lifecycle screens" |
| archive/57_plywood_tax_centre.md | commit `89f4ed4` "Task 57 — the accountant's tax centre" |
| archive/58_plywood_people_and_roles.md | commit `0d0b265` "Task 58 — people and roles in business language" |
| archive/59_plywood_onboarding_notifications_audit.md | commit `c22c491` "Task 59 — onboarding, actionable notifications, readable audit" |
| archive/60_plywood_owner_overview.md | commit `0163b21` "Task 60 — the owner's overview" |
| archive/64_plywood_itc_reconciliation.md | commit `88ae5d7` "Task 64 — input credit reconciliation" |
| 65_verity_roadmap_v3.md | living roadmap reference, cited by Task 67 |
| archive/66_phase10a_security_remediation.md | remediation applied; only P3 items (CSP nonce, `/api/metrics`) left deliberately open |
| 67_enterprise_baseline_v1.md | baseline certification doc, references plywood as "worked precedent" |
| archive/68_plywood_usability_audit.md | audit doc with concrete findings (e.g. AUDIT-SO-1), consumed by Task 69 |
| archive/69_plywood_usability_remediation_plan.md | remediation executed; findings closed per Task 70's audit |
| archive/70_plywood_second_audit.md | second audit confirms fixes landed (Cancel works, Processing order visible, etc.) |
| archive/71_plywood_transaction_and_finance_overhaul.md | explicit "Delivered" table, all 11 numbered complaints resolved with file citations; commits `0445330` + `08e90be` (verified) |
| 72_erpclaw_capability_accounting.md | **BUILT 2026-09-04, MVP scope**, ahead of demand under explicit product-owner override; migrated and live (`3311175`); acceptance script written but not yet walked (`85`) |
| 73_erpclaw_capability_inventory.md | **BUILT 2026-09-04, MVP scope**, same override; migrated and live (`3311175`) |
| 77_erpclaw_capability_billing.md | **BUILT 2026-09-04, MVP scope**, same override; migrated and live (`3311175`) |
| 78_erpclaw_capability_hr.md | **BUILT 2026-09-04, MVP scope**, same override; migrated and live (`3311175`) |
| 82_erpclaw_client_capability_builder_skill.md | **BUILT 2026-09-04** — `.claude/skills/verity-client-capability-builder/SKILL.md` |
| 84_verity_ai_agent_system.md | **COMPLETE 2026-09-04** — all six areas built and unit-tested; areas 1/2/3/5 also live-verified 2026-09-03. Known MVP gaps recorded in the file itself (no streaming, grounding is entity-agnostic, no confirm UI so destructive commands always `needs_approval`) |
| 85_foundation_conformance_acceptance_script.md | **BUILT 2026-09-04** — template + two scripts (`implementation/13-conformance/`): plywood (walked, PASS), accounting (written, not yet walked) |
| 91_bulk_operations_and_partial_failure.md | **BUILT 2026-09-04** — `src/server/platform/batch.ts`, consumed by Task 84's agent loop; trigger (Task 84 landing first) fired same day it was written |
| 81_erpclaw_ai_operating_rules.md | **AUDITED 2026-09-04, extended 2026-09-08, CLOSED 2026-09-09** (`e502208`, `implementation/13-conformance/task-81-compliance-audit.md`) — trigger fired when Task 84 area 6 shipped; 5 rules compliant by construction, 2 gaps fixed 2026-09-04 (error-class taxonomy, exact-match prompt discipline), 2 more gaps built 2026-09-08 (prose-claim numeric grounding, six-step preview step), and the last gap built 2026-09-09: structural exact-match enforcement — `GroundingCache.isAmbiguous()` (`grounding.ts`) rejects a write on an `*Id` field that only ever came from a multi-row query result and was never confirmed by a query narrowed to exactly that one row. All 16 rules now compliant or built |
| 86_dashboard_and_panel_state_model.md | **BUILT 2026-09-04** (`897ed08`) — `src/components/ui/panelState.ts` (`PanelState<T>`, `loadPanel()`), wired into `/overview`: real Degraded state distinct from denied/empty, per-panel fetch isolation so one failing query no longer crashes the whole page. Attention state still deferred to Task 90 (unfired trigger), per this file's own scope |
| 92_business_timeline_view.md | **BUILT for order/party detail, confirmed 2026-09-04** (`e733c33`, `b98a7e2`) — infrastructure (Task 38's `reconstructHistory`, `ActivityLog`) already existed; a real bug found and fixed (fact entries showed a raw event name, `kind` field added). Coverage extended to supplier/customer detail (`SupplierWorkspace`/`CustomerWorkspace` Activity tabs). Still open: employee/asset detail (no such capability exists yet — nothing to wire), a standalone timeline reading view (optional, not requested) |
| 99_verity_custom_skills_plan.md (Skills 1-5, 7-8 only) | **BUILT** — Skills 2/3 on 2026-09-04 (`e7b997b`), Skills 4/5/7/8 on 2026-09-08: `verity-taskplan-writer`, `verity-rd-miner`, `verity-orientation`, `verity-design-companion`, all under `.claude/skills/`. Skill 1 is Task 82. Only Skill 6 remains — listed Pending below, needs real design work first, not merely low-priority |
| 100_dashboard_intelligence_direction.md | **BOTH BLOCKING DECISIONS RESOLVED 2026-09-04** (`7fb4af1`, `e92dbee`) — shadcn/ui: decided NO, keep the hand-built component layer. Metrics-history: BUILT (`PlywoodMetricSnapshot`, daily capture job, `metricsHistory` query, reusing `ownerConsole`'s exact SQL to avoid a second definition of the same number). Migration application and the sparkline UI itself are the remaining concrete steps, listed Pending below — the *decisions* are what were blocking, and both are made |
| 102_adversarial_black_box_audit_prompt.md | complete as authored — the file **is** the prompt, meant to be pasted into a fresh session; nothing further to build here |
| 103_payload_cms_control_plane_adr.md | **RATIFIED 2026-09-08** — `verity-spec/17_decisions/adr/adr-019.md`, ACCEPTED. Payload rejected as tenant-scoped control-plane dependency |
| 104_verity_native_configuration_extension_architecture.md | **CORRECTED 2026-09-08** — its own premise ("item 10 unbuilt") was wrong; 4 of 5 sketched pieces already ship (`TenantActivation`, `CustomFieldSchema`, `WorkflowDefinition`/`EdgeCondition`, `contribution.ts`). Only `DocumentTemplate` is a genuine gap, fully precedented (mirror `NotificationTemplate`), listed Pending below awaiting its own trigger |
| 94_incomplete_information_states.md | **MECHANISM DECIDED 2026-09-04** — `Select`-type companion status field, no new primitive; taught in Task 82's skill; no plywood retrofit performed (its own non-goal) |
| 93_progressive_setup_capability_readiness.md | **BUILT 2026-09-09 (mostly pre-existing, unnoticed)** — Task 59 (`c22c491`) already built `onboardingChecklist` (`trading/business.ts`) + `SetupChecklist.tsx` on `/overview`, satisfying this file's core ask in full; this taskplan sat PENDING without ever being checked against it. Trigger ("next real plywood onboarding") fired by Shree Ganesh, Verity's one real client, confirmed 2026-09-09. Session added the two named steps the built version was missing (`pricing`, `first_sale`) |
| 87_import_export_migration_framework.md | **BUILT 2026-09-09, item/customer/supplier scope** — same trigger event as Task 93 (Shree Ganesh confirmed as the real client this taskplan's own gate names). `previewCustomerImport`/`previewSupplierImport` (`trading/import.ts`, reusing `createCustomer`/`createSupplier`'s own zod schemas), `previewProductImport`/`commitProductImport` (`plywood/index.ts`, two-pass commit via new `ensureBrand` find-or-create then `createProduct`), bridged by `src/server/actions/import.ts`, UI at `/import`. Partial-failure preserved via `runCommandBatch` (Task 91) at every stage. Bank-statement import/chart-of-accounts import stay out of scope, per the file's own Scope section (unchanged) |
| ADR-018 (trading capability extraction) | **BUILT 2026-09-04** — `src/server/capabilities/trading/` extracted from `plywood` (28 of 29 `Plywood*` models were already generic); `plywood` now depends on `trading` and keeps only `PlywoodProductDetail` (board dimension/grade). Explicit product-owner override of taskplans 74/75's "wait for 72/73 settled" gate, given the auto-parts client concretely arriving; see `verity-spec/17_decisions/adr/adr-018.md` for the full reasoning and what was rejected. Migration `20260904180000_trading_capability_extraction` renames tables (data-preserving), backfills the new detail table, and activates `trading` for every tenant that already had `plywood` active. |

## Pending

See `taskplans/101_remaining_work_master_plan.md` (2026-09-04) for the
current, sorted triage of everything below — buildable now vs. needs an
ADR vs. needs a real trigger vs. needs an explicit product-owner decision.
This table is the flat list; that file is the sequencing.
`taskplans/122_pending_taskplans_phase_wise_completion_plan.md`
(2026-09-24) is the current phase-by-phase re-sequencing, superseding
101/121's ordering with live-verified state — read that for "what order,
right now."

| File | Reason pending |
|---|---|
| 119_jev_decision_model_future_capability.md | **BUILT 2026-09-30, unit-proven, NOT live-verified** (node `verity.decision.ask`; needs migration + API key + one real call; see the taskplan) — earlier: PROPOSED/DRAFT 2026-09-23 — Jev (TypeSafe AI structured-decision model, verified live via `POST https://openrouter.ai/api/alpha/decisions` -> real 401) as a future advisory layer for `EdgeCondition` in `workflow.ts`, above `enforcePolicy()` per ADR-017. Blocked on two gates: (1) an ADR deciding whether an external decision-model dependency and tenant-data egress are acceptable at all, (2) `CLAUDE.md`'s objective moving past PLATFORM FOUNDATION READY into business-capability build, or a concrete named workflow-condition requirement. Neither fired |
| 118_manufacturing_capability_odoo_gap_and_ux_completeness.md | **Minimal slice + UI BUILT (2026-09-25 / 2026-09-30)**; wider build waits on a named design partner (see the taskplan §7-§8) — earlier: PROPOSED 2026-09-23 — audit of `D:\Code\veda` (Carxen factory OS) vs Odoo Manufacturing/Inventory/Quality, design for a generalized `manufacturing` capability reusing `recipe`/`inventory`/`evidence`/`scheduling`/`asset`/`workflow`. Blocked on product-owner scope decision (§6): whether manufacturing gets the same Task-84-style override that shipped `recipe`/`plywood`/etc |
| 121_permanent_obvious_basics_enforcement_and_priority_order.md | PROPOSED 2026-09-23 — priority order across active work + Tasks 118/119/120; live grep audit found the same class of bug veda had already recurring in Verity (`LedgerView.tsx` has one hand-rolled `<table>` with `overflow-x-auto` and one without, in the same file; 28 files hand-roll `<table>` vs 13 using shared `SmartTable`/`DataTable`). Proposes an ESLint rule banning bare `<table>` outside the shared components as the structural, permanent fix, plus new `design-system.md` §3 REQ items (per-row action, party ledger as a required pattern, print/export) and wiring `obvious-basics-checklist` into review |
| 122_pending_taskplans_phase_wise_completion_plan.md | **Phase 4 DONE 2026-09-24** (rest PROPOSED) — phase-wise re-sequencing of all pending taskplans. Phase 4 (bare-`<table>` migration): `DataTable` gained a `rowActions` render-prop (Task 121 §3.2's named gap), 18 of 28 grandfathered files migrated across 9 commits, 10 remain with documented structural reasons (print documents, tree/grouped hierarchies, permission matrix, live per-row `<select>`, inline-editable grid, data-viz cells, headerless summary list) — not deferred debt. Other phases: Task 115 grammar rollout (ongoing), Task 121 §3.2 REQ drafting, §3.3 checklist-in-review, Task 116 continuation, Outreach Junior/Senior smoke test (blocked on credentials), Task 90 watch-only, Tasks 118/119/120 blocked on product-owner decision |
| 124_runtime_role_default_privilege_model.md | **PROPOSED 2026-10-01** — design question only. `ALTER DEFAULT PRIVILEGES` (20260826000000) gives `verity_app` full DML on every new table; fine for tenant-RLS tables, wrong default for global ones. `deployment_state` was the one found instance (fixed by migration 20261001000000). Asks whether global tables should be read-only for the runtime by default; needs an ADR before any change |
| 123_enterprise_readiness_evidence_program.md | **PARTIALLY BUILT 2026-10-01** — Phase 1 seeder (`seed:scale`) and Phase 3 k6 harness scaffolded, unit-tested/typechecked, not yet run; no measurement taken, Phase 0 workload numbers still needed. Replaces "Verity is scalable" belief with measured evidence for a ₹10L on-prem client: reference workload model, synthetic scale dataset under `verity_app`/RLS, query/index audit, k6 load harness (incl. transaction-mode pooler stress), timed backup/restore/DR drills, installable on-prem bundle, bounded claim doc. Extends Tasks 30/31/107/108; open decision: air-gapped storage/auth replacement (Phase 5) |
| 120_relay_verity_integration.md | **PARTIAL 2026-09-30** — ADR-029 (PROPOSED) + inert tested primitives; no route/key store/Relay adapter (see the taskplan) — earlier: PROPOSED/DRAFT 2026-09-23 — `D:\Code\relay` (comms/ecommerce infra) as Verity's ecommerce/customer-messaging front, not a duplicate built in Verity. Design: Relay calls Verity via `tool-manifest.ts`'s existing `buildToolManifest()` shape (action direction); Verity pushes customer-facing events out via `integration.ts`'s `IntegrationPort`/adapter pattern (signal direction); Relay gets a real provisioned identity per ADR-017, no service-account bypass. Blocked on: Relay has no backend yet (marketing site only), the authenticated external-tool-invocation HTTP surface doesn't exist in Verity yet, and the same foundation-vs-capability scope question as Task 118 |
| 74_erpclaw_capability_selling.md | superseded in large part by ADR-018 (2026-09-04) — see below; any scope beyond what `trading` now provides stays open |
| 75_erpclaw_capability_buying.md | superseded in large part by ADR-018 (2026-09-04) — see below; any scope beyond what `trading` now provides stays open |
| 76_erpclaw_capability_payments.md | superseded in large part by ADR-018 (2026-09-04) — see below; any scope beyond what `trading` now provides stays open |
| 79_erpclaw_capability_payroll.md | no Indian statutory spec (PF/ESI/TDS/Form 16) exists to build against — real research needed first, not code |
| 80_erpclaw_capability_advanced_accounting.md | needs Task 72 settled + an enterprise consolidation/lease-accounting client; neither present |
| 83_erpclaw_vertical_module_registry.md | reference table — not a build plan for any row |
| 88_reconciliation_as_a_platform_pattern.md | trigger: second reconciliation instance — unfired. Task 87 (built 2026-09-09, see Done) was the likely first candidate but is customer/supplier/item, not bank-statement — still no reconciliation instance to generalize from |
| 89_period_locking_as_a_platform_pattern.md | trigger: payroll (79) or a second finance-heavy client — unfired |
| 90_attention_platform_concept.md | **requires ADR** if generalized — rechecked 2026-09-04 (`e96dfea`): inventory's reorder-level field exists but no query surfaces it; trigger ("two capabilities independently wanting this") has **not** fired |
| `DocumentTemplate` (from Task 104's correction) | trigger: a real document-generation requirement (quotation/invoice PDF layout, notice text) — no design question left, mirror `NotificationTemplate`'s exact shape + reuse `renderTemplate()`, unfired |
| 95_verity_ai_long_term_vision.md | aspirational, not a build plan; subordinate to Task 84 (now complete for near-term scope, but "proven" means real usage); phase 6 needs its own future ADR |
| 96_pending_roadmap_phases.md | sequencing doc for Tasks 72–95 — Phases 1/3/4 complete 2026-09-04, Phase 2 explicitly skipped, Phase 5 aspirational |
| 97_deep_codebase_cleanup.md | **Findings 1/3/6 all DONE** — 1/6 confirmed 2026-09-17 as already done 2026-09-04 (`e92dbee`, this index's own claim of "still blocked" was stale); Finding 3 fixed 2026-09-04; Finding 4 closed by Task 110. Remaining findings (2, 5, 7) are informational/no-action per the file's own text |
| 98_liquid_glass_react_extraction.md | narrow candidate (glass-shell/overlay static dispersion) applied 2026-09-04; the sign-in-mark candidate explicitly rejected (ADR-012 monochrome-mark conflict) |
| 99_verity_custom_skills_plan.md (Skill 6 only) | `verity-capability-boundary-check` needs real design work (what counts as a platform-touching change is not always a clean file-path rule) — worth scoping once two developers work in parallel, not before. Skills 1-5, 7-8 all built (see Done) |
| 100_dashboard_intelligence_direction.md | **Sparklines BUILT 2026-09-20** — real `metricsHistory` wired into `/overview` via the existing `BarStrip` primitive, confirmed real accumulated history first (5-14 daily snapshots). Metrics-history capability and the shadcn NO decision were already resolved 2026-09-17. Remaining: the non-conflicting layout parts (asymmetric layout, intelligent cards, per-role views) — buildable whenever Overview is next a priority, not blocked |
| 101_remaining_work_master_plan.md | Sequencing doc; **refreshed 2026-09-17 addendum** covers Tasks 102-114 (previously stopped at 2026-09-04). Not itself a build |
| 105_pa_oms_outreach_capability.md | **Phases 0/0.5/1/2/3/4/5 + role-based settings batch BUILT and LIVE 2026-09-12/13** — full command coverage in UI, role-scoped Junior/Senior/Company-Core views, Company Direction + Attention exceptions + Direction history, company weekly roll-up + bottleneck detection, per-team permission enforcement, account settings + password change (all roles), Senior roster management (add/remove/rename), Founder team comparison + escalation queue, 14 passing tests, all 19 real logins. Open: a real visual redesign of the 3 role views (still reuses one design system's ordinary components), vertical/channel intelligence, Phase 6 (deferred P2), test coverage for the 6 newest commands/queries. Superset PRD: see 106 below |
| 106_pa_oms_deep_operations_prd.md | **Phases 1-8 DONE 2026-09-14/15** — Contact/Research(file upload)/Task/Meeting/CoachingNote entities, duplicate detection, `deriveLeadHealth()`, target-supersession + ownership audit trails, daily-report review (`OutreachCheckInReview`, append-only, corrected mid-build after a DB-trigger-caused bug), follow-up bucketing, lead review queues, target-distribution UI; Phase 7: Company Pulse + windowed Team Comparison (Today/Week/Month/All), `/outreach/intelligence` (conversion funnel + bottleneck, by-industry, by-channel), Direction field extension, and a correction — `outreach_direction`'s stored `status` was never true (append-only table), now derived. 57 outreach tests (6 new, all pass; 5 pre-existing environmental failures on the remote DB — storage driver, pooler timeouts). Phase 8 (lean): append-only `OutreachAiInsight` with provenance, `generateLeadInsight` action over the Task 84 agent turn narrowed via new `runAgentTurn` `toolKeys`, lead-detail panel; 6 new tests. BLOCKED for live use by deployment config: `OPENAI_MODEL=groq/compound` has no tool calling (the Task 84 dock never worked here), and Groq free tier's 8k TPM is under one grounded turn |
| 109_pa_oms_outreach_domain_intelligence_and_ux.md | **BUILT 2026-09-17** — Phases A-H complete (continues 105/106's Phase A-Z lettering). F: domain funnel/velocity/aging queries + `/outreach/domains` pages. G: Kanban board, Cmd/Ctrl+K command palette, file shelf grid. H: all notification triggers wired except "unusual pipeline movement" (skipped — no threshold defined, product owner declined to invent one). Compensation calc and role-progression tooling permanently excluded per product-owner scope call; Experiments/Domain-Learnings deferred |
| 110_repo_root_cleanup.md | **BUILT 2026-09-17** — closes Task 97 Finding 4 (never acted on). Vertical-reference PRDs, erpclaw-prd/odoo-prd trees moved to `docs/reference/`; pitch decks to `business/pitch-decks/`; pre-V2 HQ/plywood-audit/experience-system docs archived under `docs/archive/`; one unreferenced screenshot deleted. `taskplans/`, `verity-bible/`, `verity-spec/`, `implementation/`, `design/`, `verity-app-ui-mockups/` deliberately untouched (flat-by-design or CLAUDE.md-cited). `tsc --noEmit` clean after the move |
| 111_global_settings_and_shell_ux_pattern.md | **Corrected 2026-09-18**: material question re-resolved in part by **ADR-024** (chrome reverts to glass; content stays solid per ADR-023). Settings/Home IA still mostly unbuilt — a basic `/settings` link-index exists (2026-09-18, via Task 114 P1.5 item 9), the three-pane shell + shade-ramp preview + Home dashboard IA do not. Full execution moved to **Task 115** |
| 112_complete_ui_ux_upgrade_to_structured_minimalism.md | **Corrected 2026-09-18**: partially superseded by **ADR-024** — chrome components (`ShellChrome`, `CommandPalette`, `AgentChatDock`, `Modal`, `Combobox`, `OverflowMenu`, `ProfileMenu`) reverted from solid back to glass; dense-content migration (Outreach's 17 files, admin screens, `DataTable`/forms) is UNCHANGED and still correct |
| 113_ai_implementation_audit_all_clients_and_global_agent.md | **DONE 2026-09-18, all 5 items** (index corrected 2026-09-20 — item 3 was already resolved in the taskplan's own text, this row just hadn't caught up). Item 1 (agent-channel regression): none found, ADR-017 holds. Item 2: `groq/compound` confirmed still broken, swapped to `openai/gpt-oss-120b`, but surfaced a second bug — tool call succeeds, insight still doesn't persist. Item 3 (per-tenant reality): live `DIRECT_URL` access confirmed zero `outreach_ai_insight` rows across all 5 tenants — the feature has never persisted an insight in production, confirmed not inferred. Item 4 (`toolKeys`): confirmed generic, no Outreach-specific coupling. Item 5: Task 95 phases 1-2 built, 3-6 correctly still not |
| 114_pa_oms_outreach_execution_layer_redesign.md | **P0/P1/P1.5 (all 9 items) DONE 2026-09-17/18** — see the taskplan's own Status section and `taskplans/handoffs/outreach-p0-continuation.md`. Only P2 (sequences/activity-type forms/enrichment) remains, parked pending product-owner scoping |
| 115_apple_design_system_governing_docs_overhaul.md | **CLOSED 2026-09-18** — governing Apple-craft layer and ADR-025 patterns completed; later product-owner corrections (blue default, removed persistent workspace pills, restrained layered content glass) are tracked by Task 116 and must be reconciled into governing text during its Phase 0 |
| 116_apple_quality_visual_ux_completion_program.md | **IN PROGRESS 2026-09-19.** Phase 0 route-family inventory and partial authenticated baseline recorded; full role/theme/viewport evidence remains open. First Phase 1 slice adds shared `HeroSignal`/`SignalRail` and replaces `/overview`'s duplicated equal-weight KPI opening with an asymmetric real-data business pulse. Platform-wide, page-family and role-specific completion remains open. Latest direction: dark graphite, subtle blue, no bloom, no persistent workspace pills |
| 117_colonel_kebabz_ui_completion.md | **BUILT + VERIFIED LIVE 2026-09-20.** Odoo-lens audit found Colonel Kebabz capabilities registering nav that 404'd (or, for `crm`, collided with plywood's `/customers`) and `coupon` with zero nav/query at all. All 8 phases have a working screen. Real logged-in pass: activated the 7 capabilities + granted Owner-role permissions (both pre-existing tenant-setup gaps, not code), then verified with real writes (expense record→approve→P&L, cash reconciliation incl. its variance-note gate). Found and fixed one real bug: `/attendance` 500'd on a function prop crossing the Server/Client boundary |
