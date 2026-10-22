import type { IconName } from "@/components/ui/icons";

/**
 * Kind hues: "what sort of thing is this" (ADR-046 §2–§4).
 *
 * Three colour systems, one job each, never swapped:
 *   tint   — interactive and selected (`--accent-seed`)
 *   state  — what condition a thing is in (`StateCategory`, ADR-009), shown only as a pill or dot
 *   kind   — what sort of thing it is. These eight hues. Icon tiles, icon discs, avatars and
 *            chart series ONLY — never a pill, button, link, text, border, cell background,
 *            focus ring or status dot.
 *
 * The hue is a function of the thing shown, not a page choice: a page asks `kindPresentation`
 * and gets the same hue and glyph as every other page showing the same kind. A ninth hue needs
 * an amendment to ADR-046.
 *
 * Values live in `src/app/globals.css` (`--color-hue-<name>-fill|ink`) and are PROVISIONAL until
 * the owner signs off the swatch sheet. `src/test/kind-hue-contrast.test.ts` holds them to
 * ADR-046 §3: the glyph (`-on`) >= 4.5:1 on its own fill in both themes, and every chromatic hue (`-ink`) >= 20deg
 * from each semantic hue and from the default tint.
 */

export const KIND_HUES = ["indigo", "purple", "magenta", "teal", "cyan", "olive", "brown", "slate"] as const;
export type KindHue = (typeof KIND_HUES)[number];

/**
 * The one order chart series take the hues in (Carbon applies its palette in a fixed order tuned for
 * neighbour contrast; ours is the same idea). A chart never picks its own colours. More than eight
 * series is a table, not a chart.
 */
export const SERIES_ORDER: readonly KindHue[] = [
  "indigo",
  "teal",
  "magenta",
  "olive",
  "cyan",
  "purple",
  "brown",
  "slate",
];

export type KindPresentation = { hue: KindHue; icon: IconName };

/**
 * Family -> hue and glyph. Extended as each family is restyled (Task 127 phases); manufacturing
 * stage kinds and electrical-equipment kinds join when their glyphs are drawn.
 */
export const KIND_PRESENTATION: Record<string, KindPresentation> = {
  sales: { hue: "indigo", icon: "sales" },
  buying: { hue: "purple", icon: "purchases" },
  stock: { hue: "teal", icon: "stock" },
  money: { hue: "cyan", icon: "finance" },
  tax: { hue: "cyan", icon: "tax" },
  ledger: { hue: "cyan", icon: "ledger" },
  people: { hue: "magenta", icon: "people" },
  party: { hue: "magenta", icon: "parties" },
  supplier: { hue: "purple", icon: "supplier" },
  evidence: { hue: "olive", icon: "evidence" },
  location: { hue: "brown", icon: "locations" },
  asset: { hue: "brown", icon: "assets" },
  schedule: { hue: "olive", icon: "schedule" },
  approval: { hue: "olive", icon: "approvals" },
  production: { hue: "slate", icon: "workspace" },
  platform: { hue: "slate", icon: "configuration" },
  audit: { hue: "slate", icon: "audit" },

  // DSEW production stage kinds. Each kind of stage gets its own hue so a shop-floor list scans by
  // stage at a glance (Task 127 §4.1). A tenant's route maps its stage to one of these kinds.
  "stage-cutting": { hue: "teal", icon: "stage-cutting" },
  "stage-winding": { hue: "indigo", icon: "stage-winding" },
  "stage-casting": { hue: "purple", icon: "stage-casting" },
  "stage-assembly": { hue: "brown", icon: "stage-assembly" },
  "stage-testing": { hue: "cyan", icon: "stage-testing" },
  "stage-dispatch": { hue: "olive", icon: "stage-dispatch" },
  "stage-mapping": { hue: "magenta", icon: "stage-mapping" },
  stage: { hue: "slate", icon: "stage" },

  // DSEW equipment kinds.
  transformer: { hue: "indigo", icon: "transformer" },
  electromagnet: { hue: "magenta", icon: "electromagnet" },
  calibration: { hue: "cyan", icon: "calibration" },
  "control-system": { hue: "slate", icon: "control-panel" },
  bushing: { hue: "brown", icon: "bushing" },
  "tap-changer": { hue: "indigo", icon: "tap-changer" },
  cooling: { hue: "cyan", icon: "cooling" },
  revision: { hue: "indigo", icon: "revision" },
  lost: { hue: "slate", icon: "lost" },
  delivery: { hue: "olive", icon: "truck" },

  // DSEW job lifecycle.
  enquiry: { hue: "olive", icon: "enquiry" },
  quote: { hue: "indigo", icon: "quote" },
  job: { hue: "slate", icon: "job" },
  milestone: { hue: "olive", icon: "milestone" },
  timesheet: { hue: "cyan", icon: "timesheet" },
  certificate: { hue: "cyan", icon: "certificate" },

  // Restaurant (Task 127 §4.2). Tables and dishes are brown; a bill is money (cyan). Order channels
  // each get their own hue so a counter queue scans by channel at a glance.
  table: { hue: "brown", icon: "table" },
  dish: { hue: "brown", icon: "dish" },
  bill: { hue: "cyan", icon: "receipt" },
  "channel-dine_in": { hue: "brown", icon: "table" },
  "channel-takeaway": { hue: "teal", icon: "takeaway" },
  "channel-delivery": { hue: "olive", icon: "truck" },
  "channel-delivery_platform": { hue: "purple", icon: "truck" },
  "channel-qr": { hue: "cyan", icon: "qr" },
  "channel-other": { hue: "indigo", icon: "sales" },
};

