import Link from "next/link";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_ENTRY, PIECEWORK_CAPABILITY, floorRegister } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { PageHeader, PermissionDenied, Surface } from "@/components/ui/primitives";
import { shortDate } from "../../lots/format";
import { photosFor } from "../photos";
import { getLang } from "../lang";
import { LangToggle } from "../LangToggle";
import { Cover, FloorTabs } from "../FloorChrome";
import { WriteoffForm } from "./WriteoffForm";

export const dynamic = "force-dynamic";

/** S4 · Rework and shortage register: what is waiting to be redone, and what did not come back and cannot be found. */
async function RegisterPage() {
  installCapabilities();
  const actor = await requireActor();
  const { lang, t } = await getLang();
  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_ENTRY));
  if (!allowed) return <PermissionDenied what="the register" />;
  const r = await executeQuery(actor, floorRegister, {});
  const photos = await photosFor(actor, [...r.shortages.map((s) => s.entryId), ...r.rework.flatMap((w) => (w.entryId ? [w.entryId] : []))]);

  return (
    <>
      <PageHeader title={t.register} description={shortDate(r.today)} actions={<LangToggle lang={lang} />} />
      <FloorTabs active="register" t={t} />

      <h2 className="micro m-0 mb-3 px-1">{t.reworkWaitingTitle}</h2>
      {r.rework.length === 0 ? (
        <Surface className="mb-8 p-5"><p className="m-0 text-[15px] text-text-secondary">{t.noRework}</p></Surface>
      ) : (
        <ul className="m-0 mb-8 grid list-none gap-3 p-0" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))" }}>
          {r.rework.map((w) => (
            <li key={`${w.bundleId}:${w.stageId}`} className="list-none">
              <Surface className="flex h-full flex-col gap-3 p-4">
                <div className="flex items-start gap-3">
                  <Evidence urls={photos.get(w.entryId ?? "")} cover={w.cover} label={w.lotNumber} />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-[16px] font-semibold text-text">{w.bundleNumber} · {w.stageLabel}</p>
                    <p className="m-0 text-[13px] text-text-secondary">{w.lotName}{w.workerName ? ` · ${w.workerName}` : ""}</p>
                    {w.reason && <p className="m-0 mt-1 text-[13px] text-text">{w.reason}</p>}
                  </div>
                  <span className="figure text-[30px]" style={{ color: "var(--color-state-pending)" }}>{w.reworkPool}</span>
                </div>
                <p className="m-0 text-[12px] text-text-tertiary">{w.ageDays} {t.daysOld}</p>
                <Link href={`/shopfloor/give-out?bundle=${w.bundleId}&stage=${w.stageId}&rework=1`} className="mt-auto inline-flex min-h-11 items-center justify-center rounded-[10px] bg-[var(--color-control)] px-4 text-[15px] font-medium text-accent-ink no-underline transition-[opacity] active:opacity-70">{t.reissue}</Link>
              </Surface>
            </li>
          ))}
        </ul>
      )}

      <h2 className="micro m-0 mb-3 px-1">{t.openShortages}</h2>
      {r.shortages.length === 0 ? (
        <Surface className="p-5"><p className="m-0 text-[15px] text-text-secondary">{t.noShortages}</p></Surface>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))" }}>
          {r.shortages.map((s) => (
            <li key={s.entryId} className="list-none">
              <Surface className="flex h-full flex-col gap-3 p-4">
                <div className="flex items-start gap-3">
                  <Evidence urls={photos.get(s.entryId)} cover={s.cover} label={s.lotNumber} />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-[16px] font-semibold text-text">{s.bundleNumber} · {s.stageLabel}</p>
                    <p className="m-0 text-[13px] text-text-secondary">{s.workerName} · {shortDate(s.date)} · {s.ageDays} {t.daysOld}</p>
                    <p className="m-0 mt-1 text-[13px] text-text-secondary">
                      {s.writtenOff > 0 && `${s.writtenOff} ${t.writtenOff} · `}{s.requested > 0 && `${s.requested} ${t.requested} · `}{s.open} {t.open}
                    </p>
                  </div>
                  <span className="figure text-[30px]" style={{ color: "var(--color-state-draft)" }}>{s.short}</span>
                </div>
                {s.open > 0 && <WriteoffForm lang={lang} entryId={s.entryId} open={s.open} />}
              </Surface>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Evidence({ urls, cover, label }: { urls: string[] | undefined; cover: string | null; label: string }) {
   
  if (urls?.[0]) return <img src={urls[0]} alt="" className="size-14 shrink-0 rounded-[12px] object-cover" />;
  return <Cover src={cover} label={label} size={56} />;
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, RegisterPage);
