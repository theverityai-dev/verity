/**
 * Display names for a client's lifecycle (ADR-034). A plain module, not part of
 * a "use client" file: a server component importing a constant from a client
 * module receives a client reference, not the object, so lookups silently fail.
 */
export const STATUS_LABEL: Record<string, string> = {
  onboarding: "Onboarding",
  active: "Active",
  suspended: "Suspended",
};
