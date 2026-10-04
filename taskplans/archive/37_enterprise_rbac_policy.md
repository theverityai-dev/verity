# Task Plan 37 — Enterprise RBAC / Policy

**Phase 8, Task 2 of 9.** Control document: `35A_phase8_execution_program.md`.
**Depends on:** Task 36 (a stable authenticated `Principal`).
**Gate owned:** G05 — enterprise authorization (role, permission, scope).

---

## 1. Objective

```text
Principal → Organization → Role → Permission → Resource → Scope
```

One authorization model, one evaluation path, for every kind of actor: a person
in the UI, a machine on the API, a background job, and — Phase 9 — an AI agent.
The model must not be able to tell them apart when deciding.

---

## 2. What HEAD Already Has

`authorization.ts` implements all three layers and is well covered
(`authorization.test.ts`, `authorization-layers.test.ts`, 30+ tests):

*   Layer 1 `authorize()` / `hasPermission()` — verb × entity, flattened through
    composite roles in the database, cycles blocked by trigger.
*   Layer 2 `assertRowInScope()` / `scopeFilter()` / `reachableOrganizations()` —
    organization subtree (PLA-ORG-002 downward, PLA-ORG-003 sibling isolation),
    `Location` via a registered scope resolver.
*   Layer 3 `redactFields()` — restricted fields omitted, never nulled.

**This task does not rewrite any of that.** Rewriting a working, tested
authorization engine to satisfy a phase title would be the worst possible trade.

---

## 3. The Actual Gap

Three things, and only three:

**G-1. There is no single decision point.** `executeCommand` calls Layer 1,
`executeQuery` calls Layers 2 and 3, and a server action or API route calls
whichever the author remembered. Each is correct; there is no place that is
*the* answer. An AI agent added in Phase 9 would become a fourth caller with a
fourth set of habits, which is exactly how an authorization model rots.

**G-2. A decision cannot be explained.** `authorize()` throws or returns. PRN-001
requires explainable automation, and Task 38 needs to record *why* an action was
permitted, not merely that it was.

**G-3. Nothing states that the channel is not an input.** The dangerous version
of "AI, API, UI and humans share one model" is a system that quietly trusts a
service account more than a person. The safe version needs the channel to be
recorded and provably unable to change a decision.

---

## 4. Design

### 4.1 `src/server/platform/policy.ts` — the decision point

```text
PolicyRequest { verb, entity, resource?, field?, channel? }
        │
        ▼
evaluatePolicy()  ──►  PolicyDecision { allowed, code, layer, reason, grants, channel }
        │
        └── enforcePolicy() throws ForbiddenError on deny
```

*   `evaluatePolicy()` never throws for a denial — a denial is an answer, and an
    answer can be logged, explained and tested.
*   `enforcePolicy()` is the gate. It throws `ForbiddenError` with the reason,
    preserving the MET-ACT-002 property that forgetting to branch cannot permit.
*   Layers run in order and the decision records which one refused, because
    "the role may not touch this entity" and "this record is in another branch"
    are different operational problems.

### 4.2 Channel is recorded, never consulted

`PolicyChannel = "human" | "api" | "job" | "agent"`.

