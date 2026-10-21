/** Paise to a rupee string: Indian digit grouping, paise shown only when there are some. */
export function rupees(minor: number): string {
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const text = (abs / 100).toLocaleString("en-IN", { minimumFractionDigits: abs % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 });
  return `${negative ? "-" : ""}₹${text}`;
}

/** What a person types in a rupee box, as whole paise. NaN becomes null so a form can refuse it. */
export function toPaise(input: string): number | null {
  const value = Number(input.trim());
  return input.trim() === "" || !Number.isFinite(value) ? null : Math.round(value * 100);
}

/** 2026-10-21 as 21 Oct. */
export function shortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  hold: "On hold",
  completed: "Completed",
  closed: "Closed",
  cancelled: "Cancelled",
};

/** The ADR-009 state category a lot status reads as, for the state pill. */
export const STATUS_CATEGORY: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  hold: "Blocked",
  completed: "Completed",
  closed: "Completed",
  cancelled: "Cancelled",
};

export const BASIS_LABEL: Record<string, string> = {
  issued: "Issued pieces",
  good: "Accepted good pieces",
  returned: "Returned pieces",
};

export const PAYMENT_LABEL: Record<string, string> = {
  advance: "Advance",
  recovery: "Advance recovered",
  deduction: "Deduction",
  payment: "Payment",
};
