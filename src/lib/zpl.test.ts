import { describe, expect, it } from "vitest";
import { ZPL_50X30, zplFile, zplLabel, zplText } from "./zpl";

describe("ZPL labels", () => {
  const label = { title: "R-0004", lines: ["Oxford, white", "118.00 m", "Mehta Textiles"], qr: "https://verity.example/fabric/5b3c" };

  it("makes one well-formed label: start, size, text lines, a QR and end", () => {
    const zpl = zplLabel(label);
    expect(zpl.startsWith("^XA\n^PW400\n^LL240")).toBe(true);
    expect(zpl.endsWith("^XZ")).toBe(true);
    expect(zpl).toContain("^FDR-0004^FS");
    expect(zpl).toContain("^FDOxford, white^FS");
    expect(zpl).toContain("^BQN,2,");
    expect(zpl).toContain("^FDMA,https://verity.example/fabric/5b3c^FS");
    // Every field that opens is closed.
    expect((zpl.match(/\^FD/g) ?? []).length).toBe((zpl.match(/\^FS/g) ?? []).length);
  });

  it("can never turn a name into a command, and never prints a wrong glyph", () => {
    expect(zplText("A^FO0,0^FDhack~DG\\")).toBe("A FO0,0 FDhack DG");
    expect(zplText("बंडल B-0001")).toBe("???? B-0001");
    expect(zplText("a\nb\tc")).toBe("a b c");
    expect(zplText("x".repeat(100), 10)).toHaveLength(10);
  });

  it("keeps the QR inside the label and the text clear of it", () => {
    const zpl = zplLabel(label, ZPL_50X30);
    const x = Number(/\^FO(\d+),\d+\^BQN/.exec(zpl)![1]);
    const mag = Number(/\^BQN,2,(\d+)/.exec(zpl)![1]);
    expect(x).toBeGreaterThan(200);
    expect(x + mag * 33).toBeLessThanOrEqual(400);
    const block = Number(/\^FB(\d+),1/.exec(zpl)![1]);
    expect(20 + block).toBeLessThan(x);
  });

  it("writes one label per piece, in order, for a file of many", () => {
    const file = zplFile([label, { ...label, title: "R-0005" }, { ...label, title: "R-0006" }]);
    expect((file.match(/\^XA/g) ?? []).length).toBe(3);
    expect(file.indexOf("R-0004")).toBeLessThan(file.indexOf("R-0005"));
    expect(file.indexOf("R-0005")).toBeLessThan(file.indexOf("R-0006"));
  });
});
