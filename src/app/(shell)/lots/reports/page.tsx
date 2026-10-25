import Link from "next/link";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import {
  ENTITY_PIECEWORK_LOT,
  ENTITY_PIECEWORK_PAYMENT,
  PIECEWORK_CAPABILITY,
  listLots,
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
import { Cover } from "@/components/ui/Cover";
import { BarList, MoneyBar, PieceBar } from "@/components/ui/PieceFlow";
import { EmptyState, PageHeader, Panel, PermissionDenied, StatTile, StatTileRow, StateBadge, Surface } from "@/components/ui/primitives";
import { ProgressBar, StackedBar } from "@/components/ui/viz";
import { PeriodFilter } from "./PeriodFilter";
import { ReportTable } from "./ReportTable";
import { STATUS_CATEGORY, STATUS_LABEL, rupees, shortDate } from "../format";

export const dynamic = "force-dynamic";

const rs = (minor: number) => minor / 100;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;
const iso = /^\d{4}-\d{2}-\d{2}$/;

/** Adds up a figure per key (a karigar, a stage) and returns the largest first. */
function tally<T>(rows: T[], key: (r: T) => string, parts: (r: T) => number[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const r of rows) {
    const k = key(r);
    const cur = out.get(k) ?? [];
    parts(r).forEach((v, i) => { cur[i] = (cur[i] ?? 0) + v; });
    out.set(k, cur);
  }
  return out;
}

function Heading({ id, children, note }: { id: string; children: string; note?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 px-1">
      <h2 id={id} className="m-0 scroll-mt-24 text-[19px] font-light leading-[24px] tracking-[-0.03em] text-text">{children}</h2>
      {note && <p className="m-0 text-[13px] text-text-tertiary">{note}</p>}
    </div>
  );
}

/**
 * Reports, as a picture first. Each question the owner asks (where is the work, where is the loss, who holds what, who is owed, what did
 * a lot cost, what is ready) is a graphic that links to what it counts; every report is still there, folded at the foot, as a table that
 * downloads to Excel, CSV or PDF. Wages and costs need the wage grant, so a supervisor sees none of them.
 */
async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  installCapabilities();
  const actor = await requireActor();
  const sp = await searchParams;
  const from = sp.from && iso.test(sp.from) ? sp.from : undefined;
  const to = sp.to && iso.test(sp.to) ? sp.to : undefined;

  const { allowed, canWage } = await withTenant(actor.tenantId, async (tx) => ({
    allowed: await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_LOT),
    canWage: await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_PAYMENT),
  }));
  if (!allowed) return <PermissionDenied what="the lot reports" />;

  const [lotStatus, location, hand, quality, process, ready, costing, wages, lots] = await Promise.all([
    executeQuery(actor, reportLotStatus, {}),
    executeQuery(actor, reportBundleLocation, {}),
    executeQuery(actor, reportWorkInHand, {}),
    executeQuery(actor, reportQuality, { from, to }),
    executeQuery(actor, reportProductionByProcess, {}),
    executeQuery(actor, reportReadyInventory, {}),
    canWage ? executeQuery(actor, reportCosting, {}) : Promise.resolve(null),
    canWage ? executeQuery(actor, reportWagePayment, { from, to }) : Promise.resolve(null),
    executeQuery(actor, listLots, {}),
  ]);

  const live = lots.filter((l) => l.status !== "cancelled");
  const lotId = new Map(lots.map((l) => [l.number, l.id]));
  const costOf = new Map((costing ?? []).map((c) => [c.lotNumber, c]));
  const readyTotal = ready.reduce((s, r) => s + r.readyPieces, 0);
  const outTotal = hand.reduce((s, h) => s + h.open, 0);
  const lateCount = hand.filter((h) => h.overdue && h.open > 0).length;
  const lostTotal = quality.totals.rejected + quality.totals.rework + quality.totals.short;
  const period = from || to ? `${from ? shortDate(from) : "the start"} to ${to ? shortDate(to) : "today"}` : "all time";

  // Pieces out, per karigar, and how many of those issues are late.
  const heldBy = tally(hand.filter((h) => h.open > 0), (h) => h.workerId, (h) => [h.open, h.overdue ? 1 : 0]);
  const heldNames = new Map(hand.map((h) => [h.workerId, h.karigar]));
  const heldItems = [...heldBy].map(([id, [open = 0, late = 0]]) => ({
    id, label: heldNames.get(id) ?? "A karigar", href: `/karigars/${id}`, value: open, display: `${open} pcs`, note: late > 0 ? `${plural(late, "issue")} past the return date` : undefined,
  })).sort((a, b) => b.value - a.value).slice(0, 10);

  // Losses in the period, per karigar and per stage.
  const lossBy = (key: (r: (typeof quality.rows)[number]) => string) => tally(quality.rows, key, (r) => [r.rejected, r.rework, r.short]);
  const lossItems = (m: Map<string, number[]>, name: (k: string) => { label: string; href?: string }) =>
    [...m].map(([k, [rej = 0, rw = 0, sh = 0]]) => ({ id: k, ...name(k), value: rej + rw + sh, display: `${rej + rw + sh}`, note: `${rej} rejected · ${rw} rework · ${sh} short` }))
      .filter((i) => i.value > 0).sort((a, b) => b.value - a.value).slice(0, 8);
  const byKarigar = lossItems(lossBy((r) => r.workerId), (k) => ({ label: quality.rows.find((r) => r.workerId === k)?.karigar ?? "A karigar", href: `/karigars/${k}` }));
  const byStage = lossItems(lossBy((r) => r.stage), (k) => ({ label: k }));

  const money = wages?.rows.reduce((m, r) => ({
    wagesMinor: m.wagesMinor + r.wagesMinor, paidMinor: m.paidMinor + r.paidMinor, recoveredMinor: m.recoveredMinor + r.recoveredMinor,
    deductionMinor: m.deductionMinor + r.deductionMinor, balanceMinor: m.balanceMinor + r.balanceMinor, advanceMinor: m.advanceMinor + r.advanceOutstandingMinor,
  }), { wagesMinor: 0, paidMinor: 0, recoveredMinor: 0, deductionMinor: 0, balanceMinor: 0, advanceMinor: 0 });
  const owedItems = (wages?.rows ?? []).filter((r) => r.balanceMinor > 0).sort((a, b) => b.balanceMinor - a.balanceMinor).slice(0, 10)
    .map((r) => ({ id: r.workerId, label: r.karigar, href: `/karigars/${r.workerId}`, value: r.balanceMinor, display: rupees(r.balanceMinor), note: r.workTypes || undefined }));

  const sections = [
    ["production", "Production"], ["lots", "Lots"], ["quality", "Quality"], ["hands", "With karigars"], ...(canWage ? [["money", "Money"]] : []), ["stock", "Ready stock"], ["tables", "Tables and files"],
  ] as const;

  return (
    <>
      <PageHeader title="Reports" description="Where the work is, where the pieces are lost, who holds what and who is owed. Every figure opens what it counts; every report is also a table you can download." />

      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <PeriodFilter from={from ?? ""} to={to ?? ""} />
        <p className="m-0 text-[13px] text-text-tertiary">The period covers wages and losses. Pieces on the floor are always as of today.</p>
      </div>

      <nav aria-label="Sections" className="mb-8 flex gap-1.5 overflow-x-auto max-sm:-mx-4 max-sm:px-4 [scrollbar-width:none]">
        {sections.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="inline-flex min-h-11 shrink-0 items-center rounded-[12px] bg-[var(--color-control)] px-4 text-[15px] font-medium text-text-secondary no-underline transition-[background-color,transform] duration-150 hover:text-text active:scale-[0.98]">{label}</a>
        ))}
      </nav>

      <section aria-labelledby="production" className="mb-10">
        <Heading id="production">Production</Heading>
        <StatTileRow className="mb-5">
          <StatTile state="completed" icon="check" label="Good pieces ready" value={readyTotal.toLocaleString("en-IN")} hint={`in ${plural(ready.reduce((s, r) => s + r.readyBundles, 0), "bundle")}`} href="/lots/ready" />
          <StatTile state="active" icon="user" label="With karigars" value={outTotal.toLocaleString("en-IN")} hint={lateCount > 0 ? `${plural(lateCount, "issue")} late` : "none late"} href="/karigars" />
          <StatTile state="pending" icon="rework" label="Rework waiting" value={quality.totals.reworkOpen.toLocaleString("en-IN")} hint="not output until accepted" href="/shopfloor/register" />
          <StatTile state="blocked" icon="flag" label="Lost in the period" value={lostTotal.toLocaleString("en-IN")} hint={`${quality.totals.rejected} rejected · ${quality.totals.short} short`} href="/shopfloor/cases" />
        </StatTileRow>

        <Panel title="Stage by stage">
          <ul className="m-0 flex list-none flex-col gap-5 p-0">
            {process.map((p) => (
              <li key={p.stage} className="list-none">
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <span className="text-[16px] font-medium text-text">{p.stage}</span>
                  <span className="text-[13px] text-text-secondary">
                    {p.pending > 0 ? <span className="font-medium text-text">{p.pending} out</span> : "nothing out"}{p.avgCycleDays !== null ? ` · ${p.avgCycleDays} ${p.avgCycleDays === 1 ? "day" : "days"} a bundle` : ""}
                  </span>
                </div>
                <ProgressBar label={`${p.stage}: accepted of sent`} value={p.accepted} total={Math.max(p.sent, 1)} tone={p.pending > 0 ? "active" : "completed"} figures={`${p.accepted.toLocaleString("en-IN")} accepted of ${p.sent.toLocaleString("en-IN")} sent`} />
              </li>
            ))}
          </ul>
        </Panel>
      </section>

      <section aria-labelledby="lots" className="mb-10">
        <Heading id="lots" note={canWage ? "Cost per good piece is fabric + wages + other costs, less charges recovered" : undefined}>Lots</Heading>
        {live.length === 0 ? (
          <EmptyState title="No lots yet" description="Create a lot and cut its bundles." />
        ) : (
          <ul className="m-0 grid list-none gap-4 p-0" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))" }}>
            {live.map((l) => {
              const c = costOf.get(l.number);
              return (
                <li key={l.id} className="list-none">
                  <Surface className="relative flex h-full flex-col gap-4 p-5 transition-[transform] duration-150 active:scale-[0.99]">
                    <div className="flex items-center gap-3.5">
                      <Cover src={l.cover} label={l.number} size={56} rounded={14} />
                      <div className="min-w-0 flex-1">
                        <Link href={`/lots/${l.id}`} className="line-clamp-2 text-[17px] font-semibold leading-[22px] text-text no-underline after:absolute after:inset-0 after:content-['']">{l.number} · {l.name ?? l.design}</Link>
                        <p className="m-0 truncate text-[13px] text-text-secondary">{l.stageLabel ? `${l.stageLabel} · ${l.location}` : l.location}</p>
                      </div>
                      <StateBadge category={STATUS_CATEGORY[l.status]!} label={STATUS_LABEL[l.status]} />
                    </div>
                    {l.bundledPieces > 0
                      ? <PieceBar label={`${l.number} pieces`} total={l.bundledPieces} size="md" legend={false} counts={{ ready: l.readyPieces, out: l.pendingPieces, rework: l.reworkPieces, rejected: l.rejectedPieces, short: l.shortPieces }} />
                      : <div aria-hidden="true" className="h-2.5 w-full rounded-full bg-[var(--color-control-strong)]" />}
                    <dl className="m-0 mt-auto grid grid-cols-3 gap-3 border-t border-[var(--color-line)] pt-3.5">
                      <div><dt className="micro">Ready</dt><dd className="figure m-0 mt-1 text-[24px] text-text">{l.readyPieces}</dd></div>
                      <div><dt className="micro">Cut</dt><dd className="figure m-0 mt-1 text-[24px] text-text">{l.bundledPieces}<span className="text-[13px] text-text-secondary"> / {l.plannedPieces}</span></dd></div>
                      <div>
                        <dt className="micro">{c ? "Per piece" : "Due"}</dt>
                        <dd className="figure m-0 mt-1 text-[24px] text-text" style={!c && l.overdue ? { color: "var(--color-state-blocked)" } : undefined}>
                          {c ? (c.perGoodPieceMinor === null ? "—" : rupees(c.perGoodPieceMinor)) : l.dueDate ? shortDate(l.dueDate) : "—"}
                        </dd>
                      </div>
                    </dl>
                  </Surface>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="quality" className="mb-10">
        <Heading id="quality" note={`Rejected, rework and short are kept apart · ${period}`}>Quality</Heading>
        {lostTotal === 0 ? (
          <Surface className="p-5"><p className="m-0 text-[15px] text-text-secondary">Nothing was rejected, sent for rework or lost in this period.</p></Surface>
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <Panel title="Losses by karigar"><BarList tone="pending" label="Pieces lost by each karigar" items={byKarigar} /></Panel>
            <Panel title="Losses by stage"><BarList tone="pending" label="Pieces lost at each stage" items={byStage} /></Panel>
          </div>
        )}
      </section>

      <section aria-labelledby="hands" className="mb-10">
        <Heading id="hands" note="As of today">With karigars</Heading>
        <Panel title="Pieces each karigar is holding">
          {heldItems.length === 0 ? <p className="m-0 text-[15px] text-text-secondary">No karigar is holding any pieces.</p> : <BarList label="Pieces each karigar is holding" items={heldItems} />}
        </Panel>
      </section>

      {canWage && money && costing && (
        <section aria-labelledby="money" className="mb-10">
          <Heading id="money" note={period}>Money</Heading>
          <StatTileRow className="mb-5">
            <StatTile icon="wallet" label="Wages earned" value={rupees(money.wagesMinor)} />
            <StatTile state="completed" icon="check" label="Paid" value={rupees(money.paidMinor)} />
            <StatTile state="pending" icon="clock" label="Still owed" value={rupees(money.balanceMinor)} href="/karigars" />
            <StatTile icon="ledger" label="Advances not recovered" value={rupees(money.advanceMinor)} />
          </StatTileRow>
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <Panel title="Where the wages went">
              <MoneyBar label="Wages split" format={rupees} parts={money} />
            </Panel>
            <Panel title="Owed to each karigar">
              {owedItems.length === 0 ? <p className="m-0 text-[15px] text-text-secondary">Every account is square.</p> : <BarList tone="pending" label="Balance due to each karigar" items={owedItems} />}
            </Panel>
            <div className="lg:col-span-2">
              <Panel title="What each lot cost">
                <ul className="m-0 flex list-none flex-col gap-6 p-0">
                  {costing.filter((c) => c.totalMinor > 0).map((c) => {
                    // Cost given on to a joined lot leaves in proportion, so the bar adds up to the figure beside it; cost taken in is its own segment.
                    const own = (c.fabricMinor ?? 0) + c.wagesMinor + c.otherMinor - c.recoveredMinor;
                    const keep = own > 0 ? (own - c.sharedOutMinor) / own : 1;
                    const other = Math.max(0, c.otherMinor - c.recoveredMinor) * keep;
                    const id = lotId.get(c.lotNumber);
                    return (
                      <li key={c.lotNumber} className="list-none">
                        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4">
                          {id ? <Link href={`/lots/${id}`} className="text-[16px] font-medium text-accent-ink no-underline hover:underline">{c.lotNumber} <span className="font-normal text-text-secondary">· {c.design}</span></Link> : <span>{c.lotNumber}</span>}
                          <span className="text-[14px] text-text-secondary"><span className="font-medium text-text">{rupees(c.totalMinor)}</span>{c.perGoodPieceMinor !== null ? ` · ${rupees(c.perGoodPieceMinor)} a good piece` : " · nothing finished yet"}</span>
                        </div>
                        <StackedBar label={`${c.lotNumber} cost`} format={rupees} segments={[
                          ...(c.fabricMinor ? [{ label: "Fabric", value: c.fabricMinor * keep }] : []), { label: "Wages", value: c.wagesMinor * keep }, ...(other > 0 ? [{ label: "Other", value: other }] : []),
                          ...(c.sharedInMinor > 0 ? [{ label: "From joined lots", value: c.sharedInMinor }] : []),
                        ].filter((s) => s.value > 0)} />
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            </div>
          </div>
        </section>
      )}

      <section aria-labelledby="stock" className="mb-10">
        <Heading id="stock" note="Dispatch is not recorded, so this does not fall when garments leave">Ready stock</Heading>
        <Panel title="Finished garments by lot">
          {ready.length === 0 ? <p className="m-0 text-[15px] text-text-secondary">Nothing has finished the last stage yet.</p> : (
            <BarList tone="completed" label="Good pieces ready in each lot" items={ready.map((r) => ({ id: r.lotNumber, label: `${r.lotNumber} · ${r.design}`, href: lotId.has(r.lotNumber) ? `/lots/${lotId.get(r.lotNumber)}` : undefined, value: r.readyPieces, display: `${r.readyPieces} pcs`, note: r.readySince ? `ready since ${shortDate(r.readySince)}` : undefined }))} />
          )}
        </Panel>
      </section>

      <section aria-labelledby="tables">
        <Heading id="tables" note="Excel, CSV or Print / PDF, with the same rows">Tables and files</Heading>
        <div className="flex flex-col gap-3">
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
              note="Fabric (at each roll's invoice rate) + wages + other costs, less what was charged to karigars for lost pieces, plus or minus cost moved between joined lots. Cost per good piece = cost so far ÷ good finished pieces; it is blank when there are none."
              columns={[
                { key: "lot", header: "Lot", subKey: "design" }, { key: "planned", header: "Planned", numeric: true }, { key: "good", header: "Good", numeric: true },
                { key: "losses", header: "Rejected · rework · short" }, { key: "fabric", header: "Fabric", numeric: true }, { key: "wages", header: "Wages", numeric: true }, { key: "other", header: "Other", numeric: true }, { key: "moved", header: "Joined lots", numeric: true }, { key: "total", header: "Total", numeric: true }, { key: "per", header: "Per good piece", numeric: true },
              ]}
              rows={costing.map((r, i) => ({ id: String(i), lot: r.lotNumber, design: r.design, planned: r.plannedPieces, good: r.goodPieces, losses: `${r.rejectedPieces} · ${r.reworkPieces} · ${r.shortPieces}`, fabric: r.fabricMinor === null ? "—" : rupees(r.fabricMinor), wages: rupees(r.wagesMinor), other: rupees(r.otherMinor - r.recoveredMinor), moved: r.sharedInMinor === 0 && r.sharedOutMinor === 0 ? "—" : rupees(r.sharedInMinor - r.sharedOutMinor), total: rupees(r.totalMinor), per: r.perGoodPieceMinor === null ? "—" : rupees(r.perGoodPieceMinor) }))}
              csvHeader={["Lot", "Design", "Planned pieces", "Good pieces", "Rejected", "Rework waiting", "Short", "Fabric (Rs)", "Wages (Rs)", "Other costs (Rs)", "Recovered from karigars (Rs)", "Given to joined lots (Rs)", "Taken from joined lots (Rs)", "Total so far (Rs)", "Cost per good piece (Rs)"]}
              csvRows={costing.map((r) => [r.lotNumber, r.design, r.plannedPieces, r.goodPieces, r.rejectedPieces, r.reworkPieces, r.shortPieces, r.fabricMinor === null ? "" : rs(r.fabricMinor), rs(r.wagesMinor), rs(r.otherMinor), rs(r.recoveredMinor), rs(r.sharedOutMinor), rs(r.sharedInMinor), rs(r.totalMinor), r.perGoodPieceMinor === null ? "" : rs(r.perGoodPieceMinor)])}
            />
          )}

          <ReportTable
            title="Ready stock"
            filename="ready-stock.csv"
            columns={[{ key: "lot", header: "Lot", subKey: "design" }, { key: "pieces", header: "Good pieces", numeric: true }, { key: "bundles", header: "Bundles", numeric: true }, { key: "since", header: "Ready since" }]}
            rows={ready.map((r, i) => ({ id: String(i), lot: r.lotNumber, design: r.design, pieces: r.readyPieces, bundles: r.readyBundles, since: shortDate(r.readySince) }))}
            csvHeader={["Lot", "Design", "Good pieces", "Bundles", "Ready since"]}
            csvRows={ready.map((r) => [r.lotNumber, r.design, r.readyPieces, r.readyBundles, r.readySince])}
          />
        </div>
      </section>
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, ReportsPage);
