# Verity Master Platform Specification

## 09_experience/design-system.md

## Provenance
*   **Primary Sources**: `SOURCE_UNAVAILABLE`
*   **Verity Bible Authority**: `verity-bible/volume_5_operations_security.md`
*   **Transformation Type**: ADOPT
*   **Open Decisions**: None

---

## 1. Brand Tokens And Layouts Colors Specification

This document details the `experience` system specifications for `Design System`.

### REQ-EXPERIENCE-DESIGNSYSTEM-001
*   **Requirement**: The system utilizes `base` core patterns for `brand tokens and layouts colors`.
*   **Status**: `[UNKNOWN_REASON: FUTURE_CAPABILITY]`

### REQ-EXPERIENCE-DESIGNSYSTEM-002
*   **Requirement**: Operational metrics and logs are scoped by `tenant_id` at the database middleware layer.
*   **Status**: `[INFERRED]`

### REQ-EXPERIENCE-DESIGNSYSTEM-003
*   **Requirement**: Actions must publish change logs to the Event Bus on commit.
*   **Status**: `[UNKNOWN_REASON: FUTURE_CAPABILITY]`

---

## 2. Apple-Craft Component Pattern Library

Authority: `Bible V4 §1` (UX Constitution), `ADR-024` (accent/motion), `ADR-025` (patterns), `ADR-026`
(the six named component patterns below). Task 115.

### REQ-EXPERIENCE-DESIGNSYSTEM-004
*   **Requirement**: A page offering a single most-likely creation action alongside two or
    more related creation commands uses the split primary action pattern (filled button +
    attached chevron opening a menu of the related commands) rather than a bare button plus
    a separate menu trigger.
*   **Authority**: `ADR-025` pattern 1 (split primary action).
*   **Status**: `[DECIDED]`

### REQ-EXPERIENCE-DESIGNSYSTEM-005
*   **Requirement**: A metric tile displays an accent-tinted icon chip, label, value, and
    delta-vs-prior-period together, with an optional per-tile overflow control, rather than
    a bare number-and-label pair.
*   **Authority**: `ADR-025` pattern 2 (icon-chip stat tile).
*   **Status**: `[DECIDED]`

### REQ-EXPERIENCE-DESIGNSYSTEM-006
*   **Requirement**: The active tenant/organization identity is presented as a bordered card
    at the shell's structural foot (sidebar or equivalent), not only as a bare dropdown
    trigger in the masthead.
*   **Authority**: `ADR-025` pattern 3 (workspace-switcher card).
*   **Status**: `[DECIDED]`

### REQ-EXPERIENCE-DESIGNSYSTEM-007
*   **Requirement**: A chart card exposes every plotted series' exact value at the pointer's
    hovered position via a live tooltip, rather than requiring a separate legend lookup.
*   **Authority**: `ADR-025` pattern 4 (chart card with live tooltip).
*   **Status**: `[UNKNOWN_REASON: NOT_YET_BUILT]` — no line/area chart component exists in
    the codebase to bind this requirement to; tracked in `taskplans/115_apple_design_system_
    governing_docs_overhaul.md`.

### REQ-EXPERIENCE-DESIGNSYSTEM-008
*   **Requirement**: A filterable row list (tasks, work queues, and similar) exposes its
    filters as count-chips above the list, using one shared chip-row primitive rather than
    a page-local implementation.
*   **Authority**: `ADR-025` pattern 5 (filter-chip rows).
*   **Status**: `[DECIDED]`

### REQ-EXPERIENCE-DESIGNSYSTEM-009
*   **Requirement**: The AI assistant's empty/idle state offers suggested prompts as
    full-width tappable rows that populate (not auto-send) the input, rather than a bulleted
    list of examples.
*   **Authority**: `ADR-025` pattern 6 (AI-assistant suggested-prompt rows).
*   **Status**: `[DECIDED]`

### REQ-EXPERIENCE-DESIGNSYSTEM-020
*   **Requirement**: Ordinary cards and panels use the shared layered glass material with
    atmospheric color, translucent gradient, blur, edge light and controlled elevation. Dense
    tables, forms, long-form text and destructive confirmation may use the shared opaque
    material when it improves reading or decision safety; individual rows, badges and status
    dots never receive glass blur.
