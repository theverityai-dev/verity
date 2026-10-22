# Task 92 — Business timeline (per-entity unified history)

Authority: User synthesis, 2026-09-03, items 5 and 10 (the same idea,
given twice — "complete history, not just current state" and "business
timeline" — merged here).

## Status: PARTIALLY BUILT, confirmed 2026-09-04 — the taskplan's own
hypothesis was right. `reconstructHistory()` (Task 38,
`src/server/platform/audit.ts`) already merges field-change and domain-event
streams per entity, oldest-first. `ActivityLog`
(`src/components/ui/business/ActivityLog.tsx`) already captions in business
language via `commandLabelOf`/`fieldLabelOf`
(`src/components/ui/business/vocabulary.ts`) and is wired into purchase and
sales order detail views (`trading.ts`). This is most of what the taskplan
asked for, already shipped before this task was picked up.

**Real bug found and fixed 2026-09-04:** `ActivityEntry` had no `kind` field,
so a domain-event ("fact") entry's subtitle ran through `fieldLabelOf` on an
event NAME (`verity.plywood.credit_approved`) as if it were a field name,
showing the raw dotted string as a redundant second line under a command
label that already said the same thing in words. Fixed: `kind: "change" |
"fact"` added to `ActivityEntry` and threaded through both call sites in
`trading.ts`; a "fact" entry now shows only its command-label caption, no
subtitle.

**Coverage extended 2026-09-04:** `supplierDetail`/`customerDetail` now
call `reconstructHistory()` and expose an `activity` field, following the
same pattern as purchase/sales order detail exactly (including the
`kind` fix). Wired into a new "Activity" tab in both `SupplierWorkspace`
and `CustomerWorkspace`. Also fixed while there: the two pre-existing
`activity` type declarations (purchase/sales order detail) were missing
`kind` in their TypeScript type even though the runtime already sent it
(silently allowed by structural typing through the `.map()` callback
boundary) — now declared correctly on all four.

**Still open** (genuinely PENDING, not silently claimed done):
- Employee (HR) and asset detail views don't exist as pages yet in any
  capability — nothing to wire until one does.
- A dedicated, standalone "timeline" reading experience distinct from the
  existing per-record activity panel was not built — `ActivityLog` already
  supports oldest-first rendering (a caller just passes `history` instead
  of `history.slice().reverse()`), so nothing new is needed in the
  component if/when that view is wanted.

## What's likely already there

`taskplans/38_audit_business_history.md` is marked DONE in the status
index ("Status: COMPLETE — BUILT and PROVEN"). Before treating this as new
work, read what Task 38 actually built — this may be a UI/presentation
gap over already-built data (audit rows, domain events with
`correlationId`), not a missing data model.

## What the user is asking for, concretely

Not raw audit rows or a generic events list — a narrative, per-entity
timeline a human reads top to bottom: *09:42 Order created · 09:45 Credit
approved · 10:03 Material reserved · 11:20 Shipment created · 14:15
Dispatched · 18:42 Delivered · 19:05 Invoice raised.* For any entity that
has one: customer, order, shipment, employee, invoice, asset.

## Scope, once Task 38's actual output is confirmed

- A rendering layer over existing `domainEvent`/audit rows, grouped and
  captioned in business language (Task 81 rule 3's vocabulary applied to
  history, not just live actions).
- Not a new event/audit data model — Task 38 already owns that.

## Trigger to start

Read Task 38's implementation first. If it already exposes something
close to this, this task shrinks to "build the timeline component"; if
it's genuinely audit-log-shaped only, this stays a real gap.