/** The kind a dine-in order channel is shown as. Presentation only; unknown channels share one tile. */
export function channelKindFor(channel: string): string {
  return `channel-${channel}` in KIND_PRESENTATION ? `channel-${channel}` : "channel-other";
}

/**
 * Which stage kind a tenant's stage is, from its key and label. Routes are tenant data, so a stage
 * carries no kind field; this reads the words the factory itself used. It is presentation only (the
 * tile's hue and glyph) and never drives behaviour. Order matters: "Core and coil assembly" is an
 * assembly, not winding. Unknown stages are the generic `stage`.
 */
export function stageKindFor(stageKey: string, label = ""): string {
  const text = `${stageKey} ${label}`.toLowerCase();
  if (/assembl/.test(text)) return "stage-assembly";
  if (/test|inspect|\bqc\b|quality/.test(text)) return "stage-testing";
  if (/dispatch|pack/.test(text)) return "stage-dispatch";
  if (/vpi|cast|epoxy|curing|impregnat|varnish|resin/.test(text)) return "stage-casting";
  if (/mapping|field/.test(text)) return "stage-mapping";
  if (/wind|coil/.test(text)) return "stage-winding";
  if (/cut|stack|lamin|machin|yoke/.test(text)) return "stage-cutting";
  return "stage";
}

/**
 * Which equipment kind a produced item is, from its name (DSEW: transformers, electromagnets,
 * calibration and control systems). Presentation only; unknown items are a generic job.
 */
export function equipmentKindFor(name: string): string {
  const text = name.toLowerCase();
  // A control panel *for* a transformer is a control system: test the thing made before what it serves.
  if (/control|panel/.test(text)) return "control-system";
  if (/transformer|\bkva\b|\bmva\b/.test(text)) return "transformer";
  if (/magnet/.test(text)) return "electromagnet";
  if (/calibrat|mapping/.test(text)) return "calibration";
  return "job";
}

/** What to call each stage kind on a chip ("Winding stage"). */
export const STAGE_KIND_LABEL: Record<string, string> = {
  "stage-cutting": "Preparation stage",
  "stage-winding": "Winding stage",
  "stage-casting": "Insulation and curing",
  "stage-assembly": "Assembly stage",
  "stage-testing": "Testing stage",
  "stage-dispatch": "Dispatch stage",
  "stage-mapping": "Field mapping",
  stage: "Production stage",
};

/**
 * The six `StateCategory` values (ADR-009). A KPI disc that counts things in one state takes that
 * state's colours (ADR-046 §2, clarified 2026-10-16) — the shop-floor "Ready / On hold / Rework"
 * discs. It is the state system, not a kind hue, so it never uses the eight hues.
 */
export const STATE_TONES = ["draft", "pending", "active", "blocked", "completed", "cancelled"] as const;
export type StateTone = (typeof STATE_TONES)[number];

const FALLBACK: KindPresentation = { hue: "slate", icon: "workspace" };

/** Unknown kinds fall back to neutral slate rather than inventing a colour. */
export function kindPresentation(kind: string): KindPresentation {
  return KIND_PRESENTATION[kind] ?? FALLBACK;
}
