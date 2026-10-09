/**
 * The arithmetic of a restaurant tax invoice (ADR-040; Task 126 Wave 2). Pure: no
 * database, no clock beyond arguments, so every rupee on a bill is testable.
 *
 * Money is integer minor units (paise). Rates are basis points of the TOTAL GST
 * rate: 5% is 500, shown as CGST 2.5% plus SGST 2.5%. A rate that does not halve
 * evenly gives CGST the lower half, so the two always sum to the rate.
 *
 * Order of operations, because it decides what the guest pays and what the
 * tax return says:
 *   1. lines are grouped by rate;
 *   2. the bill discount is shared across the groups in proportion to their value;
 *   3. a service charge, if any, is worked out on what remains and shared the same
 *      way, so it is taxed at the rate of the food it follows;
 *   4. CGST and SGST are worked out per group, each rounded to the paisa;
 *   5. the total is rounded to the rupee and the adjustment is kept, not absorbed.
 */

export type TaxInputLine = { amountMinor: number; rateBp: number };

export type TaxLineResult = {
  rateBp: number;
  grossMinor: number;
  discountMinor: number;
  serviceChargeMinor: number;
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
};

export type BillComputation = {
  subtotalMinor: number;
  discountMinor: number;
  serviceChargeMinor: number;
  taxLines: TaxLineResult[];
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  roundingMinor: number;
  totalMinor: number;
};

/** Shares `total` across `weights` in proportion, exactly: the parts always add up to `total`. */
export function allocateProportionally(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total === 0 || sum === 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const parts = exact.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  // Largest remainder first; the earlier group wins a tie, so the result is deterministic.
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    parts[index]! += 1;
    left -= 1;
  }
  return parts;
}

export function splitRate(rateBp: number): { cgstBp: number; sgstBp: number } {
  const cgstBp = Math.floor(rateBp / 2);
  return { cgstBp, sgstBp: rateBp - cgstBp };
}

export function computeBill(input: {
  lines: TaxInputLine[];
  discountMinor: number;
  /** Basis points of the amount after discount. Zero for none. */
  serviceChargeBp: number;
  /** True when the restaurant's own invoice carries no tax (platform orders, ADR-040 item 6). */
  taxFree: boolean;
}): BillComputation {
  const groups = new Map<number, number>();
  for (const line of input.lines) groups.set(line.rateBp, (groups.get(line.rateBp) ?? 0) + line.amountMinor);
  const rates = [...groups.keys()].sort((a, b) => a - b);
  const gross = rates.map((r) => groups.get(r)!);

  const subtotalMinor = gross.reduce((a, b) => a + b, 0);
  const discountMinor = Math.min(Math.max(0, input.discountMinor), subtotalMinor);
  const discounts = allocateProportionally(discountMinor, gross);
  const net = gross.map((g, i) => g - discounts[i]!);

  const serviceChargeMinor = Math.round((net.reduce((a, b) => a + b, 0) * Math.max(0, input.serviceChargeBp)) / 10_000);
  const charges = allocateProportionally(serviceChargeMinor, net);

  const taxLines: TaxLineResult[] = rates.map((rateBp, i) => {
    const taxableMinor = net[i]! + charges[i]!;
    const { cgstBp, sgstBp } = splitRate(rateBp);
    return {
      rateBp,
      grossMinor: gross[i]!,
      discountMinor: discounts[i]!,
      serviceChargeMinor: charges[i]!,
      taxableMinor,
      cgstMinor: input.taxFree ? 0 : Math.round((taxableMinor * cgstBp) / 10_000),
      sgstMinor: input.taxFree ? 0 : Math.round((taxableMinor * sgstBp) / 10_000),
    };
  });

  const taxableMinor = taxLines.reduce((a, l) => a + l.taxableMinor, 0);
  const cgstMinor = taxLines.reduce((a, l) => a + l.cgstMinor, 0);
  const sgstMinor = taxLines.reduce((a, l) => a + l.sgstMinor, 0);
  const beforeRounding = taxableMinor + cgstMinor + sgstMinor;
  const totalMinor = Math.round(beforeRounding / 100) * 100;

  return {
    subtotalMinor,
    discountMinor,
    serviceChargeMinor,
    taxLines,
    taxableMinor,
    cgstMinor,
    sgstMinor,
    roundingMinor: totalMinor - beforeRounding,
    totalMinor,
  };
}

/**
 * The tax inside a refund: the refunded amount is shared across the bill's rate
 * groups in proportion to what each group charged (tax included), then split into
 * taxable value, CGST and SGST so each group foots exactly. A refund is a credit
 * note, and a credit note states the tax it reverses.
 */
export function reverseTax(
  taxLines: Array<{ rateBp: number; taxableMinor: number; cgstMinor: number; sgstMinor: number }>,
  refundMinor: number,
): Array<{ rateBp: number; taxableMinor: number; cgstMinor: number; sgstMinor: number }> {
  const charged = taxLines.map((l) => l.taxableMinor + l.cgstMinor + l.sgstMinor);
  const shares = allocateProportionally(refundMinor, charged);
  return taxLines.map((line, i) => {
    const share = shares[i]!;
    if (charged[i] === 0 || share === 0) return { rateBp: line.rateBp, taxableMinor: share, cgstMinor: 0, sgstMinor: 0 };
    const cgstMinor = Math.round((share * line.cgstMinor) / charged[i]!);
    const sgstMinor = Math.round((share * line.sgstMinor) / charged[i]!);
    return { rateBp: line.rateBp, taxableMinor: share - cgstMinor - sgstMinor, cgstMinor, sgstMinor };
  });
}

/* ---------------------------- numbering and dates ---------------------------- */

/** Indian financial year of a moment, in the outlet's own zone: April to March. */
export function financialYearOf(at: Date, timeZone: string): { period: string; short: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const year = Number(parts.year);
  const start = Number(parts.month) >= 4 ? year : year - 1;
  const yy = (n: number) => String(n % 100).padStart(2, "0");
  return { period: `${start}-${yy(start + 1)}`, short: `${yy(start)}-${yy(start + 1)}` };
}

/** CGST Rule 46 and 53: at most 16 characters. Worked out here so a long code or a huge sequence fails loudly. */
export const MAX_DOCUMENT_NUMBER_LENGTH = 16;

function checked(number: string): string {
  if (number.length > MAX_DOCUMENT_NUMBER_LENGTH) {
    throw new Error(`document number "${number}" is longer than ${MAX_DOCUMENT_NUMBER_LENGTH} characters`);
  }
  return number;
}

/** `DC/26-27/000123` — outlet code, financial year, six digits. */
export function formatBillNumber(code: string, shortYear: string, sequence: number): string {
  return checked(`${code}/${shortYear}/${String(sequence).padStart(6, "0")}`);
}

/** `CDC/26-27/00007` — credit notes are their own series, five digits so the whole stays within 16. */
export function formatCreditNoteNumber(code: string, shortYear: string, sequence: number): string {
  return checked(`C${code}/${shortYear}/${String(sequence).padStart(5, "0")}`);
}
