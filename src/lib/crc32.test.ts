import { describe, expect, it } from "vitest";
import { crc32 as nodeCrc32 } from "node:zlib";
import { crc32 } from "./crc32";

describe("crc32", () => {
  it("matches Node's zlib on empty, short and large input", () => {
    const big = new Uint8Array(100_000).map((_, i) => (i * 31 + 7) & 0xff);
    for (const bytes of [new Uint8Array(0), new TextEncoder().encode("Stylified"), big]) {
      expect(crc32(bytes)).toBe(nodeCrc32(bytes) >>> 0);
    }
  });
});