It appears in `PolicyDecision` for audit (Task 38's `source`) and in nothing
else. A structural test asserts the evaluation code never branches on it, and a
behavioural test asserts the same request decided under all four channels
returns the identical verdict. That is the enforceable form of "AI, API, UI and
human actions are governed by the same authorization model" — an assertion in a
document is not enforceable.

### 4.3 Deny-by-default, enumerated

Every path that cannot produce a positive answer denies:

| Condition | Result |
|---|---|
| No role on the membership | deny (layer 1) |
| Role holds no matching grant | deny (layer 1) |
| Grant scope has no resolver registered | deny (layer 2) |
| Record in an organization outside the subtree | deny (layer 2) |
| Record with no organization, no Tenant-scoped grant | deny (layer 2) |
| Restricted field without the field grant | deny (layer 3) |
| `Global` scope | deny — filtered in `resolve_permissions`, still open (needs ADR) |

### 4.4 The scope axes the brief lists

The brief names Global, Organization, Business Unit, Department, Location,
Project, Record. `PermissionScope` is `Global | Tenant | Organization |
Location` (PLA-AUT-002) and **this task does not add enum values**:

*   **Business Unit** and **Department** are `Organization` nodes. ADR-005 makes
    Organization a nested hierarchy inside a Tenant; a business unit and a
    department are levels of that hierarchy, not new axes. Adding enum values
    for them would put the customer's org-chart vocabulary into the platform
    ontology — the exact coupling the foundation exists to prevent.
*   **Project** and **team**/**resource** are axes: they need a registered
    `ScopeResolver`, not a platform change. The registry already supports this.
*   **Record** (`own`) is actor-relative, appears in neither Bible nor Spec, and
    `CLAUDE.md` requires an ADR before it is added. **Not added here.** Recorded
    as an open decision, not filled in with generic engineering knowledge.

This is documented in the module so the next reader does not re-open it.

### 4.5 UI reflects authorization, never constitutes it

`permittedVerbs(tx, actor, entity)` answers "what should this actor see" for
rendering. It is advisory by construction: it is a read of the same grants the
gate reads, and every mutation still passes `enforcePolicy` server-side. Proven
by a test that grants the UI a verb it does not hold and shows the command still
refuses.

---

## 5. Files

```text
src/server/platform/policy.ts    NEW — the decision point
src/server/platform/command.ts   MODIFIED — routes Layer 1 through the policy point
src/test/policy-engine.test.ts   NEW
```

`authorization.ts` is **unchanged**: policy composes it. A decision point that
reimplemented the layers would be a second authorization model to keep in sync
with the first.

---

## 6. Acceptance Criteria

*   [x] AC-01 `evaluatePolicy` returns a reasoned decision for allow and deny.
*   [x] AC-02 Every deny-by-default row in §4.3 is tested.
*   [x] AC-03 The same request under all four channels yields the same verdict.
*   [x] AC-04 No evaluation code branches on channel (structural test).
*   [x] AC-05 Tenant and organization isolation hold through the policy point.
*   [x] AC-06 A UI-advisory verb does not permit a server-side command.
*   [x] AC-07 `executeCommand` enforces through the policy point; existing
        authorization tests pass unmodified.
*   [x] AC-08 Typecheck clean; suite green.

---

## 7. Implementation Notes (Claude Code, 2026-08-30)

### Status: COMPLETE — BUILT and PROVEN

### The temptation that was refused

The obvious way to make a phase titled "Enterprise RBAC" look substantial is to
rewrite the authorization engine and add scope enum values named after the
words in the brief — Business Unit, Department, Project, Record. That would have
been the worst trade available: a working, thirty-test authorization engine
replaced to satisfy a title, and a customer's org-chart vocabulary welded into
the platform ontology, which is precisely what the foundation exists to prevent.

`authorization.ts` is unchanged by this task. Not one rule moved.

### What was actually missing, and is now built

| File | Change |
|---|---|
| `src/server/platform/policy.ts` | NEW. `evaluatePolicy` (returns a decision), `enforcePolicy` (throws), `explainDecision`, `permittedVerbs`, `grantedScopes`. Composes Layers 1–3; implements none of them. |
| `src/server/platform/command.ts` | Layer 1 now goes through `enforcePolicy` instead of calling `authorize` directly. Same check, one path. |
| `src/test/policy-engine.test.ts` | NEW, 28 tests. |
| `src/test/conformance.test.ts` | Module tripwire 28 → 29, with the reason recorded beside the number. |

### The three decisions worth defending

**A denial is an answer, not an exception.** `evaluatePolicy` returns
`{ allowed, code, layer, reason, grants, channel }`. That is what makes a
refusal loggable (Task 38), explainable (PRN-001) and assertable. `enforcePolicy`
still throws, so MET-ACT-002's property — forgetting to branch cannot permit —
is preserved at the gate.

The decision records **which layer** refused, because "this role may not touch
Work" and "this Work is in another branch" are different operational problems
with different fixes, and an operator handed one message for both will guess.

**The channel is recorded and provably not consulted.** `PolicyChannel` is
`human | api | job | agent`. It travels in the decision for Task 38's `source`
field and is read by nothing in the evaluation. Two tests hold that line: a
behavioural one asserting all four channels produce identical verdicts *and
identical reasons*, and a structural one asserting `policy.ts` contains no
comparison, condition or switch on `channel`.

This matters more than it looks. The dangerous reading of "AI, API, UI and human
actions share one authorization model" is a system that quietly trusts a service
account more than a person — and it is dangerous precisely because it is
convenient. A Phase 9 agent carrying a regional manager's role is scoped to that
manager's subtree and nothing wider; there is a test for that too.

**The scope vocabulary was mapped, not extended.** Written into the module so it
is not re-opened:

*   Business Unit, Department → `Organization` nodes (ADR-005 nested hierarchy).
*   Project, team, resource → axes, served by the existing `ScopeResolver`
    registry. No platform change, and none made.
*   Record / `own` → actor-relative, in neither Bible nor Spec. `CLAUDE.md`
    requires an ADR first. **Not added.** Remains an open decision.
*   `Global` → defined but never granted; still needs a security decision and
    an ADR. Tested: a `Global` permission row can exist and does not take
    effect.

### Deny-by-default, each path tested

All seven rows of §4.3 have a test: no role, no grant, wrong verb, sibling
branch, unscoped record without a Tenant grant, unresolvable scope axis, and a
restricted field without the field grant. The unresolvable-axis case names
itself in the reason (`no resolver registered`) so an operator can tell a
misconfiguration from a legitimate refusal — the two would otherwise look
identical and one of them is a bug.

### UI reflects, never constitutes

`permittedVerbs` and `grantedScopes` exist for rendering. The test that proves
the distinction does the thing a broken client would do: registers a command the
actor's role does not permit and calls it anyway. It raises `E_FORBIDDEN`, from
the same policy point, server-side.

### Evidence

```text
Test Files  43 passed (43)
Tests       572 passed | 3 skipped (575)
```

*   Before Task 37: 547. After: 575 (+28). Zero regressions.
*   `authorization.test.ts` and `authorization-layers.test.ts` pass **unmodified**
    (AC-07) — the decision point did not change any rule they assert.
*   `npx tsc --noEmit`: clean.
*   Legacy-pattern scan on changed files: NONE FOUND.

### Carried forward

*   Task 38 consumes `PolicyDecision.channel` as the audit `source` and
    `PolicyDecision.reason` as the authorization context of a recorded mutation.
*   `executeQuery` still calls Layers 2 and 3 directly (`scopeFilter`,
    `redactFields`). It is not wrong — it is the same rules — but routing it
    through the decision point too would let a query denial be explained the way
    a command denial now is. Deliberately left for a task that has a reason to
    touch the query pipeline rather than bundled here.
