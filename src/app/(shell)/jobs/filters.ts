/**
 * The status groups on the Jobs list. Kept out of the client component file on purpose: a server page
 * that imports a value from a "use client" module receives a client reference, not the value.
 */
export const JOB_FILTERS = [
  ["all", "All"],
  ["open", "Open"],
  ["enquiries", "Enquiries and quotes"],
  ["working", "In work"],
  ["finished", "Finished"],
  ["lost", "Lost or cancelled"],
] as const;

export type JobFilterKey = (typeof JOB_FILTERS)[number][0];
