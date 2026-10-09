import type { TenantScopedClient } from "@/server/platform/tenancy";

/**
 * Takes the next number in a series, gaplessly (ADR-040 item 1; first written for
 * trading invoices as P2).
 *
 * `SELECT ... FOR UPDATE` on the counter row inside the CALLER'S transaction, so
 * two documents raised at the same moment serialise rather than colliding, and a
 * rollback returns the number instead of burning it. The cost is that document
 * creation serialises per series; at restaurant or trading volume that is nothing.
 *
 * Only the allocation lives here. How the number is shown (prefix, year, width)
 * is each capability's own, because a tax invoice has length rules a kitchen
 * ticket does not. The counter rows are in `trading_invoice_series` for now: a
 * table rename is cosmetic and touches live data, so it waits for a third consumer.
 *
 * `period` is whatever resets the sequence: a financial year ("2026-27") for tax
 * invoices, a service day ("2026-10-09") for kitchen tickets.
 */
export async function allocateSequence(
  tx: TenantScopedClient,
  tenantId: string,
  seriesKey: string,
  period: string,
): Promise<{ seriesId: string; sequenceNumber: number }> {
  // Also serializes an absent series row; row locks alone cannot do that.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([tenantId, seriesKey, period])}, 0))`;
  const locked = await tx.$queryRaw<{ id: string; next_number: number }[]>`
    SELECT id, next_number
      FROM trading_invoice_series
     WHERE series_key = ${seriesKey}
       AND financial_year = ${period}
     FOR UPDATE`;

  if (locked[0]) {
    const sequenceNumber = locked[0].next_number;
    await tx.tradingInvoiceSeries.update({
      where: { id: locked[0].id },
      data: { nextNumber: sequenceNumber + 1, version: { increment: 1 } },
    });
    return { seriesId: locked[0].id, sequenceNumber };
  }

  // First document in this series this period. The unique index on
  // (tenant, series, period) is what resolves two callers racing to create it.
  const created = await tx.tradingInvoiceSeries.create({
    data: { tenantId, seriesKey, financialYear: period, nextNumber: 2 },
  });
  return { seriesId: created.id, sequenceNumber: 1 };
}
