# Task Plan 44 — Enterprise Readiness Certification

**Phase 8, Task 9 of 9.** Control document: `35A_phase8_execution_program.md`.
**Depends on:** Tasks 36–43. All of them.

---

## 1. Objective

**No new functionality.** This task verifies and certifies.

It takes the twelve Enterprise Readiness Gates from the control document and
produces an evidence matrix: gate, evidence, test, result. Every gate is rated
**PASS**, **FAIL**, **PARTIAL** or **NOT APPLICABLE**.

No gate may be left unrated, and "looks good" is not a rating.

---

## 2. Rules of Certification

1.  **Evidence, not description.** A gate closes on a command that was run and
    an output that was recorded, a named passing test, or an automated
    structural check. A code excerpt with no run behind it is not evidence.
2.  **PARTIAL is a real, useful result.** A gate that is built and unit-tested
    but never executed against live infrastructure is PARTIAL, and the
    remediation is stated. Rounding it up to PASS is the one thing that would
    make the whole certificate worthless.
3.  **A failure is reported, not fixed here.** If certification finds a gap,
    it is recorded as FAIL or PARTIAL with the work needed. Fixing it inside
    the certification task would mean the certificate describes a system that
    did not exist when it was written.
4.  **Every claim is traceable.** Each row names the file, the test or the
    transcript that supports it.

---

## 3. Deliverables

*   The evidence matrix, twelve rows, in this document.
*   The Phase 8 Definition of Done checklist, sixteen lines, each with its
    supporting evidence.
*   A statement of what Verity is **not** yet ready for — the limitations an
    honest reader needs before they take the certificate to a tender.
*   The Phase 8 verdict.

---

## 4. Acceptance Criteria

*   [x] AC-01 All twelve gates rated, none unrated.
*   [x] AC-02 Every rating cites specific evidence.
*   [x] AC-03 The sixteen Definition-of-Done lines each carry evidence.
*   [x] AC-04 Known limitations are stated, not omitted.
*   [x] AC-05 No new functionality introduced by this task.

---

## 5. Certification (Claude Code, 2026-08-31)

### Status: COMPLETE — CERTIFIED WITH STATED LIMITATIONS

**Baseline:** commit `9e71e42`. Suite: **719 tests, 715 passing, 4 skipped, 0
failing.** `tsc --noEmit`: 0 errors. Phase 8 opened at 521 tests.

---

## 6. Evidence Matrix — the Twelve Gates

| # | Gate | Evidence | Test / Transcript | Result |
|---|---|---|---|---|
| G01 | Portable runtime (no cloud-provider hard dependency) | Built and run as containers with **no Supabase project and no Vercel**: identity via Keycloak/OIDC, storage via MinIO/S3, database in a container | Task 43 §7 execution record; `deployment-package.test.ts` (38) | **PASS** |
| G02 | PostgreSQL portability (migrations from empty) | 42 migrations applied to an empty containerized database; also applied to a dropped-and-recreated local cluster, suite green on the **first** run | Task 43 `migrations applied`; Task 38 §7 | **PASS** |
| G03 | Runtime configuration boundary | One validated boundary; per-provider validation; blank treated as absent (Task 43 defect 4) | `config.test.ts` (13) | **PASS** |
| G04 | External identity federation | OIDC verification (issuer, audience, signature, expiry, claim mapping) proven without an IdP, then **live against Keycloak in-container** | `oidc-provider.test.ts` (26); Task 43 login table | **PASS** |
| G05 | Enterprise authorization | One decision point over three layers; seven deny-by-default paths; channel recorded, provably not consulted; live refusal in-container | `policy-engine.test.ts` (28), `authorization*.test.ts` (30+) | **PASS** |
| G06 | Business history integrity | Correlation across three streams, source, secret withholding, reconstruction; append-only enforced by trigger; proven live | `audit-history.test.ts` (19); Task 43 core-workflow JSON | **PASS** |
| G07 | Integration boundary | Ports and adapters; inbound signature, replay window, constant-time compare; no vendor in the platform, no adapter in a capability | `integration-framework.test.ts` (32) | **PARTIAL** — see §7 |
| G08 | Operational observability | Structured logs, metrics with p95, error capture, dependency timing, build identity, ambient correlation; `/api/metrics` served in-container | `observability.test.ts` (29); Task 43 metrics output | **PARTIAL** — see §7 |
| G09 | Storage abstraction, more than one provider | Second real driver behind an **unchanged** interface; one contract suite run against both; live round trip against MinIO, twice (host and in-container) | `storage-s3.test.ts` (23); Task 41 §7, Task 43 file-upload JSON | **PASS** |
| G10 | Backup and restore | Dump verified by reading it back; restore compared by row counts; proven on the hosted database (Task 33) and in-container (Task 43) | Task 43 backup/restore transcript | **PASS** |
| G11 | Hardened deployment package | No default secrets, no database port, 0600 env file, capabilities dropped, bounded logs, UTC pinned, backup-first upgrade | `deployment-package.test.ts` (38); Task 43 refusal transcripts | **PASS** |
| G12 | Empirical containerized installation | Executed from zero containers, zero volumes, zero images | Task 43 §7 | **PASS** |

**Ten PASS, two PARTIAL, no FAIL, none unrated.**

---

## 7. Why two gates are PARTIAL

