# Task Plan 124 — Runtime role default-privilege model

**Authority:** User synthesis, 2026-10-01, follow-up to the Task 123 security audit
(`verityplus-docs/10-execution/audit/security-invariant-audit-01.md`, addendum) and the accepted
`deployment_state` remediation (migration `20261001000000_revoke_runtime_dml_deployment_state`).
Grounded in migration `20260826000000_runtime_role_privileges`, CLAUDE.md "Database connection roles"
(INV-001), and `src/test/runtime-privileges.test.ts`. Stop-condition note: changing default privileges
is a security-boundary change; it needs an ADR before code, and nothing here is authorised to proceed
without one.

## Status: DECIDED 2026-10-09 (first step built); revocations deferred

Decided by the engineering lead under the product owner's standing instruction to take open decisions
from project context. This is a security-boundary question, so the decision is deliberately the
smallest safe one:

1. **Question 1 and 2: yes in principle, by a per-table declaration enforced by a test**, not a
   separate schema (a schema move would touch every query and migration for a defect that a test
   catches). `src/test/runtime-privileges.test.ts` now lists every table with no `tenant_id` under
   exactly one of read-only, no-access, or global-writable-with-a-reason, and fails when a table is
   missing from the lists or a listed table no longer exists. A new global table therefore cannot
   arrive with the blanket default grant unnoticed. **Built 2026-10-09; 5 tests pass.**
2. **Question 3: keep the six catalogue tables as they are for now.** Revoking their runtime writes
   is right but is not safe to do blind: `installCapabilities` and the pack control plane might write
   one of them at runtime. The next step is to log or trace runtime writes to those six on a
   disposable database over the full test suite; if none occurs, revoke in one migration and move
   them to the read-only list. Until then the declared reason says what holds them.
3. **Question 4: no default-privilege change is made**, so there is no upgrade path to design. The
   existing blanket grant stays; the discovery test is the control.

Original problem statement and survey follow, unchanged.

## Problem

`20260826000000` runs `ALTER DEFAULT PRIVILEGES FOR ROLE <migration owner> IN SCHEMA public GRANT SELECT,
INSERT, UPDATE, DELETE ON TABLES TO verity_app`. It fixed a real defect (new tables arriving unreadable)
and still stands. Its side effect is that **every new table gives the runtime role full DML**, and a later
`GRANT SELECT` cannot subtract from it. A table that is meant to be narrower must therefore remember to
`REVOKE`. Two did (`_prisma_migrations`, `request_quota`); `deployment_state` did not, and the runtime role
could change the restore-quarantine flag until the accepted remediation.

The default is safe for tenant-scoped tables, because tenant RLS is the boundary there. It is the wrong
default for global tables, which have no tenant boundary.

## Survey (2026-10-01, 174 public tables)

159 carry `tenant_id` and sit behind tenant RLS. Of the 15 that do not, the runtime role can write 13:
`oidc_login_transaction`, `scheduler_lease`, `scheduler_run` (write needed), `deployment_state` (fixed), six
catalogue tables protected only by the absence of a write policy (`capability_definition`,
`entity_definition`, `field_permission`, `pack_release`, `state_definition`, `transition_definition`), and
`tenant`, `party`, `user` (scoped policies). No second unintended write was found; the pattern itself is
unchanged.

## Questions for an ADR

1. Should global (non-tenant) tables be exempt from the default grant, so a new one is read-only for the
   runtime role until a migration grants more, in the same spirit as `request_quota`?
2. If so, by mechanism: a separate schema for global tables, a naming convention checked by test, or a
   per-table explicit `GRANT` list replacing the blanket default for non-`tenant_id` tables?
3. What of the six catalogue tables: keep default-deny-by-missing-policy, or revoke writes outright and
   state the intent in a test (`runtime-privileges.test.ts` already has the structure for it)?
4. Compatibility: any change to default privileges affects every future migration and any deployment that
   already ran `20260826000000`. What is the upgrade path, and is it detectable by the conformance test?

## Interim control (already in place)

`src/test/runtime-privileges.test.ts` asserts the effective privileges of named tables. It only protects
tables that are listed, so it is a regression guard for known cases, not a discovery mechanism. A
discovery check (every table without `tenant_id` must be listed with its intended runtime access) is the
natural first step and does not change privileges.

## Non-goals

- Not changing default privileges, adding roles or touching existing grants here.
- Not part of the Task 123 benchmark critical path.
- Not revisiting RLS, which is the tenant boundary and is unchanged.

## Cross-references

Follows Task 123 (`123_enterprise_readiness_evidence_program.md`) and Task 108's audit remediation. Number
ADRs with `verity-adr-gate` (register currently ends at ADR-031).