*   **Authority**: `ADR-026` (layered glass content surfaces and visual field).
*   **Status**: `[DECIDED]`
*   **Renumber note (2026-09-24, Task 122)**: was REQ-EXPERIENCE-DESIGNSYSTEM-015, which
    collided with an unrelated REQ-015 in §3 below (a real duplicate-ID bug, not intentional —
    grep-verified no code or spec file cites either by number, so renumbering is safe). See the
    matching note on REQ-021.

### REQ-EXPERIENCE-DESIGNSYSTEM-021
*   **Requirement**: The visual field uses the configurable accent seed and semantic tokens for
    color, supports light/dark parity, preserves WCAG AA, and honors reduced-motion and
    reduced-transparency preferences. Visual anchors such as charts, icon chips, atmospheric
    fields and empty states must reinforce the page's operational purpose.
*   **Authority**: `ADR-026` (layered glass content surfaces and visual field).
*   **Status**: `[DECIDED]`
*   **Renumber note (2026-09-24, Task 122)**: was REQ-EXPERIENCE-DESIGNSYSTEM-016, same
    collision and same safety check as REQ-020 above.

---

## 3. Operational Interaction Grammar

This section turns the visual system into a repeatable operating grammar. It
draws workflow structure from Odoo's record, list, search, and activity views,
but it does not import Odoo's XML engine or reproduce its UI literally. Verity
uses familiar business-software patterns with Apple-style restraint: clear
hierarchy, direct manipulation only where a write is safe, generous touch
targets, quiet surfaces, and one obvious next action.

### REQ-EXPERIENCE-DESIGNSYSTEM-010
*   **Requirement**: A workspace page presents one clear title, optional contextual explanation, record state where relevant, and the single most likely next action before secondary commands. Secondary, destructive, or terminal commands are progressively disclosed and remain capability-guarded.
*   **Status**: `[DECIDED]`

### REQ-EXPERIENCE-DESIGNSYSTEM-011
*   **Requirement**: A record detail keeps its overview and next action visible before related information. Related entities, history, and collaboration use labelled tabs or bounded panels; they must not become an unstructured, endlessly-scrolling form.
*   **Status**: `[DECIDED]`

### REQ-EXPERIENCE-DESIGNSYSTEM-012
*   **Requirement**: Collection views use the shared table/list grammar: identity-first rows, a local filter when the visible collection is large enough to need it, explicit sorting, pagination or a bounded viewport, a named empty state, and an available first-create path. Role and team scopes are resolved server-side; client filters only refine records already safe to show.
*   **Status**: `[DECIDED]`

### REQ-EXPERIENCE-DESIGNSYSTEM-013
*   **Requirement**: A form control has a persistent label, one clear control, optional concise help, and an adjacent textual validation error. Controls use the shared `Field`, `Input`, `Textarea`, `Select`, `Checkbox`, and combobox primitives; placeholder text is not a label. Standard editable controls provide a minimum 44px target and the shared focus treatment.
*   **Status**: `[DECIDED]`

### REQ-EXPERIENCE-DESIGNSYSTEM-014
*   **Requirement**: A native-style select is reserved for short, fixed, immediately scannable choices. A searchable combobox is used for people, organizations, large taxonomies, or choices that require filtering. Both expose their current value, keyboard operation, disabled state, and a consistent focus/error treatment.
*   **Status**: `[DECIDED]`

### REQ-EXPERIENCE-DESIGNSYSTEM-015
*   **Requirement**: A write has an explicit commit affordance and a visible pending, success, or failure outcome. Cancel does not mutate state; destructive or irreversible operations require a confirmation that names their consequence. UI affordance never substitutes for server authorization or workflow validation.
*   **Status**: `[DECIDED]`

### REQ-EXPERIENCE-DESIGNSYSTEM-016
*   **Requirement**: Loading, empty, degraded, denied, and error states explain what happened and offer only a safe next step. A screen must not present a silent blank area as if the user has no records or no permission.
*   **Status**: `[DECIDED]`

### REQ-EXPERIENCE-DESIGNSYSTEM-017
*   **Requirement**: A collection-view row for an entity with a lifecycle state exposes its obvious next-state action inline (e.g. Approve, Cancel, Adjust), not only from a separate action screen the operator must re-find the same record on.
*   **Status**: `[DECIDED]` — ratified 2026-09-24 (Task 122 Phase 2). Largely already true: `DataTable`'s `rowActions` prop already ships this in `FinanceDesk`/`SalesDesk`; ratifying names the existing shape as the required one, not a new build.

