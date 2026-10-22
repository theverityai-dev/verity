/**
 * Visual effects level (Task 129 D5).
 *
 * The frosted-glass system (ADR-053) blurs every cell behind a 24px filter. That is the design and it sells in a demo, but on a
 * four-year-old Android phone or an office PC with an integrated GPU the blur is the slowest thing on the page. `lite` keeps the
 * layout, tint, type and hairlines and removes the blur and the light field, exactly what `prefers-reduced-transparency` already
 * does; it only adds a second way to arrive there.
 *
 * Stored in the `verity-effects` cookie so the server can stamp `data-effects` on the first byte of HTML, the way theme works.
 *   (absent)    automatic: decided once on the client and remembered as `auto-lite`, or left full
 *   "full"      the person chose full glass; never downgraded
 *   "lite"      the person chose lite
 *   "auto-lite" automatic detection chose lite (cleared when the person picks Automatic again)
 */

export type EffectsChoice = "auto" | "full" | "lite";

export const EFFECTS_COOKIE = "verity-effects";

/** A device that is probably short of GPU or memory. Both signals are optional; a missing one counts as "unknown", not weak. */
export function isWeakDevice(device: { hardwareConcurrency?: number; deviceMemory?: number }): boolean {
  const { hardwareConcurrency, deviceMemory } = device;
  if (typeof deviceMemory === "number" && deviceMemory <= 4) return true;
  if (typeof hardwareConcurrency === "number" && hardwareConcurrency > 0 && hardwareConcurrency <= 4) return true;
  return false;
}

/** The `data-effects` attribute the server stamps for a cookie value: `lite`, or nothing for full glass. */
export function effectsAttribute(cookie: string | undefined): "lite" | undefined {
  return cookie === "lite" || cookie === "auto-lite" ? "lite" : undefined;
}

/** What the person has chosen, for the settings control. Automatic covers a missing cookie and a remembered detection. */
export function effectsChoice(cookie: string | undefined): EffectsChoice {
  if (cookie === "lite") return "lite";
  if (cookie === "full") return "full";
  return "auto";
}
