import Link from "next/link";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_ENTRY, PIECEWORK_CAPABILITY, floorOverview } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { Icon } from "@/components/ui/icons";
import { PieceRing } from "@/components/ui/PieceFlow";
import { ButtonLink, PageHeader, PermissionDenied, Surface } from "@/components/ui/primitives";
import { shortDate } from "../lots/format";
import { getLang } from "./lang";
import { LangToggle } from "./LangToggle";
import { Cover, Figure, FloorTabs, TONE } from "./FloorChrome";

export const dynamic = "force-dynamic";

/** S1 · My floor: the stages I look after, where their pieces are, and what is late or due today. */
async function MyFloorPage() {
  installCapabilities();
  const actor = await requireActor();
  const { lang, t } = await getLang();
  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_ENTRY));
  if (!allowed) return <PermissionDenied what="the floor screens" />;

  const f = await executeQuery(actor, floorOverview, {});
  const c = f.counts;
  const alertText = { late: t.alertLate, shortage: t.alertShortage, approvals: t.alertApprovals } as const;
  const alertHref = { late: "/shopfloor/take-back", shortage: "/shopfloor/register", approvals: "/shopfloor/approvals" } as const;
  const watch = f.issues.filter((i) => i.late || i.dueToday);

  return (
    <>
      <PageHeader title={t.myFloor} description={shortDate(f.today)} actions={<><ButtonLink href="/shopfloor/challans" variant="secondary">{t.printChallans}</ButtonLink><LangToggle lang={lang} /></>} />
      <FloorTabs active="floor" t={t} />

      {f.stages.length === 0 ? (
        <Surface className="p-6"><p className="m-0 text-[15px] text-text-secondary">{t.noStages}</p></Surface>
      ) : (
        <>
          <div className="mb-6 grid items-stretch gap-6 lg:grid-cols-[1.5fr_1fr]">
            <Surface className="flex flex-wrap items-center gap-x-8 gap-y-6 p-6 sm:p-7">
              <PieceRing label={t.piecesInMyStages} total={c.total} counts={{ ready: c.done, out: c.out, rework: c.rework, rejected: c.rejected, short: c.short }} size={196}>
                <div>
                  <p className="figure m-0 text-[40px] text-text">{c.out}</p>
                  <p className="micro m-0">{t.withKarigars}</p>
                </div>
              </PieceRing>
              <div className="min-w-0 flex-1 basis-[14rem]">
                <p className="micro m-0">{t.stagesIlookAfter}</p>
                <ul className="m-0 mt-2 flex list-none flex-wrap gap-1.5 p-0">
                  {f.stages.map((s) => (
                    <li key={s.id} className="rounded-full bg-[var(--color-control)] px-3 py-1 text-[13px] font-medium text-text">{s.label}</li>
                  ))}
                </ul>
                <dl className="m-0 mt-5 grid grid-cols-2 gap-x-6 gap-y-4">
                  <Figure label={t.doneHere} value={c.done} tone={TONE.done} />
                  <Figure label={t.withKarigars} value={c.out} tone={TONE.out} />
                  <Figure label={t.waitingToGive} value={c.waiting} />
                  <Figure label={t.rework} value={c.rework} tone={TONE.rework} />
                  <Figure label={t.rejected} value={c.rejected} tone={TONE.rejected} />
                  <Figure label={t.short} value={c.short} tone={TONE.short} />
                </dl>
              </div>
              <div className="grid w-full grid-cols-2 gap-3">
                <ButtonLink href="/shopfloor/take-back" variant="primary" className="min-h-14 text-[17px]">{t.takeBack}</ButtonLink>
                <ButtonLink href="/shopfloor/give-out" variant="secondary" className="min-h-14 text-[17px]">{t.giveOut}</ButtonLink>
              </div>
            </Surface>

            <Surface className="flex flex-col p-6">
              <h2 className="m-0 mb-3 text-[17px] font-medium leading-[22px] tracking-[-0.02em]">{t.alerts}</h2>
              {f.alerts.length === 0 ? (
                <p className="m-0 flex items-center gap-2 text-[15px] text-text-secondary">
                  <span aria-hidden="true" style={{ color: "var(--color-state-completed)" }}><Icon name="check" size={18} /></span>
                  {t.nothingLate}
                </p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                  {f.alerts.map((a) => (
                    <li key={a.kind} className="list-none">
                      <Link href={alertHref[a.kind as keyof typeof alertHref] ?? "/shopfloor"} className="glass-inset flex min-h-14 items-center gap-3 rounded-[14px] px-4 py-3 no-underline transition-[transform] duration-150 active:scale-[0.99]">
                        <span className="figure text-[28px]" style={{ color: a.kind === "late" ? "var(--color-state-blocked)" : "var(--color-state-pending)" }}>{a.count}</span>
                        <span className="text-[15px] font-medium text-text">{alertText[a.kind as keyof typeof alertText]}</span>
                        <Icon name="chevronRight" size={16} className="ml-auto text-text-tertiary" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Surface>
          </div>

          <h2 className="micro m-0 mb-3 px-1">{t.lateAndDue}</h2>
          {watch.length === 0 ? (
            <Surface className="p-5"><p className="m-0 text-[15px] text-text-secondary">{t.nothingLate}</p></Surface>
          ) : (
            <ul className="m-0 grid list-none gap-3 p-0" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))" }}>
              {watch.map((i) => {
                const days = i.dueDate ? Math.round((Date.parse(`${f.today}T00:00:00Z`) - Date.parse(`${i.dueDate}T00:00:00Z`)) / 86_400_000) : 0;
                return (
                  <li key={i.issueId} className="list-none">
                    <Link href={`/shopfloor/take-back?issue=${i.issueId}`} className="glass-card flex min-h-[88px] items-center gap-3.5 p-4 no-underline transition-[transform] duration-150 active:scale-[0.99]">
                      <Cover src={i.cover} label={i.lotNumber} size={56} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[16px] font-semibold text-text">{i.bundleNumber} · {i.workerName}</span>
                          <span className="shrink-0 text-[13px] font-semibold" style={{ color: i.late ? "var(--color-state-blocked)" : "var(--color-state-pending)" }}>
                            {i.late ? `${days} ${t.daysLate}` : t.dueToday}
                          </span>
                        </span>
                        <span className="block text-[13px] leading-[18px] text-text-secondary">{i.open} {t.stillOut} · {i.stageLabel} · {t.due} {shortDate(i.dueDate)}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, MyFloorPage);
