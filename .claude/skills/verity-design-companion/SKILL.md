---
name: verity-design-companion
description: Use alongside `impeccable` for any Verity frontend work — before or during writing/changing UI, pass this skill's Verity-specific palette/material/motion/token constraints (ADR-012/023/024/025) as structured input rather than relying on memory of CLAUDE.md prose. Trigger whenever `impeccable` is invoked in this repo, or whenever a change touches accent colors, card/panel/chrome surfaces, typography, motion, or the monochrome mark.
license: Apache 2.0
---

Authority: `taskplans/99_verity_custom_skills_plan.md` Skill 8. `impeccable`
is deliberately generic across projects. Verity's Experience System
(ADR-012/023/024/025) is real, specific, and currently lives only in
`CLAUDE.md` prose — this skill hands `impeccable` those constraints as a
checklist so a frontend change doesn't drift off-token by relying on the
model having read and remembered the right paragraph.

**This file does not auto-update from `CLAUDE.md` — it is a static
checklist that must be hand-edited whenever the Experience System
changes.** Confirmed stale and corrected 2026-09-18 (Task 115): ADR-024
(2026-09-18) reverted the default accent Mint → Gold and reactivated glass
for structural chrome only, superseding the sections below that read
"Mint default" and "no glass anywhere." ADR-025 (2026-09-18) added six
named component patterns. If you remember this skill from before that
date, work from this file's current text, not memory.

## The constraints, as structured input

