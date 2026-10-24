import type { ImportWorkerRow } from "@/server/capabilities/piecework";

/**
 * Reads a karigar list pasted from Excel or typed: one person per line, columns name, mobile, in the factory or outside, address.
 * Tabs (what Excel gives) or commas separate the columns. A first line that names the columns is skipped. A line with a problem is
 * reported with its number and left out, so one typo does not stop the other hundred.
 */
const MOBILE = /^[0-9 +()-]{6,20}$/;
const HEADER = new Set(["name", "karigar", "naam", "worker"]);
const OUTSIDE = /^(out|outside|unit|bahar)/i;

export type ParsedList = { rows: ImportWorkerRow[]; problems: string[] };

export function parseKarigarList(text: string): ParsedList {
  const rows: ImportWorkerRow[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === "") return;
    const cells = (line.includes("\t") ? line.split("\t") : line.split(",")).map((c) => c.trim());
    const name = cells[0] ?? "";
    if (index === 0 && HEADER.has(name.toLowerCase())) return;
    const at = `Line ${index + 1}`;
    if (name === "") { problems.push(`${at}: no name`); return; }
    if (name.length > 120) { problems.push(`${at}: the name is too long`); return; }
    if (seen.has(name.toLowerCase())) { problems.push(`${at}: ${name} is listed twice`); return; }
    const mobile = cells[1] ?? "";
    if (mobile !== "" && !MOBILE.test(mobile)) { problems.push(`${at}: ${name} has a mobile number that is not valid`); return; }
    seen.add(name.toLowerCase());
    rows.push({
      name,
      ...(mobile ? { mobile } : {}),
      kind: OUTSIDE.test(cells[2] ?? "") ? "outside" : "in_house",
      ...(cells[3] ? { address: cells[3].slice(0, 300) } : {}),
    });
  });
  return { rows, problems };
}
