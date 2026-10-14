/** Integer minor units (paise) to rupees with Indian digit grouping. Never used for arithmetic. */
export function inr(minor: number | null | undefined, { compact = false }: { compact?: boolean } = {}): string {
  if (minor === null || minor === undefined) return "—";
  const rupees = minor / 100;
  if (compact && Math.abs(rupees) >= 100_000) {
    return `₹${(rupees / 100_000).toLocaleString("en-IN", { maximumFractionDigits: 2 })} L`;
  }
  return `₹${rupees.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** An ISO date (YYYY-MM-DD) as "12 Oct 2026". */
export function dateText(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(`${iso.slice(0, 10)}T00:00:00Z`) : iso;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function hoursText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} m`;
}

export const PRIORITY_LABEL: Record<string, string> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };
