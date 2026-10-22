/**
 * The kinds of record the import wizard accepts. A plain module on purpose: `src/server/actions/import.ts` is a `"use server"`
 * file, and a constant exported from one is not an array in a client component (the wizard threw `d.map is not a function` on
 * first render until this moved; found by the demo walk, Task 129 C2). Types may still be re-exported from there.
 */
export const IMPORT_KINDS = ["customer", "supplier", "product"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
