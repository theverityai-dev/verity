import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import {
  ENTITY_PIECEWORK_LOT,
  ENTITY_PIECEWORK_PAYMENT,
  PIECEWORK_CAPABILITY,
  reportBundleLocation,
  reportCosting,
  reportLotStatus,
  reportProductionByProcess,
  reportQuality,
  reportReadyInventory,
  reportWagePayment,
  reportWorkInHand,
} from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { ReportTable } from "./ReportTable";
import { STATUS_LABEL, rupees, shortDate } from "../format";

export const dynamic = "force-dynamic";

const rs = (minor: number) => minor / 100;

async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  installCapabilities();
  const actor = await requireActor();
  const sp = await searchParams;
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const from = sp.from && iso.test(sp.from) ? sp.from : undefined;
  const to = sp.to && iso.test(sp.to) ? sp.to : undefined;

  const { allowed, canWage } = await withTenant(actor.tenantId, async (tx) => ({
    allowed: await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_LOT),
    canWage: await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_PAYMENT),
  }));
  if (!allowed) return <PermissionDenied what="the lot reports" />;

  const [lotStatus, location, hand, quality, process, ready, costing, wages] = await Promise.all([
    executeQuery(actor, reportLotStatus, {}),
    executeQuery(actor, reportBundleLocation, {}),
    executeQuery(actor, reportWorkInHand, {}),
    executeQuery(actor, reportQuality, { from, to }),
    executeQuery(actor, reportProductionByProcess, {}),
    executeQuery(actor, reportReadyInventory, {}),
    canWage ? executeQuery(actor, reportCosting, {}) : Promise.resolve(null),
    canWage ? executeQuery(actor, reportWagePayment, { from, to }) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader title="Lot reports" description="Each report shows on screen and downloads as a file that opens in Excel. Totals match the entries they are built from." />
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3" aria-label="Choose the period for the wage and quality reports">
        <label className="flex flex-col gap-1 text-[13px] text-text-secondary">From
          <input name="from" defaultValue={from ?? ""} placeholder="YYYY-MM-DD" pattern="\d{4}-\d{2}-\d{2}" className="h-11 w-40 rounded-[10px] border-0 bg-[var(--color-control)] px-3.5 text-[15px] text-text" />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-text-secondary">To
          <input name="to" defaultValue={to ?? ""} placeholder="YYYY-MM-DD" pattern="\d{4}-\d{2}-\d{2}" className="h-11 w-40 rounded-[10px] border-0 bg-[var(--color-control)] px-3.5 text-[15px] text-text" />
        </label>
        <button type="submit" className="h-11 rounded-[10px] bg-[var(--color-control)] px-4 text-[15px] font-semibold text-accent-ink">Show period</button>
      </form>

      <div className="flex flex-col gap-6">
        <ReportTable
          title="Lot status"
          filename="lot-status.csv"
          columns={[
            { key: "lot", header: "Lot", subKey: "title" }, { key: "status", header: "Status" }, { key: "planned", header: "Planned", numeric: true }, { key: "cut", header: "Cut", numeric: true },
            { key: "good", header: "Good", numeric: true }, { key: "stage", header: "Stage" }, { key: "due", header: "Due" }, { key: "age", header: "Age (days)", numeric: true },
          ]}
          rows={lotStatus.map((l, i) => ({ id: String(i), lot: l.number, title: l.name ?? l.design, status: STATUS_LABEL[l.status], planned: l.plannedPieces, cut: l.bundledPieces, good: l.readyPieces, stage: l.stageLabel ?? "—", due: l.dueDate ? `${shortDate(l.dueDate)}${l.overdue ? " (overdue)" : ""}` : "—", age: l.ageDays }))}
          csvHeader={["Lot", "Name", "Design", "Status", "Planned pieces", "Cut pieces", "Good pieces", "Rejected", "Rework", "Short", "Stage", "Due date", "Overdue", "Age in days"]}
          csvRows={lotStatus.map((l) => [l.number, l.name, l.design, STATUS_LABEL[l.status] ?? l.status, l.plannedPieces, l.bundledPieces, l.readyPieces, l.rejectedPieces, l.reworkPieces, l.shortPieces, l.stageLabel, l.dueDate, l.overdue ? "Yes" : "No", l.ageDays])}
        />

        <ReportTable
          title="Bundle location"
          filename="bundle-location.csv"
          columns={[
            { key: "bundle", header: "Bundle", subKey: "lot" }, { key: "net", header: "Net pieces", numeric: true }, { key: "stage", header: "Stage" }, { key: "location", header: "Location" },
            { key: "last", header: "Last movement" }, { key: "days", header: "Days at stage", numeric: true },
          ]}
          rows={location.map((b) => ({ id: b.id, bundle: b.number, lot: b.lotNumber, net: b.netPieces, stage: b.stageLabel ?? "—", location: b.location, last: shortDate(b.lastMovement), days: b.daysHere }))}
          csvHeader={["Bundle", "Lot", "Net pieces", "Stage", "Location", "Last movement", "Days at stage"]}
          csvRows={location.map((b) => [b.number, b.lotNumber, b.netPieces, b.stageLabel, b.location, b.lastMovement, b.daysHere])}
        />

        <ReportTable
          title="Karigar work in hand"
          filename="karigar-work-in-hand.csv"
          columns={[
            { key: "karigar", header: "Karigar" }, { key: "bundle", header: "Bundle", subKey: "lot" }, { key: "stage", header: "Stage" }, { key: "issued", header: "Issued", numeric: true },
            { key: "returned", header: "Returned", numeric: true }, { key: "open", header: "Still out", numeric: true }, { key: "due", header: "Due" },
          ]}
          rows={hand.map((h, i) => ({ id: String(i), karigar: h.karigar, bundle: h.bundleNumber, lot: h.lotNumber, stage: h.stage + (h.isRework ? " (rework)" : ""), issued: h.issued, returned: h.returned, open: h.open, due: h.dueDate ? `${shortDate(h.dueDate)}${h.overdue ? " (overdue)" : ""}` : "—" }))}
          csvHeader={["Karigar", "Lot", "Bundle", "Stage", "Rework", "Issued", "Returned", "Still out", "Due date", "Overdue"]}
          csvRows={hand.map((h) => [h.karigar, h.lotNumber, h.bundleNumber, h.stage, h.isRework ? "Yes" : "No", h.issued, h.returned, h.open, h.dueDate, h.overdue ? "Yes" : "No"])}
        />

        {wages && (
          <ReportTable
            title="Karigar wage ledger"
            filename="karigar-wage-ledger.csv"
            note={from || to ? `Period: ${from ?? "the start"} to ${to ?? "today"}. Balances are for this period's entries and payments only.` : "Whole history. Balance due = wages − advances recovered − deductions − payments. An advance given stays owed back until it is recovered."}
            columns={[
              { key: "karigar", header: "Karigar", subKey: "mobile" }, { key: "work", header: "Work" }, { key: "wages", header: "Wages", numeric: true }, { key: "advance", header: "Advance given", numeric: true },
              { key: "recovered", header: "Recovered", numeric: true }, { key: "deduction", header: "Deductions", numeric: true }, { key: "paid", header: "Paid", numeric: true }, { key: "balance", header: "Balance due", numeric: true },
            ]}
            rows={wages.rows.map((r, i) => ({ id: String(i), karigar: r.karigar, mobile: r.mobile ?? "", work: r.workTypes || "—", wages: rupees(r.wagesMinor), advance: rupees(r.advanceGivenMinor), recovered: rupees(r.recoveredMinor), deduction: rupees(r.deductionMinor), paid: rupees(r.paidMinor), balance: rupees(r.balanceMinor) }))}
            csvHeader={["Karigar", "Mobile", "Work type", "Gross wages (Rs)", "Advance given (Rs)", "Advance recovered (Rs)", "Deductions (Rs)", "Paid (Rs)", "Balance due (Rs)", "Advance outstanding (Rs)", "Period from", "Period to"]}
            csvRows={wages.rows.map((r) => [r.karigar, r.mobile, r.workTypes, rs(r.wagesMinor), rs(r.advanceGivenMinor), rs(r.recoveredMinor), rs(r.deductionMinor), rs(r.paidMinor), rs(r.balanceMinor), rs(r.advanceOutstandingMinor), from ?? "", to ?? ""])}
          />
        )}

        <ReportTable
          title="Short, reject and rework"
          filename="short-reject-rework.csv"
          note={`Totals: rejected ${quality.totals.rejected} · rework returned ${quality.totals.rework} (still waiting ${quality.totals.reworkOpen}) · short ${quality.totals.short}. Each is its own figure; rework is not counted as output until it is accepted.`}
          columns={[
            { key: "date", header: "Date" }, { key: "bundle", header: "Bundle", subKey: "lot" }, { key: "karigar", header: "Karigar" }, { key: "stage", header: "Stage" },
            { key: "rejected", header: "Rejected", numeric: true }, { key: "rework", header: "Rework", numeric: true }, { key: "short", header: "Short", numeric: true },
          ]}
          rows={quality.rows.map((r, i) => ({ id: String(i), date: shortDate(r.date), bundle: r.bundleNumber, lot: r.lotNumber, karigar: r.karigar, stage: r.stage, rejected: r.rejected, rework: r.rework, short: r.short }))}
          csvHeader={["Date", "Lot", "Bundle", "Karigar", "Stage", "Rejected", "Rework", "Short", "Note"]}
          csvRows={quality.rows.map((r) => [r.date, r.lotNumber, r.bundleNumber, r.karigar, r.stage, r.rejected, r.rework, r.short, r.note])}
        />

        <ReportTable
          title="Production by process"
          filename="production-by-process.csv"
          columns={[{ key: "stage", header: "Stage" }, { key: "sent", header: "Sent", numeric: true }, { key: "received", header: "Received", numeric: true }, { key: "accepted", header: "Accepted", numeric: true }, { key: "pending", header: "Pending", numeric: true }, { key: "cycle", header: "Avg days", numeric: true }]}
          rows={process.map((p, i) => ({ id: String(i), stage: p.stage, sent: p.sent, received: p.received, accepted: p.accepted, pending: p.pending, cycle: p.avgCycleDays }))}
          csvHeader={["Stage", "Sent", "Received (accounted for)", "Accepted good", "Pending", "Average days per closed issue"]}
          csvRows={process.map((p) => [p.stage, p.sent, p.received, p.accepted, p.pending, p.avgCycleDays])}
        />

        {costing && (
          <ReportTable
            title="Lot cost so far"
            filename="lot-cost.csv"
            note="Wages only. The other cost categories are recorded in a later stage. Cost per good piece = cost so far ÷ good finished pieces; it is blank when there are none, and the losses stay visible beside it."
            columns={[
              { key: "lot", header: "Lot", subKey: "design" }, { key: "planned", header: "Planned", numeric: true }, { key: "good", header: "Good", numeric: true },
              { key: "losses", header: "Rejected · rework · short" }, { key: "wages", header: "Wages", numeric: true }, { key: "per", header: "Per good piece", numeric: true },
            ]}
            rows={costing.map((r, i) => ({ id: String(i), lot: r.lotNumber, design: r.design, planned: r.plannedPieces, good: r.goodPieces, losses: `${r.rejectedPieces} · ${r.reworkPieces} · ${r.shortPieces}`, wages: rupees(r.wagesMinor), per: r.perGoodPieceMinor === null ? "—" : rupees(r.perGoodPieceMinor) }))}
            csvHeader={["Lot", "Design", "Planned pieces", "Good pieces", "Rejected", "Rework waiting", "Short", "Wages (Rs)", "Other costs (Rs)", "Total so far (Rs)", "Cost per good piece (Rs)"]}
            csvRows={costing.map((r) => [r.lotNumber, r.design, r.plannedPieces, r.goodPieces, r.rejectedPieces, r.reworkPieces, r.shortPieces, rs(r.wagesMinor), "Not recorded yet", rs(r.totalMinor), r.perGoodPieceMinor === null ? "" : rs(r.perGoodPieceMinor)])}
          />
        )}

        <ReportTable
          title="Ready stock"
          filename="ready-stock.csv"
          note="Good pieces that reached the last stage, lot by lot. Packing and dispatch are not recorded yet, so the figure does not fall when garments leave."
          columns={[{ key: "lot", header: "Lot", subKey: "design" }, { key: "pieces", header: "Good pieces", numeric: true }, { key: "bundles", header: "Bundles", numeric: true }, { key: "since", header: "Ready since" }]}
          rows={ready.map((r, i) => ({ id: String(i), lot: r.lotNumber, design: r.design, pieces: r.readyPieces, bundles: r.readyBundles, since: shortDate(r.readySince) }))}
          csvHeader={["Lot", "Design", "Good pieces", "Bundles", "Ready since"]}
          csvRows={ready.map((r) => [r.lotNumber, r.design, r.readyPieces, r.readyBundles, r.readySince])}
        />
      </div>
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, ReportsPage);
