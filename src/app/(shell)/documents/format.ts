/** How soon a released revision lapses, in words a person can act on. `valid` with no date reads as "No expiry". */
export function expiryText(expiry: string, validUntil: string | null, today = new Date()): string {
  if (!validUntil || expiry === "none") return "No expiry";
  const days = Math.round((new Date(`${validUntil}T00:00:00Z`).getTime() - new Date(today.toISOString().slice(0, 10) + "T00:00:00Z").getTime()) / 86_400_000);
  if (days < 0) return `Expired ${-days} ${-days === 1 ? "day" : "days"} ago`;
  if (days === 0) return "Expires today";
  if (days <= 31) return `Expires in ${days} ${days === 1 ? "day" : "days"}`;
  return `Valid until ${new Date(`${validUntil}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`;
}

/** The state tone a revision status reads as (ADR-009 categories; the colour comes from the category only). */
export const STATUS_CATEGORY: Record<string, string> = {
  draft: "Draft",
  in_review: "Pending",
  released: "Active",
  superseded: "Completed",
  obsolete: "Cancelled",
};

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  in_review: "In review",
  released: "Released",
  superseded: "Superseded",
  obsolete: "Withdrawn",
};

/** Where a linked record lives, and what to call it. */
export function linkTarget(entityKey: string, id: string): { href: string; kind: string } {
  if (entityKey === "verity.project.job") return { href: `/jobs/${id}`, kind: "Job" };
  if (entityKey === "verity.manufacturing.order") return { href: `/manufacturing/${id}`, kind: "Production order" };
  return { href: `/manufacturing/boms/${id}`, kind: "Bill of materials" };
}
