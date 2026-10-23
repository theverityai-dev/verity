import Link from "next/link";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_ENTRY, PIECEWORK_CAPABILITY, floorOverview, lookupCode, type FloorOverview, type ScanResult } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { Cover } from "@/components/ui/Cover";
import { Icon } from "@/components/ui/icons";
import { PageHeader, PermissionDenied, Surface } from "@/components/ui/primitives";
import { shortDate } from "../../lots/format";
import { getLang } from "../lang";
import { LangToggle } from "../LangToggle";
import { FloorTabs } from "../FloorChrome";
import type { Labels } from "../labels";
import { Scanner } from "./Scanner";

export const dynamic = "force-dynamic";

type Action = { href: string; title: string; detail: string; primary: boolean };

/**
 * Scan: the one place a supervisor starts from. A slip, a label or a typed number opens what it is, and for a bundle the screen lists
 * only what can be done with it now at this person's stages (give it out, take it back from whoever holds it), each one tap away
 * with the bundle already chosen. Nothing happens on its own: the next screen still asks for the count.
 */
async function ScanPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  installCapabilities();
  const actor = await requireActor();
  const { lang, t } = await getLang();
  const { code } = await searchParams;
  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_ENTRY));
  if (!allowed) return <PermissionDenied what="scanning" />;

  const found = code ? await executeQuery(actor, lookupCode, { code: code.slice(0, 500) }) : null;
  const floor = found?.kind === "bundle" ? await executeQuery(actor, floorOverview, {}) : null;

  return (
    <>
      <PageHeader title={t.scan} description={t.scanIntro} actions={<LangToggle lang={lang} />} />
      <FloorTabs active="scan" t={t} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Surface className="p-4 sm:p-5">
          <Scanner t={t} initial="" />
        </Surface>
        {found && <Result r={found} t={t} floor={floor} />}
      </div>
    </>
  );
}

function Result({ r, t, floor }: { r: ScanResult; t: Labels; floor: FloorOverview | null }) {
  if (r.kind === "none") {
    return (
      <Surface className="p-5">
        <p role="alert" className="m-0 text-[16px] text-text">{t.scanNotFound}</p>
        <p className="m-0 mt-1 text-[13px] text-text-secondary">{r.code}</p>
      </Surface>
    );
  }
  if (r.kind !== "bundle") {
    const [href, label, title] =
      r.kind === "roll" ? [`/fabric/${r.id}`, t.scanOpenRoll, r.number]
      : r.kind === "lot" ? [`/lots/${r.id}`, t.scanOpenLot, `${r.number} · ${r.name}`]
      : [`/shopfloor/challan/${r.number}`, t.scanOpenChallan, r.number];
    return (
      <Surface className="flex flex-col gap-4 p-5">
        <p className="m-0 text-[22px] font-light tracking-[-0.03em] text-text">{title}</p>
        <ActionLink a={{ href, title: label, detail: "", primary: true }} />
      </Surface>
    );
  }

  const actions: Action[] = [];
  if (!r.cancelled && floor) {
    for (const i of floor.issues.filter((x) => x.bundleId === r.id)) {
      actions.push({ href: `/shopfloor/take-back?issue=${i.issueId}`, title: `${t.scanTakeFrom} ${i.workerName}`, detail: `${i.stageLabel} · ${i.open} ${t.stillOut}${i.dueDate ? ` · ${t.due} ${shortDate(i.dueDate)}` : ""}`, primary: true });
    }
    for (const w of floor.waiting.filter((x) => x.bundleId === r.id)) {
      if (w.toIssue > 0) actions.push({ href: `/shopfloor/give-out?bundle=${r.id}&stage=${w.stageId}`, title: `${t.scanGiveAt} ${w.stageLabel}`, detail: `${w.toIssue} ${t.toIssue}`, primary: true });
      if (w.reworkPool > 0) actions.push({ href: `/shopfloor/give-out?bundle=${r.id}&stage=${w.stageId}&rework=1`, title: `${t.scanReworkAt} ${w.stageLabel}`, detail: `${w.reworkPool} ${t.reworkWaiting}`, primary: false });
    }
  }

  return (
    <Surface className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-3.5">
        <Cover src={r.cover} label={r.lotNumber} size={64} rounded={14} />
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[22px] font-light tracking-[-0.03em] text-text">{r.number}</p>
          <p className="m-0 truncate text-[14px] text-text-secondary">{r.lotNumber} · {r.lotName} · {r.netPieces} {t.pieces}{r.sizeNote ? ` · ${r.sizeNote}` : ""}</p>
        </div>
      </div>
      {r.cancelled ? (
        <p role="alert" className="m-0 text-[15px] text-text">{t.scanCancelled}</p>
      ) : actions.length === 0 ? (
        <p className="m-0 text-[15px] text-text-secondary">{t.scanNothingHere}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">{actions.map((a) => <li key={a.href} className="list-none"><ActionLink a={a} /></li>)}</ul>
      )}
      <Link href={`/lots/bundles/${r.id}`} className="text-[14px] font-medium text-accent-ink no-underline hover:underline">{t.scanOpenBundle}</Link>
    </Surface>
  );
}

function ActionLink({ a }: { a: Action }) {
  return (
    <Link
      href={a.href}
      className={`flex min-h-14 items-center gap-3 rounded-[14px] px-4 py-3 no-underline transition-[transform,background-color] duration-150 active:scale-[0.99] focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--color-accent-subtle)] ${a.primary ? "bg-accent text-accent-on" : "bg-[var(--color-control)] text-text"}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-semibold">{a.title}</span>
        {a.detail && <span className={`block text-[13px] ${a.primary ? "opacity-85" : "text-text-secondary"}`}>{a.detail}</span>}
      </span>
      <Icon name="expand" size={18} />
    </Link>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, ScanPage);
