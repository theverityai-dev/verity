import Link from "next/link";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_ENTRY, PIECEWORK_CAPABILITY, floorCases, type CaseRow } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { EmptyState, PageHeader, PermissionDenied, Surface } from "@/components/ui/primitives";
import { shortDate } from "../../lots/format";
import { getLang } from "../lang";
import { LangToggle } from "../LangToggle";
import { FloorTabs } from "../FloorChrome";
import type { Labels } from "../labels";

export const dynamic = "force-dynamic";

/**
 * Cases: wherever a count did not match. A short return belongs to the karigar who held the pieces; a handover that differs belongs to
 * whoever counted wrong, until the receiver's count settles it. The supervisor above answers for it, so each case shows what the karigar
 * said, the challan it came from and where the charge stands. It shows the status of a charge, never its amount.
 */
async function CasesPage() {
  installCapabilities();
  const actor = await requireActor();
  const { lang, t } = await getLang();
  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_ENTRY));
  if (!allowed) return <PermissionDenied what="cases" />;
  const c = await executeQuery(actor, floorCases, {});

  return (
    <>
      <PageHeader title={t.cases} description={t.casesIntro} actions={<LangToggle lang={lang} />} />
      <FloorTabs active="cases" t={t} />

      {c.open.length === 0 ? (
        <EmptyState title={t.noCases} description="" />
      ) : (
        <ul className="m-0 mb-8 grid list-none gap-3 p-0" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))" }}>
          {c.open.map((x) => <li key={x.entryId} className="list-none"><CaseCard x={x} t={t} /></li>)}
        </ul>
      )}

      {c.settled.length > 0 && (
        <section aria-labelledby="settled-h">
          <h2 id="settled-h" className="micro m-0 mb-3 px-1">{t.settledCases}</h2>
          <ul className="m-0 grid list-none gap-3 p-0" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))" }}>
            {c.settled.map((x) => <li key={x.entryId} className="list-none"><CaseCard x={x} t={t} /></li>)}
          </ul>
        </section>
      )}
    </>
  );
}

function CaseCard({ x, t }: { x: CaseRow; t: Labels }) {
  const charge = x.chargeStatus === "pending" ? t.chargeAsked : x.chargeStatus === "approved" ? t.chargeApproved : x.chargeStatus === "declined" ? t.chargeDeclined : null;
  return (
    <Surface className="relative flex h-full flex-col gap-3 p-5 transition-[transform] duration-150 active:scale-[0.99]">
      <div className="flex items-baseline justify-between gap-3">
        <Link href={`/shopfloor/karigar/${x.workerId}`} className="truncate text-[17px] font-semibold text-text no-underline after:absolute after:inset-0 after:content-['']">{x.workerName}</Link>
        <span className="shrink-0 text-[13px] text-text-secondary">{shortDate(x.date)} · {x.ageDays}d</span>
      </div>
      <p className="m-0 flex items-baseline gap-2">
        <span className="figure text-[34px] text-text">{x.pieces}</span>
        <span className="text-[14px] text-text-secondary">{x.kind === "short" ? t.caseShort : t.caseHandover}</span>
      </p>
      <p className="m-0 text-[13px] text-text-secondary">
        {x.bundleNumber} · {x.stageLabel} · {x.lotNumber}
        {x.kind === "handover" && ` · ${x.sent} ${t.handedCounted} ${x.counted}`}
      </p>
      <p className="m-0 rounded-[12px] bg-[var(--color-control)] px-3.5 py-2.5 text-[14px] text-text">
        <span className="micro block">{t.karigarSaid}</span>
        {x.answer ?? <span className="text-text-secondary">{t.noAnswer}</span>}
      </p>
      <div className="relative z-10 mt-auto flex flex-wrap items-center gap-3 text-[13px]">
        {charge && <span className="rounded-full bg-[var(--color-control)] px-3 py-1 font-medium text-text">{charge}</span>}
        {x.challan && <Link href={`/shopfloor/challan/${x.challan}`} className="font-medium text-accent-ink no-underline hover:underline">{x.challan}</Link>}
      </div>
    </Surface>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, CasesPage);
