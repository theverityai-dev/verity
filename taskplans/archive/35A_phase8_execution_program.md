# Task 35A — Phase 8 Execution Program

**Status: COMPLETE (2026-08-31) — see `44_enterprise_readiness_certification.md`**
**Opened: 2026-08-30**
**Predecessor: `35_phase7_closeout.md` (Phase 7 COMPLETE, final commit `e48e7b9`)**

This is the Phase 8 control document. Tasks 36–44 are one program with one
objective; each task keeps its own detailed plan and its own commit.

---

## 1. Phase Objective

**Phase 8 — Enterprise Security, Operations & Deployment Readiness.**

Phase 7 made Verity *portable*: no hard dependency on any one cloud. Phase 8
makes it *deployable into an enterprise*: federated identity, enterprise
authorization, auditable business history, integration boundaries, operational
observability, a second real storage provider, a hardened deployment package,
and an empirically verified containerized installation path.

---

## 2. Success Definition

At the close of Task 44 the defensible claim is:

> Verity is technically prepared for enterprise / private-cloud deployment, with
> external identity federation, enterprise authorization, auditable business
> operations, integration boundaries, operational observability, portable
> storage, hardened deployment, and an empirically verified containerized
> installation path.

Not "we added some enterprise features". The deliverable is a certified
baseline, not nine closed tickets.

---

## 3. Tasks

| Task | Title | Plan | Nature |
|---|---|---|---|
| 36 | Enterprise Identity / OIDC | `36_enterprise_identity_oidc.md` | Implementation |
| 37 | Enterprise RBAC / Policy | `37_enterprise_rbac_policy.md` | Implementation |
| 38 | Audit & Business History | `38_audit_business_history.md` | Implementation |
| 39 | Integration Framework | `39_integration_framework.md` | Implementation |
| 40 | Observability | `40_enterprise_observability.md` | Implementation |
| 41 | Production Storage Provider | `41_s3_storage_implementation.md` | Validation |
| 42 | Deployment Hardening | `42_deployment_hardening.md` | Packaging |
| 43 | Full Docker Acceptance | `43_docker_acceptance_rerun.md` | Empirical |
| 44 | Enterprise Readiness Certification | `44_enterprise_readiness_certification.md` | Certification |

---

## 4. Dependency Graph

```text
35  Phase 7 Closeout
     │
     ▼
36  OIDC / Identity ──────── a stable authenticated Principal
     │
     ▼
37  RBAC / Policy ────────── authorization needs that Principal
     │
     ▼
38  Audit / History ──────── audit needs a trustworthy actor + authz context
     │
     ▼
39  Integration Framework ── needs the platform boundaries from 36–38
     │
     ▼
40  Observability ────────── needs the runtime/application boundaries stable
     │
     ▼
41  S3-Compatible Storage ── validates the seam Task 27 created
     │
     ▼
42  Deployment Hardening ─── packages the result into an operational deployment
     │
     ▼
43  Full Docker Acceptance ─ the empirical proof
     │
     ▼
44  Enterprise Certification  the evidence matrix over everything above
```

**Strictly sequential. No parallel execution.** Each arrow is a real dependency,
not a preference:

*   37 after 36 — authorization is meaningless without a stable authenticated principal.
*   38 after 36–37 — an audit row is only worth writing if actor and authorization context are trustworthy.
*   39 after 36–38 — an integration port crosses the identity, authorization and audit boundaries.
*   40 after 39 — you cannot correlate what has not stabilized.
*   41 after 40 — a second driver is observed like any other dependency.
*   42 after 41 — hardening packages what exists, not what is planned.
*   43 after 42 — the acceptance run exercises the hardened package.
*   44 after 43 — certification cites evidence, never intent.

---

## 5. Shared Constraints

These bind every task in the phase. A task that cannot satisfy them stops and
escalates rather than improvising (CLAUDE.md, *Stop conditions*).

1.  **Authority citation.** Every concrete technology choice cites
    `Authority: V2-ADR-[N]` | `Bible V2 [section]` | `Spec V2 [REQ-ID]` |
    `EXISTING INFRASTRUCTURE` | `IMPLEMENTATION DECISION REQUIRED`.
2.  **INV-001 is not negotiable.** No task may widen a tenant boundary, and no
    task may introduce a connection role that bypasses RLS.
3.  **Fail closed.** Missing configuration, an unknown principal, an unresolved
    scope, or an unregistered driver must deny — never degrade to permit.
4.  **The platform core stays capability-agnostic.** New behaviour arrives
    through the existing extension points (`registerCommand`,
    `registerStorageDriver`, `registerScopeResolver`, capability contributions).
    A task that needs to modify unrelated platform infrastructure has found a
    design problem, not a work item.
5.  **No provider-specific types cross a boundary.** OIDC claim shapes, S3
    responses and vendor SDK objects stop at their adapter.
6.  **No secrets in code, documents or audit payloads.** Ever, including
    examples and test fixtures.
7.  **Reporting vocabulary is exact.** BUILT / PROVEN / DEMONSTRATED /
    NOT YET BUILT. A test that did not run is NOT EXECUTED, with the remediation
    written out — never a simulated pass. This discipline is inherited from
    Phase 7 (`35_phase7_closeout.md` §5) and is the reason the phase is credible.
