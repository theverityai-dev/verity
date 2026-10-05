import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * UI reachability — the automated form of the 2026-10-04 UI completeness audit
 * (`docs/audits/2026-10-04-ui-completeness-audit.md`).
 *
 * 1. Every navigation link a capability registers resolves to a page. A link
 *    with no page is the "nav 404" defect class (/inventory, /accounting,
 *    /billing all shipped that way).
 * 2. Every registered command and query is used by a screen, unless it is on
 *    the reviewed list in `ui-reachability.baseline.json` with a reason. The
 *    list is a ratchet: a NEW unreachable key fails, and a listed key that has
 *    since been wired also fails until it is removed, so the list only shrinks.
 *
 * Static by design (no database), so it runs in `test:pure` and in CI.
 * Regenerate the list after a deliberate change with
 * `UPDATE_UI_REACHABILITY=1 npx vitest run src/test/ui-reachability.test.ts`.
 */

const ROOT = process.cwd();
const CAPABILITIES = join(ROOT, "src", "server", "capabilities");
// Server actions are the screens' own backend (`"use server"` modules called by
// pages), so a definition they call is reachable from a screen.
const UI_DIRS = [join(ROOT, "src", "app"), join(ROOT, "src", "components"), join(ROOT, "src", "server", "actions")];
const BASELINE = join(ROOT, "src", "test", "ui-reachability.baseline.json");

function walk(dir: string, accept: (file: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full, accept);
    return accept(full) ? [full] : [];
  });
}

const isSource = (file: string) => /\.(ts|tsx)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file);
const capabilityFiles = walk(CAPABILITIES, isSource);
const uiSource = UI_DIRS.flatMap((dir) => walk(dir, isSource)).map((file) => readFileSync(file, "utf8")).join("\n");

/** Route groups like `(shell)` and `(hq)` do not appear in the URL. */
function pageExists(href: string): boolean {
  const segments = href.split("?")[0]!.split("/").filter(Boolean);
  const appDir = join(ROOT, "src", "app");
  const groups = readdirSync(appDir).filter((name) => /^\(.+\)$/.test(name));
  return [appDir, ...groups.map((g) => join(appDir, g))].some((base) => existsSync(join(base, ...segments, "page.tsx")));
}

type Definition = { key: string; exportName: string | null; file: string };

function definitions(): Definition[] {
  const found: Definition[] = [];
  for (const file of capabilityFiles) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/^\s*key:\s*"(verity\.[a-z0-9_]+\.[a-z0-9_]+)"/gm)) {
      const before = text.slice(0, match.index);
      // `notify({ key: ... })` names a notification, not a command or query.
      if (/notify\(\s*[\w.]*\s*,?\s*\{[^}]*$/.test(before.slice(-400))) continue;
      // The definition's exported name is the nearest `export const X` above it.
      const exports = [...before.matchAll(/export const (\w+)/g)];
      found.push({
        key: match[1]!,
        exportName: exports.at(-1)?.[1] ?? null,
        file: relative(ROOT, file).split(sep).join("/"),
      });
    }
  }
  return found;
}

function isReachable(definition: Definition): boolean {
  if (uiSource.includes(`"${definition.key}"`) || uiSource.includes(`'${definition.key}'`)) return true;
  if (definition.exportName && new RegExp(`\\b${definition.exportName}\\b`).test(uiSource)) return true;
  return false;
}

describe("UI reachability", () => {
  it("every registered navigation link resolves to a page", () => {
    const hrefs = new Set<string>();
    for (const file of capabilityFiles) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\bhref:\s*"(\/[^"]*)"/g)) hrefs.add(match[1]!);
    }
    expect(hrefs.size).toBeGreaterThan(0);
    const missing = [...hrefs].filter((href) => !pageExists(href)).sort();
    expect(missing, "navigation links with no page").toEqual([]);
  });

  it("every registered command and query is used by a screen, or is on the reviewed list", () => {
    const unreachable = definitions()
      .filter((d) => !isReachable(d))
      .map((d) => d.key)
      .sort();
    const unique = [...new Set(unreachable)];

    if (process.env.UPDATE_UI_REACHABILITY === "1") {
      const previous: Record<string, string> = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
      const next = Object.fromEntries(
        unique.map((key) => [key, previous[key] ?? "Not on a screen at the 2026-10-05 baseline; triage pending."]),
      );
      writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    }

    const reviewed: Record<string, string> = JSON.parse(readFileSync(BASELINE, "utf8"));
    const newlyUnreachable = unique.filter((key) => !(key in reviewed));
    const nowReachable = Object.keys(reviewed).filter((key) => !unique.includes(key));

    expect(newlyUnreachable, "commands/queries with no screen — wire them, or list them with a reason").toEqual([]);
    expect(nowReachable, "listed as unreachable but now used by a screen — remove them from the list").toEqual([]);
  });
});
