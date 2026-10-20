import type { FieldOption } from "@/server/platform/views";

export const RELATIONSHIP_CAPABILITY = "verity.capability.relationship";
export const ENTITY_COMPANY = "verity.relationship.company";
export const ENTITY_PERSON = "verity.relationship.person";
export const ENTITY_OPPORTUNITY = "verity.relationship.opportunity";
export const ENTITY_STAGE = "verity.relationship.stage";
export const ENTITY_NOTE = "verity.relationship.note";
export const ENTITY_INTERACTION = "verity.relationship.interaction";
export const ENTITY_FOLLOW_UP = "verity.relationship.follow_up";

/** The three things notes, interactions and follow-ups attach to. */
export const TARGET_KINDS = ["company", "person", "opportunity"] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

export const STAGE_CATEGORIES = ["Active", "Completed", "Cancelled"] as const;
export type StageCategory = (typeof STAGE_CATEGORIES)[number];

/**
 * The pipeline a tenant starts with. Names follow an engineering sale (enquiry, technical quote) because that is
 * the first client's flow; every tenant renames, reorders or adds stages from the pipeline settings.
 */
export const DEFAULT_STAGES: Array<{ key: string; label: string; category: StageCategory; probability: number }> = [
  { key: "enquiry", label: "Enquiry", category: "Active", probability: 10 },
  { key: "qualified", label: "Qualified", category: "Active", probability: 25 },
  { key: "quote", label: "Technical quote", category: "Active", probability: 50 },
  { key: "negotiation", label: "Negotiation", category: "Active", probability: 75 },
  { key: "won", label: "Won", category: "Completed", probability: 100 },
  { key: "lost", label: "Lost", category: "Cancelled", probability: 0 },
];

export const OPPORTUNITY_SOURCES: FieldOption[] = [
  { value: "enquiry", label: "Direct enquiry", tone: "info" },
  { value: "referral", label: "Referral", tone: "success" },
  { value: "website", label: "Website", tone: "accent" },
  { value: "tender", label: "Tender", tone: "warning" },
  { value: "rfq", label: "RFQ", tone: "warning" },
  { value: "repeat", label: "Repeat customer", tone: "success" },
  { value: "exhibition", label: "Exhibition", tone: "info" },
  { value: "other", label: "Other", tone: "neutral" },
];

export const LOST_REASONS: FieldOption[] = [
  { value: "price", label: "Price" },
  { value: "lead_time", label: "Delivery time" },
  { value: "specification", label: "Did not meet the specification" },
  { value: "competitor", label: "Went to a competitor" },
  { value: "no_decision", label: "No decision / project dropped" },
  { value: "budget", label: "No budget" },
  { value: "other", label: "Other" },
];

export const SIZE_BANDS: FieldOption[] = [
  { value: "1-10", label: "1–10" },
  { value: "11-50", label: "11–50" },
  { value: "51-200", label: "51–200" },
  { value: "201-1000", label: "201–1,000" },
  { value: "1000+", label: "1,000+" },
];

export const INTERACTION_KINDS = ["call", "meeting", "visit", "email", "message"] as const;
export type InteractionKind = (typeof INTERACTION_KINDS)[number];
export const INTERACTION_LABEL: Record<InteractionKind, string> = {
  call: "Call",
  meeting: "Meeting",
  visit: "Site visit",
  email: "Email",
  message: "Message",
};

/** `OPP-12`. */
export function opportunityRef(number: number): string {
  return `OPP-${number}`;
}

/** `acme.in` from `https://www.Acme.in/about`; null when it is not a domain. */
export function normaliseDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0] ?? "";
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(raw) ? raw : null;
}

/** The domain part of an email address, for matching a person to a company. */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at > 0 ? normaliseDomain(email.slice(at + 1)) : null;
}

/** Free-mail domains never identify a company. */
export const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "yahoo.co.in", "outlook.com", "hotmail.com", "live.com", "icloud.com", "rediffmail.com", "proton.me",
]);

export function personName(p: { givenName: string; familyName: string | null }): string {
  return [p.givenName, p.familyName].filter(Boolean).join(" ");
}
