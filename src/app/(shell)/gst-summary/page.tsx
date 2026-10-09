import { withPageAccess } from "@/components/ui/PageAccess";
import { requireActor } from "@/server/platform/auth";
import { installCapabilities } from "@/server/capabilities/registry";
import { executeQuery } from "@/server/platform/query";
import { ForbiddenError } from "@/server/platform/authorization";
import { gstSummary } from "@/server/capabilities/dinein";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState, PageHeader, Panel, PermissionDenied, Stat, StatRow } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function rupees(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * The month's outward supplies by GST rate, the credit notes, and the range of invoice
 * numbers issued: what a GSTR-1 for restaurant (B2C) sales asks for (ADR-040, Task 126
 * item 2.9). A summary to file from, not a filing: check it with your tax adviser.
 */
async function GstSummaryPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  installCapabilities();
  const actor = await requireActor();
  const params = await searchParams;
  const month = params.month && MONTH.test(params.month) ? params.month : undefined;

  let summary: Awaited<ReturnType<typeof gstSummary.handler>>;
  try {
    summary = await executeQuery(actor, gstSummary, { month });
  } catch (error) {
    if (error instanceof ForbiddenError) return <PermissionDenied what="the GST summary" />;
    throw error;
  }

  return (
    <>
      <PageHeader
        title="GST summary"
        description={`Month of ${summary.month}. Supplies are settled, taxed bills; credit notes are refunds. Check the figures with your tax adviser before filing.`}
      />
      <form className="mb-6 flex flex-wrap items-end gap-3" method="get">
        <label className="flex flex-col gap-1 text-[13px] text-text-secondary">
          Month
          <input type="month" name="month" defaultValue={summary.month} className="min-h-11 rounded-[10px] bg-control px-3 text-[15px] text-text" />
        </label>
        <button type="submit" className="min-h-11 cursor-pointer rounded-[10px] border-0 bg-control px-4 text-[15px] font-semibold text-accent-ink hover:bg-control-strong">
          Show
        </button>
      </form>

      {summary.outlets.length === 0 ? (
        <EmptyState title="No outlets in your scope" description="The summary is per outlet." />
      ) : (
        <div className="flex flex-col gap-6">
          {summary.outlets.map((outlet) => {
            const taxable = outlet.rates.reduce((s, r) => s + r.taxableMinor, 0);
            const tax = outlet.rates.reduce((s, r) => s + r.cgstMinor + r.sgstMinor, 0);
            const noteTax = outlet.creditNotes.rates.reduce((s, r) => s + r.cgstMinor + r.sgstMinor, 0);
            return (
              <Panel key={outlet.locationId} title={outlet.locationName} action={<span className="text-[12px] text-text-tertiary">{outlet.gstin ? `GSTIN ${outlet.gstin}` : "No GSTIN set"}</span>}>
                <StatRow cols={4} className="mb-4">
                  <Stat label="Taxable supplies" value={rupees(taxable)} />
                  <Stat label="Tax collected" value={rupees(tax)} hint="CGST plus SGST" />
                  <Stat label="Credit notes" value={outlet.creditNotes.count} hint={`Tax reversed ${rupees(noteTax)}`} />
                  <Stat label="Tax-free supplies" value={rupees(outlet.taxFreeMinor)} hint="Delivery-platform orders" />
                </StatRow>
                <p className="mb-3 mt-0 text-[13px] text-text-secondary">
                  {outlet.invoices.count === 0
                    ? "No numbered invoices were raised this month."
                    : `${outlet.invoices.count} invoice${outlet.invoices.count === 1 ? "" : "s"}, ${outlet.invoices.first} to ${outlet.invoices.last}.`}
                  {outlet.creditNotes.count > 0 ? ` Credit notes ${outlet.creditNotes.first} to ${outlet.creditNotes.last}.` : ""}
                </p>
                <DataTable
                  caption={`Outward supplies by rate, ${outlet.locationName}`}
                  emptyTitle="No taxed supplies this month"
                  emptyDescription="Settled invoices with tax appear here by rate."
                  columns={[
                    { key: "rate", header: "GST rate", sortable: true },
                    { key: "taxable", header: "Taxable value", numeric: true },
                    { key: "cgst", header: "CGST", numeric: true },
                    { key: "sgst", header: "SGST", numeric: true },
                    { key: "notes", header: "Credit notes (taxable)", numeric: true },
                  ]}
                  rows={outlet.rates.map((r) => {
                    const note = outlet.creditNotes.rates.find((n) => n.rateBp === r.rateBp);
                    return {
                      id: String(r.rateBp),
                      rate: `${r.rateBp / 100}%`,
                      taxable: rupees(r.taxableMinor),
                      cgst: rupees(r.cgstMinor),
                      sgst: rupees(r.sgstMinor),
                      notes: note ? rupees(note.taxableMinor) : "",
                    };
                  })}
                />
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}

export default withPageAccess(GstSummaryPage);
