# Visual language library study

**Date:** 2026-10-16. **Feeds:** ADR-046, `taskplans/127_visual_language_every_screen_redesign.md` (§3.4, Phase 0).
**Purpose:** learn how mature icon and UI/UX systems solve the problems Verity now has (kind-coded icon tiles,
state pills, graphics on real data, list plus live detail pane), decide what to adopt, and record what we do
**not** do. Verity draws its own glyphs; nothing here authorises copying artwork or adding an icon package.

**Evidence tags.** *[fetched]* = read from the source on 2026-10-16. *[search]* = reported by a web search result,
not opened. *[prior knowledge]* = what I know of the system, not re-checked today; verify before relying on it.
*[to study]* = a question for the Phase 0 reading, not a finding.

---

## 1. Licences (read from each repository's own LICENSE file, *[fetched]*)

| System | Licence in the repo's root LICENSE | Attribution if text or paths are carried over | Note |
|---|---|---|---|
| Lucide | **ISC** (project), **MIT** for icons derived from Feather (© Cole Bemis) | Copyright and permission notice | Resolves the earlier "MIT or ISC" disagreement: both apply, to different icons |
| Phosphor | MIT (© 2023 Phosphor Icons) | Notice | Six weights |
| Tabler | MIT (© 2020-2026 Paweł Kuna) | Notice | 5,000+ glyphs |
| Heroicons | MIT (© Tailwind Labs) | Notice | Outline and solid |
| Iconoir | MIT (© 2021 Luca Burgio) | Notice | |
| Radix Icons | MIT (© 2022 WorkOS) | Notice | 15px grid *[prior knowledge]* |
| Fluent UI System Icons | MIT (© 2020 Microsoft) | Notice | |
| Material Symbols (material-design-icons repo) | Apache 2.0 | Licence text and notices | Variable font axes |
| IBM Carbon (carbon repo) | Apache 2.0 for the repository | as Apache | The root LICENSE text did not separate icons or pictograms; confirm the icon package's own licence before any use as a tracing reference *[to study]* |
| Apple SF Symbols | Apple's own licence, restricted to Apple platforms *[prior knowledge]* | not applicable | **Never embedded, copied or traced.** Visual target only |

**What this means.** Every set above except SF Symbols is permissive, so *studying* them is safe. We still redraw
rather than copy: copying even one path would obligate a notice in the product, and a mixed-origin set drifts
visually. Read the **individual icon** licence of any set before using one glyph as a tracing reference (a repo's
root licence does not always cover every asset).

---

## 2. Findings that change Verity's design

### 2.1 IBM Carbon — status indicators and data colour *[fetched]*

**What it does.** Status is drawn as *symbol + shape + colour + text*, never colour alone. Two indicator styles:
**icon indicator** (icon, meaningful colour, inline label) and **shape indicator** (shape, colour, label). Severity is
three levels: high (act now), medium (feedback or progress), low (something is ready or changed). Colour meanings:
red danger/error, orange serious warning, yellow regular warning, green normal/success, **blue passive notification
or workflow progress**, **gray drafts or unstarted jobs**, purple outliers/undefined. A consolidated status takes
the highest-attention colour. Accessibility on the page: use at least two of colour/shape/symbol (three of four for
compliance); non-text elements at least 3:1 against each other and the background; sizes are 20px icon with 16pt
type or 16px icon with 14pt type, shape indicators 16px with 14 or 12pt.

**Data colour.** A fixed-order categorical palette of 14 colours "curated to maximize contrast between neighboring
colors" (apply in the given order); smaller one-hue-family palettes when the category count is known; sequential
palettes of 10 steps (in light themes the darkest step is the largest value, reversed in dark); diverging palettes
that do not swap between themes; gradients only to highlight extremes. The page states **no** contrast ratios or
colour-blindness rules itself.

**Adopt.**
- Carbon's mapping lines up with ours and confirms it: blue = in-progress, gray = draft/unstarted, green = done,
  orange/yellow = warning, red = error. Verity's `StateCategory` map (ADR-046 §2) matches it.
- Pill = **dot + word** is the "shape indicator" (16px shape, 14pt text); an optional glyph makes it the "icon
  indicator". We take both as the pill's two forms (compact in tables, with glyph in headers and panes).
- Aggregate to the **highest-attention** colour (a job with one blocked stage shows blocked).
- Categorical chart colours are applied in **one fixed order** tuned for neighbour contrast; we fix an order for our
  eight kind hues and never let a chart pick its own.
- 3:1 for non-text, as already planned for icon-on-tile.

**Reject.** Purple-for-undefined (we have no "undefined" state; ADR-009 is closed). Fourteen categorical colours (we
have eight; more than eight series becomes a table). Gradients for ranges (ADR-033 forbids gradients on surfaces; a
chart range uses stepped values).

### 2.2 Shopify Polaris — badge tone and wording *[search; the page redirected and was not read]*

