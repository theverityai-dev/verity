# Task 100 — Dashboard direction: from record display to business understanding

Authority: user synthesis, 2026-09-03 (full writeup preserved in spirit
below). Checked against `src/components/ui/charts.tsx` (existing chart
primitives, read in full) and the Spinner/shadcn finding from this same
session's nav-loading work.

## Status: Both flagged decisions made 2026-09-04.

**Metrics-history capability: BUILT AND APPLIED (confirmed 2026-09-17).**
Table + daily capture job (`verity.plywood.capture_metric_snapshot`) + a
`metricsHistory` query, reusing the exact SQL expressions `ownerConsole`
already uses for stock value/receivables/payables (source-of-truth
discipline) at whole-tenant scope. This is the actual unblocking
prerequisite this file itself identified as missing from the original
writeup. Migration `20260904150000_plywood_metric_snapshot` was applied
and `prisma migrate resolve --applied`'d the same day (commit `e92dbee`,
"table exists, RLS enabled+forced, entity_definition row present... migrate
status clean") — this file's earlier "not yet applied" note was stale,
corrected 2026-09-17. **The model itself was later renamed
`TradingMetricSnapshot`** as part of ADR-018's generic plywood→Trading
extraction — same table, same data, just no longer plywood-specific in
name. `pending-metric-snapshot-migration.sql` no longer exists at the repo
root; its content is what's now in the proper `prisma/migrations/` entry.
**Sparklines: BUILT 2026-09-20.** The prerequisite this file named
(real elapsed days of accumulated history) is now satisfied — confirmed
via `DIRECT_URL` before writing any UI: Shri Ganesh has 5 daily
snapshots, the audit tenant has 14, both real, both from the capture
job running since 2026-09-04. Wired `metricsHistory` into `/overview`'s
existing Inventory Snapshot / Money at a Glance panels (inventory
value, owed-to-us, owed-by-us) using the already-built `BarStrip`
primitive — no new chart library, matching `StatCard`'s own `weeks`
prop pattern exactly. Gated on `history.length > 1` so a tenant too new
for the job to have run twice renders no sparkline, never a fake or
flat one.

**shadcn/ui adoption: decided NO.** Verity keeps its existing hand-built
component layer as the only one. Reasoning: the file's own analysis
already showed installing shadcn "underneath" means either running two
component systems in parallel (real maintenance cost, no corresponding
benefit for an existing product) or a large deliberate migration of
already-working primitives — neither justified by anything currently
blocked on it. `react-map-gl`/MapLibre, Recharts, and the other named
libraries remain reference choices for when their actual prerequisite
(multi-region client data, real time-series data) exists, per this file's
own re-ranked priority list — none installed now.

The non-conflicting parts of this file (asymmetric layout, intelligent
cards, per-role views) remain buildable whenever Overview work is next a
priority — no blocker, not done in this pass.

## The core idea, worth keeping in one sentence

Move Verity from *record display* → *business understanding* → *business
action*: metrics that answer what's happening, whether it's changing, and
what to do about it; drill-down from a number to its underlying records;
information hierarchy instead of a flat grid of equal-weight cards. This
is a real direction, not decoration-for-its-own-sake, and it's
consistent with `impeccable`'s own craft floor and with what Tasks 86/90/
92 already independently arrived at from a different angle.

## Where this overlaps what's already planned — don't duplicate

- **Click-through drill-down** (metric → filtered list → record →
  action) is the Metabase pattern the writeup names directly. It's also
  exactly what Task 90 (Attention) and Task 92 (business timeline)
  already point at. Build those two, and a large part of "click a KPI,
  land on filtered records" falls out of them rather than needing a
  separate mechanism.
- **"Attention" panel** in the redesigned Overview mockup is Task 90,
  named identically, independently arrived at twice now.
