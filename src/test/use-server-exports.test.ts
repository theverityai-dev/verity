import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A `"use server"` file may export only async functions (and types). Any other export is not what the importer expects once the
 * file crosses into a client component: the import wizard threw `d.map is not a function` on first render because `IMPORT_KINDS`
 * was a constant exported from one (found by the demo walk, Task 129 C2). `tsc` and `next build` both accept it, so this is the
 * only thing that notices.
 */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

describe("use-server files", () => {
  it("export no constants, classes or enums", () => {
    const offenders: string[] = [];
    for (const file of walk("src").filter((f) => /\.(ts|tsx)$/.test(f))) {
      const source = readFileSync(file, "utf8");
      if (!/^\s*["']use server["']/m.test(source.slice(0, 300))) continue;
      for (const match of source.matchAll(/^export\s+(const|let|var|class|enum)\s+(\w+)/gm)) {
        offenders.push(`${file}: export ${match[1]} ${match[2]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
