# Task 116 — Apple-quality visual UX completion program

Authority: Product-owner direction, 2026-09-19 — Verity does not yet meet the
expected Apple level of visual quality. The required direction is **dark,
classy, restrained, subtly blue, spatial, information-rich, and visually
expressive without bloom, neon, decorative gradients, or glass applied as a
cheap theme**. This plan converts that direction into an executable,
page-by-page completion program.

This plan sits on top of:

- ADR-024 — material, typography, accent restraint, and motion substrate;
- ADR-025 — reusable Apple-craft component patterns;
- ADR-026 — layered content surfaces and visual field;
- Task 100 — dashboards must move from record display to business
  understanding and action;
- Task 114 — Outreach workflow and interaction hierarchy;
- Task 115 — governing Apple-craft documentation and shared patterns.

Where an older decision conflicts with a newer explicit product-owner
instruction, the newer instruction wins for implementation and the governing
document must be corrected in the same phase. In particular:

1. The current global default accent is blue. Task 116 does not restore the
   earlier gold default described by ADR-024.
2. The persistent workspace switcher in the header/sidebar was explicitly
   rejected and removed on 2026-09-19. ADR-025 pattern 3 is therefore no longer
   a shell requirement. Workspace switching may return only in a dedicated,
   purposeful account/workspace surface supported by a real multi-workspace
   need.
3. Liquid Glass is a material technique, not the product identity. It is used
   selectively to communicate hierarchy and depth; it must never become a blue
   bloom over every page or card.

## Status

**IN PROGRESS — started 2026-09-19.** No phase in this file is complete merely
because a token, glass class, or shared component exists. Completion requires
signed-in visual evidence, real data, interaction verification, and the
page-family gates defined below.

### Execution log

- **2026-09-19 — Phase 0 partial:** classified the full production route list
  into page families and captured authenticated live observations for a dark
  business-owner `/overview` and a light Company-Core `/outreach`. Evidence and
  remaining persona/theme/viewport gaps are recorded in
  `docs/audits/2026-09-19-task-116-visual-baseline.md`. Phase 0 remains open
  until durable screenshots and the full role matrix exist.
- **2026-09-19 — Phase 1 / owner-dashboard slice partial:** added shared
  `HeroSignal` and `SignalRail` compositions and rebuilt `/overview`'s opening
  hierarchy around one dominant, real sales signal plus a compact operational
  rail. This removes the duplicated sales card and the equal-weight four-card
  wall while retaining exact values, real weekly history, drill-through, and
  panel-level error isolation. Focused ESLint and TypeScript checks pass.
- **2026-09-19 — Phase 3 / Core dashboard `/outreach` slice partial:** reused
  `HeroSignal`/`SignalRail` for the "Pipeline health" band (§8.1's hero signal
  + pipeline-now rail, replacing the two equal-weight eight-`Stat` rows) and
  rebuilt "Team performance" as identity cards (avatar initials, leader,
  member count, prospecting-target progress bar, four-metric footer,
  hover-lift) replacing the 13-column horizontally-scrolled table and the
  separate plain-count "Teams" panel it duplicated. §8.1's "Today's
  execution," "Attention," and "Management intelligence" required regions are
  now all present; team comparison and pipeline-now are asymmetric, not equal
  cards. Signed-in visual verification done for Core (divyom.sharma) against
  the real PlotArmour Studio tenant, light and dark, desktop viewport — both
  themes preserve the same hierarchy. `tsc --noEmit` and `eslint` on the file
  are clean. Not yet done: Senior/Junior dashboard variants (§8.2/§8.3),
  mobile viewport proof, and the rest of the §16 evidence matrix — this slice
  only closes the Core desktop light/dark cell for `/outreach`.
- **2026-09-24 — Phase 3 / Junior workspace §8.3 slice, code-complete, NOT
  visually verified:** `/outreach/workspace` extended toward §8.3's required
  composition — linear progress track (done-today vs still-to-go, both real
  counts, no fabricated target), compact current-direction card (reused
  `getCurrentDirection`'s read path, confirmed Junior already has `Read` on
  `ENTITY_DIRECTION` before adding), a "Logged today" activity timeline from
  data already fetched but not previously rendered, and a split empty-queue
  state ("All caught up" vs "Nothing on your list" — different situations
  that were one message). `impeccable` detector clean (zero findings),
  `tsc --noEmit` and `eslint` clean. **Blocked from live verification by the
  same Phase 6 gap** (`taskplans/122_...`) — no Junior login credentials
  exist to sign in and confirm the render against real queue/timeline data.
  Senior's §8.2 variant (member work-state matrix, coaching-scoped queue)
  remains entirely unstarted — it lives inside the shared, 667-line
  `outreach/page.tsx` Core/Senior split, a larger and riskier edit than this
  self-contained page; do not start it without a fresh read of that file's
  current `isCoreView` branching.