Rounding these up would make the whole certificate worthless.

**G07 — Integration boundary.** The contract, the registry, inbound
verification and one reference REST adapter exist and are tested. What has
**not** happened is an exchange with a real external system: every test drives a
fake adapter or an injected `fetch`. The seam is proven the way Task 27's
storage seam was proven *before* Task 41 — by construction, not by a second
implementation against a live counterpart.

*Remediation:* wire one real integration for the first client and run it. Until
then G07 is a well-designed boundary, not a demonstrated one.

**G08 — Operational observability.** The contract is complete and the defaults
work unconfigured. Three real limits, all stated in the code:

*   metrics are **per instance and reset on restart** — with more than one
    replica an operator scrapes each;
*   `p95` comes from a bounded 256-sample reservoir;
*   only the command path and the readiness probe are instrumented. The query
    pipeline, the storage driver and the integration adapter have `timed()`
    available and do not yet call it.

*Remediation:* instrument those three call sites and point a collector at
`/api/metrics`. Neither is architectural work.

---

## 8. Phase 8 Definition of Done

| # | Criterion | Evidence | |
|---|---|---|---|
| 1 | External identity provider boundary works | Keycloak login in-container; 26 tests | ✅ |
| 2 | Enterprise authorization works | one decision point; 28 tests; live denial | ✅ |
| 3 | Tenant / organization / scope enforcement works | RLS + subtree scoping + policy point; INV-001 tests | ✅ |
| 4 | Business audit trail works | correlation, source, redaction, reconstruction; live | ✅ |
| 5 | Integration boundary works | contract + adapter + 32 tests (no live counterpart) | ⚠️ PARTIAL |
| 6 | Operational observability exists | logs, metrics, errors, correlation, build identity | ⚠️ PARTIAL |
| 7 | Storage abstraction has more than one provider | Supabase + S3, interface unchanged, live MinIO | ✅ |
| 8 | Deployment is hardened | 38 enforcement tests + live refusals | ✅ |
| 9 | Fresh Docker deployment actually runs | Task 43, from nothing | ✅ |
| 10 | Migration runs in the containerized environment | 42 migrations, empty database | ✅ |
| 11 | Bootstrap runs in the containerized environment | granted, then idempotent | ✅ |
| 12 | Health and readiness work in the container | 200/200; 503 with the database down, liveness still 200 | ✅ |
| 13 | Backup and restore is proven | verified dump, row counts identical | ✅ |
| 14 | Full regression suite passes | 715 passing, 0 failing, 4 skipped | ✅ |
| 15 | No unresolved P0 security or deployment blocker | see §9 | ✅ |
| 16 | Enterprise readiness certification completed | this document | ✅ |

**Fourteen met, two met with stated limitations, none failed.**

---

## 9. Security posture at certification

*   **INV-001** — the application connects as `verity_app`
    (`NOSUPERUSER NOBYPASSRLS`); `assertRlsEnforceable()` refuses to start
    otherwise. Verified against the containerized database.
*   **No default credential can reach a running deployment** — compose refuses
    (`${VAR:?}`), preflight rejects every `CHANGE_ME` placeholder, and both were
    demonstrated live.
*   **No secret is retained where it cannot be removed** — audit tables refuse
    `UPDATE` for every role, so sensitive values are withheld at write time; log
    fields, log messages, integration errors and S3 errors are each redacted.
*   **The database and object store publish no host port.**
*   **Unknown principals fail closed** — a valid corporate token with no Verity
    identity grants nothing.

**No P0 open.** Three P2 decisions remain open and are recorded, not hidden:
`Global` scope is defined but never granted (needs an ADR); the `own` permission
scope is not implemented (needs an ADR); the credential encryption key is
supplied per call from the environment rather than from a managed KMS.

---

## 10. What Verity is *not* yet ready for

Stated so nobody carries this certificate further than it goes.

*   **High availability.** Single application container, single database. No
    replication, no failover, no multi-replica test.
*   **Scale evidence.** All measurements come from 2 vCPU / 4 GB under
    emulation. Functional, not performance, evidence.
*   **A browser sign-in flow for OIDC.** The verification boundary is proven; the
    authorization-code redirect that sets the session cookie is unbuilt
    (Task 36 scoped it out).
*   **A live external integration.** See G07.
*   **Any industry pack or client capability.** Out of scope by construction —
    Phase 10.
*   **Formal compliance certification.** SOC 2, ISO 27001 and similar are
    organizational programs. This is engineering readiness, which is a
    precondition, not a substitute.

---

## 11. Verdict

Ten gates PASS, two PARTIAL with named remediation, none FAIL. Fourteen of
sixteen Definition-of-Done criteria met outright, two with stated limitations.
Every claim above cites a test file, a transcript, or an automated structural
check.

> **PHASE 8 COMPLETE — Verity Enterprise Deployment Baseline Certified.**
>
> Verity is technically prepared for enterprise / private-cloud deployment,
> with external identity federation, enterprise authorization, auditable
> business operations, integration boundaries, operational observability,
> portable storage, hardened deployment, and an **empirically verified**
> containerized installation path.

Certified subject to §7 and §10. Next: **Phase 9 — AI Platform**, which inherits
Task 37's decision point (an agent is a `PolicyChannel`, governed by the same
model and scoped no wider than the role it carries) and Task 38's correlated
audit trail.
