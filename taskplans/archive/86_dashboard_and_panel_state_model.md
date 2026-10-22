# Task 86 — Dashboard & panel state model

Authority: `erpclaw-prd/01-information-architecture-and-pages.md` §2.4
(Dashboard States). User synthesis, 2026-09-03, item 8 (independent
dashboard sections) — merged in here rather than split out, since it's
the same concept applied at panel granularity.

## Status: BUILT 2026-09-04. Checked current implementation first, per
this file's own scope note — real gap confirmed, not already covered:
`/overview` caught `ForbiddenError` per query (denied → empty/null) but
let any OTHER thrown error propagate and crash the whole page. No
"Degraded" state existed at all; a genuine DB error in one panel took
down every panel.

Fixed: `src/components/ui/panelState.ts` (`PanelState<T>` = `ok | denied |
error`, `loadPanel()` — never rejects, so `Promise.all` across independent
panel fetches can't have one failure take the others down). Wired into
`src/app/(shell)/overview/page.tsx`: the owner-console query (feeds nearly
the whole page) now maps to page-level System-failure on real error, still
distinct from denied; the four secondary queries (margin, low-stock,
setup checklist, tax) each render their own inline `ErrorState` (already
existed in `primitives.tsx`, just never reached by a panel-level error
before) without affecting the others. Empty/first-setup was already
correctly handled by the existing `SetupChecklist` gating. Attention state
deferred to Task 90, per this file's own scope.

## What's missing

Verity's Overview page has no named state machine. ERPClaw's model, worth
adopting directly: **Empty/first-setup** (nothing configured, show setup
steps not a blank grid), **Operational** (normal), **Attention** (N things
need it — see Task 90, which this should consume rather than duplicate),
**Degraded** (some sections loaded, one didn't — inventory shows, finance
failed to load), **System failure** (can't reach the database at all).

The second half: each KPI/panel fetches and fails **independently**. A
failing finance query must not blank the whole Overview page — the
sales/inventory panels that loaded successfully still render, and the
failed one shows its own inline error, not a page-level crash.

## Scope

- A named state per dashboard/section, not just "loading/error/data".
- Per-panel fetch isolation on the Overview page specifically — check
  current implementation before assuming it needs changing; may already
  be closer to this than expected.

## Trigger to start

Whenever Overview page work is next touched, or when Task 90 (Attention)
is built, since Attention state depends on this model existing.
