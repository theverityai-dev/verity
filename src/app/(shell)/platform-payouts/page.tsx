import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { FINANCE_CAPABILITY, type PlatformBillRow } from "@/server/capabilities/finance";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { runQuery } from "@/server/actions/platform";
import { trailingDaysRange } from "@/lib/date-range";
import { EmptyState, ErrorState, Field, Input, PageHeader, Button, Select } from "@/components/ui/primitives";
import { PayoutMatcher } from "./PayoutMatcher";

export const dynamic = "force-dynamic";

/**
 * Task 125 item 4.2 — did Zomato or Swiggy pay what it should have? Upload the
 * platform's settlement file; it is read in the browser, matched against the
 * orders recorded for that platform, and nothing is stored or written off.
 */
async function PlatformPayoutsPage({ searchParams }: { searchParams: Promise<{ platform?: string; from?: string; to?: string }> }) {
  const actor = await requireActor();
  const params = await searchParams;
  const platforms = (
    await withTenant(actor.tenantId, (tx) =>
      tx.diningOrder.findMany({ where: { channel: "delivery_platform", platform: { not: null } }, distinct: ["platform"], select: { platform: true } }),
    )
  )
    .map((o) => o.platform!)
    .sort();

  const range = trailingDaysRange(30);
  const valid = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const fromDate = valid(params.from) ?? range.fromDate;
  const toDate = valid(params.to) ?? range.toDate;
  const platform = platforms.find((p) => p === params.platform) ?? platforms[0];

  if (!platform) {
    return (
      <>
        <PageHeader title="Platform payouts" description="Check what Zomato and Swiggy paid against the orders you recorded." />
        <EmptyState
          title="No delivery-platform orders yet"
          description="When an order is recorded with the channel Delivery platform and its platform order number, it can be matched here."
        />
      </>
    );
  }

  const result = await runQuery<PlatformBillRow[]>("verity.finance.list_platform_bills", { platform, fromDate, toDate });
  if (!result.ok) return <ErrorState title="Could not load platform orders" message={result.message} issues={result.issues} retryable={result.retryable} />;

  return (
    <>
      <PageHeader title="Platform payouts" description="Check what Zomato and Swiggy paid against the orders you recorded. The file is read here and not saved." />
      <form method="get" action="/platform-payouts" className="mb-6 grid items-end gap-3 sm:grid-cols-4">
        <Field label="Platform" htmlFor="po-platform">
          <Select id="po-platform" name="platform" defaultValue={platform}>
            {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </Field>
        <Field label="Orders settled from" htmlFor="po-from">
          <Input id="po-from" name="from" type="date" defaultValue={fromDate} />
        </Field>
        <Field label="to" htmlFor="po-to">
          <Input id="po-to" name="to" type="date" defaultValue={toDate} />
        </Field>
        <Button type="submit" variant="secondary">Show orders</Button>
      </form>
      <PayoutMatcher
        platform={platform}
        bills={result.data.map((b) => ({ ref: b.ref, billId: b.billId, label: b.label, totalMinor: b.totalMinor }))}
      />
    </>
  );
}

export default withCapabilityPageAccess(FINANCE_CAPABILITY, PlatformPayoutsPage);
