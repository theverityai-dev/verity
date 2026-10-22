# Task Plan 127 — Visual language for every screen: colour-coded, graphic, welcoming

**Authority:** Product-owner request, 2026-10-16: two reference screens (a manufacturing *Route detail*,
"Cast resin transformer", and a *Shop floor* worklist) are "how I want every screen to look. Properly colour
coded. High visibility. Whatever can be represented graphically should be, so the interface becomes more
welcoming and interactive. First make a detailed report comprising every screen; plan it; save it as a
taskplan; don't change code yet." Grounded in ADR-033 (iOS Experience System), ADR-009 (`StateCategory` is
closed), Task 115 (design-system grammar), Task 116 (Apple-quality visual UX program; its route × role × theme ×
viewport matrix is reused here as the verification matrix) and `verity-spec/09_experience/design-system.md`.
The reference content (DSEW, transformers, Indore, Adani) is the owner's placeholder; the **look**, not the
content, is the requirement.

## Status: IN PROGRESS — Phase 1 started 2026-10-16; ADR-046 ACCEPTED

**2026-10-23 consistency pass (committed `9b855275`, ADR-053 amendment).** Light-theme glass fixed (cool canvas, stronger blooms, layered shadows; lite effects keeps edge and shadows). Pills and kind tiles are solid saturated fills with `-fill`/`-on`/`-ink` tokens, in both themes. One stat card everywhere (`StatRow` renders `StatTile`); eight DSEW screens got real kinds and states on their `Stat`s. `font-semibold` maps to 500, headline numerals use `.figure`, stray sizes snapped. **Not browser-walked as the DSEW owner** (the dev servers were OIDC-only); verified on a throwaway preview page in light, dark and lite. The Phase 1 pastel values quoted below are superseded.

**Phase 1 progress (2026-10-16, uncommitted). BUILT and PROVEN** (`kind-hue-contrast.test.ts` 5 tests,
`viz-geometry.test.ts` 15 tests, `nav-icons.test.ts`; `tsc` 0 errors after `prisma generate`; ESLint clean):
- Tokens: eight kind hues and six state-pill fill/ink pairs (`globals.css`). The test caught dark brown 8deg from
  warning amber; desaturated.
- `domains.ts`: hue set, `SERIES_ORDER`, family map incl. DSEW stage, equipment and job kinds; `STATE_TONES`.
- `IconTile` / `IconDisc` (kind or state tone); `Avatar`; `Breadcrumb` + `EntityHeader`.
- `StateBadge` tinted pill; `StatTile` with kind/state disc, hint, link and a real-data `viz` slot (unclassified
  tiles now neutral slate, not tint); `FilterChipRow` chips take an icon.
- `viz.tsx`: `ProgressRing`, `ProgressBar`, `StepProgress`, `Sparkline`, `StackedBar`, `Gauge` on tested geometry.
- Icons: optical stroke `strokeFor()`; 24 DSEW glyphs (stage kinds, equipment, test and job lifecycle).
- Spec: REQ-EXPERIENCE-DESIGNSYSTEM-025 to 030.
**Browser verification, 2026-10-16 (ECC `browser-qa` + `chrome-devtools`, signed in as the DSEW demo owner,
read-only):** `/manufacturing/floor` at 1280 light and dark and 390 light; swatch sheet light and dark. Found and fixed:
(1) **the new tokens never reached the page** — Tailwind v4 drops `@theme` variables no utility references, and the
tokens are read only through inline `var()`; the unit test passed because it reads the source. Moved to a plain
`:root` rule. (2) Shared `Button` `danger` variant measured 4.14:1 (`#d70015` on `#f4dcdf`); new
`--color-danger-ink` (5.09:1, test added) and `OperationActions` "Send back" moved from a page-local
`text-danger` override to `variant="danger"`. Lighthouse accessibility on `/manufacturing/floor`: 96 before,
**100 after, in light and dark**. Remaining non-a11y-score item: `DataTable` row-actions column has no header
(`td-has-header`), existing. Existing defect logged for Phase 2: on a phone the assistant dock button covers the
row actions on the shop floor. Screenshots: `temporary screenshots/p127-*.png`.
**Correction, Phase 2 browser pass:** the plain `:root` move above was not enough. Tailwind v4's unused-variable
pass also stripped it (`lightningcss` alone keeps it), so the tokens were missing again on a clean dev-server start
and the earlier "Lighthouse 100" was measured with `--color-danger-ink` undefined (button text fell back to black).
Fixed with `@theme static`, which always emits. Re-audited after the fix (below).