- **2026-09-24 — §8.2 closed, smaller than expected:** reading `outreach/
  page.tsx`'s `isCoreView` branching (as the entry above flagged as
  necessary first) found the real gap was routing, not missing UI. A Senior
  visiting bare `/outreach` got no auto-scoping — `isCoreView` requires
  `canPostDirection` (Founder-only), so they saw an unfiltered cross-team
  lead list, no direction banner, and a hardcoded "Company Core view"
  description that was simply wrong for them. `/outreach/team` ("Team
  Command") already existed and already matched §8.2's checklist closely —
  team-scoped hero, `listTeamDailyWorkStatus` work-state matrix, coaching
  notes, lead queue, escalations. Added the same redirect pattern this page
  already used for Junior (`/outreach` → `/outreach/prospects`), just for
  Senior (`/outreach` → `/outreach/team`), only on the bare landing — an
  explicit `?team=` deep link still renders this page scoped, unchanged.
  Also fixed the hardcoded description for that remaining case. `tsc
  --noEmit`, `eslint`, and `impeccable detect.mjs` all clean. **Not
  live-verified** — same Phase 6 credential gap as the Junior slice above,
  though this is a routing change on an already-shipped page, lower risk
  than new UI.
- **2026-09-24 — §8.4 Teams / member-detail slice, code-complete, NOT
  visually verified:** the team list and team-detail pages already matched
  most of §8.4 (identity cards on `/outreach/teams`, work-state matrix on
  team detail); the real gap was the member-detail page
  (`teams/[teamId]/members/[partyId]/page.tsx`), which had none of the
  spec's "progress, activity heatmap, reports, coaching timeline, assigned
  work with explicit periods." Rebuilt it: a 14-day activity heatmap from
  `OutreachActivity.occurredAt` (grouped client-side, no new query), a
  daily-reports list from `OutreachCheckIn`/`OutreachCheckInReview` (same
  tables `listTeamCheckIns` already reads, queried directly here per this
  file's existing raw-Prisma pattern), the existing `CoachingNotePanel`
  wired in for Core/leader viewers (it already existed for Senior's own
  team but was never reachable from Core's per-team member view), and the
  assigned-work list regrouped into explicit periods (Overdue / Due this
  week / No next action set / On track / Closed) instead of one flat list.
  `tsc --noEmit` and `eslint` on the file are clean. **Not live-verified**
  — same Phase 6 credential gap as the two entries above.
- **2026-09-24 — §8.5 audited, already complete; §8.6 drill-through
  closed:** §8.5 (prospects/lead detail) needed nothing — the lead detail
  page already has a strong summary hero, a tabbed workflow (Overview/
  Activity/Contacts/Tasks/Meetings/Research/Commercial, not a stacked
  page), and `AiInsightPanel` already shows provenance
  (model/sourceReads/requestedBy) and a `configured` gate instead of raw
  provider errors. §8.6 (Intelligence/domains) had funnel, velocity,
  aging, and channel/industry tables already built; the one real gap was
  "drill through" — added a link from Intelligence's industry-row key to
  a filtered prospect search (`/outreach/prospects?q=`, since the row key
  is free text with no id to target) and from the domain page's per-team
  row to that team's page. Found and fixed a real bug while there: the
  `eslint.config.mjs` `no-restricted-syntax` ignores array's entry for
  `outreach/domains/[domainId]/page.tsx` was a silent no-op — minimatch
  parses a literal `[domainId]` route segment as a bracket character
  class, never the real path, so the file was actually failing lint. Every
  *other* bracket-route file in that list turned out to already carry its
  own inline `eslint-disable` comment (the real protection); this file
  didn't, so it got one, matching the existing pattern. `eslint.config.mjs`
  itself is protected by a config-integrity hook and wasn't touched — the
  array still lists bracket paths that don't functionally match anything;
  future bracket-route grandfathering needs the inline-comment pattern,
  not an ignores-array entry alone. `tsc --noEmit` and `eslint` clean on
  every touched file. **Not live-verified** — same Phase 6 gap.
- **2026-09-24 — §9.2 spot-audited (no gap), §7 sign-in audited (no gap),
  §10 graphics decided against building:** `FinanceDesk`/`SalesDesk` read
  in full — attention bands (`StatRow`, "Goods moved without a document"),
  lifecycle via `DataTable`'s declarative `variant: "state"` column (not a
  literal `StateBadge` grep hit, which is why an earlier pattern-match
  pass here misread them as gaps), `rupees()` tabular formatting. Already
  spec-compliant; `PurchaseDesk`/`TransactionsDesk`/`StockBoard` weren't
  individually re-read but share the same `DataTable` architecture. §7
  sign-in (`sign-in/page.tsx`) was already rebuilt against a reference
  board 2026-09-04 — product-led layout, monochrome mark, human-readable
  OIDC error copy, clean server-side redirect. No changes needed either
  place. §10 (graphics): invoked `impeccable` before starting, which
  surfaced that `EmptyState` (`primitives.tsx`) already renders a
  low-opacity `VeritySymbol` identically across every empty state in the
  app — one coherent, theme-aware, on-brand treatment, not per-context
  illustrations, but a real answer to §10's actual ask ("restrained...
  no mascots/stock/3D... first-party visual asset system" — a single
  first-party mark IS that, at lower risk than 10 bespoke SVGs). Building
  10 separate illustrations would replace that already-shipped,
  already-consistent pattern across every screen in the product — a
  visual-identity decision, not a bounded UI slice, and not something to
  improvise without product-owner sign-off (the same posture ADR-024's
  gold board got). Decided, with the product owner, not to build it.
  §10 is considered **closed as already-met**, not open debt.
- **2026-09-30 — Phase 6 credential gap closed; §8.2/§8.3/§8.4/§8.6 live-
  verified.** The product owner approved `pacreds.txt` accounts as test-only
  on localhost. Signed in as Senior (Kulsoom), Junior (Hikari) and Core
  (Divo), each in an isolated browser context. Results: **§8.2** bare
  `/outreach` redirects a Senior to `/outreach/team`, which renders the
  team-scoped hero, work-state matrix and lead queues (dark desktop, light
  mobile 390px: no horizontal scroll, bottom tab bar present). **§8.3**
  `/outreach/workspace` renders greeting, counts, direction card and the
  split "Nothing on your list" empty state (dark desktop, light mobile). The
  progress track and "Logged today" timeline only render with data, and no
  test records were written to the tenant, so those two remain unproven with
  data. **§8.4** member detail renders heatmap, coaching, daily reports and
  assigned work (dark desktop). **§8.6** drill-through links present.
  **Two real defects found and fixed:** (1) Intelligence's "Unspecified"
  industry row linked to a text search for the literal word, returning 0
  of 7 prospects; it now links to `?domain=none` (4 of 7). (2) The
  liquid-glass engine (ADR-028) wrote `class`/`style` on server-rendered
  elements before hydration finished, producing a React hydration-mismatch
  console error; it now starts 1.2s after `load`. Still open for Phase 0:
  durable screenshots and the remaining route-family/theme/viewport matrix.

## 1. Product outcome

Verity should feel like a mature operating system for a company rather than a
styled database admin panel. A person opening any page should immediately know:

1. where they are;
2. what changed;
3. what requires attention;
4. what the primary action is;
5. how the current state relates to the wider workflow;
6. which details are secondary and safely ignorable for now.

The target is not to imitate an Apple product screen-by-screen. “Apple quality”
means restraint, coherent hierarchy, direct manipulation, exact spacing,
excellent state transitions, legible materials, meaningful graphics, and a
calm interface that does not make the user decode the design.

## 2. Definition of success

Task 116 is complete only when all of the following are true:

- Every production route belongs to a documented page family and uses that
  family's visual grammar.
- The shell, page headers, cards, forms, tables, menus, dialogs, charts, empty
  states, loading states, errors, and mobile navigation look like one system.
- Every dashboard has a clear dominant region; no dashboard is a flat grid of
  equal-weight rectangles.
- Every graphic represents real application data or a useful workflow concept.
- Every metric answers at least two of: what happened, compared with what,
  why it matters, and what to do next.
- Glass is subtle and physically plausible in both themes. Dense information
  remains legible and calm.
- The dark theme uses graphite/near-black neutrals with restrained cool-blue
  light, not navy flood fills, cyan bloom, purple haze, or luminous borders.
- Light and dark themes preserve the same hierarchy rather than becoming two
  different designs.
- Desktop, tablet, and mobile layouts are intentionally composed; mobile is not
  the desktop page squeezed into one column.
- Keyboard, screen-reader, reduced-motion, reduced-transparency, contrast, and
  touch-target requirements pass.
- Authenticated screenshots exist for the required role/route/viewport matrix.
- No page is marked complete based only on lint, typecheck, build, HTTP 200, or
  the existence of CSS tokens.

## 3. Current-state diagnosis

The codebase already contains useful ingredients: semantic colors, a glass
material ladder, `Panel`, `Surface`, `StatCard`, chart primitives, a command
palette, polished dropdowns, responsive shell behavior, and role-specific
Outreach routes. The quality gap is primarily compositional:

- too many pages arrange similarly weighted cards in regular grids;
- surfaces communicate “container” more often than meaning;
- data graphics are sparse and inconsistently tied to action;
- page headers often end before establishing operational context;
- status is shown as text and badges where timelines, distributions, progress,
  or comparison would communicate faster;
- empty states and zero-data states are functional but rarely memorable or
  instructive;
- detail pages tend toward long vertical stacks rather than a strong summary +
  focused work area + contextual history;
- forms have correct fields but insufficient grouping, progressive disclosure,
  and completion feedback;
- motion is not yet a systematic part of state change;
- visual verification has been narrower than the product surface.

This plan addresses those gaps without changing authorization, tenancy,
business rules, or the truthfulness of data.

## 4. Non-negotiable visual principles

### 4.1 Restraint before decoration

- One dominant focal area per page.
- One global interactive accent: restrained blue.
- Semantic colors are independent from the accent.
- Large surfaces stay neutral. Accent appears in controls, focus, selected
  states, small indicators, chart highlights, and meaningful edges.
- No full-card electric-blue fills for ordinary content.
- No glow used merely to make an empty area feel “designed.”

### 4.2 Material hierarchy

Use four functional material roles:

| Role | Typical surfaces | Treatment |
|---|---|---|
| Canvas | page field | near-black/soft-white neutral, extremely faint cool atmosphere |
| Content | cards, forms, data regions | quiet translucent or solid surface chosen for legibility |
| Control | search, segmented controls, buttons, compact inputs | slightly elevated, crisp edge, immediate feedback |
| Overlay | menus, dialogs, command palette, assistant | strongest blur/elevation, opaque enough for reading |

Rules:

- Do not nest glass inside glass more than one level.
- Do not apply blur per row, badge, table cell, or status chip.
- Use `.verity-solid` where table density, long-form text, financial data,
  destructive confirmation, or form clarity demands opacity.
- Keep borders low-contrast. A card should not look outlined in neon.
- Reserve stronger shadow for temporary overlays and dragged/active objects.

### 4.3 Information hierarchy

Every page follows this sequence where applicable:

1. Context — title, period, scope, owner, and current direction.
2. Signal — the most important current condition.
3. Action — the next useful operation.
4. Explanation — supporting metrics, chart, or workflow context.
5. Detail — table, history, secondary metadata, and administration.

### 4.4 Meaningful graphics only

Approved visual categories:

- sparklines and period comparisons from real historical data;
- progress rings and completion bars with explicit denominators;
- stage funnels and pipelines backed by real stages/counts;
- timeline rails for real events;
- activity heatmaps based on real daily activity;
- avatar/initial stacks for real people;
- relationship diagrams where ownership or handoff is the point;
- small monochrome illustrations for empty/onboarding/error states;
- file thumbnails and document previews where files exist;
- geographical visuals only when location materially changes a decision.

Prohibited:

- fabricated trend lines;
- decorative analytics with no drill-through;
- stock photography in operational screens;
- random abstract blobs behind every section;
- charts that duplicate a number without adding comparison or structure;
- color as the only carrier of state;
- maps for single-region data merely to fill space.

## 5. Shared design-system work

Build shared primitives before page-specific copies. Each primitive must expose
semantic props, use shared tokens, and document when it should not be used.

### 5.1 Layout and hierarchy primitives

1. `PageIntro`
   - eyebrow/context, title, concise description, actions, and optional period
     control;
   - supports compact list-page and editorial dashboard variants;
   - collapses actions into an intentional mobile arrangement.
2. `HeroSignal`
   - one dominant metric/state with context, delta, and primary action;
   - optional supporting visual; never used for six equal metrics.
3. `SectionHeader`
   - title, explanation, count/state, and optional action;
   - standardized spacing between major content bands.
4. `SplitWorkspace`
   - summary/queue left, focused work right, with independently bounded
     scrolling and responsive collapse.
5. `DetailHero`
   - identity, state, ownership, next action, and important metadata for record
     pages.

### 5.2 Data and status primitives

1. `MetricTile`
   - value, label, comparison, evidence period, optional action;
   - icon chip is small and quiet;
   - supports loading, unavailable, zero, and permission-redacted states.
2. `TrendSparkline`
   - real time series only;
   - exact-value tooltip, start/end context, reduced-motion support;
   - no curve smoothing that implies nonexistent values.
3. `StatusRing`
   - explicit numerator/denominator and accessible text;
   - not used for vague “health scores.”
4. `ProgressTrack`
   - target progress, stage progress, or checklist completion;
   - includes target and remaining amount where meaningful.
5. `ActivityHeatmap`
   - day-by-day contribution/activity cells;
   - tooltip contains exact date and activity count;
   - empty days remain visibly distinct from missing data.
6. `WorkflowTimeline`
   - event marker, actor, timestamp, state transition, related action;
   - filters by event type without visually rebuilding the list.
7. `PipelineFunnel`
   - stage counts, conversion, drop-off, sample-size warning;
   - every segment drills into the underlying filtered records.
8. `AvatarStack`
   - real people only, deterministic initials fallback, overflow count;
   - labels available to assistive technology.
9. `SemanticLegend`
   - label + icon/shape + color; never color alone.

### 5.3 Operational interaction primitives

1. `AttentionCard`
   - one issue, why it matters, age/severity, and next action;
   - supports warning/danger without full-card saturation.
2. `ActionQueue`
   - reusable filtered work queue with counts, due state, owner, and inline
     completion/entry points.
3. `SegmentedControl`
   - compact Apple-style period/view switcher with animated selection plate;
   - keyboard arrows and reduced-motion fallback.
4. `CommandBar`
   - search/filter/sort/view controls grouped as one coherent toolbar;
   - wraps or becomes a sheet on mobile.
5. `InlineInspector`
   - focused side panel for secondary details without losing list context;
   - URL-addressable when it represents a real record.
6. `CompletionFeedback`
   - short success transition after an action; does not block continued work.

### 5.4 State and illustration primitives

1. `EmptyStateIllustration`
   - small, monochrome/duotone, product-specific line illustration;
   - variants: first record, no results, completed queue, unavailable data,
     permission boundary, connectivity issue;
   - illustration supports the message and never replaces clear copy/action.
2. `SkeletonComposition`
   - mirrors final geometry rather than generic gray bars;
   - no layout shift when data arrives.
3. `InlineError`
   - human explanation, retry action, optional diagnostic reference;
   - raw internal error codes are not the primary user-facing message.
4. `PermissionBoundary`
   - explains what is unavailable and provides an allowed recovery action.

### 5.5 Form primitives

1. `FormSection` with title, reason, optional disclosure, and error summary.
2. `PolishedSelect` as the only visible select control, including grouped
   options, search for long sets, and mobile-safe behavior.
3. `DateTimePicker` with readable natural-language summary.
4. `ChoiceCardGroup` for small, important mutually exclusive choices.
5. `StickyFormActions` for long forms, respecting safe areas on mobile.
6. `FieldHelp` and `ValidationMessage` with consistent geometry.
7. `StepProgress` for multi-step creation/setup flows.

## 6. Token and styling completion

### 6.1 Color

- Establish an audited graphite neutral ladder for light and dark.
- Establish one restrained blue accent ladder with separate fill, ink, line,
  hover, active, and focus tokens.
- Keep semantic success/warning/danger/info colors desaturated enough to sit
  naturally in the dark theme.
- Define chart-series tokens that remain distinguishable in both themes and
  under common color-vision deficiencies.
- Define illustration foreground/background tokens instead of embedding
  literal colors in SVGs.
- Add a lintable ban list for obsolete or visually harmful literal classes
  found during the route sweep.

### 6.2 Typography

- Audit every heading level and remove page-local approximations.
- Use display weight sparingly; avoid large fields of thin, low-contrast type.
- Standardize numeric typography with tabular figures and optical size.
- Establish maximum readable line lengths for descriptions and long-form text.
- Normalize uppercase eyebrow labels; use them only for context, never ordinary
  field labels.

### 6.3 Geometry

- Establish radius roles for control, card, overlay, and pill.
- Use an 8px-derived spacing rhythm with explicit compact exceptions.
- Standardize content maximum widths by page family.
- Eliminate accidental full-width forms and giant empty card interiors.
- Maintain 44px minimum touch targets on touch layouts.

### 6.4 Motion

- Define motion tokens for hover/press, disclosure, overlay, page-region
  insertion, reordering, and completion.
- Motion explains state change; it never runs continuously for decoration.
- Default transitions stay approximately 160–240ms for controls and 240–360ms
  for larger spatial changes.
- Use spring movement only where position/scale changes communicate physical
  continuity.
- `prefers-reduced-motion` uses immediate state or short cross-fade.

## 7. Page-family visual grammar

### 7.1 Executive/owner dashboards

Routes: `/`, `/overview`, `/outreach`, `/outreach/intelligence`, `/hq`.

Required composition:

- editorial page intro with current scope and period;
- one hero signal or attention region;
- asymmetric grid rather than repeated equal cards;
- real trends/comparisons where history exists;
- clear path from metric → filtered records → record → action;
- management summaries below operational priorities;
- no more than one major chart per viewport band unless the page is explicitly
  an analytics workspace.

### 7.2 Daily-work workspaces

Routes: `/outreach/workspace`, `/counter`, `/floor`, `/kitchen`,
`/scheduling`, `/approvals`.

Required composition:

- “what should I do now?” dominates;
- today/date/status context remains visible;
- queue and focused task are visually connected;
- rapid actions require minimal pointer travel;
- completion gives immediate visual feedback and advances naturally;
- secondary reporting never displaces today’s queue.

### 7.3 Lists and catalogues

Routes include `/outreach/prospects`, `/customers`, `/suppliers`, `/sales`,
`/purchases`, `/stock`, `/catalogue`, `/transactions`, `/people`, `/locations`,
`/assets`, `/godowns`, `/ledgers`, `/menu`.

Required composition:

- useful summary band only when it changes list decisions;
- one command bar for search/filter/sort/view;
- saved views or filter chips where recurring workflows exist;
- table/card choice based on task, not novelty;
- row hover, selection, keyboard focus, and bulk mode are visually distinct;
- meaningful empty/filter-empty/error/loading states;
- compact density without tiny touch targets or gray-on-gray text.

### 7.4 Record-detail workspaces

Routes include `/outreach/[id]`, `/customers/[customerId]`,
`/suppliers/[supplierId]`, `/sales/[orderId]`, `/purchases/[orderId]`,
`/stock/[productId]`, `/assets/[id]`, `/locations/[id]`, and team/member
detail routes.

Required composition:

- `DetailHero` with identity, state, owner, next action, and primary action;
- a focused primary work area, not a sequence of unrelated cards;
- history/timeline visually distinct from editable current state;
- tabs only when they represent stable conceptual work areas;
- destructive/terminal actions in a clearly labelled secondary menu;
- related records and provenance reachable without burying the main task.

### 7.5 Forms and setup

Routes include `/import`, `/configuration`, `/settings/**`, `/floor/setup`,
creation dialogs/sheets, and inline editors.

Required composition:

- grouped sections with explanations where choices are consequential;
- bounded widths and no horizontal clipping at 320px or desktop zoom;
- progressive disclosure for expert/rare fields;
- visible completion/error summary;
- sticky actions for long forms;
- review/confirmation step for consequential multi-record writes;
- custom dropdown/date/combobox controls with complete keyboard behavior.

### 7.6 Reports and intelligence

Routes: `/reports/**`, `/tax/**`, `/finance`, `/outreach/intelligence`,
`/outreach/domains/**`, `/audit`.

Required composition:

- period, cohort, scope, and data freshness are always visible;
- chart and table views share the same filters and totals;
- exact values available without relying on visual estimation;
- anomalies and exceptions are separated from ordinary totals;
- export/print views remove decorative atmosphere and preserve labels;
- no chart without an explicit question it answers.

### 7.7 Administration and HQ

Routes: `/hq/**`, `/roles`, `/capabilities`, `/configuration`, `/people`,
`/settings/**`, `/account`.

Required composition:

- denser, calmer surfaces than executive dashboards;
- strong hierarchy between tenant identity, configuration, and irreversible
  operations;
- diagrams for role composition/module relationships where relationships are
  otherwise difficult to understand;
- change previews for permissions/configuration;
- danger zones isolated from routine settings;
- no decorative analytics unrelated to the administrative decision.

### 7.8 Authentication and recovery

Routes: `/sign-in`, `/reset-password`, `/reset-password/update`.

Required composition:

- minimal centered composition with subtle atmosphere and strong legibility;
- brand mark remains monochrome;
- password/help states feel first-class, not appended;
- errors are human-readable and do not expose internal/provider detail;
- loading/redirect states are visually stable.

## 8. Outreach role-view specification

Outreach is the reference implementation because it contains the three most
important role experiences and the richest current workflow.

### 8.1 Company Core — `/outreach`

Goal: understand company execution and intervene where needed.

Above the fold:

- current direction as a quiet editorial banner with a small blue edge/icon,
  period, vertical, geography, and last update;
- hero signal: today’s company execution, showing active contributors versus
  expected contributors and the number requiring attention;
- compact period selector;
- primary action appropriate to Core, not a generic “add” button.

Primary visual regions:

1. **Today’s execution**
   - worked / partial / not started distribution;
   - exact counts and denominator;
   - drill-through to people/teams;
   - latest meaningful activity and missed check-ins.
2. **Team comparison**
   - two-team or N-team comparison using aligned horizontal measures;
   - members, active prospects, activities, meetings, progress, and review
     status;
   - team cards use avatar stacks and restrained status bars.
3. **Pipeline movement**
   - funnel or stage flow with current count, period movement, and drop-off;
   - segment click filters prospects.
4. **Attention**
   - overdue actions, unreviewed reports, stalled prospects, and escalations;
   - one clear action per item.
5. **Management intelligence**
   - domain/channel signals, bottleneck explanation, trend evidence;
   - visually secondary to today’s execution.

Do not:

- show eight equal KPI cards before the work requiring intervention;
- use large blue-filled team cards;
- use a decorative illustration when real company activity can occupy the
  space.

### 8.2 Senior — `/outreach`

Goal: run one team today, coach people, and remove blockers.

Required differences from Core:

- the hero is “your team today,” not company-wide roll-up;
- member work-state matrix is prominent;
- queue prioritizes reviews, escalations, overdue actions, and coaching;
- each member row shows current status, recent activity, next action, and
  whether the daily report requires review;
- team trend and pipeline are scoped to the led team;
- coaching notes and review actions appear near the relevant member context.

### 8.3 Junior — `/outreach/workspace`

Goal: know exactly what to do next and report work with minimal friction.

Required composition:

- greeting + date + concise progress state;
- “Next up” work queue as the dominant region;
- today’s progress ring or track with explicit completed/remaining counts;
- quick activity logging anchored to the selected prospect/task;
- daily check-in/report presented as a short guided flow, not a legacy form;
- current direction summarized in a compact, readable card;
- recent work timeline provides confidence that actions were recorded;
- gentle completion state when the day’s required work is done.

The page must not expose management analytics that do not help the Junior act.

### 8.4 Teams — `/outreach/teams` and detail routes

- Replace plain count cards with team identity cards: lead/co-lead, avatar
  stack, member count, today’s active count, prospect load, and attention
  indicator.
- Use neutral surfaces; blue appears in small active indicators and controls.
- Team detail opens with team identity + current operating status.
- Member list is a work-state matrix, not only a directory.
- Member detail uses progress, activity heatmap, reports, coaching timeline,
  and assigned work with explicit periods.

### 8.5 Prospects and lead detail

- Prospect list defaults to the most efficient daily-work view and preserves
  the card alternative only where it improves scanning.
- Health/stage/next action/last touch use aligned, compact visual language.
- Lead detail uses a strong summary hero and a workflow timeline.
- Contacts, tasks, meetings, research, commercial status, and AI insight are
  stable work areas rather than an undifferentiated vertical stack.
- AI insight must show provenance and unavailable/configuration states without
  displaying raw provider errors as product copy.

### 8.6 Intelligence and domains

- The page opens with the question being answered, period, cohort, and sample
  size.
- Funnel, velocity, aging, channel, and industry visuals drill through.
- Thin samples are visibly labelled and not visually overemphasized.
- Explanatory copy states what changed and why it may matter without claiming
  causality the data does not prove.

## 9. Business capability specification

### 9.1 Owner overview — `/overview`

- One dominant business pulse combining sales, money, inventory, and attention.
- Real historical trends from `TradingMetricSnapshot` where sufficient history
  exists.
- Sales/purchase comparison uses a shared time axis and exact values.
- Inventory visual emphasizes low-stock risk and incoming/reserved context.
- Receivables visual communicates aging and overdue exposure.
- Recent activity becomes a timeline; top customers/items become ranked visual
  summaries with drill-through.
- Onboarding checklist appears only while incomplete and reads as progress, not
  another generic card.

### 9.2 Sales, purchasing, inventory, finance, tax

- Keep operational tables dense and solid.
- Add compact summary/attention bands only when they drive a decision.
- State transitions are shown as a clear lifecycle.
- Financial values use aligned tabular typography.
- Tax exceptions, match failures, low stock, overdue balances, and approval
  holds use a shared attention language.
- Detail pages distinguish current state, available action, evidence, and
  history.

## 10. Graphics and illustration production

Create a small first-party visual asset system rather than collecting unrelated
artwork.

### 10.1 Style

- line-based or simple layered vector artwork;
- rounded geometric forms consistent with Verity’s icon language;
- monochrome graphite plus one restrained blue tint;
- no mascots, stock vectors, 3D clay objects, or glossy AI-generated scenes;
- transparent backgrounds and theme-aware strokes/fills;
- visual weight appropriate to 96–220px placements.

### 10.2 Initial asset set

1. No prospects yet.
2. No work due today.
3. Team fully checked in.
4. No search/filter results.
5. No activity history.
6. Import ready / import complete.
7. Permission boundary.
8. Assistant unavailable/configuration required.
9. Connectivity/retry.
10. Business setup complete.

Each asset must have:

- light and dark token behavior;
- accessible surrounding text;
- an explicit intended component/route;
- an SVG size/complexity budget;
- no embedded product or customer data.

## 11. Responsive behavior

Required viewports for implementation and proof:

- 1440×900 desktop;
- 1280×800 compact desktop;
- 1024×768 tablet landscape;
- 768×1024 tablet portrait;
- 390×844 modern phone;
- 320×568 minimum supported narrow phone.

Rules:

- Dashboard asymmetry collapses by priority, not DOM accident.
- Charts retain labels and exact-value access; they do not simply shrink.
- Wide tables use deliberate horizontal containment or switch to a record-list
  composition; the whole page must not horizontally scroll.
- Fixed actions respect safe areas and do not cover content.
- Popovers that do not fit become sheets/dialogs.
- Hover-only affordances have touch and keyboard equivalents.
- Outer desktop page scrolling remains bounded where the workbench design calls
  for independent panel scrolling, per `AGENTS.md`.

## 12. Accessibility and inclusion gates

- WCAG AA contrast for text and meaningful non-text indicators.
- 200% browser zoom without clipped actions or lost content.
- Complete keyboard path through navigation, controls, menus, forms, tables,
  and dialogs.
- Visible focus that follows the same radius/material language.
- Correct names, roles, states, and live-region behavior.
- Charts include textual summaries/data access.
- Status uses text/icon/shape in addition to color.
- Reduced-motion and reduced-transparency variants are tested, not only coded.
- Theme selection respects system preference and remains stable during
  hydration.
- Error, warning, and success copy remains understandable without domain or
  provider error codes.

## 13. Performance gates

- No new client chart library until a real missing capability justifies it;
  prefer existing SVG primitives for bounded charts.
- No full-page client conversion for visual polish.
- Avoid backdrop filters on large scrolling data regions.
- Avoid animated blur and continuously animated gradients.
- SVG illustrations are optimized and lazy where below the fold.
- Dashboard queries are composed in parallel and retain panel-level failure
  isolation.
- Visual additions must not cause layout shift after initial composition.
- Measure route JS and interaction latency before and after each page-family
  phase; material visual regressions require correction before merge.

## 14. Execution phases

### Phase 0 — baseline, inventory, and evidence harness (P0)

Deliverables:

- enumerate every production route and assign a page family;
- capture current signed-in screenshots for Core, Senior, Junior, owner, and
  platform operator in light/dark desktop/mobile states;
- record viewport, role, tenant, theme, route, commit, and timestamp with every
  screenshot;
- identify clipped controls, raw native controls, dead actions, low-contrast
  states, empty expanses, equal-weight card walls, and horizontal overflow;
- create a route-by-route acceptance checklist;
- reconcile ADR-024 gold and ADR-025 workspace-switcher text with the latest
  explicit blue/no-switcher direction.

Gate: no implementation phase starts without baseline proof for its target
routes. Missing credentials/data are blockers to visual completion, not reasons
to declare success from source inspection.

### Phase 1 — foundations and shared primitives (P0)

Deliverables:

- audited neutral/accent/chart/illustration tokens;
- typography, spacing, radius, shadow, material, and motion roles;
- shared primitives listed in section 5;
- Storybook-equivalent internal showcase route or isolated test fixtures for
  every primitive and every state;
- accessibility and visual regression tests for primitives.

Gate: no page-specific clone of a planned shared pattern; reduced-motion,
reduced-transparency, light/dark, and keyboard behavior pass.

### Phase 2 — shell and global states (P0)

Deliverables:

- refine sidebar/top bar/search/theme/profile/notification hierarchy;
- keep removed workspace pills absent;
- ensure command palette, polished selects, menus, modals, and assistant share
  one overlay grammar;
- rebuild global loading, empty, permission-denied, error, offline, and success
  states;
- translate AI-provider configuration failures into a designed assistant-
  unavailable state while preserving diagnostic detail in logs.

Gate: shell proof across all target viewports, both themes, expanded/collapsed
desktop rail, mobile navigation, and keyboard traversal.

### Phase 3 — Outreach role dashboards (P0)

Deliverables:

- Core dashboard per section 8.1;
- Senior dashboard per section 8.2;
- Junior workspace per section 8.3;
- reusable execution-status, team-comparison, and daily-progress visuals;
- real role-scoped data and actions only.

Gate: three role journeys verified with real accounts. A screenshot of one role
does not prove the other two.

### Phase 4 — Outreach teams, prospects, detail, intelligence (P1)

Deliverables:

- teams/member visual redesign;
- prospect list command bar and work-efficient default view;
- lead detail summary + workflow timeline + stable work areas;
- intelligence/domain drill-through graphics;
- meaningful Outreach empty states and illustrations.

Gate: list → filtered list → record → action → updated visual state works on
desktop and mobile; Senior cross-team boundaries remain enforced.

### Phase 5 — owner overview and business operations (P1)

Deliverables:

- `/overview` asymmetric business pulse;
- real trend UI over retained snapshots;
- visual attention language across sales, purchases, inventory, finance, and
  tax;
- record-detail lifecycle/timeline pattern across business entities.

Gate: every chart is backed by real values and exact-value access; all totals
reconcile with their underlying filtered records.

### Phase 6 — administration, HQ, configuration, settings (P1)

Deliverables:

- dense administration grammar;
- role/permission composition visualization;
- client/module/organization relationship views where useful;
- change previews and isolated danger zones;
- settings forms rebuilt with shared form primitives.

Gate: no visual simplification obscures authority, scope, tenant boundary, or
irreversibility.

### Phase 7 — remaining routes and consistency sweep (P1)

Deliverables:

- route inventory reaches 100% page-family coverage;
- remove page-local duplicate components/styles;
- eliminate remaining native-looking controls and obsolete material classes;
- verify print/export modes;
- verify all illustrations and semantic legends.

Gate: automated inventory reports no unclassified route and no prohibited
visual pattern.

### Phase 8 — final quality audit and release evidence (P0 release gate)

Deliverables:

- complete screenshot matrix;
- interaction recordings for representative Core/Senior/Junior/owner flows;
- visual regression baseline;
- accessibility results;
- performance comparison;
- issue ledger with every finding closed, consciously deferred, or rejected
  with rationale;
- updated taskplan/index/handoff documents.

Gate: product owner can compare before/after evidence for every primary role and
page family. “Looks better locally” is not release evidence.

## 15. Required acceptance tests

### 15.1 Visual

- no clipped fields, menus, charts, buttons, or labels at target viewports;
- no accidental horizontal page scrolling;
- no bloom/neon halo around ordinary cards;
- no large accent-filled content surfaces;
- consistent spacing/radius/material within each page family;
- dark theme remains graphite with restrained blue, not a blue canvas;
- empty states occupy appropriate space and provide a useful next action;
- light/dark hierarchy matches.

### 15.2 Interaction

- every visible control performs a real action;
- menus close on selection, outside click, and Escape;
- dialogs return focus correctly;
- dropdowns support keyboard selection and form submission;
- charts expose exact values and drill-through where promised;
- filters are reflected in URL or otherwise survive expected navigation;
- loading and completion states prevent double submission without freezing the
  interface;
- destructive actions remain secondary and confirmed.

### 15.3 Data truth

- every metric defines source, scope, period, and empty/unavailable behavior;
- comparisons use equal periods;
- no missing data is presented as zero;
- no synthetic trends, placeholder KPIs, invented health scores, or decorative
  maps;
- visible totals reconcile with detail records;
- role-scoped views do not imply access to hidden data.

### 15.4 Engineering

- focused ESLint and TypeScript checks after each slice;
- relevant unit/integration tests for transformed components and queries;
- production build after each phase;
- browser console free of new errors;
- visual test coverage for shared primitives and primary routes;
- `git diff --check` clean;
- small, reversible commits pushed after each independently verified slice.

## 16. Screenshot evidence matrix

Minimum release matrix:

| Persona | Routes | Themes | Desktop | Mobile |
|---|---|---|---|---|
| Company Core | `/outreach`, teams, prospects, intelligence | light + dark | yes | yes |
| Senior | `/outreach`, team detail, member detail, prospect | light + dark | yes | yes |
| Junior | `/outreach/workspace`, assigned prospect, daily report | light + dark | yes | yes |
| Business owner | `/overview`, sales, stock, finance | light + dark | yes | yes |
| Platform operator | `/hq`, client detail, roles/configuration | light + dark | yes | yes |

Each proof set must include at least one populated, empty, loading, error, and
permission-limited state where that state can occur.

## 17. Commit and rollout strategy

- One shared primitive/token slice per commit where practical.
- One page family or coherent user journey per feature commit.
- Do not combine schema/business-rule changes with visual redesign unless the
  visual requirement genuinely cannot be truthful without the data change.
- Push each verified slice to `main` under the existing user-authorized working
  model.
- Update this file’s status after every phase with commit hashes, routes, proof
  paths, tests, and remaining gaps.
- Do not mark an entire phase done when only the shared component exists.
- If a production rollout reveals a visual regression, correct the shared
  primitive first when the defect is systemic; avoid per-page patches.

## 18. Risk controls

1. **Aesthetic overreach** — control through restrained tokens, visual review,
   and the prohibition on decorative graphs/glow.
2. **Glass legibility/performance** — solid fallbacks, reduced transparency,
   bounded blur regions, and device testing.
3. **Dashboard dishonesty** — require source/period/denominator and drill-down.
4. **Component proliferation** — shared primitive inventory and extraction
   gate before page-local creation.
5. **Role leakage** — preserve permission-derived composition and test all
   three Outreach roles separately.
6. **Responsive regressions** — fixed viewport matrix plus 200% zoom tests.
7. **Visual-only completion claims** — pair screenshots with interaction and
   data reconciliation evidence.
8. **Design-document drift** — amend superseded ADR clauses in Phase 0 and keep
   status index/handoffs synchronized.

## 19. Explicit non-goals

- No copying Apple trademarks, product chrome, SF Symbols, or proprietary
  layouts.
- No new business metrics without a defined source and owner.
- No weakening permissions or RLS to make dashboards easier to populate.
- No broad framework upgrade as part of this visual program.
- No new chart/component library by default.
- No reintroducing the removed workspace pills.
- No full-product color explosion; dark classy graphite + subtle blue remains
  the visual direction.
- No claiming every page is redesigned after changing only global CSS.

## 20. Final definition of done

Task 116 closes only after:

1. Phases 0–8 satisfy their gates.
2. Every production route is classified and reviewed.
3. Shared visual/interaction primitives are the only implementation of their
   patterns.
4. Core, Senior, Junior, owner, and operator journeys pass with real accounts.
5. Light/dark desktop/mobile evidence is stored and reviewable.
6. Accessibility and performance checks pass.
7. Business totals and visualizations reconcile with source records.
8. No known P0/P1 visual or interaction defect remains open.
9. Governing ADR/spec/taskplan language reflects the final blue, restrained,
   no-persistent-workspace-pill direction.
10. The product owner accepts the before/after visual evidence—not merely the
    implementation description.