### REQ-EXPERIENCE-DESIGNSYSTEM-018
*   **Requirement**: Any entity holding a counterparty relationship (customer, supplier, dealer, or an equivalent party-like entity in a future capability) exposes a running ledger/statement view — generalizing the pattern already built in `src/app/(shell)/ledgers/LedgerView.tsx` platform-wide via a shared query/component, not left to each capability to reinvent or omit.
*   **Status**: `[DECIDED]`, **build blocked** — checked 2026-09-24 (Task 122 follow-up), product owner confirmed same session. No shared platform primitive exists yet, only `LedgerView.tsx`'s own capability-local (`trading`) pattern — and no second capability has a counterparty-balance concept to generalize *to* today (checked `accounting` — general-ledger/chart-of-accounts, a different concept; `billing` — bills the tenant itself, no counterparty; `crm` — marketing profile, no balance). Extracting a "shared platform primitive" now, with zero second caller, would be a single-implementation abstraction — the anti-pattern this repo's own engineering posture argues against (no speculative extension points for one implementation). Deferred pending a real second consumer or an explicit instruction to build the seam anyway; do not report this REQ as satisfied, and do not build the generalization speculatively in the meantime.

### REQ-EXPERIENCE-DESIGNSYSTEM-019
*   **Requirement**: A record meant to leave the system to an external party (an invoice, a purchase order, a certificate) has a print/PDF path. A CSV/data export alone does not satisfy this — the recipient is assumed to want a document, not a spreadsheet.
*   **Status**: `[DECIDED]` — ratified 2026-09-24 (Task 122 Phase 2), verified same day: `BillView.tsx` and `InvoiceView.tsx` both already had a real print path (`window.print()`, `print:hidden`/`print:border-0` CSS). `PurchaseOrderView.tsx` — the REQ's own third named example — had none; added the same day: a dedicated print-only document block (`hidden print:block`) carrying only what a supplier needs (order lines, HSN, rate, GST total), with the rest of the page's operational chrome (receiving form, three-way match, activity log) marked `print:hidden`, since that page is a working desk, not a document-only view like the other two. All three named examples now satisfy this REQ.

### REQ-EXPERIENCE-DESIGNSYSTEM-022
*   **Requirement**: A collection view whose rows commonly need the same action applied to several at once (approve, assign, tag, export) offers a bulk-selection affordance — a checkbox per row plus a "select all shown" control — and surfaces the chosen action(s) in place of the row-count line once 1+ rows are checked, rather than requiring the same command be repeated per row. `DataTable`'s existing `bulkActions` prop is the reference shape; a capability does not invent a second selection mechanism.
*   **Status**: `[DECIDED]` — ratified 2026-09-24 (Task 122 Phase 2). Already shipped infrastructure: `DataTable`'s `bulkActions` prop, used today in Prospects' `BulkActionBar`; ratifying names the existing shape as the required one.

### REQ-EXPERIENCE-DESIGNSYSTEM-023
*   **Requirement**: A record type that a person refers to by a short human name in conversation or on paper (an order, an invoice, a bill, a work item) carries a stable, sequential, human-readable number distinct from its internal identifier, generated at creation and shown wherever the record is referenced. A raw UUID or CUID fragment is not an acceptable substitute in a caption, a printed document, or a search field.
*   **Status**: `[DECIDED]`, **satisfied** — checked 2026-09-24 (Task 122 follow-up). The "known real gap" noted at ratification was stale: `orderNumber()` (`src/server/capabilities/trading/orders.ts`, added in the earlier audit-remediation pass, commit `c923ec0`) already assigns a gapless sequential reference at creation for both `createPurchaseOrder` and `createSalesOrder`, sharing the same counter invoices use. `PurchaseDesk.tsx`/`SalesDesk.tsx`'s `id.slice(0, 8)` is defensive display for pre-migration rows with a null `reference` only, not the creation path — verified against `orders.ts` directly, not assumed from the fallback's presence.