**Phase 2 — BUILT 2026-10-16 (uncommitted).** Shared: `JourneyMap` (snake rows on wide screens, vertical timeline on
phones, optional per-stage status), `ChecklistRows` + `ChecklistHeader` (verdict circles, requirement, evidence
state), `ActionBar`, `MasterDetail` + `DetailPane` (URL-selected, sticky column; bottom sheet on phones),
`DataTable` `kindKey` / `activeKey` / `rowHref` and an "Actions" header (closes `td-has-header`),
`FilterChipRow` link chips, `StatTileRow cols`, `stageKindFor()` + `STAGE_KIND_LABEL`. `operation_queue` returns
`stageIndex`/`stageCount` (read-only). Screens: **`/manufacturing/floor` rebuilt** to the shop-floor mockup
(state-tone KPI discs, stage chips with icons and counts, stage tiles with "Stage n of N", tinted pills, row Start,
live pane with Checklist / Details / Stages tabs and a pinned Mark stage complete / Hold stage / Send back bar);
**`/manufacturing/routes/[id]` new** to the route mockup (breadcrumb, code chip, state pill, journey, stage
checklist on selection, overview tiles, stages at a glance), linked from the routes list. Not in the mockups and not
built because no data exists: route "Edit", "product type" count, floor "priority" filter, "Documents" tab.
**Verified (ECC browser-qa, DSEW demo owner, read-only):** floor and route at 1440 light, floor pane scrolled,
floor sheet and route timeline at 390 dark, no horizontal overflow. Lighthouse accessibility **100** on the route
page and on the floor with the pane open, after fixing two contrast failures found here (active-chip count at 70%
opacity 3.65:1; tint link on the `accent-subtle` selected row 4.35:1, now `accent-muted`). tsc 0, ESLint 0 errors,
26 unit tests pass. **Not run:** `capability-manufacturing-*` DB tests (`E_CONFIG_INVALID`, no `.env.test` here);
`ui-reachability` fails on `verity.project.add_task_dependency`, which predates this work.
**Phase 3 - BUILT 2026-10-17 (uncommitted).** `/manufacturing/[id]`: `EntityHeader`, KPI tiles (produces with
equipment tile, stages done and checks passed with rings, components), **live production journey** (done green tick,
in progress blue, held amber, not started grey; open stages link into the floor pane), stage table kept as Stage
actions. `/manufacturing`: state-disc tiles, equipment tile per row, stage progress under the state pill (one extra
tenant-scoped read of live operation states). `/jobs`: tiles that link to their filter, icon chips, equipment tile per
job. `/jobs/[id]`: `EntityHeader` with code chip, lifecycle `StepProgress` (Enquiry to Completed; none for lost or
cancelled), KPI tiles (margin as a state disc, progress ring). `/summary`: KPI tiles linking to job filters, state discs
on attention items, stage tiles with progress bars on the floor list, milestone tiles. `/manufacturing/boms`,
`/batches`, `/routes`: KPI tiles (batches adds draft orders free to batch). Helpers: `equipmentKindFor()`;
DSEW glyph batch 2 (control panel, calibration, bushing, tap changer, cooling, core, temperature, revision, lost,
truck): **86 glyphs**; contact sheet `docs/reference/visual-language/glyphs.html` (generated). Chrome: the bell
badge and search hint already existed; the sidebar keeps ADR-033's tinted glyphs, unchanged.
**Verified (ECC browser-qa, 1440 light):** order, orders list, jobs, job, summary rendered with real DSEW data;
Lighthouse accessibility 100 on summary, jobs and job detail (order detail inherits the audited components). Found and
fixed: "Control panel for transformer test bay" mapped to transformer (control systems now tested first).
**Glyph review notes (to redraw):** `timesheet` equals `clock`, `milestone` equals `flag`, `stage-dispatch`
equals the `purchases`/`assets` cube, `tap-changer` reads as a stopwatch.
**NOT YET DONE in Phase 1:** filled glyph variants; redraw of the existing ~40 glyphs to the new weights; ~~`StatCard` merged into
`StatTile`~~ (done 2026-10-23: `StatCard` wraps `StatTile`, and `StatRow` draws each `Stat` as a `StatTile`); `EmptyState`/`LoadingRows` with icon tiles; `AreaTrend`, `FunnelChart`, `HeatCalendar`, `Waterfall`,
`Timeline` (built in the phase whose page first needs them). Phase 2 components (`JourneyMap`, `MasterDetail`,
`DetailPane`, `ChecklistRows`, `ActionBar`) next.

Written 2026-10-16 against `main` at `205eef45`; revised the same day with the product owner's answers. Nothing in
`src/` was touched.

**Owner decisions, 2026-10-16:**

1. **Keep the iOS cards** (ADR-033: borderless inset cells, `#F2F2F7` canvas) and **borrow the structure and colour
   system** from the mock images. G0-1 is closed in favour of the recommendation; ADR-033's cell rule is *not*
   amended.
2. **Eight icon-tile colours approved**, used on icon tiles and chart series only, never on pills or buttons (G0-2).
3. **Study multiple premium icon and UI/UX libraries, adapt them to Verity, and create our own in-house icons**
   (G0-3, reframed: not "extend 40 icons" but a studied, original in-house set; see §3.4).
4. **The two images were mockups; neither screen exists in the software.** The route-detail and shop-floor pages
   are therefore built new (the nearest existing pages are `/manufacturing/routes` and `/manufacturing/floor`).
5. **The first client is D & S Electric Works (DSEW)**: custom electrical equipment (dry-type and cast-resin
   transformers, electromagnets, calibration and control systems), engineered jobs, VPI winding, test reports.
   The mockup content (DSEW 500 kVA, IIT Indore) was DSEW-like on purpose.

