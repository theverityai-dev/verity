import Link from "next/link";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_ENTRY, PIECEWORK_CAPABILITY, floorOverview, lookupCode, type FloorOverview, type ScanResult } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { Cover } from "@/components/ui/Cover";
import { PageHeader, PermissionDenied, Surface } from "@/components/ui/primitives";
import { getLang } from "../lang";
import { LangToggle } from "../LangToggle";
import { FloorTabs } from "../FloorChrome";
import type { Labels } from "../labels";
import { ActionLink, BundleNext } from "../BundleNext";
import { Scanner } from "./Scanner";

export const dynamic = "force-dynamic";

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
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
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
  return (
    <Surface className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-3.5">
        <Cover src={r.cover} label={r.lotNumber} size={64} rounded={14} />
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[22px] font-light tracking-[-0.03em] text-text">{r.number}</p>
          <p className="m-0 truncate text-[14px] text-text-secondary">{r.lotNumber} · {r.lotName} · {r.netPieces} {t.pieces}{r.sizeNote ? ` · ${r.sizeNote}` : ""}</p>
        </div>
      </div>
      {r.cancelled ? <p role="alert" className="m-0 text-[15px] text-text">{t.scanCancelled}</p> : floor && <BundleNext bundleId={r.id} floor={floor} t={t} />}
      <Link href={`/lots/bundles/${r.id}`} className="text-[14px] font-medium text-accent-ink no-underline hover:underline">{t.scanOpenBundle}</Link>
    </Surface>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, ScanPage);
