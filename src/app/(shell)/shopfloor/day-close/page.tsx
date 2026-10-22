import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_DAY_CLOSE, PIECEWORK_CAPABILITY, dayPreview } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { PageHeader, PermissionDenied, Surface } from "@/components/ui/primitives";
import { shortDate } from "../../lots/format";
import { getLang } from "../lang";
import { LangToggle } from "../LangToggle";
import { Figure, FloorTabs, TONE } from "../FloorChrome";
import { DayCloseForm } from "./DayCloseForm";

export const dynamic = "force-dynamic";

/** S5 · Day close: the day's numbers for my stages, a handover note, then frozen for the owner and manager to read. */
async function DayClosePage() {
  installCapabilities();
  const actor = await requireActor();
  const { lang, t } = await getLang();
  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Create", ENTITY_PIECEWORK_DAY_CLOSE));
  if (!allowed) return <PermissionDenied what="closing the day" />;
  const { summary: s, closed } = await executeQuery(actor, dayPreview, {});
  const warnings = s.late.length + (s.openShortages > 0 ? 1 : 0);

  return (
    <>
      <PageHeader title={t.dayClose} description={`${shortDate(s.date)}${s.stages.length ? ` · ${s.stages.join(", ")}` : ""}`} actions={<LangToggle lang={lang} />} />
      <FloorTabs active="day-close" t={t} />

      <Surface className="mb-6 p-6">
        <h2 className="m-0 mb-4 text-[17px] font-medium tracking-[-0.02em]">{t.daySummary}</h2>
        <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
          <Figure label={t.given} value={s.given} />
          <Figure label={t.takenBack} value={s.takenBack} />
          <Figure label={t.good} value={s.good} tone={TONE.done} />
          <Figure label={t.rejected} value={s.rejected} tone={TONE.rejected} />
          <Figure label={t.rework} value={s.rework} tone={TONE.rework} />
          <Figure label={t.short} value={s.short} tone={TONE.short} />
        </dl>
        {warnings > 0 && (
          <div className="mt-6 border-t border-[var(--color-line)] pt-4">
            <p className="micro m-0 mb-2">{t.warnings}</p>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[14px] text-text-secondary">
              {s.late.map((l) => <li key={`${l.bundleNumber}-${l.workerName}-${l.stageLabel}`}>{l.bundleNumber} · {l.workerName} · {l.open} {t.stillOut} · {t.due} {shortDate(l.dueDate)}</li>)}
              {s.openShortages > 0 && <li>{s.openShortages} {t.alertShortage}</li>}
            </ul>
          </div>
        )}
      </Surface>

      {closed ? (
        <Surface className="p-6">
          <p role="status" className="m-0 text-[16px] font-semibold text-text">{t.dayClosed}</p>
          {closed.note && <p className="m-0 mt-3 whitespace-pre-wrap text-[15px] text-text" lang={closed.lang}>{closed.note}</p>}
        </Surface>
      ) : (
        <DayCloseForm lang={lang} />
      )}
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, DayClosePage);
