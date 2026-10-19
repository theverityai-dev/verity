import { z } from "zod";
import { ValidationError } from "@/server/platform/command";
import type { TenantScopedClient } from "@/server/platform/tenancy";

/**
 * Document numbers. A pattern is literal text plus tokens:
 *
 *   {TYPE}       the document type's key, upper-cased
 *   {YEAR}       the four-digit year in the tenant's time zone
 *   {SEG:name}   the code chosen for the segment `name` (a country, a client, a division: the type's own code lists)
 *   {SEQ:n}      the running number, zero-padded to n digits. Exactly one.
 *
 * The sequence runs within everything else in the pattern, so `IN-A3-DRG-{SEQ:3}` and `IN-A4-DRG-{SEQ:3}` count
 * separately: a new document for a client that already has some takes that client's next number. Allocation takes
 * a transaction advisory lock and locks the counter row, so two documents raised together never share a number and
 * a rollback returns the number.
 */

export const segmentSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,19}$/, "lowercase letters, digits and underscores"),
    label: z.string().trim().min(1).max(40),
    options: z
      .array(z.object({ code: z.string().regex(/^[A-Za-z0-9]{1,6}$/, "1 to 6 letters or digits"), label: z.string().trim().min(1).max(60) }))
      .min(1)
      .max(60),
  })
  .refine((s) => new Set(s.options.map((o) => o.code)).size === s.options.length, "a code appears twice");
export type Segment = z.infer<typeof segmentSchema>;

export const segmentsSchema = z
  .array(segmentSchema)
  .max(8)
  .refine((all) => new Set(all.map((s) => s.key)).size === all.length, "a segment appears twice");

/** Reads the stored JSON back; anything that is not a valid list reads as no segments rather than throwing. */
export function readSegments(json: unknown): Segment[] {
  const parsed = segmentsSchema.safeParse(json);
  return parsed.success ? parsed.data : [];
}

type Token = { kind: "text"; text: string } | { kind: "type" } | { kind: "year" } | { kind: "seg"; key: string } | { kind: "seq"; width: number };

const SAFE_TEXT = /^[A-Za-z0-9\-_/.]*$/;

/** Validates a pattern against the type's segments. Throws a ValidationError that says what is wrong. */
export function parsePattern(pattern: string, segments: Segment[]): Token[] {
  if (pattern.length < 1 || pattern.length > 120) throw new ValidationError("E_VALIDATION: the number pattern must be 1 to 120 characters");
  const tokens: Token[] = [];
  for (const part of pattern.split(/(\{[^}]*\})/)) {
    if (part === "") continue;
    if (!part.startsWith("{")) {
      if (!SAFE_TEXT.test(part)) throw new ValidationError("E_VALIDATION: a number may contain letters, digits and - _ / . only");
      tokens.push({ kind: "text", text: part });
      continue;
    }
    const body = part.slice(1, -1);
    if (body === "TYPE") tokens.push({ kind: "type" });
    else if (body === "YEAR") tokens.push({ kind: "year" });
    else if (body.startsWith("SEG:")) {
      const key = body.slice(4);
      if (!segments.some((s) => s.key === key)) throw new ValidationError(`E_VALIDATION: the pattern uses {SEG:${key}} but the type has no segment "${key}"`);
      tokens.push({ kind: "seg", key });
    } else if (/^SEQ:\d+$/.test(body)) {
      const width = Number(body.slice(4));
      if (width < 2 || width > 8) throw new ValidationError("E_VALIDATION: {SEQ:n} needs n between 2 and 8");
      tokens.push({ kind: "seq", width });
    } else {
      throw new ValidationError(`E_VALIDATION: unknown token ${part}; use {TYPE}, {YEAR}, {SEG:name} or {SEQ:n}`);
    }
  }
  if (tokens.filter((t) => t.kind === "seq").length !== 1) throw new ValidationError("E_VALIDATION: the pattern needs exactly one {SEQ:n}");
  return tokens;
}

/**
 * The text a number has before its running part is filled in, with `#` marking where it goes. This is the counter's
 * key: two documents share a sequence exactly when their prefixes are equal.
 */
export function numberPrefix(tokens: Token[], ctx: { typeKey: string; year: string; chosen: Record<string, string> }): string {
  return tokens
    .map((t) => {
      switch (t.kind) {
        case "text": return t.text;
        case "type": return ctx.typeKey.toUpperCase();
        case "year": return ctx.year;
        case "seg": return ctx.chosen[t.key] ?? "";
        case "seq": return "#";
      }
    })
    .join("");
}

export function fillNumber(prefix: string, tokens: Token[], sequence: number): string {
  const width = (tokens.find((t) => t.kind === "seq") as { kind: "seq"; width: number }).width;
  const padded = String(sequence).padStart(width, "0");
  if (padded.length > width) throw new ValidationError("E_VALIDATION: this number series is full; widen {SEQ:n}");
  return prefix.replace("#", padded);
}

/** Each segment of the type needs one of its own codes. Returns the chosen codes keyed by segment. */
export function chooseSegments(segments: Segment[], chosen: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of segments) {
    const code = chosen?.[s.key];
    if (!code || !s.options.some((o) => o.code === code)) {
      throw new ValidationError(`E_VALIDATION: choose a ${s.label.toLowerCase()} from the list`);
    }
    out[s.key] = code;
  }
  return out;
}

/** The four-digit year as it is in the tenant's time zone right now. */
export function yearIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric" }).format(now);
}

/** Takes the next running number for a prefix, gaplessly, inside the caller's transaction. */
export async function allocateDocumentNumber(tx: TenantScopedClient, tenantId: string, prefix: string): Promise<number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([tenantId, "document", prefix])}, 0))`;
  const locked = await tx.$queryRaw<{ id: string; next_value: number }[]>`
    SELECT id, next_value FROM document_number_counter WHERE prefix = ${prefix} FOR UPDATE`;
  if (locked[0]) {
    await tx.documentNumberCounter.update({ where: { id: locked[0].id }, data: { nextValue: locked[0].next_value + 1 } });
    return locked[0].next_value;
  }
  await tx.documentNumberCounter.create({ data: { tenantId, prefix, nextValue: 2 } });
  return 1;
}
