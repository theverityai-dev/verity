/**
 * A minimal ZIP writer: stored (uncompressed) entries, UTF-8 names, no ZIP64.
 * Enough for a data export that every spreadsheet and OS can open, without a
 * dependency. CRC-32 comes from Node's own zlib.
 *
 * Authority: ADR-037 (the client's full-data export is one ZIP of CSV files).
 */
import { crc32 } from "node:zlib";

export type ZipEntry = { name: string; data: Uint8Array };

/** The classic format counts sizes and offsets in 32 bits; refuse rather than corrupt. */
export const ZIP_LIMIT_BYTES = 0xffffffff;
const MAX_ENTRIES = 0xffff;

/** DOS date/time for a fixed instant, so the same input always gives the same bytes. */
function dosDateTime(at: Date): { time: number; date: number } {
  const year = Math.max(1980, at.getUTCFullYear());
  return {
    time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | (at.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
  };
}

export function zipStore(entries: readonly ZipEntry[], at: Date = new Date()): Uint8Array {
  if (entries.length > MAX_ENTRIES) throw new Error("E_ZIP_TOO_MANY_ENTRIES");
  const { time, date } = dosDateTime(at);
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    if (name.length === 0 || name.length > 0xffff || entry.name.includes("\\") || entry.name.startsWith("/") || entry.name.split("/").includes("..")) {
      throw new Error("E_ZIP_BAD_NAME");
    }
    const size = entry.data.byteLength;
    const crc = crc32(entry.data) >>> 0;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);

    const header = new DataView(new ArrayBuffer(46));
    header.setUint32(0, 0x02014b50, true);
    header.setUint16(4, 20, true); // version made by
    header.setUint16(6, 20, true);
    header.setUint16(8, 0x0800, true);
    header.setUint16(10, 0, true);
    header.setUint16(12, time, true);
    header.setUint16(14, date, true);
    header.setUint32(16, crc, true);
    header.setUint32(20, size, true);
    header.setUint32(24, size, true);
    header.setUint16(28, name.length, true);
    header.setUint32(42, offset, true);

    parts.push(new Uint8Array(local.buffer), name, entry.data);
    central.push(new Uint8Array(header.buffer), name);
    offset += 30 + name.length + size;
    if (offset > ZIP_LIMIT_BYTES) throw new Error("E_ZIP_TOO_LARGE");
  }

  const centralSize = central.reduce((sum, part) => sum + part.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  if (offset + centralSize > ZIP_LIMIT_BYTES) throw new Error("E_ZIP_TOO_LARGE");

  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.byteLength, 0));
  let cursor = 0;
  for (const part of all) {
    out.set(part, cursor);
    cursor += part.byteLength;
  }
  return out;
}
