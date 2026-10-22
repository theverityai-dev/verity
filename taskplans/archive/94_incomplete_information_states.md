# Task 94 — Representing incomplete information explicitly

Authority: User synthesis, 2026-09-03, second round, item 5.

## Status: MECHANISM DECIDED, 2026-09-04 — no retrofit performed (explicit
non-goal below). Checked `CustomFieldSchema`/`CustomFieldType`
(`prisma/schema.prisma`) directly, per this file's own instruction: the type
set is `String | Number | Boolean | Select | Date`, plain-nullable, with no
existing sentinel for "unknown" vs. "checked and blank" vs. "not
applicable". The gap is real, not already covered.

**Decision: no new primitive.** `Select` already solves this without a
platform change — a capability adds a companion status field (also
`Select`, e.g. "GSTIN verification status" with options `Unknown` /
`Not applicable` / `Verified` / `Checked — declined to provide`) alongside
the value field, rather than overloading the value field itself with a
sentinel string. A picker forces an explicit choice, so "Unknown" becomes a
real, queryable, filterable value distinguishable from a blank the business
never looked at. This is a *modeling pattern* the capability-builder skill
(Task 82) should teach, not new platform code — added to `.claude/skills/
verity-client-capability-builder/SKILL.md`'s rules 2026-09-04.

No plywood field was retrofitted — this file's own non-goal. Stays
genuinely PENDING for a first real application; the mechanism is ready the
moment one arrives.

## What's missing

Real businesses don't operate on perfect records. Verity's data model
should be able to say `Unknown`, `Missing`, `Pending`, `Not applicable`,
or `Not verified` for a field, rather than forcing a fake value (a zero
that means "no data" instead of "actually zero," a blank that could mean
either) or making the field required when the business genuinely doesn't
know yet.

## Why this matters beyond data hygiene

Task 81 rule 9's error taxonomy and Task 84's grounding rule both assume
the system can tell the difference between "this is zero" and "this isn't
known" — an AI agent (Task 84) that can't distinguish "customer GSTIN is
missing" from "customer GSTIN was checked and is blank" will either
hallucinate a value or block on something that isn't actually blocking.

## Scope

- Not a platform-wide nullable-everything mandate. Scoped per field, per
  capability, wherever "we don't know yet" is a real, distinct state from
  "the value is empty" — GSTIN, a customer's credit rating, a delivery
  confirmation.
- Likely expressed through the existing custom-field/entity-definition
  machinery rather than a new column type — check `EntityDefinition`'s
  current field-typing options before assuming a new primitive is needed.

## Trigger to start

The next capability whose data entry genuinely needs this distinction —
plywood's GST fields are a plausible first real instance.

## Non-goals

- Not a mandate to retrofit existing plywood fields.
