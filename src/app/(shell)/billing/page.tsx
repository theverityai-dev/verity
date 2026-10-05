import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { BILLING_CAPABILITY } from "@/server/capabilities/billing";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { runQuery } from "@/server/actions/platform";
import { ErrorState, PageHeader, Stat, StatRow } from "@/components/ui/primitives";
import { day, rupees } from "@/components/ui/business/format";
import { BillingDesk, type InvoiceRow, type MeterRow, type PeriodRow } from "./BillingDesk";

export const dynamic = "force-dynamic";

/**
 * Usage billing: meters per customer, their readings, billing periods and the
 * invoices generated for each period (Task 77). One invoice per meter per
 * period, enforced by the database, so a repeated run cannot double-bill.
 */
async function BillingPage() {
  const actor = await requireActor();

  const meters = await runQuery<unknown[]>("verity.billing.list_meters", { includeInactive: true });
  if (!meters.ok) {
    return <ErrorState title="Could not load billing" message={meters.message} issues={meters.issues} retryable={meters.retryable} />;
  }

  const [meterRecords, periods, invoices, parties] = await Promise.all([
    withTenant(actor.tenantId, (tx) =>
      tx.billingMeter.findMany({
        include: {
          party: { select: { displayName: true } },
          readings: { orderBy: { readAt: "desc" }, take: 1 },
        },
        orderBy: { name: "asc" },
      }),
    ),
    withTenant(actor.tenantId, (tx) =>
      tx.billingPeriod.findMany({ include: { invoices: { select: { amountMinor: true } } }, orderBy: { periodStart: "desc" } }),
    ),
    withTenant(actor.tenantId, (tx) =>
      tx.billingInvoice.findMany({
        include: {
          meter: { select: { name: true, party: { select: { displayName: true } } } },
          billingPeriod: { select: { periodStart: true, periodEnd: true } },
        },
        orderBy: { generatedAt: "desc" },
        take: 300,
      }),
    ),
    withTenant(actor.tenantId, (tx) =>
      tx.party.findMany({ select: { id: true, displayName: true }, orderBy: { displayName: "asc" } }),
    ),
  ]);

  const meterRows: MeterRow[] = meterRecords.map((m) => {
    const last = m.readings[0];
    return {
      id: m.id,
      name: m.name,
      customer: m.party.displayName,
      rate: `${rupees(m.ratePerUnitMinor)} per unit`,
      ratePaise: m.ratePerUnitMinor,
      lastReading: last ? `${last.readingUnits.toLocaleString("en-IN")} units` : "No reading yet",
      lastReadingUnits: last?.readingUnits ?? null,
      lastReadAt: last ? day(last.readAt) : "",
      active: m.active,
    };
  });

  const periodRows: PeriodRow[] = periods.map((p) => ({
    id: p.id,
    period: `${day(p.periodStart)} – ${day(p.periodEnd)}`,
    invoices: p.invoices.length,
    total: rupees(p.invoices.reduce((sum, i) => sum + i.amountMinor, 0)),
    status: p.closedAt ? "Closed" : "Open",
  }));

  const invoiceRows: InvoiceRow[] = invoices.map((i) => ({
    id: i.id,
    customer: i.meter.party.displayName,
    meter: i.meter.name,
    period: `${day(i.billingPeriod.periodStart)} – ${day(i.billingPeriod.periodEnd)}`,
    usage: `${i.usageUnits.toLocaleString("en-IN")} units`,
    amount: rupees(i.amountMinor),
    generated: day(i.generatedAt),
  }));

  const billed = invoices.reduce((sum, i) => sum + i.amountMinor, 0);

  return (
    <>
      <PageHeader title="Billing" description="Meters, readings and usage invoices for each billing period." />
      <StatRow cols={4} className="mb-6">
        <Stat label="Active meters" value={meterRecords.filter((m) => m.active).length} />
        <Stat label="Billing periods" value={periods.length} />
        <Stat label="Invoices" value={invoices.length} />
        <Stat label="Billed" value={rupees(billed)} />
      </StatRow>
      <BillingDesk meters={meterRows} periods={periodRows} invoices={invoiceRows} parties={parties} />
    </>
  );
}

export default withCapabilityPageAccess(BILLING_CAPABILITY, BillingPage);
