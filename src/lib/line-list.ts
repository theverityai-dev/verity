/**
 * Shared rules for any form that builds a list of lines (purchase order, bill
 * of materials, production order, order pad): one place, so every module
 * behaves the same way.
 *
 * Choosing an item that is already on another line folds the two together:
 * the quantities add and the second line disappears. Nobody has to notice the
 * duplicate and add up by hand, and the server never sees the same item twice.
 */
export function assignLineItem<L extends { key: number }>(
  lines: L[],
  key: number,
  itemField: keyof L,
  itemId: string,
  qtyField: keyof L,
  /** Extra fields to set when the item is new to the list (a starting price). */
  extra: Partial<L> = {},
): L[] {
  const existing = itemId ? lines.find((l) => l.key !== key && l[itemField] === itemId) : undefined;
  if (!existing) {
    return lines.map((l) => (l.key === key ? { ...l, [itemField]: itemId, ...extra } : l));
  }
  const mine = lines.find((l) => l.key === key);
  const sum = (Number(existing[qtyField]) || 0) + (Number(mine?.[qtyField]) || 0);
  return lines
    .filter((l) => l.key !== key)
    .map((l) => (l.key === existing.key && sum > 0 ? { ...l, [qtyField]: String(sum) } : l));
}