**What it does.** Tone is chosen by what the status *means*, not by the colour it used to produce. Tones: info,
success, warning, critical, caution, neutral. Orange is for in-progress, pending or needs-attention; red is reserved
for blocked actions or errors; background-to-text contrast at least 4.5:1. Labels are one word where possible, an
adjective ("unpaid", not "payment not received"), two or three words only for compound states ("partially
fulfilled"). The older React badge had a three-step progress indicator (incomplete, partially complete, complete).

**Adopt.** Tone by meaning (our `StateCategory` already is); one-word adjective labels as a written style rule for
tenant state labels in seeds and screens; a three-step *progress* glyph on a pill is a possible small addition for
"partially received / partially paid" (decide in Phase 1, not assumed).

**Differ.** Polaris uses orange for in-progress; our `Active` is **blue** (Carbon, ADR-033 and the owner's mockup all
agree) and **orange is Pending**. We follow ADR-009 and the mockup here.

### 2.3 Material Symbols — variable axes *[fetched, Google Fonts docs]*

**What it does.** Four axes: **FILL** 0 to 1 (outline to filled, "to show a state change"), **wght** 100 to 700
(stroke), **GRAD** (about -50 to 200: fine thickness change that barely alters size; negative grade reduces glare of
light-on-dark, positive grade makes a symbol stand out), **opsz** 20 to 48 dp (stroke auto-adjusts as size changes so
the look stays consistent).

**Adopt.**
- **Optical size is the key idea.** One stroke weight cannot look right at 16 and 32px. Verity Glyphs define stroke
  **per size** (16, 20, 24, 32) rather than scaling one drawing. This is the main weakness of today's `icons.tsx`
  (one 1.4 stroke at 16.5px).
- **FILL as state**: outline default, filled for selected/active (tab bar, selected sidebar row, KPI disc), as iOS
  does.
- **Grade for dark mode**: dark-theme glyphs get a slightly different effective weight so light-on-dark does not
  glare or thin out. We implement it as a small per-theme stroke offset, not a font axis.

**Reject.** Shipping a variable icon font (a dependency, a font download, and it blocks server-rendered inline SVG).

### 2.4 Lucide, Phosphor, Tabler, Heroicons, Iconoir, Radix, Fluent *[to study; licences fetched above]*

The attempt to fetch Lucide's design guide returned 404 at the address tried, so no grid numbers are asserted here.
What the Phase 0 reading must answer for each, appended to this file as a short note:

| Question | Why it matters to Verity |
|---|---|
| Canvas, keyline padding, stroke width at 24, corner radius, cap and join | Fix the Verity Glyphs grid (plan §3.4: 24px grid, round caps and joins, 2px radius, 2px padding, tested at 16) |
| How the set handles *weights* (Phosphor's six; Fluent regular and filled) | Our outline and filled states and the per-size stroke |
| Metaphors for **industrial and electrical** things: transformer, coil, core, bushing, tap changer, insulation, high voltage, megger, calibration, cooling | Tabler is expected to be strongest; DSEW needs about 55 glyphs, many with no standard metaphor. Record which metaphors are conventional so ours read as familiar |
| Metaphors for **process and quality**: stage, hold, rework, send back, checklist, evidence, certificate | KPI discs and journey stage cards |
| Optical corrections (circle overshoot, diagonal stroke thickness) | Glyph quality at 16px on non-retina screens |
| Radix's small grid | A reference for dense table rows |

Rule while studying: **record the idea, not the path.** No coordinates are copied into the repository.

---

## 3. UI and UX systems still to read *[to study]*

Each gets one section here before Phase 1 closes. The question list is fixed now so the reading is not open-ended.

| System | Specific question for Verity |
|---|---|
| Apple HIG (governing via ADR-033) | Lists with leading icons in tinted rounded squares (Settings app) for our icon tiles; sidebar and tab bar selected states; sheets and detail presentation for the pane-to-sheet change on phones |
| Fluent 2 | Master-detail and split-view behaviour; progress and stepper conventions |
| Atlassian | Lozenge (status pill) conventions, empty-state weight, timeline patterns |
| GitHub Primer | Label, counter and state-label conventions; dense data list with side panel |
| Material 3 | Filter chips with icon and count, navigation rail, large-screen two-pane layouts |
| Ant Design, Mantine | Steps, timeline, statistic cards, dense tables, description lists for "at a glance" |
| Tremor, shadcn/ui charts | KPI card plus sparkline composition; chart accessibility defaults. **Ideas only; we add no library** |
| Linear, Stripe Dashboard | List plus pane with keyboard navigation; restrained colour; how they show money and status |
| Manufacturing and ERP references already in the repo (Odoo mrp and quality, ERPNext, manager.io; `clients/dsew/reference-parity/`) | **What data** a stage, checklist, batch or job screen must show, so the restyle removes nothing DSEW needs |

---

## 4. Decisions this study already supports (carried into ADR-046)

1. State is **dot + word** (shape indicator) with an optional glyph (icon indicator), 4.5:1 text, 3:1 non-text. *(Carbon)*
2. State colours follow `StateCategory`; **Active = blue**, **Pending = orange**, Draft/Cancelled grey, Completed
   green, Blocked red. *(Carbon, Polaris on meaning, ADR-009)*
3. A roll-up shows the **highest-attention** colour. *(Carbon)*
4. Chart categories use one **fixed colour order**; more than eight series becomes a table. *(Carbon)*
5. Icons are drawn **per optical size**, with **outline and filled** states and a small dark-theme weight offset. *(Material Symbols)*
6. Labels are short adjectives. *(Polaris)*
7. No variable icon font, no third-party icon package, no copied paths, no chart library.

## 5. Open points

- Read the **icon-level** licence of each set (especially Carbon's icons and pictograms) before any glyph is used as
  a tracing reference.
- Re-fetch Polaris (the badge page now lives under `shopify.dev`) and the Lucide design guide to turn the *[search]*
  and *[to study]* items into *[fetched]* facts.
- Complete §2.4 and §3 during Phase 0; this file is the home for those notes.
