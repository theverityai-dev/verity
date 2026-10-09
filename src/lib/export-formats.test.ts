import { describe, expect, it } from "vitest";
import { crc32 } from "node:zlib";
import { zipStore } from "./zip-store";
import { csvCell, toCsv } from "./csv";

/** Reads a stored ZIP back through its central directory, the way an unzip tool would. */
function readZip(bytes: Uint8Array): Array<{ name: string; data: Uint8Array; crcOk: boolean }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.byteLength - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out: Array<{ name: string; data: Uint8Array; crcOk: boolean }> = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const localAt = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    expect(view.getUint32(localAt, true)).toBe(0x04034b50);
    const dataAt = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    const data = bytes.subarray(dataAt, dataAt + size);
    out.push({ name, data, crcOk: (crc32(data) >>> 0) === crc });
    at += 46 + nameLen;
  }
  return out;
}

describe("zipStore", () => {
  it("round-trips entries through the central directory with matching CRCs", () => {
    const enc = new TextEncoder();
    const zip = zipStore(
      [
        { name: "manifest.csv", data: enc.encode("a,b\r\n1,2\r\n") },
        { name: "guests/क्लाइंट.csv", data: enc.encode("naam\r\nरवि\r\n") },
        { name: "empty.csv", data: new Uint8Array() },
      ],
      new Date("2026-10-09T10:00:00Z"),
    );
    const back = readZip(zip);
    expect(back.map((e) => e.name)).toEqual(["manifest.csv", "guests/क्लाइंट.csv", "empty.csv"]);
    expect(back.every((e) => e.crcOk)).toBe(true);
    expect(new TextDecoder().decode(back[1]!.data)).toBe("naam\r\nरवि\r\n");
  });

  it("is deterministic for the same input and instant", () => {
    const entries = [{ name: "a.csv", data: new TextEncoder().encode("x") }];
    const at = new Date("2026-10-09T10:00:00Z");
    expect(Buffer.from(zipStore(entries, at)).equals(Buffer.from(zipStore(entries, at)))).toBe(true);
  });

  it("refuses names that could escape the folder when unzipped", () => {
    for (const name of ["../x.csv", "/abs.csv", "a\\b.csv", "a/../b.csv", ""]) {
      expect(() => zipStore([{ name, data: new Uint8Array() }])).toThrow("E_ZIP_BAD_NAME");
    }
  });
});

describe("toCsv", () => {
  it("quotes commas, quotes and newlines, and writes CRLF rows with a BOM", () => {
    const csv = toCsv(["name", "note"], [["Ravi, Jr.", 'said "hi"'], ["Line\nbreak", null]]);
    expect(csv).toBe('﻿name,note\r\n"Ravi, Jr.","said ""hi"""\r\n"Line\nbreak",\r\n');
  });

  it("renders dates as ISO, booleans and numbers plainly, null as empty", () => {
    expect(toCsv(["d", "b", "n", "x"], [[new Date("2026-10-09T10:00:00Z"), true, 12.5, undefined]])).toContain("2026-10-09T10:00:00.000Z,true,12.5,");
  });

  it("neutralises spreadsheet formulas but leaves phones and signed numbers as stored", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-1+2")).toBe("'-1+2");
    expect(csvCell("+91 98765 00000")).toBe("+91 98765 00000");
    expect(csvCell("-250")).toBe("-250");
    expect(csvCell(-250)).toBe("-250");
  });
});
