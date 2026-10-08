import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isIconName } from "@/components/ui/icons";

/**
 * A capability names its navigation icon as a string. `isIconName` drops a name
 * the icon set does not have, so the item renders with no glyph and nothing
 * fails: seven items (Guests, Complaints, Recipes, Expenses, Coupons, Cash
 * reconciliation, Attendance) shipped that way until the 2026-10-09 production
 * walk noticed the sidebar. This makes the gap a failing test instead.
 */
const CAPABILITIES = join(process.cwd(), "src", "server", "capabilities");

function sources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

describe("navigation icons", () => {
  it("every icon a capability names exists in the icon set", () => {
    const unknown: string[] = [];
    for (const file of sources(CAPABILITIES)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\bicon:\s*"([A-Za-z]+)"/g)) {
        if (!isIconName(match[1])) unknown.push(`${file.replace(process.cwd(), "")}: ${match[1]}`);
      }
    }
    expect(unknown).toEqual([]);
  });
});
