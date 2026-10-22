import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The frosted glass (ADR-053) is a `backdrop-filter`. Lightning CSS, which Next 16 uses to build CSS, keeps a hand-written
 * `-webkit-backdrop-filter` and DROPS the standard property from the same rule. The shipped stylesheet then blurs in Safari and
 * nowhere else: Chrome, Edge and Firefox render flat translucent gradients, and every composited-contrast check made against the
 * blurred look is about a screen nobody sees. This already happened once (fixed 2026-09-18, commit 7d3276c) and ADR-053's CSS
 * brought it back; it was found on 2026-10-22 by reading `getComputedStyle(...).backdropFilter` in Chromium (it was `none`).
 *
 * The build adds the prefix itself for the browsers in `browserslist`, so no hand-written prefix is ever needed.
 */
const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

describe("globals.css backdrop-filter", () => {
  it("declares no -webkit-backdrop-filter by hand", () => {
    const declarations = css.split("\n").filter((line) => /-webkit-backdrop-filter\s*:/.test(line));
    expect(declarations).toEqual([]);
  });

  it("still declares the standard backdrop-filter on the glass materials", () => {
    for (const selector of [".glass-shell", ".glass-card", ".glass-inset", ".glass-overlay"]) {
      const rule = new RegExp(`${selector.replace(".", "\\.")}\\s*\\{[^}]*backdrop-filter\\s*:\\s*(?!none)[^;]+;`);
      expect(css, `${selector} must blur`).toMatch(rule);
    }
  });

  it("gives lite effects and reduced transparency the same no-blur answer", () => {
    expect(css).toMatch(/@media \(prefers-reduced-transparency: reduce\)/);
    expect(css).toMatch(/:root\[data-effects="lite"\] \.glass-card/);
    expect(css).toMatch(/:root\[data-effects="lite"\] body::before \{ display: none; \}/);
  });
});