**Accent (configurable, ADR-012, default reverted by ADR-024):** ten
approved presets — Warm Sand Gold `#D4A017` (**default since ADR-024**),
Verity Mint `#00D1B2`, Champagne, Ocean Blue, Slate Blue, Indigo, Violet,
Emerald, Rose, Graphite — plus custom hex. Never hard-code an accent value
into a component; everything derives from `--accent-seed` through
`color-mix` in `globals.css`. Contrast against the accent is computed
(`src/server/platform/accent.ts`), never assumed — white does not work on
every preset. **New constraint (ADR-024): accent governs small/interactive
surfaces only — buttons, links, focus rings, active nav state, badges as a
tint/outline. Never a large filled background.** A card or banner filled
edge-to-edge with accent color is the concrete defect ADR-024 was written
against (Outreach's old "Current Direction" banner); rebuild as a bordered
surface with a small accent touch instead.

**Mark (fixed, ADR-012):** the Verity mark is monochrome everywhere,
including the favicon and app icon. It is never recolored by the accent.
This is the one thing in the system that is NOT theme-configurable —
check any new surface that renders the mark against this before shipping.

**Semantic colors (independent of accent, ADR-012):** success/warning/
danger are their own hues (success specifically retuned to a leaf green,
deliberately not the accent hue) so status and theme never read as one
signal. Never let a status color equal the current accent by coincidence
of a particular preset — check against more than one preset if unsure.

**Neutrals and type (brand sheet is the authority, ADR-012):**
`#F7F8FA` / `#0F1115` / `#1C1F24` / `#2A2E33` / `#E6E8EB`; Inter (Thin /
Light / Regular / Medium); icons are thin outline. `design/verity
asthetics.png` is the palette authority — check it directly for anything
this list doesn't cover, never invent a brand color.

**Material (two-treatment system, ADR-024 — supersedes ADR-023's "no
glass anywhere"):** Structural chrome — sidebar, top bar, command palette,
modals, dropdowns/popovers, the mobile nav sheet — uses the glass classes:
`.glass-shell` / `.glass-control` / `.glass-overlay`. Dense content — data
tables, forms, record/prospect cards, long-form text, `Panel`/`Surface`
holding record content, `PermissionDenied` — stays exactly as ADR-023
specified: `.verity-solid`, fully opaque, `1px` hairline border, soft
non-tinted shadow, consistent corner radius. **Do not glass a table, a
form, or long-form text. Do not solid a floating/transient surface.**
Check ADR-024's surface table before choosing either class on a new
component; when editing an existing file, a `.verity-solid` on something
that reads as floating chrome, or a glass class on dense content, is a
signal to migrate it, not to match it. Depth on chrome comes from
translucency + blur; depth on content comes from tonal contrast, spacing,
and shadow — never blur on content. Reference shape observed from the
product-owner screens: light theme uses a warm cream/tan page background
(`#F7F8FA`-family, warmer than pure gray); dark theme uses a near-black
navy page background (`~#0F1115`) — same hairline-plus-shadow structure on
solid content in both, never a glow or a colored halo. Text contrast must
meet WCAG AA on both materials — unchanged from ADR-011, carried through
ADR-023 and ADR-024 without exception. Known open defect: `backdrop-filter`
is currently stripped by the build pipeline on the reactivated glass
classes (confirmed via CSSOM inspection, not yet root-caused — see
`taskplans/handoffs/experience-system-v2-adr024.md`) — glass surfaces
render as tinted/bordered/shadowed solids until that's fixed; still write
the correct class, don't work around the bug by reverting to `.verity-solid`.

**Motion (spring-based, ADR-024 — new, no prior Bible/ADR coverage):**
Interactive/transient surfaces (dropdowns, popovers, modals, sheets,
button press feedback) animate with `framer-motion` springs from
`src/lib/motion.ts` — `springDefault` (critically damped, `damping 1.0`,
`response ~0.35`) by default; `springMomentum` (`damping ~0.8`, slight
bounce) only for genuinely gesture-driven interactions (drag-to-dismiss).
Respect `prefers-reduced-motion`: cross-fade instead of spring/scale, same
treatment `prefers-reduced-transparency` already gets for materials.
Popover/menu surfaces scale from their trigger's `transform-origin`, not
from center. As of Task 115, the presets exist but are wired into few
components — check `src/lib/motion.ts`'s own usages before assuming a
component you're touching already animates correctly.

**Component patterns (ADR-025 — six named patterns, additive to the
above):** split primary action (filled button + chevron opening related
creation commands — `SplitButton.tsx`), icon-chip stat tile with overflow
(`StatTile`/`StatTileRow` in `primitives.tsx`), workspace-switcher card at
the sidebar foot (`OrganizationSwitcher.tsx`'s `stacked` variant), chart
card with a live hover tooltip (not yet built — no chart component exists
to bind it to), filter-chip rows above a filterable list (`FilterChipRow`
in `primitives.tsx`), AI-assistant suggested-prompt rows in the empty
state (`AgentChatDock.tsx`). REQ-IDs: `verity-spec/09_experience/
design-system.md` §2 (`REQ-EXPERIENCE-DESIGNSYSTEM-004` through `-009`).
Use the existing primitive/component before reimplementing a pattern
locally — check `primitives.tsx` and the files named above first.

**Light/dark:** two material interpretations of one system, not two
designs — a change to one surface's light-mode treatment needs its
dark-mode counterpart considered in the same pass, not as a follow-up.

## Procedure

1. Before writing or changing any Verity UI, run through the constraints
   above against the specific surface being touched — solid material
   correctly applied (no stray glass class), does it touch the accent or
   a semantic color, does it render the mark.
2. Hand `impeccable` this as explicit input (not just "follow CLAUDE.md")
   when invoking it for Verity work, so its general design judgment
   operates within these specific bounds rather than defaulting to
   whatever a generic project would use.
3. Check the anti-regression list in `CLAUDE.md`'s Experience System
   section before finishing — it names the specific failure modes already
   seen (glassing a content surface or soliding a chrome surface without
   checking ADR-024's table, hard-coding an accent, filling a large
   surface with flat accent color, recoloring the mark, collapsing success
   into the accent hue, reintroducing scarlet, generic-SaaS drift with no
   material point of view).
4. **Before shipping any new collection/detail/form screen for a
   capability** (or reviewing an existing one against a client complaint
   that it "feels unfinished"), run the `obvious-basics-checklist` skill
   against it. Required, not optional, per `taskplans/121_permanent_
   obvious_basics_enforcement_and_priority_order.md` — this is the
   standing gate that replaces one-off audits: per-row actions, drill-in,
   a ledger/statement for any counterparty entity, print/export, mobile
   table safety (also enforced structurally by ESLint's ban on bare
   `<table>` outside `DataTable`/`SmartTable`/`DynamicTable`), search/
   filter, empty/error states. Cite `verity-spec/09_experience/design-
   system.md` REQ-EXPERIENCE-DESIGNSYSTEM-017..019 (`[PROPOSED]`, not yet
   `[DECIDED]`) for the three categories now spec-drafted from that
   checklist; the rest of the checklist's categories are process-enforced
   here, not yet spec REQ items.
5. **No internal identifiers on screen, and no dead navigation** (2026-10-05, from the HQ live pass
   in `docs/audits/2026-10-05-hq-audit.md`). Never render `verity.<capability>.<entity>`, command
   keys, raw config keys, snake_case field names, or `Verb entity @ Scope` permission strings to a
   user — map them to business labels (`src/components/ui/business/vocabulary.ts`). Never ship
   developer commentary as UI copy ("a provider chosen without a requirement is a guess…"). Every
   sidebar `href` must resolve to a page. These are the most common reasons a Verity screen reads as
   unfinished.
6. **Judge completeness against the client's reference-parity document**, not against what the code
   already has: `clients/<slug>/reference-parity/` (from
   `docs/reference/client-reference-parity-template.md`) and `docs/reference/module-completeness-bar.md`.

## Non-goals

- Not a replacement for `impeccable` — this supplies Verity-specific
  facts; `impeccable` still supplies general design judgment and craft.
- Not a mandate to re-litigate ADR-012/023/024/025 — where this skill and
  a new idea conflict, the ADRs win; propose a new ADR if the conflict is
  a genuine improvement, don't just override in one component.
