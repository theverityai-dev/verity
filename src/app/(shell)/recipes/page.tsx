import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { RECIPE_CAPABILITY } from "@/server/capabilities/recipe";
import { trailingDaysRange } from "@/lib/date-range";
import { requireActor } from "@/server/platform/auth";
import { runQuery } from "@/server/actions/platform";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader, StatRow, Stat, ErrorState } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

type AnalyticsRow = {
  menuItemId: string; name: string; qtySold: number; revenueMinor: number;
  marginPercent: number | null; quadrant: "Star" | "PlowHorse" | "Puzzle" | "Dog" | "Unclassified";
};

function formatRupees(minor: number): string {
  return (minor / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
}

/** §62 — Star/Plow Horse/Puzzle/Dog, last 30 days. */
async function RecipesPage() {
  await requireActor();
  const { fromDate, toDate } = trailingDaysRange(30);

  const result = await runQuery<AnalyticsRow[]>("verity.recipe.get_menu_analytics", { fromDate, toDate });
  if (!result.ok) return <ErrorState title="Could not load menu analytics" message={result.message} issues={result.issues} retryable={result.retryable} />;

  const rows = result.data;
  const stars = rows.filter((r) => r.quadrant === "Star").length;
  const dogs = rows.filter((r) => r.quadrant === "Dog").length;

  return (
    <>
      <PageHeader
        title="Menu analytics"
        description={`Sales volume vs. margin, last 30 days (${fromDate} → ${toDate}), each relative to the median item actually sold in range.`}
      />
      <StatRow cols={3} className="mb-6">
        <Stat label="Items analyzed" value={rows.length} />
        <Stat label="Stars" value={stars} />
        <Stat label="Dogs" value={dogs} />
      </StatRow>
      <DataTable
        caption="Menu items"
        rows={rows.map((r) => ({
          id: r.menuItemId,
          name: r.name,
          qtySold: r.qtySold,
          revenue: formatRupees(r.revenueMinor),
          margin: r.marginPercent === null ? "Unclassified" : `${r.marginPercent.toFixed(0)}%`,
          quadrant: r.quadrant,
        }))}
        columns={[
          { key: "name", header: "Item", variant: "link", href: "/recipes/{id}" },
          { key: "qtySold", header: "Qty sold", numeric: true },
          { key: "revenue", header: "Revenue", numeric: true },
          { key: "margin", header: "Margin", numeric: true },
          { key: "quadrant", header: "Quadrant" },
        ]}
        emptyTitle="No sales in range"
        emptyDescription="No settled orders in the last 30 days to classify."
      />
    </>
  );
}

export default withCapabilityPageAccess(RECIPE_CAPABILITY, RecipesPage);
