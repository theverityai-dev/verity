# Task Plan 38 — Audit & Business History

**Phase 8, Task 3 of 9.** Control document: `35A_phase8_execution_program.md`.
**Depends on:** Task 36 (trustworthy actor), Task 37 (authorization context).
**Gate owned:** G06 — business history integrity / audit reconstruction.

---

## 1. Objective

Formalize **Material Business History Integrity**: a sensitive business mutation
must be reconstructable — *who did what, to which object, when, and what
changed* — and the answer must be defensible in a contract dispute.

---

## 2. Three Streams, Deliberately Not One

The brief's central point. They are not the same thing and must not be merged:

| Stream | Question it answers | Where it lives | Retention |
|---|---|---|---|
| **Audit history** | Who changed this record, and from what to what? | `activity` (EXE-AUD-001) | Infinite |
| **Security audit** | Who authenticated, whose permissions moved, who was refused? | `security_audit_event` (EXE-AUD-002) | Compliance clock |
| **Business ledger** | What is the business consequence — stock, money, obligation? | Capability-owned ledgers (e.g. plywood stock ledger) | Business rules |
| **Operational logs** | What did the process do? | stdout / Task 40 | Rotation |

Merging audit and security would force the stricter retention on both. Merging
either with a business ledger would make a bookkeeping correction look like a
tampered audit row. Operational logs are not evidence and never become evidence.

---

## 3. What HEAD Already Has

*   `activity` — field-level changes, append-only at the **database** level:
    `UPDATE` refused for every role without exception, `DELETE` refused for the
    application role and permitted only to a `BYPASSRLS` role the runtime never
    uses (`assertRlsEnforceable` refuses to start on one). EXE-AUD-003 satisfied
    by trigger, not by convention.
*   `domain_event` — write-once facts (MET-EVE-001), written inside the
    command's transaction so a rollback takes them with it.
*   `security_audit_event` — with `AuthorizationDenied` distinct from
    `AuthFailed`.
*   `diffFields()` — only genuinely changed fields are recorded.

This is a strong base. Three things are missing.

---

## 4. The Gap

**G-1. Nothing correlates.** An `activity` row, the `domain_event` it produced
and the `security_audit_event` for the same request share no identifier. Asked
"what else happened in the request that changed this price?", the platform
cannot answer. Correlation is the brief's own list item and the one that makes
reconstruction possible rather than merely plausible.

**G-2. No source is recorded.** Task 37 produces `PolicyChannel`
(`human | api | job | agent`) on every decision and then discards it. "A person
did this" and "an agent did this" are not the same fact, and Phase 9 makes the
difference material.

**G-3. Values are stored verbatim.** `render()` stringifies whatever it is
given. A command that rotates a credential, sets a webhook secret or writes an
API key would write the value into a table that is, by design, impossible to
delete. The brief says it outright: *do not store secrets*.

---

## 5. Design

### 5.1 Correlation

One `correlationId` per command execution, generated in `executeCommand` and
carried on `CommandContext`. It is written to every `activity`, every
`domain_event` and every `security_audit_event` produced under that command.

`correlationId` and `channel` are **required** on `CommandContext`, not
optional. A correlation identifier that can be silently absent is the gap this
task exists to close, and the type is the only place that can enforce it.

### 5.2 Source

`PolicyChannel` from Task 37 is written as `source`. Recorded as text rather
than an enum: the set of channels will grow (Phase 9 will want to distinguish
kinds of agent), and an enum change is a migration on an append-only table.

### 5.3 Secret protection

`redactSensitiveValue()` runs on every value before it is rendered. A field
whose **name** matches the sensitive pattern (password, secret, token, key,
credential, apiKey, privateKey, otp, pin) records the change — the field name,
the fact that it changed, the actor and the time — with the values replaced by
`[redacted]`.

The change is still recorded. That is the point: "the API key was rotated by X
at T" is exactly the audit fact a compliance reviewer needs, and the value is
exactly what they must not be handed.

### 5.4 Reconstruction

```text
reconstructHistory(tx, entityKey, entityId)
        │
        ├── activity rows      → what changed, field by field
        ├── domain events      → what facts were published
        └── correlation groups → what happened together, in one request
```

Returns an ordered timeline of entries, each carrying actor, action, timestamp,
correlation, source, and — for changes — before and after. This is the
answerable form of the brief's question, and it is one function rather than a
convention every reader must reassemble by hand.

---

## 6. Files

```text
prisma/schema.prisma                                  MODIFIED — correlationId, source
prisma/migrations/<ts>_audit_correlation/migration.sql NEW
src/server/platform/command.ts                        MODIFIED — correlation + channel on context
src/server/platform/audit.ts                          MODIFIED — redaction, correlation, reconstruction
src/test/audit-history.test.ts                        NEW
```

---

## 7. Acceptance Criteria

