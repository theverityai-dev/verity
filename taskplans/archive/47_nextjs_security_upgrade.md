# Task Plan 47 — Next.js Security Upgrade

**Targeted remediation for the Task 46 P1 blocker.** This task exists to move
the repository off the vulnerable `next@16.2.10` release identified by the
enterprise audit.

**Depends on:** Task 46.  
**Scope:** Next.js upgrade only, plus the minimum lockfile and regression work
needed to prove the upgrade did not break security boundaries, routing, or
deployment behavior.

---

## 1. Objective

Upgrade Next.js to the first fixed release available to this repository, then
prove the application still behaves correctly at its security and deployment
boundaries.

The goal is not to clean up dependencies in general. The goal is to remove the
known framework vulnerability without widening the task into unrelated package
maintenance.

---

## 2. Constraints

1.  **No general dependency cleanup.** Only the Next.js package and direct lock
    file changes required by the upgrade are in scope.
2.  **No architecture changes.** Do not use the upgrade as a chance to refactor
    auth, tenancy, proxying, or server-action structure.
3.  **No production feature work.** If a regression appears, document it. Do not
    fold unrelated fixes into this task.
4.  **Preserve audit history.** Task 46 remains the evidence snapshot of the
    pre-upgrade state.

---

## 3. Upgrade Path

```text
upgrade Next.js
  -> refresh lockfile
  -> npm audit
  -> typecheck
  -> lint
  -> test suite
  -> production build
  -> standalone server / deployment verification
  -> security regression pass
```

The upgrade should stop at the first fixed version that is compatible with the
repository and build pipeline.

---

## 4. Required Verification

### 4.1 Dependency evidence

Run the repository-compatible security and build checks after the upgrade:

```text
npm audit
npm run typecheck
npm run lint
npm run test
npm run build
```

If the repository has a Docker acceptance or standalone server gate, run that
too. Do not report the upgrade complete until the actual deployment path
still works.

### 4.2 Proxy and routing regression

Because the audit identified a Next.js proxy/middleware advisory, explicitly
re-test the request boundary around `src/proxy.ts` and the public probe routes.

Minimum cases:

```text
Unauthenticated -> protected route
Authenticated -> permitted route
Authenticated -> unauthorized route
Wrong tenant -> resource
Malformed session -> protected route
Public health -> 200
Public readiness -> 200 / 503 as appropriate
```

### 4.3 Server action regression

Because the app uses server actions as the mutation boundary, explicitly re-test
the action path after the upgrade:

```text
server action
  -> forged / malformed input
  -> authentication
  -> authorization
  -> tenant scope
  -> mutation
```

Do not accept a successful build as proof that the boundary still behaves.

### 4.4 Deployment regression

If the repository has an existing Docker or standalone acceptance harness,
re-run it after the upgrade so the framework change is validated in the same
shape customers receive.

---

## 5. Deliverables

1.  Updated `package.json` / lockfile with the Next.js fixed release.
2.  A concise change summary explaining exactly what version changed and why.
3.  Verification evidence for audit, typecheck, lint, tests, and build.
4.  Regression evidence for proxy, route, and server-action boundaries.
5.  A final verdict: whether the Next.js blocker is closed.

---

## 6. Acceptance Criteria

*   [ ] AC-01 Next.js is upgraded to a fixed release.
*   [ ] AC-02 The lockfile is updated consistently.
*   [ ] AC-03 `npm audit` no longer reports the original Next.js blocker.
*   [ ] AC-04 `npm run typecheck` passes.
*   [ ] AC-05 `npm run lint` passes.
*   [ ] AC-06 `npm run test` passes.
*   [ ] AC-07 `npm run build` passes.
*   [ ] AC-08 Proxy and protected-route regressions are explicitly checked.
*   [ ] AC-09 Public health/readiness routes still behave correctly.
*   [ ] AC-10 Server-action security boundaries still behave correctly.
*   [ ] AC-11 Deployment / Docker acceptance passes if available in this repo.
*   [ ] AC-12 No unrelated dependency cleanup is bundled into the task.

---

## 7. Expected Result

The task closes only if the repository no longer carries the known Next.js
security blocker and the existing security/deployment behavior still holds.



---

## Outcome (executed 2026-09-01)

`next` and `eslint-config-next` 16.2.10 → **16.3.3**, pinned exact.
Non-semver-major, as `npm audit` predicted.

| | Before | After |
|---|---|---|
| advisories | 11 (10 high, 1 moderate) | 8 (7 high, 1 moderate) |
| `next` high | Turbopack middleware/proxy bypass; server-action DoS | cleared |
| `postcss` high | arbitrary file read via `sourceMappingURL` | cleared |
| `sharp` high | inherited libvips CVEs | cleared |

Both `next` advisories described this application's actual configuration rather
than a hypothetical one — it builds with Turbopack and uses server actions as
its primary write path.

Gate results, in the order this plan specifies:

- `npm audit` — three highs cleared, no new direct advisory.
- `npm run typecheck` — clean.
- `npm run lint` — clean (one pre-existing TanStack compiler warning).
- `npm run test` — green.
- `npm run build` — clean, 70 routes.
- Standalone runtime — `.next/standalone/server.js` produced, with
  `node_modules/.prisma/client` traced into it.

**Docker acceptance was not re-run.** The container runtime was stopped earlier
in this session at the user's request. The standalone output is the artefact the
image wraps and it was verified directly, but the containerised acceptance of
Task 43 has not been repeated against 16.3.3 and should be before a deployment
that relies on it.
