import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_ENTRY, PIECEWORK_CAPABILITY, floorKarigar } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { PageHeader, PermissionDenied, Surface } from "@/components/ui/primitives";
import { shortDate } from "../../../lots/format";
import { getLang } from "../../lang";
import { LangToggle } from "../../LangToggle";
import { Cover, Figure, TONE } from "../../FloorChrome";

export const dynamic = "force-dynamic";

/** S6 · Karigar quick view: pieces held, due dates, today's returns, and the last 30 days' reject and rework rates. No money. */
async function KarigarQuickView({ params }: { params: Promise<{ id: string }> }) {
  installCapabilities();
  const actor = await requireActor();
  const { lang, t } = await getLang();
  const { id } = await params;
  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_ENTRY));
  if (!allowed) return <PermissionDenied what="this karigar" />;
  const k = await executeQuery(actor, floorKarigar, { workerId: id });
  if (!k) notFound();

  return (
    <>
      <PageHeader title={k.name} description={`${t.karigarView} · ${shortDate(k.today)}`} back={{ href: "/shopfloor", label: t.myFloor }} actions={<LangToggle lang={lang} />} />

      <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Surface className="p-6">
          <p className="micro m-0">{t.last30}</p>
          <dl className="m-0 mt-4 grid grid-cols-3 gap-x-6">
            <Figure label={t.holdingNow} value={k.held} tone={TONE.out} />
            <Figure label={t.rejectRate} value={`${k.last30.rejectRatePct}%`} tone={TONE.rejected} />
            <Figure label={t.reworkRate} value={`${k.last30.reworkRatePct}%`} tone={TONE.rework} />
          </dl>
          <p className="m-0 mt-5 text-[12px] text-text-tertiary">{t.noMoney}</p>
        </Surface>

        <Surface className="p-6">
          <p className="micro m-0 mb-3">{t.returnsToday}</p>
          {k.returnsToday.length === 0 ? <p className="m-0 text-[14px] text-text-secondary">—</p> : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {k.returnsToday.map((r, i) => (
                <li key={i} className="text-[14px] text-text">{r.bundleNumber} · {r.stageLabel} — {t.good} {r.good}, {t.rejected} {r.rejected}, {t.rework} {r.rework}, {t.short} {r.short}</li>
              ))}
            </ul>
          )}
        </Surface>
      </div>

      <h2 className="micro m-0 mb-3 px-1">{t.holdingNow}</h2>
      {k.holding.length === 0 ? (
        <Surface className="p-5"><p className="m-0 text-[15px] text-text-secondary">{t.nothingHeld}</p></Surface>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))" }}>
          {k.holding.map((i) => (
            <li key={i.issueId} className="list-none">
              <Link href={`/shopfloor/take-back?issue=${i.issueId}`} className="glass-card flex min-h-[84px] items-center gap-3.5 p-4 no-underline transition-[transform] duration-150 active:scale-[0.99]">
                <Cover src={i.cover} label={i.lotNumber} size={52} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-semibold text-text">{i.bundleNumber} · {i.stageLabel}</span>
                  <span className="block text-[13px] text-text-secondary">{i.open} {t.stillOut} · {t.due} {shortDate(i.dueDate)}</span>
                </span>
                {i.late && <span className="shrink-0 text-[13px] font-semibold" style={{ color: "var(--color-state-blocked)" }}>{t.daysLate}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, KarigarQuickView);
