# Task 90 — "Attention": a platform-wide exceptions concept

Authority: User synthesis, 2026-09-03, item 9 (their own numbering;
extends `erpclaw-prd/01-information-architecture-and-pages.md` §2.4's
"Warning state" into a standing product concept rather than a dashboard
mood).

## Status: PENDING — genuinely new gap, platform-primitive-shaped

> **2026-11-06:** Task 132 (P1) takes the concrete shape from OpenConstructionERP's `deadlines` sweep: registered due-date sources, one scheduled classifier, outbox notice, escalation on repeat.

## What's missing

Every capability accumulates things that need a human: overdue, blocked,
awaiting approval, a reconciliation difference (Task 88), missing
required information, a failed automation, an expiring document/item, or
unusual activity worth a look. Today each of these is discoverable only
inside its own capability's own screen. The proposal: a single contributed
"Attention" feed, the same shape as the existing workspace-contribution
pattern (`CLAUDE.md`'s "capability contributions" — a capability declares
*where* it appears, never how to draw its page) — each capability
contributes attention items in one shared shape, one shared surface
renders all of them.

## Scope

- A contribution point (`AttentionContribution` or similar), parallel to
  the existing dashboard/navigation contribution pattern — NOT a new
  entity registry, a new query shape over what capabilities already track.
- Consumed by Task 86's dashboard "Attention" state and by whatever
  surfaces a cross-capability "what needs me today" view.

## Trigger to start

This is a genuine platform-primitive candidate, which per `CLAUDE.md`'s
own Authorization/Identity precedent likely wants an ADR before the
contribution shape is finalized — classify as **requires ADR** if picked
up, not as ready-to-build. Two real capabilities each independently
wanting this (plywood likely already has 3+ candidate attention sources:
overdue receivables, pending goods issue, low stock) is the trigger to
write that ADR.

## Trigger watch (2026-09-17)

`taskplans/114_pa_oms_outreach_execution_layer_redesign.md` P0.1 adds a
capability-local "work queue" (overdue/due-today/no-next-action/unassigned/
at-risk) to Outreach. Decision made there: build it Outreach-local, not as
a platform primitive — per this project's own "standardize the foundation,
not every behavior" principle and the anti-pattern against premature
generalization. This is **not** the trigger firing yet (inventory's
`reorderLevel` field still has no surfacing query, so the count of real
capabilities independently building their own exceptions feed is one, not
two — Outreach's queue is functionally similar but this is the first
capability to actually *build* one, not a second independently-arrived-at
instance in the sense this file means). Recorded here so whoever next
touches either Outreach's queue or a second capability's own exceptions
list checks this note before re-deriving the trigger question from
scratch.

## Non-goals

- Not a new notification/alerting delivery mechanism — Verity's
  notification substrate (`notification.ts`, already built) is a
  different concern (push/delivery); this is a read surface.