*   [x] AC-01 Every activity, event and security event from one command shares a correlation id.
*   [x] AC-02 The source channel is recorded and is not `human` by accident.
*   [x] AC-03 A sensitive field's value is never written; the change still is.
*   [x] AC-04 `reconstructHistory` answers who / what / when / before / after.
*   [x] AC-05 The correlation view groups a multi-write command into one request.
*   [x] AC-06 Append-only still holds: UPDATE refused, DELETE refused to the app role.
*   [x] AC-07 The four streams stay separate — no merge, no shared table.
*   [x] AC-08 Typecheck clean; suite green.

---

## 8. Implementation Notes (Claude Code, 2026-08-30)

### Status: COMPLETE — BUILT and PROVEN

### What HEAD already got right

The append-only guarantee was real, not aspirational: `UPDATE` refused for every
role by trigger, `DELETE` refused for the application role and permitted only to
a `BYPASSRLS` role the runtime refuses to start on. Two streams, correctly
separated, with `AuthorizationDenied` already distinguished from `AuthFailed`.
None of that was touched.

### Two defects found by building on it

**1. The write-once trigger froze a hard-coded column list.**
`verity.domain_event_append_only()` compares an explicit `ROW(...)` and permits
only `delivered_at` to move. That is the right design — it says exactly what is
frozen — but it means a column added later is **mutable until it is named**. The
columns this task added are correlation and source: the two fields that
establish the *context* of a fact. Leaving them rewritable would have let the
part of the trail that proves two records belong to the same request be edited
while the record it contextualises stayed frozen. The migration extends the
frozen row; two tests hold it.

**2. A test encoded the hosted database's state as a requirement.**
`bootstrap-operator.test.ts` asserted `platformTenantCreated === false`, true of
this project's established database and false of an empty one. It therefore
failed on the very run that matters most — the first bootstrap of a fresh
deployment, which is exactly what Task 43 accepts from — and passed on every run
afterwards, which is the worst possible failure signature. The real property is
"there is exactly one platform tenant and a second call finds it", and that is
what it now asserts. **The suite now passes from a genuinely empty database on
the first run.**

### What was built

| File | Change |
|---|---|
| `prisma/migrations/20260830120000_audit_correlation/` | NEW. `correlation_id` + `source` on `activity` and `domain_event`, `correlation_id` on `security_audit_event`, three indexes, and the extended write-once trigger. |
| `src/server/platform/command.ts` | One `correlationId` per execution, minted before any write; `channel` parameter defaulting to `api`. Both **required** on `CommandContext`. |
| `src/server/platform/audit.ts` | `isSensitiveField`, `REDACTED`, `redactPayload`, correlation/source on every write, `reconstructHistory`, `reconstructRequest`. |
| `src/test/audit-history.test.ts` | NEW, 19 tests. |
| `src/test/bootstrap-operator.test.ts` | The fresh-database fix above. |

### Decisions worth defending

**Correlation is required on the type, not optional.** A correlation identifier
that can be silently absent is the gap this task exists to close; TypeScript is
the only place that can enforce its presence, so it does.

**Sensitive values are withheld at write time, and only there.** The audit table
cannot be updated — by anyone, by design. A secret written into it cannot be
redacted afterwards by an administrator, a support engineer, or a well-meaning
script. The only safe moment is before the `INSERT`.

The match is on the field **name**, not the value: a value-shaped heuristic
("looks like a token") fails in both directions and fails silently. It errs
toward withholding — `tokenizerVersion` is redacted and is not a secret — because
the two errors are not symmetric. Over-redaction costs an auditor one field of
detail; under-redaction costs a customer a leaked credential in a table that
cannot be edited.

**The change is still recorded when the value is not.** "The API key was rotated
by X at T" is precisely the fact a compliance reviewer needs. A null stays null
rather than becoming `[redacted]`, because "this credential was cleared" and
"this credential was set to something" are different events.

**The default channel is `api`, not `human`.** A server action is an API caller.
Recording it as a person would be a fabricated fact in an evidence table — the
same category of error as backfilling a correlation id, which this migration
also declines to do (pre-existing rows honestly have none).

**The business ledger is not folded in.** `reconstructHistory` returns changes
and facts only. A ledger entry is a business consequence owned by a capability;
merging a bookkeeping correction into the audit stream would make a legitimate
adjustment indistinguishable from a tampered audit row. The four streams stay
four streams, and a test asserts it.

### Evidence

```text
Test Files  44 passed (44)
Tests       591 passed | 3 skipped (594)
```

*   Before Task 38: 575. After: 594 (+19). Zero regressions.
*   Migrations applied to a **dropped and recreated** database, then the full
    suite run against it: green on the first run, which is a stronger claim than
    the suite could previously make.
*   `npx tsc --noEmit`: clean.
*   Legacy-pattern scan on changed files: NONE FOUND.

### Carried forward

*   Task 40 consumes `correlationId` as the request-correlation identifier for
    logs and errors, so an operator moves from a log line to the audit trail
    without a join on timestamps.
*   `security_audit_event` is not yet written on an authorization denial. Task 37
    made the denial a value (`PolicyDecision`) rather than only an exception,
    which is what makes recording it possible; wiring it belongs with Task 40's
    error path rather than being bundled here.