- **Per-page visual grammar** ("Overview is visual, Purchases is dense
  and operational, Transactions is a ledger") is already Verity's
  practice, not a new proposal — plywood's own shipped pages already
  differ this way (Task 71's finance desks vs. the Overview page's KPI
  cards). Worth stating explicitly as a standing principle rather than
  something to newly adopt, but not new work.

## Where this conflicts with an already-made decision — needs resolving, not folding in

**Charts and sparklines "everywhere appropriate."** `charts.tsx` states
its own rule directly: *"no library... EVERY VALUE IS REAL... no sample
data, no smoothing and no projected series — the platform has no
analytics layer, so a trend line here would be a drawing rather than a
measurement."* A sparkline needs a time series — daily/weekly snapshots
of sales, stock, receivables — and Verity does not currently store one;
every number on Overview today is a live aggregate query, not a
retained history. Adding sparklines "everywhere appropriate" without
that layer means either (a) fabricating a plausible-looking trend from
one data point, which is the exact thing `charts.tsx`'s comment refuses,
or (b) building a real time-series/snapshot capability first. This is
the actual prerequisite the writeup doesn't name: **a metrics-history
capability is missing infrastructure, not a chart-library choice.**
Recharts vs. ECharts vs. hand-drawn SVG is a real but secondary decision
that only matters once there's a real series to draw.

**shadcn/ui "as the foundation."** Verity already has a hand-built
component layer (`src/components/ui/` — `Modal.tsx`, `primitives.tsx`,
`Combobox.tsx`, `DataTable.tsx`, and this session's own `Spinner.tsx`),
deliberately not shadcn-shaped: no `components.json`, no `cn()` /
`@/lib/utils`, no styled-jsx, every component hand-styled against
Verity's own semantic tokens (confirmed directly in this session's own
Spinner work, which explicitly declined to set up shadcn for exactly
this reason). Installing shadcn "underneath" Verity's identity, as the
writeup itself cautions doing carefully, means either running two
component systems in parallel (real maintenance cost) or migrating
existing hand-built primitives onto shadcn's underneath a Verity skin
(a large, deliberate rewrite, not an addition). This needs an explicit
yes/no from you before any shadcn primitive is installed — it is not a
default-safe "core layer" the way the writeup frames it for a greenfield
project, because Verity isn't one.

## Where this is new, doesn't conflict, and is reasonable to plan

- **Asymmetric layout, information hierarchy, "intelligent cards"**
  (metric → context → interpretation → action, not metric → label) —
  compatible with everything already built, no missing infrastructure,
  no conflicting prior decision. Genuinely just better layout/copy work
  on the existing Overview page.
- **Maps** — the writeup's own instinct is right ("don't put a map on
  every dashboard... only where geography changes the decision") and
  worth taking further than the writeup does: Shree Ganesh is a
  single-tenant, Delhi-NCR business with a handful of godowns, not the
  multi-city "operations across India" the mockup depicts. A map is
  aspirational for a future multi-location/multi-region client, not
  something the current client's actual data would make honest today —
  same "every value is real" principle `charts.tsx` already states,
  applied to geography instead of trend lines. Worth keeping
  `react-map-gl`/MapLibre as the reference choice for whenever a client
  genuinely has multi-region operations; not worth building against
  Shree Ganesh's single-region reality now.
- **Per-role different views of the same data** — already how permission
  scoping works (Verb+Entity+Scope, redacted fields); the writeup's
  framing (owner sees X, cashier sees Y) is a UI-composition question
  over data Verity already scopes correctly, not a new access-control
  concept.

## The "design formula" paragraph, kept as a standing brief

Worth preserving close to verbatim as a reference brief for future
Overview/dashboard work, since it states the restraint half of the
direction as clearly as the ambition half: evolve the existing Verity
identity (typography, accent system, restrained glass) toward richer
information hierarchy and drill-down, inspired by Linear/Stripe/Metabase/
Twenty/Plane's *interaction patterns* — not their branding or layouts.
Avoid excessive gradients, glass, animation, and "AI-startup" decoration.
Every metric should answer: what's happening, is it changing, what
should I do. This reads as consistent with — not a departure from — the
existing Experience System (ADR-011/012) and with `impeccable`'s craft
floor as already applied this session.

## Library priority, re-ranked against what's actually missing

The writeup's priority table ranks shadcn #1 and Recharts #3. Given the
findings above, the real order if any of this gets built:

1. **A metrics-history/snapshot capability** — not in the writeup at
   all, but the actual unblocking prerequisite for sparklines, trend
   charts, and "vs. last month" comparisons, all of which are currently
   fabricable-looking but not measurable.
2. **Recharts** (once #1 exists) — reasonable default for everyday trend
   charts once there's real time-series data to draw; no conflict with
   the existing hand-drawn `charts.tsx` primitives, which can stay for
   the ring/bar shapes that don't need a series.
3. **shadcn/ui** — explicit yes/no needed first (see above); not a
   default.
4. **react-map-gl + MapLibre** — reference choice for whenever a client
   has real multi-region data; not for Shree Ganesh now.
5. **Apache ECharts, Tremor, Motion Primitives, Magic UI** — study-only,
   as the writeup itself says for most of these; no action.

## Non-goals

- Not a redesign happening now. Nothing in this file is scheduled.
- Not an endorsement of shadcn or a chart library — both need explicit
  decisions this file surfaces rather than makes.
- Not a claim that Task 90/92 alone deliver everything in the writeup —
  the intelligent-card copy pattern and asymmetric layout are additional,
  real work on top of those.
