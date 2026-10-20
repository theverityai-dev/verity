/**
 * Where a dine-in table is in its service (`ServiceStage`, derived by `serviceStageOf`).
 *
 * One vocabulary for the floor plan and the outlet's Today page. It lives here and not in the shared
 * `components/ui/business` set because it names the kitchen, and ADR-014 keeps kitchen vocabulary out of
 * shared components (`conformance.test.ts`).
 *
 * The categories say who is waiting on whom: Pending is a waiter's move (take the order, carry the
 * food), Active is time passing on its own (the kitchen cooking, guests eating), Blocked is a table
 * nobody can seat until it is cleaned.
 */
export type TablePresentation = { label: string; category: string };

export const TABLE_STAGE: Record<string, TablePresentation> = {
  free: { label: "Free", category: "Completed" },
  seated: { label: "Ordering", category: "Pending" },
  with_kitchen: { label: "With the kitchen", category: "Active" },
  ready: { label: "Food ready", category: "Pending" },
  served: { label: "Eating", category: "Active" },
  reserved: { label: "Reserved", category: "Draft" },
  cleaning: { label: "Cleaning", category: "Blocked" },
  out_of_service: { label: "Out of service", category: "Cancelled" },
};