**ADR and study:** **ADR-046** (ACCEPTED 2026-10-16, `verity-spec/17_decisions/adr/adr-046.md`) recording the eight-hue token set and the new component
vocabulary (additive; no amendment to ADR-033's cell rule). The library study is written (`docs/reference/visual-language/library-study.md`); its sections 2.4 and 3 still need the Phase 0 reading.
Number check done 2026-10-16:
(ADR-044 is accounting statements; ADR-045 is held for the pending Mode D deployment proposal). Because the cell rule is untouched, the two-authority conflict flagged in
the first draft no longer blocks Phase 1; only the hue set needs the ADR.

## Non-goals (explicit)

- No new business capability, no new entity, no new command, no change to `enforcePolicy()`, tenancy, RLS or the
  write path. This is presentation and read-model shaping only. Where a graphic needs a number nobody queries yet,
  the plan says **"needs query"** and the query is a read-only `QueryDefinition` through the existing path.
- **No decorative or invented data in any chart** (`charts.tsx` already states "every value is real, no sample
  data, no smoothing"; Task 115 left `TrendChart` unwired for exactly this reason). A graphic with no real series
  is not drawn; the screen shows the number and an honest empty state.
- No rebuild of the outreach Kanban (removed 2026-09-17, Task 109; do not rebuild).
- No new colour outside the token layer; no hard-coded tint; no semantic colour equal to the tint (ADR-033
  anti-regression list stands unless Gate 0 amends it).
- No copying of the mock's literal content, and no new sections invented beyond the patterns in §3.
- Not a re-theme of the Verity mark (stays monochrome, ADR-012).

---

## 1. What the two reference screens actually establish

Read from the images, not assumed. These are the design rules the whole plan applies.

### 1.1 Route detail (image 1) — "a record whose body is a visual journey"

| Element | What it is | Rule extracted |
|---|---|---|
| Breadcrumb `Routes / DRY-TRAFO` | tint-coloured parent link, grey current | every detail page opens with a breadcrumb |
| Title row | Large title, **code chip** (grey), **status pill** (tinted, dot) | identity = name + code + state, on one line |
| Subtitle | `Production route · 6 stages` | one-line meta with a middot, counts not prose |
| Actions | filled primary (icon + label), gray "More ⋮" | one primary, rest overflow |
| **Production journey** card | numbered stage cards joined by arrows, wrapping in a snake (row 1 left→right, elbow connector, row 2) | a process is *drawn*, not tabulated |
| Stage card | numbered disc (selected = dark blue, others = light blue), **icon tile**, title, one-line description, **type chip** with icon (clock = preparation, wrench = assembly, truck = dispatch, check = "5 quality checks") | icon encodes stage *kind*; chip encodes metadata |
| Selected stage | tinted fill + tinted border | selection = tint |
| **Route overview** | three tiles: icon disc + big number + label (6 stages, 5 quality checks, 1 product type) | KPI tile = coloured icon disc, number, label |
| **Stages at a glance** | table: numbered disc, stage, process, checks, type chip; "View all stages →" tinted button top-right | a graphic summary is always paired with the accountable table |
| Surface | very light blue-white canvas, white cells with hairline border and soft elevation, ~12px radius | see Gate 0 (conflicts with ADR-033) |

### 1.2 Shop floor (image 2) — "a worklist with a live detail pane"

| Element | What it is | Rule extracted |
|---|---|---|
| Header | Large title, one-line explanation of the rule ("Work can only start when everything before it is done"), search with `/` hint, theme toggle, bell with unread dot, avatar | explain the business rule under the title; chrome carries search/theme/alerts |
| **KPI tiles** | 4 tiles, each a **coloured icon disc**: blue (open stages), green (ready to start), amber (on hold), red (rework) | disc colour = meaning, number = count; the colour is the legend |
| **Filter chips** | capsule chips each with a **stage icon + count**; first = filled tint "All stages (14)" | chips are navigable categories, not text filters |
| Toolbar | search + three dropdowns (routes, states, priority) | filters sit directly above the list |
| **Table** | order link (tint) + grey subtitle; **stage icon tile** + stage + "Stage 5 of 6"; qty; **state pill**; row action (`Start` outlined tint, `Checklist 0/5`, `Hold` grey) + chevron | the icon tile does the scanning; the pill does the status; one action per row |
| **State pills** | in-progress = blue, pending = amber, ready = green, on hold = grey, all with a dot | colour-coded, never colour-only (dot + word) |
| Selected row | tinted outline around the whole row | selection = tint outline |
| **Detail pane** (right) | title, open-in-new link, close ×; summary strip (current stage, stage order "5 of 6", quantity); tabs (Checklist 0/5, Details, History, Documents) | master–detail, not navigate-away |
| Checklist | circle (selection), title, secondary requirement ("Photo required", "Remarks required"), evidence status "Not recorded", chevron | a checklist is a list of tappable, evidence-aware rows with a progress count ("0 of 5 completed") |
| **Sticky action bar** | `Mark stage complete` (filled, check icon) · `Hold stage` (gray, pause icon) · `Send back` (red-tinted, undo icon) | the three outcomes are always visible, colour = consequence |

### 1.3 The common grammar (this is the specification)

1. **Colour has one job per use.** Tint = interactive/selected. Semantic green/amber/red/blue = state. A *domain*
   hue = "what kind of thing" (icon tiles only). They are three different systems and never swap roles.
2. **Icons are tiles, not glyphs.** A rounded-square (list) or disc (KPI, number) in a soft tint of its hue, with
   a stroke icon in the saturated hue. Icon kind carries meaning (stage type, document kind, party kind).
3. **State is a pill with a dot and a word.** Never colour alone (WCAG).
4. **Process = journey; progress = ring/bar; distribution = donut/stacked bar; trend = sparkline/area; capacity
   = gauge; time = timeline/calendar heat.** Table remains the accountable record beneath.
5. **Counts are everywhere and clickable** (chips, tiles, tabs: "Checklist 0/5").
6. **List + live detail pane** on wide screens; the pane becomes a bottom sheet on phones.
7. **Consequence-coloured actions**: filled tint = proceed, gray = defer, red-tint = reverse/destroy.
8. **Each page explains itself in one line under its title** (PRN-001, PRN-002).

---

## 2. Where the references collide with what is already accepted

**Gate 0 — RESOLVED 2026-10-16.**

| # | Question | Decision |
|---|---|---|
| G0-1 | Cell surface: mock's bordered, shadowed cells vs ADR-033's borderless inset cells | **ADR-033 stands.** Keep borderless 12px inset cells on `#F2F2F7` / `#000`; take the mock's *structure* (journey cards, icon tiles, KPI discs, filter chips, list + pane, sticky action bar) and its *colour system*. Selection is shown by tint fill plus a 2px inside selection ring (a focus/selection ring, not a content border); separation between cells is canvas gap, not outline. |
| G0-2 | Domain hues | **Approved: a fixed set of eight icon-tile colours, never on pills or buttons.** Recorded by ADR-046 (additive). |
| G0-3 | Icon source | **In-house set, informed by a study of premium icon and UI/UX libraries.** See §3.4. No third-party icon dependency is added; third-party paths are not copied. |

Also settled here (no ADR needed, listed so nobody re-asks):

- **Pill colour comes from `StateCategory` only** (ADR-009: SLA/behaviour read `category`, never `key` or `label`).
  Draft = grey, Pending = amber, Active = blue, Blocked = orange/red, Completed = green, Cancelled = grey struck.
  The mock's "ready = green" is shown as a green KPI tile driven by a derived "all prerequisites done" count
  (a query), and a "Ready" pill only if the capability's state map puts that state in a green category; we do
  **not** key colour off the label "ready".
- Current `StateBadge` is a neutral grey pill with a coloured dot (`primitives.tsx:770`). The target is the
  **tinted** pill (soft fill of the state colour, same dot, AA text). Change is in `StateBadge` only; every
  page inherits it.

---

## 3. Design-system layer (built once, used by every screen)

Per `CLAUDE.md`: change shared primitives, not individual pages. Existing pieces are reused where they fit.

### 3.1 Tokens (`src/app/globals.css`)

- `--hue-{indigo,purple,pink,teal,cyan,brown,mint,slate}` with `-fill` (soft tile background), `-ink`
  (icon stroke / chart series), and dark-mode values. Contrast checked by a unit test in the style of
  `accent.ts` (icon-on-fill ≥ 3:1 non-text, text-on-fill ≥ 4.5:1).
- `--state-{draft,pending,active,blocked,completed,cancelled}-{fill,ink,dot}` derived from existing semantic
  colours; `active` follows semantic blue, **not** the tint (a green/orange tint must not turn "in progress"
  green).
- Tentative hue → family mapping (finalised in Phase 1 with contrast numbers): Sales = indigo, Buying =
  purple, Stock/Godowns = teal, Money/Accounting/Tax = cyan, People/HR/Guests = pink, Production = slate,
  Kitchen/Menu = brown, Outreach = mint, Platform/Settings = slate. Mapping lives in one file
  (`src/components/ui/business/domains.ts`), so no screen is ever coloured ad hoc.

### 3.2 Components

| Component | New or change | Used for |
|---|---|---|
| `IconTile`, `IconDisc` | new (`primitives`) | list/KPI/number icons; takes `hue`, `size` |
| `StatusPill` / `StateBadge` | change | tinted state pill, dot + word (§2) |
| `StatTile` | change (exists) | adds icon disc, hint, optional mini-viz slot; `StatCard` and `StatTile` unified, one survives |
| `EntityHeader` | new | breadcrumb + title + code chip + pill + meta + primary/overflow actions |
| `JourneyMap` | new | numbered stage cards + connectors, **snake wrap** on wide, **vertical timeline** on phone; stage kind icon + type chip; selected state; optional progress overlay (done/active/blocked per stage) |
| `StepProgress` | new | compact horizontal stepper for forms, order status, passports |
| `ProgressRing`, `ProgressBar` | new | checklists (0/5), fill rate, completion, utilisation |
| `FilterChips` | change `FilterChipRow` | icon + count + selected fill; one scrolling row on phone |
| `MasterDetail` | new | list + live pane (≥ 1024px); pane → bottom sheet on phones; URL-synced selection |
| `DetailPane` | new | header, summary strip, tabs, sticky action bar |
| `ChecklistRows` | new | circle, title, requirement, evidence status, chevron; used by QC, daily checklists, handover |
| `ActionBar` | new | proceed / defer / reverse trio, sticky |
| `Sparkline`, `AreaTrend` | new (`TrendChart` wiring or successor) | revenue/orders/stock-level trends where a series exists |
| `StackedBar`, `Donut` (exists), `Legend` (exists), `BarStrip` (exists) | reuse/extend | mix and distribution |
| `Gauge` / `Meter` | new | capacity, credit limit used, cash variance, budget used |
| `FunnelChart` | new | outreach pipeline, job pipeline, order → delivered → paid |
| `HeatCalendar` | new | attendance, leave, sales by day-of-week × hour |
| `Waterfall` | new | P&L, tax output vs ITC |
| `Timeline` | new | audit, history, activity, ticket lifecycle (extends `ActivityLog`) |
| `Avatar` | new | people, guests, suppliers (initials on hue) |
| `Breadcrumb` | new | every detail route |
| `EmptyState`, `ErrorState`, `LoadingRows` | change | friendlier states using `IconTile`; skeletons shaped like the real layout |

All SVG, server-renderable, no chart library (no new dependency, no client bundle growth, matches
`charts.tsx`). Interactivity (hover value, click-through) is a thin client wrapper only where needed. Motion:
iOS spring only on transform/opacity; `prefers-reduced-motion` cross-fades; `prefers-reduced-transparency`
honoured. Every graphic ships with a text equivalent (table beneath, `aria-label` on the SVG, values in a
`<title>`), and a label so colour is never the only channel.

### 3.4 Library study and the in-house icon programme (owner decision G0-3)

**Principle: learn the grammar, draw our own.** We study how mature systems solve each problem, adapt the idea to
Verity's iOS skin, and draw original artwork. No path data is lifted, so no third-party attribution or licence
condition enters the product and the set stays one visual family. The study is a Phase 0 deliverable
(`docs/reference/visual-language/library-study.md`), one section per system: what it does well, what we adopt, what
we reject and why.

**Icon systems to study (grid, stroke, terminals, optical corrections, metaphors for our domains).**
Lucide, Phosphor (six weights), Tabler (5,000+ glyphs, strong on industrial and electrical metaphors), Heroicons,
Iconoir, Radix Icons, Material Symbols (variable weight/fill/grade axes), Fluent UI System Icons, IBM Carbon icons,
and Apple's SF Symbols as the *visual target only* (its licence restricts use to Apple platforms, so we study its
weights and metaphors from Apple's HIG and never copy or embed it).
Licences as reported by third-party directories on 2026-10-16: Heroicons, Phosphor, Tabler MIT; Material Symbols
Apache 2.0; Fluent UI System Icons MIT; Lucide MIT or ISC (sources disagree); Iconoir and Carbon not confirmed by
that search. **Every licence is read from the project's own LICENSE file** before any glyph is used even as a tracing
reference; redrawing avoids carrying any notice obligation.

**UI/UX systems to study (patterns, not code).**
- *IBM Carbon*: data-visualisation palette applied in a fixed order built for neighbour contrast; status indicator
  pattern (shape + colour + text); accessibility testing of colour pairs. Feeds §3.1 and the chart palette.
- *Shopify Polaris*: badge tone chosen by *meaning, not colour* (info, success, warning, critical, caution,
  neutral); orange for in-progress/pending/needs-attention, red reserved for blocked or error; one-word adjective
  labels ("unpaid", not "payment not received"); 4.5:1 contrast. Feeds `StatusPill` and label style.
  (Our `StateCategory` has Active = blue, so we follow ADR-009 and ADR-033 where Polaris differs.)
- *Apple HIG* (governing, via ADR-033), *Fluent 2*, *Atlassian*, *GitHub Primer*, *Material 3*, *Ant Design* and
  *Mantine* (dense tables, steppers, progress, empty states), *Tremor* and *shadcn/ui charts* (KPI + sparkline
  card composition), *Linear* and *Stripe Dashboard* (list + pane, keyboard-first worklists, restrained colour).
- ERP references already in the repo (Odoo, ERPNext, manager.io; `clients/dsew/reference-parity/`) for *what data a
  manufacturing screen must show*; the new look must not drop anything those references show that DSEW needs.

**In-house icon set ("Verity Glyphs").**
- 24px grid, round caps and joins, 2px corner radius on rectangles, 2px keyline padding. Stroke is defined **per
  size** (16, 20, 24, 32) instead of today's single 1.4 at 16.5px, with optical balance reviewed at 16px.
- Two states per glyph where useful: **outline** (default) and **filled** (selected, tab bar, KPI disc), as iOS does.
- Named by *meaning in Verity*, not shape: `stage-winding`, `stage-casting`, `stage-testing`.
- Delivered as one TypeScript path map in `icons.tsx` (the same mechanism as today: no dependency, tree-shakable,
  server-renderable), plus a generated contact sheet for review.
- **Drawing order, DSEW first:** (1) manufacturing stage kinds: core cutting and stacking, coil winding, epoxy
  casting / VPI curing, core-and-coil assembly, routine and type testing, packing and dispatch, 3-axis field
  mapping, rework, hold; (2) electrical equipment: transformer, electromagnet, coil, core laminations, bushing, tap
  changer, control panel, calibration, cooling (water/air), high voltage, insulation; (3) quality and test:
  insulation resistance, HV withstand, turns ratio, no-load/load loss, temperature rise, megger, photo evidence,
  remarks required, certificate; (4) job lifecycle: enquiry, quote, revision, approval, lost reason, job, milestone,
  timesheet, cost line; (5) shell and generic (the existing ~40 redrawn to the new weights); (6) other families
  (restaurant, trading, outreach, HQ) as their phase arrives. Target about 130 glyphs by Phase 9, about 55 needed
  for DSEW.
- Quality gates: 16px legibility check; icon on its tile at 3:1 in both themes; checked in the iOS tab bar and the
  collapsed sidebar; always `aria-hidden` with a visible label beside it.

### 3.3 Page patterns (each screen below names one)

| Code | Pattern | Skeleton |
|---|---|---|
| **P-DASH** | Dashboard | title + one-line purpose · KPI tile row (icon discs, mini-viz) · hero chart · ranked lists · attention list |
| **P-WORK** | Worklist + live pane (image 2) | title + rule line · KPI tiles · FilterChips · toolbar · table · DetailPane |
| **P-REC** | Record with journey (image 1) | EntityHeader · JourneyMap/StepProgress · overview tiles · at-a-glance table · tabs |
| **P-LIST** | Catalogue / register | toolbar + chips · summary strip (counts + one chart) · table with IconTile/Avatar, state pills, quick actions |
| **P-FORM** | Create / edit | sectioned form · live summary rail (totals, validation) · StepProgress for long ones |
| **P-REPORT** | Report | PeriodSwitch · KPI tiles · primary chart · breakdown table · drill-through |
| **P-SET** | Settings | iOS grouped list, every row an IconTile + value + chevron |
| **P-BOARD** | Spatial / flow board | floor plan, kitchen ticket columns, stage lanes |
| **P-PUB** | Public / guest | phone-first, one task, big targets |
| **P-HQ** | HQ console | fleet tiles + health ring per client |

---

## 4. Screen-by-screen plan

Route inventory taken from `find src/app -name page.tsx` on 2026-10-16: **133 pages** (HQ 19, shell
~108, public/auth 6). "Needs query" = the graphic needs a number not yet returned by an existing read; it is
added as a read-only query and is **not** built from guesses. Phase numbers refer to §5. "Exists" means the
data is already returned by the page's current queries; confirm per screen at build time.

### 4.1 DSEW and manufacturing (first client; the two reference screens are built here) — Phases 2 and 3

DSEW's chain (from `clients/dsew/prd.md`): enquiry → technical quote → approval → job → design and BOM →
procurement → winding / VPI / assembly → test and QC → dispatch → invoice. These screens make that chain *visible*.
Neither mockup exists today; the "Today" column names the nearest real page.

| Route | Today | Target | Graphics | Data |
|---|---|---|---|---|
| `/manufacturing/routes` | table of routes (`RoutesTable`) | **P-LIST**: route cards with stage count, check count, product-type count (IconTile row); table below | mini stage strip per route (n dots, coloured by kind) | exists |
| `/manufacturing/routes/[id]` — **not a page today** (routes are only listed and created) | — | **P-REC, image 1 exactly**: breadcrumb, code chip, Active pill, Edit route / More; Production journey (JourneyMap, snake wrap); Route overview tiles; Stages at a glance + View all stages | JourneyMap, 3 overview discs | stages and checks exist; **new page**; a read by route id is needed (check for an existing query, else add a read-only one) |
| `/manufacturing/floor` | `FloorQueue` DataTable | **P-WORK, image 2 exactly**: 4 KPI tiles (open, ready, on hold, rework), stage-kind chips with counts, filters (route/state/priority), table with stage IconTile, state pills, row actions, **live DetailPane** with Checklist/Details/History/Documents tabs, sticky Mark complete / Hold / Send back | KPI discs, chip counts, checklist ring (0/5) | rows exist; counts derive from rows; History/Documents reuse `ActivityLog` and evidence (read); "ready" and "priority" counts need confirming |
| `/manufacturing` | order list + create form | **P-DASH + P-LIST**: tiles (in production, awaiting QC, dispatched this week, overdue); order status funnel; order list with `StepProgress` per row (stage n of N) | funnel, mini progress bars | counts from existing order query; "overdue" needs a due date (check) |
| `/manufacturing/[id]` | `StagesPanel`, `PassportPanel`, `LogisticsPanels`, `OrderActions` | **P-REC**: EntityHeader (order, customer, state), JourneyMap with **live progress overlay** (done/active/blocked/held), stage detail pane, passport and dispatch as tabs with IconTiles | journey with state colouring; ring for QC checklist | exists |
| `/manufacturing/batches`, `/batches/[id]` | list + detail | P-LIST / P-REC: batch cards, reserved-vs-free **StackedBar** per batch, linked orders | stacked bar | reservation data exists (Task 118) |
| `/manufacturing/boms`, `/boms/[id]` | list + detail | P-LIST / P-REC: per-unit BOM as a component ledger with IconTile per item kind; cost-share **Donut** only if unit cost exists | donut (conditional) | cost: **needs query** or omit |

#### 4.1b DSEW job, quote, and customer screens (Phases 2 and 3)

| Route | Today | Target | Graphics | Data |
|---|---|---|---|---|
| `/jobs` | `JobTables`, `JobFilters` | **P-WORK**: tiles (open jobs, due this week, awaiting test, quoted vs won), chips by job stage with counts, table with equipment-kind IconTile (transformer, electromagnet, control system) and state pill, pane with milestones and next action | tiles, stage chips, quoted-vs-won bar | exists (project capability, DSEW Phase 2) |
| `/jobs/[id]` | job record | **P-REC**: EntityHeader (job code chip, customer, state), **JourneyMap of the job** (enquiry → quote → approved → build → test → dispatch → invoiced) with the manufacturing stages nested beneath, milestones and tasks, timesheet hours vs quoted, cost lines | journey, quoted-vs-actual **bars**, hours meter, margin ring | quoted-vs-actual exists; margin from cost lines |
| `/jobs/[id]/quote/[quoteId]` | quote revisions with snapshot | **P-REC**: revision timeline (R1, R2, approved snapshot), line table, totals rail with GST split | revision timeline, tax donut | exists |
| `/jobs/lost-reasons` | list | P-LIST: ranked bars by reason with counts and denominators | bars | exists |
| Test report per unit (DSEW Phase 4, **NOT YET BUILT** as a record) | checkpoints live on the testing stage | when built: **ChecklistRows** (turns ratio, insulation resistance, applied/induced HV withstand, no-load and load loss, temperature rise; "photo required", "remarks required", "not recorded"), pass/fail pills, printable page | checklist ring, pass-rate bar | design only; build waits on DSEW Phase 4 |
| Customer job-status page (DSEW Phase 6, **NOT YET BUILT**) | — | P-PUB: read-only job journey, hashed token, ADR-030 pattern | read-only JourneyMap | design only |
| `/customers`, `/suppliers`, `/purchases`, `/sales`, `/inventory` as DSEW uses them | trading and inventory pages | follow §4.3 patterns; BOM procurement shows **required vs on-hand vs on-order** per BOM line as a three-part bar | stacked bar | needs query for on-order |
| Summary home and Production group (DSEW Phase 5, built in part) | manager.io-style Summary | P-DASH: Summary tiles become icon discs with counts and a sparkline where a series exists; the owner's liking for manager.io is respected by keeping its *information density and tab list*, restyled in the new language | tiles | exists |

### 4.2 Restaurant operations (Colonel Kebabz) — Phase 4

**Ledger (2026-10-20).** Built, not yet browser-checked: `/floor` (table tiles with service-stage pill,
seated-minutes ring against the outlet's "seated too long" setting, guest-waiting flag, area chips with
counts, phone grid, seat sheet with a guest stepper, four KPI tiles), `/kitchen` (one docket per order per
column, age ring against the SLA target, late count, per-dish and whole-docket moves, cancelled lane),
`/counter` (one queue, three filters with counts, channel tiles, live pane with the next step pinned, KPI
tiles; "oldest bill" flags on the outlet's unpaid setting). Shared additions: glyphs `table`, `dish`,
`takeaway`, `receipt`, `qr`; channel kinds and `channelKindFor`; `TABLE_STAGE` (also used by `/today`);
`serviceStageOf` (one derivation for floor and Today); `ProgressRing.centre`; `ButtonLink`.
Also built, not yet browser-checked (2026-10-21): `/floor/[orderId]` (category and Specials chips with
counts, dish cards, course lanes with served counts, a state pill per dish, served bar, large subtotal;
`getOrderDetail` now returns each line's course) and `/counter/history` (range chips, Sales with a daily
line, average bill, refunded, cancelled; says so when the 300-row cap clips the totals). Not started:
`/floor/setup`, `/kitchen/setup`, `/kitchen/ticket/[ticketId]` (print layout, change with care),
`/menu`, `/menu/prices`, `/recipes`, `/counter/[billId]` (payment flow, 587 lines), and every row from
`/coupons` down. The tax donut on the order pad row is dropped on purpose: tax does not exist until the
bill is raised, and a chart of a number nobody has computed breaks the honest-data rule.

| Route | Target | Graphics | Data |
|---|---|---|---|
| `/floor` | P-BOARD: **FloorPlan** tables as coloured tiles by order state, seat count, elapsed-time ring, self-order inbox as chips | table state colours, elapsed ring | exists (`FloorPlan.tsx`) |
| `/floor/[orderId]` | P-REC: order header, course lanes (StepProgress: starters → mains → desserts), lines with qty stepper, bill summary rail with Donut of tax/discount/total | course stepper, bill split | exists |
| `/floor/setup` | P-SET: tables/zones as IconTile list, grid preview of the layout | layout preview | exists |
| `/kitchen` | P-BOARD: **ticket columns** (new / preparing / ready) per station, ticket age rings, colour by lateness | age ring, column counts | exists |
| `/kitchen/setup` | P-SET: stations as IconTile rows | — | exists |
| `/kitchen/ticket/[ticketId]` | P-REC: ticket timeline, items by course | timeline | exists |
| `/menu` | P-LIST: category chips with counts, item cards with veg/non-veg marker, price, margin chip | margin chip | needs recipe cost (recipes exist) |
| `/menu/prices` | P-LIST: outlet × channel price grid, changed cells highlighted | delta chips | exists |
| `/recipes`, `/recipes/[menuItemId]` | P-LIST / P-REC: food-cost % **Gauge** per dish, ingredient cost **Donut** | gauge, donut | exists |
| `/counter` | P-WORK: open bills as chips by table/channel, bill pane, tender buttons | tender split bar | exists |
| `/counter/[billId]` | P-REC: GST invoice header, tender and refund timeline | — | exists |
| `/counter/history` | P-LIST: day totals strip + sparkline per day | sparkline | exists |
| `/coupons` | P-LIST: coupon cards with redemption **ProgressBar** (used/limit), expiry chip | bar | exists |
| `/guests`, `/guests/[customerId]` | P-LIST (Avatar, segment chips with counts, points) / P-REC (visit **HeatCalendar**, spend sparkline, points ring, favourite-item bars) | calendar, sparkline | exists / spend series **needs query** |
| `/complaints` | P-WORK: chips by severity colour, detail pane, resolution timeline | severity donut | exists |
| `/expenses` | P-LIST: category **Donut**, month bar, approval pills | donut, bars | exists |
| `/cash-reconciliation` | P-LIST: expected vs counted **variance Gauge** per outlet/day, reason chips | gauge | exists |
| `/gst-summary` | P-REPORT: tax-by-rate **StackedBar**, filing readiness ring | stacked bar | exists |
| `/outlet-pnl` | P-REPORT: revenue vs cost **Waterfall**, labour line, outlet comparison bars | waterfall | exists |
| `/platform-payouts` | P-LIST: platform marks as IconTile, matched/unmatched ring, variance chip | match ring | exists |
| `/attendance` | P-LIST: today strip (present/late/absent discs), **HeatCalendar** by month | calendar | exists |
| `/hr`, `/hr/[employeeId]` | P-LIST (Avatar grid, role chips) / P-REC (attendance calendar, lateness bar, payroll summary donut, leave balance rings) | calendar, rings | exists |
| `/scheduling` | P-BOARD: roster **week grid**, shifts as coloured blocks per role, leave overlay | grid | exists |
| `/checklists` | P-WORK: checklist cards with **progress ring**, overdue red | rings | exists |
| `/inventory`, `/inventory/[itemId]` | P-LIST (stock level **bar vs reorder point**, low-stock chip) / P-REC (movement sparkline, batches, par gauge) | bars, sparkline | movement series **needs query** if absent |
| `/inventory/purchase-orders`, `/[orderId]` | P-LIST / P-REC with `StepProgress` (draft → sent → received → paid) and receipt fill bar | stepper, fill | exists |

### 4.3 Trading (plywood) — Phase 5

| Route | Target | Graphics | Data |
|---|---|---|---|
| `/overview` | P-DASH (post-sign-in home): KPI discs (sales, receivables, payables, stock value), revenue **AreaTrend** with period switch, receivables ageing **StackedBar**, top customers/products RankedList with bars, attention list | area, stacked bar | partly exists (`HeroSignal`/`SignalRail`); ageing exists in reports |
| `/today`, `/summary` | P-DASH: day strip, due-today chips, cash position tiles | sparkline | exists |
| `/sales`, `/sales/[orderId]` | P-LIST (StepProgress per row: quote → confirmed → dispatched → invoiced → paid) / P-REC (journey, lines, dispatch, invoice, payment rail) | journey | exists |
| `/purchases`, `/purchases/[orderId]` | same pattern, buying hue; receipt fill bar | journey, bar | exists |
| `/customers`, `/customers/[customerId]` | P-LIST (Avatar, balance vs credit-limit **Meter**) / P-REC (outstanding ageing bar, sales sparkline, last orders timeline) | meter, sparkline | exists / series **needs query** |
| `/suppliers`, `/suppliers/[supplierId]` | mirror of customers | meter, bar | same |
| `/catalogue`, `/catalogue/[productId]` | P-LIST (product tiles by category hue, stock chip) / P-REC (price history line, stock by godown **StackedBar**) | line, stacked | price history exists (Task 125 3.4) |
| `/stock`, `/stock/[productId]` | P-LIST (level bars) / P-REC (movement timeline + sparkline) | bar, sparkline | exists |
| `/godowns`, `/godowns/[locationId]` | P-LIST (fill meter only if capacity is modelled, else item-count) / P-REC (contents donut by category) | donut | capacity: **omit unless modelled** |
| `/prices` | P-LIST: price grid with delta chips (↑↓ colour) | delta chips | exists |
| `/transactions`, `/ledgers` | P-LIST: day-grouped list, in/out bars, party Avatar | in/out bar | exists |
| `/finance`, `/finance/[invoiceId]` | P-LIST (invoice state pills, overdue chips red, ageing strip) / P-REC (invoice header, payment **StepProgress**, allocation bar) | ageing, bar | exists |
| `/reports` | P-DASH: report tiles with a live mini-viz each | mini charts | exists |
| `/reports/sales`, `/reports/finance`, `/reports/inventory`, `/reports/purchases`, `/sales-reports` | P-REPORT ×5: PeriodSwitch, KPI discs, primary chart (sales trend, receivable ageing, stock value by category donut, purchase by supplier bars), drill-through rows | per report | aggregates exist; some series **need query** |
| `/tax`, `/tax/purchases`, `/tax/itc`, `/tax/gstr-1`, `/tax/gstr-3b`, `/tax/exceptions`, `/tax/close`, `/settings/tax` | P-REPORT / P-REC: filing-period **StepProgress** (collect → reconcile → file → close), output vs ITC **Waterfall**, exceptions as red chip list with count discs, period-close checklist ring | waterfall, ring | exists |

### 4.4 Accounting — Phase 5

| Route | Target | Graphics | Data |
|---|---|---|---|
| `/accounting` | P-DASH: chart of accounts as grouped IconTile list (assets/liabilities/income/expense), balances with sign colour | group donut | exists |
| `/accounting/[accountId]` | P-REC: account header, running-balance **line**, ledger rows | line | derives from ledger |
| `/accounting/statements` | P-REPORT: P&L waterfall (income → expense → profit), balance sheet two-column with a balanced assets vs liabilities+equity bar, period compare | waterfall, bar | exists (ADR-044, proposed, just built) |

### 4.5 Jobs and Outreach — Phase 6

| Route | Target | Graphics | Data |
|---|---|---|---|
| `/jobs` | P-WORK: pipeline chips, job table, pane | funnel | exists |
| `/jobs/[id]`, `/jobs/[id]/quote/[quoteId]` | P-REC: job journey (lead → quote → won → delivered), quote lines + totals rail | journey | exists |
| `/jobs/lost-reasons` | P-LIST: reasons as bar ranking | bars | exists |
| `/outreach`, `/outreach/workspace` | P-DASH / P-WORK: today's actions, **pipeline funnel**, activity heat | funnel, heat | exists |
| `/outreach/prospects`, `/outreach/[id]` | P-LIST (stage chips with counts, score ring) / P-REC (activity timeline, next-action chip, task and meeting rail) | ring, timeline | exists |
| `/outreach/domains`, `/outreach/domains/[domainId]` | P-LIST / P-REC with conversion rates **always with denominator** (`verity-analytics-integrity`) | bars with n | exists |
| `/outreach/intelligence` | P-REPORT: funnel, channel comparison; every number clickable | funnel | exists |
| `/outreach/team`, `/outreach/teams`, `/outreach/teams/[teamId]`, `…/members/[partyId]` | P-LIST / P-REC: Avatar, load bar, owned-prospect donut | donut, bar | exists |

### 4.6 Platform shell, settings, governance — Phases 3 and 7

| Route | Target |
|---|---|
| App shell chrome (`ShellChrome`, `CommandPalette`, `ThemeToggle`, notifications bell) | top bar with `/` search hint, theme, **bell with unread dot**, avatar (as image 2); sidebar rows get domain `IconTile`s; phone tab bar keeps its five |
| `/account` | P-SET: profile Avatar, security rows as IconTile list |
| `/notifications` | P-LIST: tone-coded IconTile per kind, unread dot, grouped by day |
| `/approvals` | P-WORK: pending count disc, chips by kind, pane with approve / defer / reject (ActionBar consequence colours) |
| `/capabilities`, `/configuration` | P-SET: capability cards (IconTile, active pill, dependency chips), configuration groups |
| `/settings`, `/settings/business`, `/settings/outlets`, `/settings/alerts`, `/settings/self-order`, `/settings/data-export` | P-SET ×6: iOS grouped lists with IconTiles, preview where visual (self-order QR/sticker preview, accent preview) |
| `/roles` | P-LIST: role cards with permission-coverage ring, member Avatars |
| `/people` | P-LIST: Avatar grid, role/state chips |
| `/locations`, `/locations/[id]` | P-LIST / P-REC: location tiles by kind, address block, linked assets |
| `/assets`, `/assets/[id]` | P-LIST / P-REC: asset IconTiles by kind, **service-due meter**, history timeline |
| `/audit` | P-LIST: **Timeline**, actor Avatar, command-category IconTiles, failed commands red |
| `/evidence` | P-LIST: thumbnail grid with kind IconTile and verified chip |
| `/import` | P-FORM: StepProgress (upload → map → validate → commit), row-error summary donut |
| `/billing` | P-SET / P-DASH: plan card, usage **meters** |
| `/workspace` | P-DASH: tenant home tiles |

### 4.7 HQ console — Phase 7

| Route | Target | Graphics | Data |
|---|---|---|---|
| `/hq` | P-HQ: fleet tiles (clients, healthy, attention, suspended), health **ring**, activity trend | rings, sparkline | exists (ADR-034 health) |
| `/hq/clients` | P-LIST: client cards with health pill, module IconTile row, last-active | pills | exists |
| `/hq/clients/[tenantId]` | P-REC: client header + lifecycle StepProgress, health breakdown, support session state | stepper, ring | exists |
| `…/modules`, `…/packs`, `…/operations`, `…/organizations`, `…/people`, `…/roles`, `…/settings` | P-SET / P-LIST: module toggles with dependency chips; org tree (indented IconTiles); failed-command **count bars** (ADR-036, totals only, no metadata leakage) | tree, bars | exists |
| `/hq/audit` | P-LIST Timeline | — | exists |
| `/hq/settings` | P-SET | — | exists |

### 4.8 Public and auth — Phase 8

| Route | Target | Note |
|---|---|---|
| `/sign-in`, `/reset-password`, `/reset-password/update` | P-PUB: Verity monochrome mark, one task, clear error tone | mark stays monochrome |
| `/o/s/[token]` (guest self-order) | P-PUB: category chips with icons, big item cards, cart bar, order status StepProgress | **public write surface (ADR-042)**: presentation only, must not change the token/definer path |
| `/verify/[token]` (public passport) | P-PUB: verified seal, product journey (read-only JourneyMap), evidence thumbnails | frozen snapshot, ADR-030; presentation only |

---

## 5. Phases (each is shippable and reversible)

| Phase | Scope | Exit evidence |
|---|---|---|
| **0 — Study and baseline** | Gate 0 is answered. ADR-046 written (additive; ADR-033 unchanged): owner signs off. Library study written (licences read from each LICENSE file); finish its §2.4 and §3 reading. Capture "before" screenshots for every pattern exemplar × light/dark × 390/768/1280 (reuses the Task 116 matrix; stored under `docs/audits/`). | ADR accepted; baseline folder |
| **1 — Foundation** | Tokens, `domains.ts`, `IconTile/Disc`, tinted `StateBadge`, `StatTile` unification, `FilterChips`, `Breadcrumb`, `Avatar`, `EntityHeader`, empty/loading/error states; icon set extended; token contrast test; unit tests for chart geometry; spec REQs added to `design-system.md`. No page redesigned except by inheritance (pills, tiles). | tsc, eslint, vitest green; contrast test; every page still loads (UI-reachability suite) |
| **2 — Reference screens (DSEW)** | `/manufacturing/routes/[id]` (new page, image 1) and `/manufacturing/floor` (rebuilt, image 2) built to match structure and colour system on iOS cards, using DSEW seed data (`npm run seed:dsew`), with `JourneyMap`, `MasterDetail`, `DetailPane`, `ChecklistRows`, `ActionBar`. Rule: **at least two screenshot-compare rounds** against each reference. | side-by-side compare notes; keyboard and screen-reader pass |
| **3 — Chrome and the rest of DSEW** | Top bar (search hint, bell dot), sidebar tiles, phone tab bar tiles; `/manufacturing`, `/[id]`, batches, BOMs, routes list; §4.1b jobs, quotes, Summary home; the ~55 DSEW glyphs. | live walk as DSEW with `verity-usage-qa` (390px and desktop) |
| **4 — Restaurant** | §4.2 in order: floor, kitchen, counter, menu/recipes, guests, money pages, HR/scheduling, inventory. | `verity-usage-qa` pass on Colonel Kebabz |
| **5 — Trading and accounting** | §4.3, §4.4. Overview first (most seen). | plywood walk; AA check |
| **6 — Outreach** | §4.5 outreach rows (the Jobs rows moved to Phase 3 for DSEW) | analytics-integrity check |
| **7 — Platform and HQ** | §4.6, §4.7 | HQ walk; ADR-036 totals-only check |
| **8 — Public and auth** | §4.8 | phone walk of the guest page with a real token; token flow untouched |
| **9 — Closeout** | Sweep: no stray hard-coded colours (grep), no `transition-all`, no backdrop-filter on cells, anti-regression list re-run; update `design-system.md`, FINISHER, `00_STATUS_INDEX.md`; reconcile Task 116. | grep clean; matrix filled |

Ordering rationale: DSEW is the first client, so its screens and glyphs come before the restaurant and trading families, which keep the order given. Tokens and components first so no page invents its own; the two reference screens next
because they are the acceptance test for the grammar; then by how often each client's users open a screen.

## 6. Verification (applies to every phase)

- **Matrix:** pattern exemplar × role × light/dark × 390/768/1280 px, signed in with approved test accounts
  (the Task 116 constraint: some role passwords are not retrievable by an agent; needs the owner's credentials).
- **Accessibility:** AA text and 3:1 non-text in both themes; colour never the only channel (every pill has a
  dot and word, every chart has a text equivalent); 44pt targets; keyboard order across list ↔ pane;
  focus-visible on every control; reduced-motion and reduced-transparency checked.
- **Honesty:** each graphic's data source is named in its PR; no series is padded, smoothed or sampled.
- **Boundaries:** no Prisma import in components; every new read goes through a `QueryDefinition`; run
  `verity-tenant-query-safety` on each new query; no write path touched.
- **Performance:** graphics are server-rendered SVG; record a client bundle budget per page family; pane data
  is fetched on selection, not for every row.
- **Tests:** unit tests beside source for chart geometry, token contrast and the state→colour map; existing
  conformance and UI-reachability suites stay green; `tsc` and `eslint` clean.

## 7. Risks

| Risk | Mitigation |
|---|---|
| **Colour overload** ("properly colour coded" vs PRN-002 progressive disclosure) | three colour systems with one job each (§1.3); domain hue appears only on icon tiles and series; hue is a function of the thing shown (`domains.ts`), never a page choice; ADR-046 §4 |
| Mock relies on borders and shadows that ADR-033 forbids | Resolved: borderless cells kept; selection by tint fill and an inside ring; checked on every screen against the anti-regression list |
| Hue collides with semantic colour (green sales vs green success) | domain hues exclude the four semantic hues; distinctness tested |
| Scope (133 pages) | phases are independently shippable; Phase 1 alone upgrades every page through shared primitives |
| Charts without real series become decoration | "needs query" rule; empty state instead |
| Phone density | JourneyMap → vertical timeline, MasterDetail → sheet, chips → one scrolling row (established phone behaviour, commit `67bfd97f`) |
| Overlap with Task 116 | this plan extends 116's matrix and family work; on acceptance, mark 116 "direction superseded by 127, matrix retained" |

## 8. Open items

1. Owner sign-off of ADR-046 (eight hues, component vocabulary); hue values frozen after the Phase 1 swatch sheet. No owner decision on direction is outstanding.
2. Name the eight hues and their family mapping in Phase 1 after contrast measurement; the owner sees a swatch
   sheet before it is frozen.
3. DSEW's test-report record and customer job-status page are **not built** (DSEW Phases 4 and 6); this plan only
   specifies how they will look. Whether to build them before or after the restyle is a DSEW phase-plan question.
4. Confirm DSEW's real stage names, test list and equipment kinds with the client before the glyphs are final (the
   site names VPI winding and 3-axis magnetic mapping; the rest of the mock's wording is placeholder).

## 9. Cross-references

Extends Task 116 and Task 115; constrained by ADR-033, ADR-009, ADR-012, ADR-017 (no authority change),
ADR-030 and ADR-042 (public surfaces: presentation only). Skills to use at build time: `impeccable`,
`verity-design-companion`, `dataviz`, `verity-usage-qa`, `verity-analytics-integrity`,
`verity-tenant-query-safety`.
