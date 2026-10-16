import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Generic capabilities must not speak one industry's language. Inventory, manufacturing, project (jobs),
 * accounting, HR and attendance serve every client, and the canonical term for a site is `Location`
 * (GOV-TER). "Outlet" and kitchen words leaked from the restaurant build into a factory's screens once;
 * this fails the build instead of waiting for a client to notice.
 *
 * Only user-visible string text is checked: quoted strings that read as words (a capital letter or a space).
 * Lowercase identifiers such as `"outlet"` row keys are code, not copy.
 */

const ROOT = process.cwd();
const GENERIC = [
  "src/app/(shell)/inventory",
  "src/app/(shell)/manufacturing",
  "src/app/(shell)/jobs",
  "src/app/(shell)/accounting",
  "src/app/(shell)/hr",
  "src/app/(shell)/attendance",
  "src/app/(shell)/summary",
  "src/server/capabilities/inventory",
  "src/server/capabilities/manufacturing",
  "src/server/capabilities/project",
  "src/server/capabilities/accounting",
];
/** Words that belong to the restaurant (or another single industry), not to a generic capability. */
const BANNED = /\b(outlets?|kitchen|waiters?|chefs?|burnt)\b/i;
/**
 * Known debt, named so it cannot grow quietly: "Burnt" is a stored value in the closed WASTAGE_REASONS list.
 * Changing it needs a per-tenant configurable reason list (FINISHER), not a rename.
 */
const KNOWN_DEBT = new Set(['"Burnt"']);

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(full) && !/\.test\.(ts|tsx)$/.test(full) ? [full] : [];
  });
}

function strings(source: string): Array<{ line: number; text: string }> {
  const found: Array<{ line: number; text: string }> = [];
  source.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) return;
    for (const m of raw.matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g)) {
      const text = m[2] ?? "";
      if (/^[a-z][\w.-]*$/.test(text)) continue; // a lowercase identifier or key, not copy
      found.push({ line: i + 1, text });
    }
    // JSX text between tags.
    for (const m of raw.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)) found.push({ line: i + 1, text: m[1] ?? "" });
  });
  return found;
}

describe("generic capability wording", () => {
  it("uses no restaurant-only words in user-visible text", () => {
    const hits: string[] = [];
    for (const dir of GENERIC) {
      for (const file of walk(join(ROOT, dir))) {
        for (const s of strings(readFileSync(file, "utf8"))) {
          if (BANNED.test(s.text) && !KNOWN_DEBT.has(`"${s.text}"`)) hits.push(`${file.replace(ROOT, "")}:${s.line}  "${s.text.slice(0, 80)}"`);
        }
      }
    }
    expect(hits, "say 'location' (or the generic word), not the restaurant's").toEqual([]);
  });
});
