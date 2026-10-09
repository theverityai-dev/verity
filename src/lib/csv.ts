/**
 * CSV for data export (ADR-037). RFC 4180 quoting, CRLF rows, a UTF-8 byte-order
 * mark so spreadsheets read non-Latin names correctly.
 *
 * A cell that a spreadsheet would run as a formula (starts with = or @, a tab or
 * a carriage return, or a + or - that is not a plain number or phone) gets a
 * leading apostrophe. Numbers and phone-like values are left exactly as stored,
 * because an export that rewrites a guest's phone number is not a faithful copy.
 */

const PLAIN_SIGNED = /^[+-]?[0-9][0-9 ()-]*$/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString() : typeof value === "string" ? value : String(value);
  if (typeof value === "string" && text.length > 0) {
    const first = text[0]!;
    if (first === "=" || first === "@" || first === "\t" || first === "\r" || ((first === "+" || first === "-") && !PLAIN_SIGNED.test(text))) {
      text = `'${text}`;
    }
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(columns: readonly string[], rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  const lines = [columns.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))];
  return `﻿${lines.join("\r\n")}\r\n`;
}
