import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import {
  ENTITY_PIECEWORK_LOT,
  ENTITY_PIECEWORK_PAYMENT,
  PIECEWORK_CAPABILITY,
  reportCosting,
  reportLotProduction,
  reportReadyInventory,
  reportWorkerPayment,
} from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { ReportTable } from "./ReportTable";
import { rupees, shortDate } from "../format";

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

  const [production, ready, costing, payments] = await Promise.all([
    executeQuery(actor, reportLotProduction, {}),
    executeQuery(actor, reportReadyInventory, {}),
    canWage ? executeQuery(actor, reportCosting, {}) : Promise.resolve(null),
    canWage ? executeQuery(actor, reportWorkerPayment, { from, to }) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader title="Lot reports" description="Four reports. Each shows on screen and downloads as a file that opens in Excel." />
      <div className="flex flex-col gap-6">
        <ReportTable
          title="Lot-wise production"
          filename="lot-wise-production.csv"
          columns={[
            { key: "lot", header: "Lot", subKey: "design" },
            { key: "stage", header: "Stage" },
            { key: "total", header: "Total pieces", numeric: true },
            { key: "issued", header: "Issued", numeric: true },
            { key: "received", header: "Received", numeric: true },
            { key: "pending", header: "Pending", numeric: true },
            { key: "start", header: "Stage start" },
            { key: "days", header: "Days in stage", numeric: true },
            { key: "location", header: "Location" },
          ]}
          rows={production.map((r, i) => ({
            id: String(i), lot: r.lotNumber, design: r.design, stage: r.stage, total: r.totalPieces, issued: r.issued, received: r.received,
            pending: r.pending, start: shortDate(r.stageStart), days: r.daysInStage, location: r.location,
          }))}
          csvHeader={["Lot", "Design", "Total pieces", "Stage", "Issued", "Received", "Pending", "Stage start date", "Days in stage", "Location"]}
          csvRows={production.map((r) => [r.lotNumber, r.design, r.totalPieces, r.stage, r.issued, r.received, r.pending, r.stageStart, r.daysInStage, r.location])}
        />

        {payments && (
          <div className="flex flex-col gap-2">
            <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Choose the period for the payment report">
              <label className="flex flex-col gap-1 text-[13px] text-text-secondary">
                From
                <input name="from" defaultValue={from ?? ""} placeholder="YYYY-MM-DD" pattern="\d{4}-\d{2}-\d{2}" className="h-11 w-40 rounded-[10px] border-0 bg-[var(--color-control)] px-3.5 text-[15px] text-text" />
              </label>
              <label className="flex flex-col gap-1 text-[13px] text-text-secondary">
                To
                <input name="to" defaultValue={to ?? ""} placeholder="YYYY-MM-DD" pattern="\d{4}-\d{2}-\d{2}" className="h-11 w-40 rounded-[10px] border-0 bg-[var(--color-control)] px-3.5 text-[15px] text-text" />
              </label>
              <button type="submit" className="h-11 rounded-[10px] bg-[var(--color-control)] px-4 text-[15px] font-semibold text-accent-ink">Show period</button>
            </form>
            <ReportTable
              title="Worker-wise payment"
              filename="worker-wise-payment.csv"
              note={from || to ? `Period: ${from ?? "the start"} to ${to ?? "today"}. Balance is for this period's entries and payments only.` : "Whole history. Balance due is wages earned, minus advances, minus payments."}
              columns={[
                { key: "karigar", header: "Karigar", subKey: "mobile" },
                { key: "work", header: "Work" },
                { key: "given", header: "Given", numeric: true },
                { key: "returned", header: "Returned", numeric: true },
                { key: "wages", header: "Wages", numeric: true },
                { key: "advance", header: "Advance", numeric: true },
                { key: "paid", header: "Paid", numeric: true },
                { key: "balance", header: "Balance due", numeric: true },
              ]}
              rows={payments.rows.map((r, i) => ({
                id: String(i), karigar: r.karigar, mobile: r.mobile ?? "", work: r.workTypes || "—", given: r.given, returned: r.returned,
                wages: rupees(r.wagesMinor), advance: rupees(r.advanceMinor), paid: rupees(r.paidMinor), balance: rupees(r.balanceMinor),
              }))}
              csvHeader={["Karigar", "Mobile", "Work type", "Pieces given", "Pieces returned", "Total wages (Rs)", "Advance (Rs)", "Paid (Rs)", "Balance due (Rs)", "Period from", "Period to"]}
              csvRows={payments.rows.map((r) => [r.karigar, r.mobile, r.workTypes, r.given, r.returned, rs(r.wagesMinor), rs(r.advanceMinor), rs(r.paidMinor), rs(r.balanceMinor), from ?? "", to ?? ""])}
            />
          </div>
        )}

        {costing && (
          <ReportTable
            title="Costing"
            filename="lot-costing.csv"
            note="Wages only. Cloth and other costs are shown as to confirm until the business says what a lot's cost includes."
            columns={[
              { key: "lot", header: "Lot", subKey: "design" },
              { key: "total", header: "Total pieces", numeric: true },
              { key: "cloth", header: "Cloth" },
              { key: "wages", header: "Wages", numeric: true },
              { key: "other", header: "Other" },
              { key: "sum", header: "Total so far", numeric: true },
              { key: "perPiece", header: "Wage per ready piece", numeric: true },
            ]}
            rows={costing.map((r, i) => ({
              id: String(i), lot: r.lotNumber, design: r.design, total: r.totalPieces, cloth: "To confirm", wages: rupees(r.wagesMinor), other: "To confirm",
              sum: rupees(r.totalMinor), perPiece: r.wagePerReadyPieceMinor === null ? "—" : rupees(r.wagePerReadyPieceMinor),
            }))}
            csvHeader={["Lot", "Design", "Total pieces", "Cloth cost (Rs)", "Wages (Rs)", "Other costs (Rs)", "Total so far (Rs)", "Wage per ready piece (Rs)"]}
            csvRows={costing.map((r) => [r.lotNumber, r.design, r.totalPieces, "To confirm", rs(r.wagesMinor), "To confirm", rs(r.totalMinor), r.wagePerReadyPieceMinor === null ? "" : rs(r.wagePerReadyPieceMinor)])}
          />
        )}

        <ReportTable
          title="Ready inventory"
          filename="ready-inventory.csv"
          note="Pieces that have reached ready, lot by lot. Dispatch is not part of this software, so the figure does not fall when garments leave."
          columns={[
            { key: "lot", header: "Lot", subKey: "design" },
            { key: "pieces", header: "Ready pieces", numeric: true },
            { key: "bundles", header: "Ready bundles", numeric: true },
            { key: "since", header: "Ready since" },
          ]}
          rows={ready.map((r, i) => ({ id: String(i), lot: r.lotNumber, design: r.design, pieces: r.readyPieces, bundles: r.readyBundles, since: shortDate(r.readySince) }))}
          csvHeader={["Lot", "Design", "Ready pieces", "Ready bundles", "Ready since"]}
          csvRows={ready.map((r) => [r.lotNumber, r.design, r.readyPieces, r.readyBundles, r.readySince])}
        />
      </div>
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, ReportsPage);
