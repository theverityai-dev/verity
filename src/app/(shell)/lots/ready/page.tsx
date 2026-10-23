import Link from "next/link";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_LOT, PIECEWORK_CAPABILITY, readyGarments } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { Cover } from "@/components/ui/Cover";
import { EmptyState, PageHeader, PermissionDenied, Surface } from "@/components/ui/primitives";
import { ProgressBar } from "@/components/ui/viz";
import { shortDate } from "../format";

export const dynamic = "force-dynamic";

/**
 * Ready garments: pieces that have finished the last stage, by lot. The system ends here (dispatch is not part of it), so this is the
 * answer to "what can go out?": a card per lot with its picture, how much of the plan is ready, since when, and the bundles it sits in.
 */
async function ReadyPage() {
  installCapabilities();
  const actor = await requireActor();
  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_LOT));
  if (!allowed) return <PermissionDenied what="ready garments" />;
  const lots = await executeQuery(actor, readyGarments, {});
  const total = lots.reduce((s, l) => s + l.readyPieces, 0);

  return (
    <>
      <PageHeader title="Ready garments" description={lots.length === 0 ? "Nothing has finished the last stage yet." : `${total.toLocaleString("en-IN")} pieces ready across ${lots.length} lot${lots.length === 1 ? "" : "s"}`} />
      {lots.length === 0 ? (
        <EmptyState title="Nothing is ready yet" description="Pieces appear here when the last stage takes them back as good." />
      ) : (
        <ul className="m-0 grid list-none gap-4 p-0" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))" }}>
          {lots.map((l) => (
            <li key={l.lotId} className="list-none">
              <Surface className="relative flex h-full flex-col gap-4 p-5 transition-[transform] duration-150 active:scale-[0.99]">
                <div className="flex items-center gap-3.5">
                  <Cover src={l.cover} label={l.number} size={64} rounded={14} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/lots/${l.lotId}`} className="block truncate text-[17px] font-semibold text-text no-underline after:absolute after:inset-0 after:content-['']">{l.number} · {l.name}</Link>
                    <p className="m-0 text-[13px] text-text-secondary">{l.readySince ? `Ready since ${shortDate(l.readySince)}` : "Ready"}</p>
                  </div>
                </div>
                <p className="figure m-0 text-[40px] text-text">{l.readyPieces.toLocaleString("en-IN")}<span className="ml-2 text-[14px] font-normal text-text-secondary">of {l.plannedPieces.toLocaleString("en-IN")} planned</span></p>
                <ProgressBar label={`${l.number} ready against planned`} value={Math.min(l.readyPieces, l.plannedPieces)} total={Math.max(l.plannedPieces, 1)} tone="completed" showFigures={false} />
                <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                  {l.bundles.slice(0, 8).map((b) => (
                    <li key={b.id} className="list-none"><Link href={`/lots/bundles/${b.id}`} className="relative z-10 inline-flex min-h-8 items-center rounded-full bg-[var(--color-control)] px-3 text-[12px] font-medium text-text no-underline hover:underline">{b.number} · {b.ready}{b.sizeNote ? ` ${b.sizeNote}` : ""}</Link></li>
                  ))}
                  {l.bundles.length > 8 && <li className="list-none text-[12px] text-text-secondary">+{l.bundles.length - 8} more</li>}
                </ul>
              </Surface>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, ReadyPage);
