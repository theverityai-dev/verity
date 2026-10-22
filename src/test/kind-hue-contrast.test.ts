import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/server/platform/accent";
import { KIND_HUES, KIND_PRESENTATION, SERIES_ORDER } from "@/components/ui/business/domains";

/**
 * ADR-046 §3 made executable. The eight kind hues and the six state-pill pairs are CSS tokens, so
 * contrast cannot be checked once by hand: this reads `globals.css` and holds every pair to the
 * rule in both themes. A hue that fails is replaced before it ships.
 */

const css = readFileSync(path.resolve(__dirname, "../app/globals.css"), "utf8");

/** `--color-x: light-dark(#aaaaaa, #bbbbbb);` -> { light, dark } */
function token(name: string): { light: string; dark: string } {
  const m = css.match(new RegExp(`--${name}:\\s*light-dark\\(\\s*(#[0-9a-fA-F]{6})\\s*,\\s*(#[0-9a-fA-F]{6})\\s*\\)`));
  if (!m) throw new Error(`token --${name} is missing or not a light-dark() of two hex values`);
  return { light: m[1]!, dark: m[2]! };
}

function hueDegrees(hex: string): { h: number; s: number } {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s };
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

describe("kind hues (ADR-046 §3)", () => {
  it("defines exactly eight hues, each with a fill and an ink", () => {
    expect(KIND_HUES).toHaveLength(8);
    for (const hue of KIND_HUES) {
      expect(() => token(`color-hue-${hue}-fill`)).not.toThrow();
      expect(() => token(`color-hue-${hue}-ink`)).not.toThrow();
    }
  });

  it("clears 4.5:1 for the glyph on its own fill, in both themes", () => {
    const failures = KIND_HUES.flatMap((hue) => {
      const fill = token(`color-hue-${hue}-fill`);
      const ink = token(`color-hue-${hue}-on`);
      return [
        ...(contrastRatio(ink.light, fill.light) < 4.5 ? [`${hue} light ${contrastRatio(ink.light, fill.light).toFixed(2)}`] : []),
        ...(contrastRatio(ink.dark, fill.dark) < 4.5 ? [`${hue} dark ${contrastRatio(ink.dark, fill.dark).toFixed(2)}`] : []),
      ];
    });
    expect(failures).toEqual([]);
  });

  it("keeps every chromatic hue 20deg or more from the semantic hues and the default tint", () => {
    // Semantic ink in both themes, plus the default tint (#0A84FF), are the colours a kind hue must
    // not be mistaken for. Low-chroma hues (brown, slate) differ by saturation, not angle, and are
    // exempt from the angle rule.
    const anchors = [
      ...["danger", "warning", "success", "info"].flatMap((n) => {
        const t = token(`color-${n}`);
        return [t.light, t.dark];
      }),
      "#0a84ff",
    ].map((hex) => hueDegrees(hex).h);
    const tooClose = KIND_HUES.flatMap((hue) => {
      const ink = token(`color-hue-${hue}-ink`);
      return [ink.light, ink.dark].flatMap((hex) => {
        const { h, s } = hueDegrees(hex);
        if (s <= 0.5) return [];
        const nearest = Math.min(...anchors.map((a) => hueDistance(h, a)));
        return nearest < 20 ? [`${hue} ${hex} is ${nearest.toFixed(0)}deg from a semantic hue`] : [];
      });
    });
    expect(tooClose).toEqual([]);
  });

  it("gives every family a known hue and orders series with every hue exactly once", () => {
    for (const [kind, p] of Object.entries(KIND_PRESENTATION)) {
      expect(KIND_HUES, kind).toContain(p.hue);
    }
    expect([...SERIES_ORDER].sort()).toEqual([...KIND_HUES].sort());
  });
});

describe("state pill tokens (ADR-046 §5)", () => {
  const categories = ["draft", "pending", "active", "blocked", "completed", "cancelled"];

  it("clears 4.5:1 for the pill word on its own fill, in both themes", () => {
    const failures = categories.flatMap((c) => {
      const fill = token(`color-state-${c}-fill`);
      const ink = token(`color-state-${c}-on`);
      return [
        ...(contrastRatio(ink.light, fill.light) < 4.5 ? [`${c} light ${contrastRatio(ink.light, fill.light).toFixed(2)}`] : []),
        ...(contrastRatio(ink.dark, fill.dark) < 4.5 ? [`${c} dark ${contrastRatio(ink.dark, fill.dark).toFixed(2)}`] : []),
      ];
    });
    expect(failures).toEqual([]);
  });
});

describe("state ink as plain text", () => {
  it("clears 4.5:1 as text on the light canvas and on white, and on the dark surface", () => {
    const failures = ["draft", "pending", "active", "blocked", "completed", "cancelled"].flatMap((c) => {
      const ink = token(`color-state-${c}-ink`);
      return [
        ...(contrastRatio(ink.light, "#e9edf6") < 4.5 ? [`${c} on light canvas`] : []),
        ...(contrastRatio(ink.light, "#ffffff") < 4.5 ? [`${c} on white`] : []),
        ...(contrastRatio(ink.dark, "#1c1c1e") < 4.5 ? [`${c} on dark surface`] : []),
      ];
    });
    expect(failures).toEqual([]);
  });
});

describe("danger button ink", () => {
  it("clears 4.5:1 on the danger-subtle fill and the gray hover fill (light) and the dark fills", () => {
    const ink = token("color-danger-ink");
    // Light: danger-subtle over the canvas and over white, and control-strong over the canvas,
    // as measured by Lighthouse. Dark: danger-subtle over black and over #1c1c1e.
    for (const bg of ["#f4dcdf", "#fde1e0", "#e3e3e9"]) expect(contrastRatio(ink.light, bg)).toBeGreaterThanOrEqual(4.5);
    for (const bg of ["#2e0c0a", "#452323"]) expect(contrastRatio(ink.dark, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
