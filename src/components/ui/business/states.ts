/**
 * What a trader calls each order state, and the behavioural category behind it.
 *
 * Two separate maps in two page components said this before, and a supplier
 * workspace that called `receiving` "Part delivered" while the purchase desk
 * called it something else would be the same fact rendered two ways — the exact
 * inconsistency §84 is written against.
 *
 * The KEY is the capability's; the LABEL is the business's. Categories are the
 * six ADR-009 closes over, and SLA clocks read the category and never the key.
 */

export type StatePresentation = { label: string; category: string };

/** Purchase order states. `receiving` is Active: material is arriving now. */
export const PURCHASE_STATE: Record<string, StatePresentation> = {
  draft: { label: "Draft", category: "Draft" },
  submitted: { label: "With supplier", category: "Pending" },
  receiving: { label: "Part delivered", category: "Active" },
  completed: { label: "Complete", category: "Completed" },
  cancelled: { label: "Cancelled", category: "Cancelled" },
};

/**
 * Sales order states.
 *
 * `pending_credit` is Blocked, not Pending: the order is not waiting its turn
 * in a queue, it is stopped until somebody with authority acts. The badge
 * should say which, because those are different things to a salesperson.
 */
export const SALES_STATE: Record<string, StatePresentation> = {
  draft: { label: "Draft", category: "Draft" },
  pending_credit: { label: "Held for credit", category: "Blocked" },
  approved: { label: "Approved", category: "Pending" },
  dispatching: { label: "Stock held", category: "Active" },
  completed: { label: "Goods issued", category: "Completed" },
  cancelled: { label: "Cancelled", category: "Cancelled" },

  /**
   * Non-canonical, and mapped rather than erased — audit finding U0-2.
   *
   * A real order carrying this value exists in a client's data. It is written
   * by nothing in this repository, so it arrived from an import or an earlier
   * system. `openOrders` used to filter it away, which made an ₹82,500 order
   * invisible on every screen while its value still counted against the
   * customer's credit.
   *
   * Naming it here is the smaller intervention: the row stays exactly as the
   * business recorded it, and it becomes visible and actionable. Rewriting a
   * client's data to match our vocabulary would be the larger and less
   * reversible move, and is not ours to make.
   */
  Processing: { label: "Processing", category: "Active" },
};

/**
 * Falls back to the raw key rather than inventing a label for a new state.
 *
 * Audit finding U0-2. Showing an unmapped state verbatim is deliberate: the
 * alternative — hiding it, or calling it "Unknown" — loses the one piece of
 * information a person could act on. `StateBadge` renders an unrecognised
 * category with a neutral dot, so the row reads as ordinary rather than broken.
 */
export function present(
  map: Record<string, StatePresentation>,
  key: string,
): StatePresentation {
  return map[key] ?? { label: key, category: key };
}

/** Every state key the UI can name, for the conformance check. */
export function knownStateKeys(): string[] {
  return [
    ...new Set([...Object.keys(PURCHASE_STATE), ...Object.keys(SALES_STATE)]),
  ];
}
