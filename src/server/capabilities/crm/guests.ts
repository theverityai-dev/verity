import type { TenantScopedClient } from "@/server/platform/tenancy";

/**
 * Guest identity after merges (Task 125 item 5.1).
 *
 * A duplicate guest row points at the guest to keep (`mergedIntoId`). Nothing is
 * deleted and no order, bill or ledger entry is edited, so identity is resolved
 * on read: a phone belongs to the guest its row points at, and a guest answers
 * for every phone in its group. A group is one level deep (the root and the rows
 * pointing straight at it); `mergeCustomers` flattens before it links.
 *
 * Lives apart from the CRM index so loyalty can use it without importing CRM
 * commands.
 */

/** The guest a phone counts as: its own row, or the guest that row was merged into. */
export async function findGuestByPhone(
  tx: TenantScopedClient,
  tenantId: string,
  phone: string,
): Promise<{ id: string; phone: string } | null> {
  const row = await tx.customer.findUnique({ where: { tenantId_phone: { tenantId, phone } } });
  if (!row) return null;
  if (!row.mergedIntoId) return { id: row.id, phone: row.phone };
  const root = await tx.customer.findUnique({ where: { id: row.mergedIntoId } });
  return root ? { id: root.id, phone: root.phone } : { id: row.id, phone: row.phone };
}

/** Every customer row that is this guest: the root first, then the rows merged into it. */
export async function guestGroup(
  tx: TenantScopedClient,
  rootId: string,
): Promise<Array<{ id: string; phone: string }>> {
  const root = await tx.customer.findUnique({ where: { id: rootId } });
  if (!root) return [];
  // A row that was itself merged answers as its root.
  const head = root.mergedIntoId ? ((await tx.customer.findUnique({ where: { id: root.mergedIntoId } })) ?? root) : root;
  const children = await tx.customer.findMany({ where: { mergedIntoId: head.id }, orderBy: { createdAt: "asc" } });
  return [head, ...children].map((c) => ({ id: c.id, phone: c.phone }));
}