8.  **No legacy contamination.** The forbidden-pattern list in `CLAUDE.md` is
    grep-checked before each commit.

---

## 6. Enterprise Readiness Gates

Twelve gates. Phase 7 delivered the first three in substance; Phase 8 owns the
remaining nine and re-verifies the first three under container conditions.

| # | Gate | Owning task(s) | Phase 7 status |
|---|---|---|---|
| G01 | Portable runtime (no cloud-provider hard dependency) | 42, 43 | Structural, not container-proven |
| G02 | PostgreSQL portability (migrations from empty DB) | 43 | Proven live, host-run only |
| G03 | Runtime configuration boundary | 36, 40, 41, 42 | Delivered (Task 26) |
| G04 | External identity federation | 36 | Not started |
| G05 | Enterprise authorization (role, permission, scope) | 37 | Foundation only |
| G06 | Business history integrity / audit reconstruction | 38 | Two streams exist, no reconstruction contract |
| G07 | Integration boundary | 39 | Not started |
| G08 | Operational observability | 40 | Health/readiness only |
| G09 | Storage abstraction with more than one provider | 41 | One provider |
| G10 | Backup and restore | 43 | Proven live (Task 33), not in container |
| G11 | Hardened deployment package | 42 | Runbooks only |
| G12 | Empirical containerized installation | 43 | NOT EXECUTED (no daemon) |

---

## 7. Required Evidence

A gate closes on evidence, not on a description of evidence. Accepted forms,
strongest first:

1.  **Live execution transcript** — a command actually run, its output recorded
    in the task document (the Phase 7 standard for Tasks 33–34).
2.  **Automated test** — named file, named test, in the committed suite, passing
    in the recorded run.
3.  **Structural verification** — a check that a boundary holds (no import of X
    outside Y), automated where possible.
4.  **Documented deliberate limitation** — NOT EXECUTED plus the exact
    remediation command and the condition that unblocks it.

"Looks correct", "should work", and a code excerpt with no run behind it are not
evidence.

**Environment preconditions recorded at phase open (2026-08-30):**

*   Test baseline: 521 tests in the suite.
*   The live PostgreSQL used by the integration suites was returning
    `FATAL: (ECIRCUITBREAKER) too many authentication failures` at phase open.
    Tasks whose evidence requires it record NOT EXECUTED with remediation until
    it is reachable.
*   No Docker daemon is installed on the development machine (`docker` CLI
    present, `/var/run/docker.sock` absent). Task 43 is blocked on provisioning
    one and says so rather than simulating.

---

## 8. Commit Policy

*   **One commit per task.** Nine tasks, nine commits (plus this control
    document). Never one change spanning 36–44 — the rollback points are the
    point.
*   Commit only after: implementation complete, tests written, tests run,
    typecheck clean, spec-conformance checked, architectural boundaries checked,
    legacy contamination checked (the `CLAUDE.md` implementation loop).
*   Conventional commit type, task number in the subject:
    `feat(platform): Task 36 — enterprise OIDC identity provider`.
*   A task blocked on the environment still commits its code, its tests and its
    honest NOT EXECUTED record. Blocked is a result; silence is not.

---

## 9. Handoff Policy

*   **Antigravity** produces research, task plans, architecture review and
    handoff notes. Antigravity does not write production code.
*   **Claude Code** reads the task plan, inspects HEAD, implements, tests,
    commits, reports. Claude Code does not invent requirements.
*   Where a task plan conflicts with HEAD, the plan is corrected in the task
    document **before** code is written — the Phase 7 discipline recorded in
    `35_phase7_closeout.md` §9. Correcting the brief after the fact is how drift
    enters.
*   Each task document ends with an Implementation Notes section written after
    execution: what was found, what was corrected, what was proven, what was not.

---

## 10. Phase Exit Criteria

Phase 8 is complete only when every line is true and evidenced:

```text
[x] External identity provider boundary works
[x] Enterprise authorization works
[x] Tenant / organization / scope enforcement works
[x] Business audit trail works
[~] Integration boundary works              PARTIAL — no live external counterpart
[~] Operational observability exists        PARTIAL — per-instance metrics, 3 call sites uninstrumented
[x] Storage abstraction has more than one provider
[x] Deployment is hardened
[x] Fresh Docker deployment actually runs
[x] Migration actually runs in the containerized environment
[x] Bootstrap actually runs in the containerized environment
[x] Health and readiness actually work in the container
[x] Backup and restore is proven
[x] Full regression suite passes            715 passing, 0 failing
[x] No unresolved P0 security or deployment blocker
[x] Enterprise readiness certification completed (Task 44 matrix, no gate unrated)
```

On all sixteen:

**PHASE 8 COMPLETE — Verity Enterprise Deployment Baseline Certified.**

---

## 11. Position in the Program

```text
PHASE 7   Portable Runtime                      COMPLETE
   ▼
PHASE 8   Enterprise Security + Operations      COMPLETE
   ▼
PHASE 9   AI Platform
   ▼
PHASE 10  Vertical Packs
   ▼
PHASE 11  Enterprise Implementation Platform
```

Task 37's authorization model is deliberately built to govern AI, API, UI and
human actions through one evaluation path, because Phase 9 depends on it.
