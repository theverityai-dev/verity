import Link from "next/link";
import { withPageAccess } from "@/components/ui/PageAccess";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { installCapabilities } from "@/server/capabilities/registry";
import { executeQuery } from "@/server/platform/query";
import { ForbiddenError } from "@/server/platform/authorization";
import { outletToday, type ServiceStage } from "@/server/capabilities/dinein";
import { EmptyState, PageHeader, Panel, PermissionDenied, Row, RowList, Stat, StatRow } from "@/components/ui/primitives";
import { day } from "@/components/ui/business/format";

export const dynamic = "force-dynamic";

function rupees(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

const STAGE: Record<ServiceStage, { label: string; tone: string }> = {
  free: { label: "Free", tone: "text-success" },
  seated: { label: "Seated", tone: "text-accent-ink" },
  with_kitchen: { label: "With the kitchen", tone: "text-warning" },
  ready: { label: "Ready to serve", tone: "text-info" },
  served: { label: "Served", tone: "text-text-secondary" },
  reserved: { label: "Reserved", tone: "text-info" },
  cleaning: { label: "Cleaning", tone: "text-warning" },
  out_of_service: { label: "Out of service", tone: "text-text-tertiary" },
};

const chip = (active: boolean) =>
  "inline-flex min-h-11 items-center rounded-full px-4 text-[14px] font-medium no-underline transition-colors " +
  (active ? "bg-accent text-accent-on" : "bg-[var(--color-control)] text-text hover:bg-[var(--color-control-strong)]");

/**
 * The outlet's day, at a glance (Task 126 item 1.2; URY's dashboard). What is
 * earned, who is seated and in what stage, what needs a person now, and what a
 * normal day looks like at this hour. Every number is read from stored facts by
 * one query; the thresholds that raise a flag are settings, not code.
 */
async function TodayPage({ searchParams }: { searchParams: Promise<{ outlet?: string }> }) {
  installCapabilities();
  const actor = await requireActor();
  const params = await searchParams;
  const outlets = await withTenant(actor.tenantId, (tx) => tx.location.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }));
  const outlet = outlets.find((o) => o.id === params.outlet);

  let t: Awaited<ReturnType<typeof outletToday.handler>>;
  try {
    t = await executeQuery(actor, outletToday, { locationId: outlet?.id });
  } catch (error) {
    if (error instanceof ForbiddenError) return <PermissionDenied what="the outlet's day" />;
    throw error;
  }

  const stageCounts = new Map<ServiceStage, number>();
  for (const row of t.serviceLine) stageCounts.set(row.stage, (stageCounts.get(row.stage) ?? 0) + 1);

  return (
    <>
      <PageHeader
        title="Today"
        description={`Service day of ${day(t.day)}${outlet ? `, ${outlet.name}` : ""}. A day runs from 5 am to 5 am.`}
        actions={
          <Link href="/sales-reports" className="text-[13px] text-text-secondary underline-offset-4 hover:underline">
            Sales reports
          </Link>
        }
      />

      {outlets.length > 1 && (
        <nav aria-label="Outlet" className="mb-5 flex flex-wrap gap-2">
          <Link href="/today" className={chip(!outlet)}>All outlets</Link>
          {outlets.map((o) => (
            <Link key={o.id} href={`/today?outlet=${o.id}`} className={chip(o.id === outlet?.id)}>{o.name}</Link>
          ))}
        </nav>
      )}

      {t.sales && (
        <StatRow cols={4} className="mb-6">
          <Stat label="Sales so far" value={rupees(t.sales.grossMinor)} hint={`${t.sales.bills} bill${t.sales.bills === 1 ? "" : "s"}`} href="/sales-reports" />
          <Stat label="Average bill" value={rupees(t.sales.avgBillMinor)} />
          <Stat label="Covers" value={t.sales.covers} hint={t.sales.covers ? `${rupees(t.sales.avgPerCoverMinor)} each` : undefined} />
          <Stat label="Order to served" value={t.sales.avgTicketMinutes === null ? "—" : `${t.sales.avgTicketMinutes} min`} hint="Average today" />
        </StatRow>
      )}

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Panel title="Needs a person" flush>
          {t.attention.length === 0 ? (
            <p className="m-0 p-4 text-[14px] text-text-secondary">
              Nothing is waiting too long. Flags appear when a bill is unpaid for {t.thresholds.unpaidMinutes} minutes, a table
              has been seated for {t.thresholds.seatedMinutes} minutes, or an order is left open overnight.
            </p>
          ) : (
            <RowList>
              {t.attention.map((a) => (
                <Row key={a.kind} className="justify-between">
                  <Link href={a.href} className="min-h-11 py-2 text-text underline-offset-4 hover:underline">{a.message}</Link>
                </Row>
              ))}
            </RowList>
          )}
        </Panel>

        <Panel title="Floor" flush>
          <RowList>
            <Row className="justify-between">
              <span className="text-text">Tables seated</span>
              <span className="tabular text-text-secondary">{t.tables.seated} of {t.tables.total}</span>
            </Row>
            {t.floorLoad.length === 0 ? (
              <Row><span className="text-text-secondary">No tables are being served.</span></Row>
            ) : (
              t.floorLoad.map((w) => (
                <Row key={w.staffName} className="justify-between">
                  <span className="text-text">{w.staffName}</span>
                  <span className="tabular text-text-secondary">{w.tables} table{w.tables === 1 ? "" : "s"}</span>
                </Row>
              ))
            )}
          </RowList>
        </Panel>
      </div>

      <Panel title="Every table, by stage" flush>
        {t.serviceLine.length === 0 ? (
          <EmptyState compact title="No tables yet" description="Draw the floor plan first." />
        ) : (
          <>
            <p className="m-0 border-b border-line px-4 py-3 text-[13px] text-text-secondary">
              {(["seated", "with_kitchen", "ready", "served", "free"] as ServiceStage[])
                .map((s) => `${stageCounts.get(s) ?? 0} ${STAGE[s].label.toLowerCase()}`)
                .join(" · ")}
            </p>
            <ul className="m-0 grid list-none grid-cols-2 gap-px bg-line p-0 sm:grid-cols-3 lg:grid-cols-4">
              {t.serviceLine.map((row) => (
                <li key={row.tableId} className="bg-surface px-4 py-3">
                  <Link href="/floor" className="flex min-h-11 flex-col justify-center no-underline">
                    <span className="text-[15px] font-medium text-text">{row.label}</span>
                    <span className={`text-[13px] ${STAGE[row.stage].tone}`}>{STAGE[row.stage].label}</span>
                    {row.minutes !== null && (
                      <span className={`tabular text-[12px] ${row.over ? "text-danger" : "text-text-tertiary"}`}>
                        {row.minutes} min{row.over ? ", longer than usual" : ""}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {t.sales && (
          <Panel title="A usual day, about now" flush>
            {t.baseline.sampleDays === 0 ? (
              <p className="m-0 p-4 text-[14px] text-text-secondary">
                Not enough earlier days yet. This compares today with the same weekday, the hour either side of now, over the last six weeks.
              </p>
            ) : (
              <RowList>
                <Row className="justify-between">
                  <span className="text-text">Typical sales</span>
                  <span className="tabular text-text-secondary">{rupees(t.baseline.medianSalesMinor)}</span>
                </Row>
                <Row className="justify-between">
                  <span className="text-text">Typical covers</span>
                  <span className="tabular text-text-secondary">{t.baseline.medianCovers}</span>
                </Row>
                <Row>
                  <span className="text-[13px] text-text-tertiary">Median of {t.baseline.sampleDays} earlier day{t.baseline.sampleDays === 1 ? "" : "s"}, same weekday.</span>
                </Row>
              </RowList>
            )}
          </Panel>
        )}

        {t.runningLow && (
          <Panel title="Running low" flush>
            {t.runningLow.length === 0 ? (
              <p className="m-0 p-4 text-[14px] text-text-secondary">Everything with a reorder level is above it.</p>
            ) : (
              <RowList>
                {t.runningLow.map((item, i) => (
                  <Row key={`${item.name}-${i}`} className="justify-between">
                    <span className="text-text">{item.name}</span>
                    <span className="tabular text-text-secondary">{item.onHand} left, reorder at {item.reorderLevel}</span>
                  </Row>
                ))}
              </RowList>
            )}
          </Panel>
        )}
      </div>
    </>
  );
}

export default withPageAccess(TodayPage);
