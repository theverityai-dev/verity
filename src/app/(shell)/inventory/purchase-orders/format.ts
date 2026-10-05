/** Rupees with paise, because a vendor's price is ₹255.50, not ₹256. */
export function paiseToRupeesText(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Parses what a person typed ("255", "255.5", "1,250.75") into whole paise, or null. */
export function rupeesTextToPaise(text: string): number | null {
  const cleaned = text.replace(/[,₹\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

export const STATUS_LABEL: Record<string, string> = {
  Draft: "Draft",
  PendingApproval: "Waiting for approval",
  Approved: "Approved",
  PartiallyReceived: "Partly received",
  Received: "Received",
  Cancelled: "Cancelled",
};

/** The platform's behavioural categories (ADR-009) for the status badge. */
export const STATUS_CATEGORY: Record<string, string> = {
  Draft: "Draft",
  PendingApproval: "Pending",
  Approved: "Active",
  PartiallyReceived: "Active",
  Received: "Completed",
  Cancelled: "Cancelled",
};
