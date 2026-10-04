import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { COUPON_CAPABILITY } from "@/server/capabilities/coupon";
import { requireActor } from "@/server/platform/auth";
import { runQuery } from "@/server/actions/platform";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader, Stat, StatRow, ErrorState } from "@/components/ui/primitives";
import { CreateCouponForm } from "./CreateCouponForm";

export const dynamic = "force-dynamic";

type CouponRow = {
  id: string; code: string; discountType: "Percent" | "Flat"; value: number;
  usageLimit: number | null; usedCount: number; expiresAt: string | null; active: boolean;
};

function formatDiscount(c: CouponRow): string {
  return c.discountType === "Percent" ? `${(c.value / 100).toFixed(0)}%` : `₹${(c.value / 100).toFixed(0)}`;
}

/** §32 — percent/flat discount codes only, per the lean-V1 cut. */
async function CouponsPage() {
  await requireActor();
  const result = await runQuery<CouponRow[]>("verity.coupon.list_coupons", {});
  if (!result.ok) return <ErrorState title="Could not load coupons" message={result.message} issues={result.issues} retryable={result.retryable} />;

  const coupons = result.data;
  const now = new Date();
  const active = coupons.filter((c) => c.active && (!c.expiresAt || new Date(c.expiresAt) > now)).length;
  const expired = coupons.length - active;

  return (
    <>
      <PageHeader title="Coupons" description="Percent or flat discount codes. Applied at the counter against an open bill." />
      <StatRow cols={2} className="mb-6">
        <Stat label="Active" value={active} />
        <Stat label="Expired / inactive" value={expired} />
      </StatRow>
      <CreateCouponForm />
      <DataTable
        caption="Coupons"
        rows={coupons.map((c) => ({
          id: c.id,
          code: c.code,
          discount: formatDiscount(c),
          usage: c.usageLimit ? `${c.usedCount} / ${c.usageLimit}` : `${c.usedCount}`,
          expiresAt: c.expiresAt ? new Date(c.expiresAt).toLocaleDateString("en-IN") : "No expiry",
        }))}
        columns={[
          { key: "code", header: "Code" },
          { key: "discount", header: "Discount", numeric: true },
          { key: "usage", header: "Used", numeric: true },
          { key: "expiresAt", header: "Expires" },
        ]}
        emptyTitle="No coupons yet"
        emptyDescription="Create a percent or flat discount code above."
      />
    </>
  );
}

export default withCapabilityPageAccess(COUPON_CAPABILITY, CouponsPage);
