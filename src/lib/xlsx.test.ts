import { describe, expect, it } from "vitest";
import { columnName, toXlsx } from "./xlsx";

/** Reads a stored ZIP's entries back by name, as an unzip tool would. */
function entries(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.byteLength - 22;
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    const size = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const localAt = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    const dataAt = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    out.set(name, new TextDecoder().decode(bytes.subarray(dataAt, dataAt + size)));
    at += 46 + nameLen;
  }
  return out;
}

describe("xlsx", () => {
  it("names columns like a spreadsheet", () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
  });

  it("writes the parts a spreadsheet needs, numbers as numbers and text as text that is never a formula", () => {
    const file = entries(toXlsx(["Lot", "Good", "Note"], [["LOT-0001", 86, "=SUM(A1)"], ["Mandarin & <co>", 1250.5, null]], "Lot: cost?"));
    expect([...file.keys()].sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]);
    const sheet = file.get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain('<c r="B2"><v>86</v></c>');
    expect(sheet).toContain('<c r="B3"><v>1250.5</v></c>');
    // Inline text, so "=SUM(A1)" is shown, not calculated; markup in a value is escaped.
    expect(sheet).toContain('t="inlineStr"><is><t xml:space="preserve">=SUM(A1)</t>');
    expect(sheet).toContain("Mandarin &amp; &lt;co&gt;");
    expect(sheet).not.toContain("<f>");
    // The header is bold and frozen; an empty cell writes nothing.
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr">');
    expect(sheet).toContain('state="frozen"');
    expect(sheet).not.toContain('r="C3"');
    // Excel refuses : ? in a sheet name.
    expect(file.get("xl/workbook.xml")).toContain('name="Lot  cost"');
  });
});
