import Link from "next/link";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_ROLL, PIECEWORK_CAPABILITY, listRolls, type RollRow } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { ButtonLink, EmptyState, PageHeader, PermissionDenied, Surface } from "@/components/ui/primitives";
import { ProgressBar } from "@/components/ui/viz";
import { shortDate } from "../lots/format";
import { LangToggle } from "../shopfloor/LangToggle";
import { qty } from "./format";
import { fill, type OfficeLabels } from "./office-labels";
import { getOfficeLang } from "./office-lang";
import { ReceiveRolls } from "./ReceiveRolls";

export const dynamic = "force-dynamic";

/**
 * Fabric: what is on the shelf, and which roll it is on. The job is to find a roll fast and to know how much of a fabric is left, so the
 * top is stock per fabric (one card each, with its rolls and metres) and below it are the rolls themselves, each a card that opens the
 * roll. Used-up rolls drop to a quiet list; they stay findable because a lot's fabric always links back to its roll. In Hindi or English,
 * as chosen on this device.
 */
async function FabricPage() {
  installCapabilities();
  const actor = await requireActor();
  const { lang, o } = await getOfficeLang();
  const { canRead, canReceive } = await withTenant(actor.tenantId, async (tx) => ({
    canRead: await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_ROLL),
    canReceive: await hasTenantPermission(tx, actor.roleId, "Create", ENTITY_PIECEWORK_ROLL),
  }));
  if (!canRead) return <PermissionDenied what="fabric" />;
  const { rolls, inStock, low, lowLevelCenti } = await executeQuery(actor, listRolls, {});
  const lowKeys = new Set(low.map((l) => `${l.fabricType}|${l.unit}`));
  const live = rolls.filter((r) => !r.cancelled);
  const shelf = live.filter((r) => r.balanceCenti > 0);
  const empty = live.filter((r) => r.balanceCenti <= 0);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title={o.fabric} description={shelf.length === 0 ? o.noRollLeft : `${shelf.length} ${shelf.length === 1 ? o.roll : o.rolls} ${o.rollsOnShelfSuffix}`} actions={<>
        <LangToggle lang={lang} />
        {shelf.length > 0 && <ButtonLink href={`/fabric/labels?ids=${shelf.slice(0, 100).map((r) => r.id).join(",")}`} variant="secondary">{o.printLabels}{shelf.length > 100 ? ` ${o.firstHundred}` : ""}</ButtonLink>}
        {canReceive && shelf.length > 0 && <ButtonLink href="/fabric/count" variant="secondary">{o.countShelf}</ButtonLink>}
        {canReceive && <ReceiveRolls o={o} fabricTypes={[...new Set(live.map((r) => r.fabricType))]} today={today} seen={live.filter((r) => r.invoiceNumber).map((r) => ({ supplier: r.supplier, invoice: r.invoiceNumber!, number: r.number }))} />}
      </>} />

      {live.length === 0 ? (
        <EmptyState title={o.noRollsYet} description={o.noRollsDesc} />
      ) : (
        <>
          {low.length > 0 && (
            <section aria-labelledby="low-h" className="mb-6">
              <h2 id="low-h" className="micro m-0 mb-3 px-1">{o.runningLow}</h2>
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {low.map((l) => (
                  <li key={`${l.fabricType}|${l.unit}`} className="list-none rounded-full px-4 py-2 text-[14px] font-medium text-text" style={{ background: "color-mix(in srgb, var(--color-state-pending) 18%, transparent)" }}>
                    {l.fabricType}: {l.balanceCenti <= 0 ? o.noneLeft : qty(l.balanceCenti, l.unit)}
                    <span className="ml-2 font-normal text-text-secondary">{o.below} {qty(lowLevelCenti!, l.unit)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {inStock.length > 0 && (
            <section aria-labelledby="stock-h" className="mb-8">
              <h2 id="stock-h" className="micro m-0 mb-3 px-1">{o.inStockByFabric}</h2>
              <ul className="m-0 grid list-none gap-3 p-0" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))" }}>
                {inStock.map((s) => (
                  <li key={`${s.fabricType}|${s.unit}`} className="list-none">
                    <Surface className="flex h-full flex-col gap-1 p-5">
                      <p className="m-0 flex items-center justify-between gap-2 text-[15px] font-medium text-text"><span className="truncate" title={s.fabricType}>{s.fabricType}</span>{lowKeys.has(`${s.fabricType}|${s.unit}`) && <span className="shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-medium" style={{ background: "color-mix(in srgb, var(--color-state-pending) 24%, transparent)" }}>{o.lowTag}</span>}</p>
                      <p className="figure m-0 text-[34px] text-text">{(s.balanceCenti / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}<span className="ml-1 text-[16px] tracking-normal text-text-secondary">{s.unit}</span></p>
                      <p className="m-0 text-[13px] text-text-secondary">{s.rolls === 1 ? o.onOneRoll : fill(o.onRolls, { n: s.rolls })}</p>
                    </Surface>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {shelf.length > 0 && (
            <section aria-labelledby="rolls-h" className="mb-8">
              <h2 id="rolls-h" className="micro m-0 mb-3 px-1">{o.rollsHeading}</h2>
              <ul className="m-0 grid list-none gap-3 p-0" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))" }}>
                {shelf.map((r) => <li key={r.id} className="list-none"><RollCard r={r} o={o} /></li>)}
              </ul>
            </section>
          )}

          {empty.length > 0 && (
            <section aria-labelledby="used-h">
              <h2 id="used-h" className="micro m-0 mb-3 px-1">{o.usedUp}</h2>
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {empty.map((r) => (
                  <li key={r.id} className="list-none">
                    <Link href={`/fabric/${r.id}`} className="inline-flex min-h-11 items-center gap-2 rounded-[12px] bg-[var(--color-control)] px-4 text-[14px] text-text-secondary no-underline hover:text-text active:scale-[0.98]">
                      <span className="font-medium text-text">{r.number}</span> {r.fabricType}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}

function RollCard({ r, o }: { r: RollRow; o: OfficeLabels }) {
  return (
    <Surface className="relative flex h-full flex-col gap-3 p-5 transition-[transform] duration-150 active:scale-[0.99]">
      <div className="flex items-start gap-3.5">
        <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-[14px] bg-[var(--color-control)] text-[13px] font-medium tracking-[0.04em] text-text-secondary">{r.number.replace("R-", "R")}</span>
        <div className="min-w-0 flex-1">
          <Link href={`/fabric/${r.id}`} className="block truncate text-[16px] font-semibold text-text no-underline after:absolute after:inset-0 after:content-['']">{r.number} · {r.fabricType}</Link>
          <p className="m-0 truncate text-[13px] text-text-secondary">{[r.supplier, r.invoiceNumber].filter(Boolean).join(" · ") || shortDate(r.receivedOn)}</p>
        </div>
      </div>
      <p className="figure m-0 text-[30px] text-text">{qty(r.balanceCenti, r.unit)}<span className="ml-2 text-[13px] font-normal tracking-normal text-text-secondary">{fill(o.ofQty, { q: qty(r.receivedCenti, r.unit) })}</span></p>
      <ProgressBar label={`${r.number} fabric left`} value={r.balanceCenti} total={Math.max(r.receivedCenti, 1)} tone={r.balanceCenti / r.receivedCenti < 0.15 ? "pending" : "active"} showFigures={false} />
      <p className="m-0 text-[13px] text-text-secondary">{r.lotCount === 0 ? o.notCutYet : r.lotCount === 1 ? o.usedInOneLot : fill(o.usedInLots, { n: r.lotCount })} · {fill(o.receivedOnFmt, { d: shortDate(r.receivedOn) })}</p>
    </Surface>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, FabricPage);
