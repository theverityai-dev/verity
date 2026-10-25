import Link from "next/link";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_LOT, PIECEWORK_CAPABILITY, readyGarments, readyStock } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { Cover } from "@/components/ui/Cover";
import { EmptyState, PageHeader, PermissionDenied, Surface } from "@/components/ui/primitives";
import { ProgressBar } from "@/components/ui/viz";
import { fill } from "../../fabric/office-labels";
import { getOfficeLang } from "../../fabric/office-lang";
import { LangToggle } from "../../shopfloor/LangToggle";
import { shortDate } from "../format";
import { ReportTable } from "../reports/ReportTable";
import { CorrectCount, OpeningStock, ReverseMove, StockOut, type StockOption } from "./ReadyActions";

export const dynamic = "force-dynamic";

/**
 * Ready stock: the garments that have finished the last stage, less what has gone out. The system ends here (dispatch is not part of it),
 * so this is the answer to "what can go out, and how many?": a card per lot or opening line with its balance and where it came from, and
 * the ledger of every movement underneath, each one reversible and every one exportable. Hindi or English, as chosen on this device.
 */
async function ReadyPage() {
  installCapabilities();
  const actor = await requireActor();
  const { lang, o } = await getOfficeLang();
  const KIND: Record<string, string> = { opening: o.kindOpening, out: o.kindOut, adjust_in: o.kindAdjIn, adjust_out: o.kindAdjOut };
  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_LOT));
  if (!allowed) return <PermissionDenied what="ready stock" />;
  const [stock, garments] = await Promise.all([executeQuery(actor, readyStock, {}), executeQuery(actor, readyGarments, {})]);
  const bundlesOf = new Map(garments.map((g) => [g.lotId, g.bundles]));
  const options: StockOption[] = stock.lines.map((l) => ({ key: l.key, lotId: l.lotId, label: l.number ? `${l.number} · ${l.name}` : l.name, balance: l.balance }));
  const inStock = stock.lines.filter((l) => l.balance > 0);

  return (
    <>
      <PageHeader
        title={o.readyStock}
        description={stock.lines.length === 0 ? o.rsNone : fill(o.rsSummary, { n: stock.totalBalance.toLocaleString("en-IN"), l: inStock.length })}
        actions={<><LangToggle lang={lang} /><OpeningStock o={o} today={stock.today} /><CorrectCount o={o} options={options} today={stock.today} /><StockOut o={o} options={options} today={stock.today} /></>}
      />

      {stock.lines.length === 0 ? (
        <EmptyState title={o.rsEmptyTitle} description={o.rsEmptyDesc} />
      ) : (
        <ul className="m-0 grid list-none gap-4 p-0" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))" }}>
          {stock.lines.map((l) => (
            <li key={l.key} className="list-none">
              <Surface className={`relative flex h-full flex-col gap-4 p-5 transition-[transform] duration-150 active:scale-[0.99] ${l.balance === 0 ? "opacity-70" : ""}`}>
                <div className="flex items-center gap-3.5">
                  <Cover src={l.cover} label={l.number ?? o.openingWord} size={64} rounded={14} />
                  <div className="min-w-0 flex-1">
                    <Link href={l.lotId ? `/lots/${l.lotId}` : "#ledger"} className="block truncate text-[17px] font-semibold text-text no-underline after:absolute after:inset-0 after:content-['']">{l.number ? `${l.number} · ` : ""}{l.name}</Link>
                    <p className="m-0 text-[13px] text-text-secondary">{l.lotId ? (l.readySince ? fill(o.readySince, { d: shortDate(l.readySince) }) : o.readyWord) : o.openingStockLabel}{l.lastMovedOn ? ` · ${fill(o.lastMoved, { d: shortDate(l.lastMovedOn) })}` : ""}</p>
                  </div>
                </div>
                <p className="figure m-0 text-[40px] text-text">{l.balance.toLocaleString("en-IN")}<span className="ml-2 text-[14px] font-normal tracking-normal text-text-secondary">{o.inStockWord}</span></p>
                <ProgressBar label={`${l.name} ${o.inStockWord}`} value={Math.max(0, l.balance)} total={Math.max(l.made + l.opening + Math.max(l.adjusted, 0), 1)} tone="completed" showFigures={false} />
                <dl className="m-0 grid grid-cols-3 gap-3 border-t border-[var(--color-line)] pt-3.5">
                  <div><dt className="text-[12px] leading-[16px] text-text-tertiary">{l.lotId ? o.made : o.openingWord}</dt><dd className="tabular m-0 text-[15px] font-semibold leading-[20px] text-text">{(l.lotId ? l.made : l.opening).toLocaleString("en-IN")}</dd></div>
                  <div><dt className="text-[12px] leading-[16px] text-text-tertiary">{o.takenOut}</dt><dd className="tabular m-0 text-[15px] font-semibold leading-[20px] text-text">{l.out.toLocaleString("en-IN")}</dd></div>
                  <div><dt className="text-[12px] leading-[16px] text-text-tertiary">{o.countFixes}</dt><dd className="tabular m-0 text-[15px] font-semibold leading-[20px] text-text">{l.adjusted > 0 ? "+" : ""}{l.adjusted.toLocaleString("en-IN")}</dd></div>
                </dl>
                {l.lotId && (bundlesOf.get(l.lotId)?.length ?? 0) > 0 && (
                  <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                    {bundlesOf.get(l.lotId)!.slice(0, 6).map((b) => (
                      <li key={b.id} className="list-none"><Link href={`/lots/bundles/${b.id}`} className="relative z-10 inline-flex min-h-8 items-center rounded-full bg-[var(--color-control)] px-3 text-[12px] font-medium text-text no-underline hover:underline">{b.number} · {b.ready}</Link></li>
                    ))}
                    {bundlesOf.get(l.lotId)!.length > 6 && <li className="list-none text-[12px] text-text-secondary">{fill(o.moreFmt, { n: bundlesOf.get(l.lotId)!.length - 6 })}</li>}
                  </ul>
                )}
              </Surface>
            </li>
          ))}
        </ul>
      )}

      <section id="ledger" className="mt-8 scroll-mt-6" aria-label={o.movements}>
        <h2 className="micro m-0 mb-3 px-1">{o.movements}</h2>
        {stock.moves.length === 0 ? (
          <Surface className="p-5"><p className="m-0 text-[15px] text-text-secondary">{o.noMovements}</p></Surface>
        ) : (
          <Surface className="p-0">
            <ul className="m-0 flex list-none flex-col divide-y divide-[var(--color-line)] p-0">
              {stock.moves.slice(0, 30).map((m) => (
                <li key={m.id} className="flex list-none flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                  <span className="min-w-0 flex-1 basis-56">
                    <span className="block text-[15px] text-text">{m.isReversal ? o.reversalWord : ""}{KIND[m.kind] ?? m.kind} · {m.lotNumber ?? m.label}{m.reversed ? o.reversedTag : ""}</span>
                    <span className="block text-[13px] leading-[19px] text-text-secondary">{shortDate(m.movedOn)} · {m.by}{m.party ? ` · ${fill(o.toParty, { p: m.party })}` : ""}{m.reference ? ` · ${m.reference}` : ""}{m.reason ? ` · ${m.reason}` : ""}{m.note ? ` · ${m.note}` : ""}</span>
                  </span>
                  <span className="tabular text-[15px] font-semibold text-text" style={m.signed < 0 ? { color: "var(--color-state-pending-ink)" } : undefined}>{m.signed > 0 ? "+" : ""}{m.signed.toLocaleString("en-IN")}</span>
                  {!m.isReversal && !m.reversed && <ReverseMove o={o} moveId={m.id} summary={`${m.pieces} ${o.pieces}, ${KIND[m.kind]?.toLowerCase() ?? m.kind}, ${m.lotNumber ?? m.label}`} />}
                </li>
              ))}
            </ul>
            {stock.moves.length > 30 && <p className="m-0 border-t border-[var(--color-line)] px-5 py-3 text-[13px] text-text-secondary">{o.latest30}</p>}
          </Surface>
        )}
      </section>

      <div className="mt-6 flex flex-col gap-3">
        <ReportTable
          title={o.readyStockTable}
          note="One row per lot or opening line, with what was made, what went out and the balance."
          filename="ready-stock.csv"
          columns={[{ key: "line", header: "Stock" }, { key: "made", header: "Made or opening", numeric: true }, { key: "out", header: "Taken out", numeric: true }, { key: "adjusted", header: "Count fixes", numeric: true }, { key: "balance", header: "In stock", numeric: true }]}
          rows={stock.lines.map((l) => ({ id: l.key, line: l.number ? `${l.number} ${l.name}` : l.name, made: l.lotId ? l.made : l.opening, out: l.out, adjusted: l.adjusted, balance: l.balance }))}
          csvHeader={["Stock", "Made or opening", "Taken out", "Count fixes", "In stock"]}
          csvRows={stock.lines.map((l) => [l.number ? `${l.number} ${l.name}` : l.name, l.lotId ? l.made : l.opening, l.out, l.adjusted, l.balance])}
        />
        <ReportTable
          title={o.stockMovementsTable}
          note="Every movement, newest first, including reversals."
          filename="ready-stock-movements.csv"
          columns={[{ key: "date", header: "Date" }, { key: "what", header: "Movement", subKey: "stock" }, { key: "pieces", header: "Pieces", numeric: true }, { key: "party", header: "To", subKey: "reference" }, { key: "by", header: "By" }]}
          rows={stock.moves.map((m) => ({ id: m.id, date: shortDate(m.movedOn), what: `${m.isReversal ? "Reversal: " : ""}${KIND[m.kind] ?? m.kind}`, stock: m.lotNumber ?? m.label ?? "", pieces: m.signed, party: m.party ?? "", reference: m.reference ?? "", by: m.by }))}
          csvHeader={["Date", "Movement", "Stock", "Pieces", "To", "Reference", "Reason", "Note", "By"]}
          csvRows={stock.moves.map((m) => [m.movedOn, `${m.isReversal ? "Reversal: " : ""}${KIND[m.kind] ?? m.kind}`, m.lotNumber ?? m.label ?? "", m.signed, m.party, m.reference, m.reason, m.note, m.by])}
        />
      </div>
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, ReadyPage);