### REQ-EXPERIENCE-DESIGNSYSTEM-024
*   **Requirement**: A state transition on a record that another person is responsible for acting on next (an approval request, an assignment, a dispatch) raises a notification to that person at the moment of transition, through the platform's existing notification mechanism — not left as a fact only visible if the responsible person happens to reopen the record.
*   **Status**: `[DECIDED]` — ratified 2026-09-24 (Task 122 Phase 2). First real wiring landed same-day follow-up: `trading/orders.ts` gained `notifyPermissionHolders()` (recipients = tenant members whose role holds `ActionExecute` on the entity, same resolution shape as `requestAccess` in `src/server/actions/access-request.ts`, minus the acting user) and two `notify()` calls — `submitPurchaseOrder` (next actor: whoever receives) and `reserveForOrder`'s transition to `dispatching` (next actor: whoever dispatches). `pending_credit`/`approveCredit` was considered and rejected as a wiring target: no live code path sets an order into `pending_credit` any more (credit gate removed, per that handler's own comment — "every order is approved"), so it is dead state, not a real handoff. Still not retrofitted: `receiveGoods`, `dispatchOrder`, `cancelPurchaseOrder`/`cancelSalesOrder`, and every non-trading capability's transitions — this closes the two clearest trading examples, not the whole surface.

### REQ-EXPERIENCE-DESIGNSYSTEM-025
*   **Requirement**: Colour has three jobs that never swap (ADR-046 §2): the tint marks what is interactive or selected; state colour marks condition and comes only from `StateCategory`; one of eight kind hues marks what sort of thing is shown. Kind hues appear only on icon tiles, icon discs, avatars and chart series, never on pills, buttons, links, text, borders, cell backgrounds, focus rings or status dots. A KPI disc that counts one state may take that state's colours.
*   **Status**: `[DECIDED]` — ADR-046, accepted 2026-10-16. Tokens in `src/app/globals.css`; map in `src/components/ui/business/domains.ts`; contrast and distinctness enforced by `src/test/kind-hue-contrast.test.ts`.

### REQ-EXPERIENCE-DESIGNSYSTEM-026
*   **Requirement**: A kind's hue and glyph come from the one map in `domains.ts`. A page never chooses a kind colour; the same kind looks the same on every screen. An unknown kind falls back to neutral slate.
*   **Status**: `[DECIDED]` — ADR-046 §4. `IconTile` / `IconDisc` (`src/components/ui/IconTile.tsx`) and `Avatar` read it.

### REQ-EXPERIENCE-DESIGNSYSTEM-027
*   **Requirement**: A state is drawn as a solid pill: a saturated fill of the state colour, a dot and a word (white; amber takes a near-black word), the word at least 4.5:1 on its fill in both themes (ADR-053 amendment 2026-10-23). Each state and kind hue has `-fill`, `-on` (the word or glyph on that fill) and `-ink` (the colour as plain text on glass; never on its own fill). `StateBadge` is the only implementation. A roll-up of several states shows the highest-attention one.
*   **Status**: `[DECIDED]` — ADR-046 §5. `StateBadge` changed in place 2026-10-16 (every page inherits it).

### REQ-EXPERIENCE-DESIGNSYSTEM-028
*   **Requirement**: A graphic (ring, bar, stepper, sparkline, stacked bar, gauge, chart) is drawn only from values the page's own query returns. No sample, padded or smoothed series. A series that cannot be drawn honestly renders nothing and the figure stands alone. Every graphic has a text equivalent. Charts are server-rendered SVG with no chart library; series take kind hues in `SERIES_ORDER`; more than eight series is a table.
*   **Status**: `[DECIDED]` — ADR-046 §7. `src/components/ui/viz.tsx`, geometry in `viz-geometry.ts` with unit tests beside it.

### REQ-EXPERIENCE-DESIGNSYSTEM-029
*   **Requirement**: A record detail page opens with `EntityHeader`: breadcrumb to its list, title, human reference as a grey chip (REQ-023), state pill, one line of meta facts joined by a middot, one primary action and an overflow.
*   **Status**: `[DECIDED]` — ADR-046 §8. `src/components/ui/EntityHeader.tsx`. Pages adopt it as Task 127 reaches them.

### REQ-EXPERIENCE-DESIGNSYSTEM-030
*   **Requirement**: Icons are Verity's own (Verity Glyphs): drawn in-house on a 24 grid with round caps and joins, stroke set per rendered size (optical sizing), named by meaning in Verity, decorative (`aria-hidden`) with a visible label beside them. No third-party icon package and no copied path data; Apple SF Symbols are never embedded.
*   **Status**: `[DECIDED]` — ADR-046 §9. `strokeFor()` in `src/components/ui/icons.tsx`; first DSEW batch of 24 glyphs added 2026-10-16. Study: `docs/reference/visual-language/library-study.md`.
