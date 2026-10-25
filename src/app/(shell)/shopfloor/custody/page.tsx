import Link from "next/link";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_ENTRY, PIECEWORK_CAPABILITY, custodyBoard } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState, PageHeader, PermissionDenied, Surface } from "@/components/ui/primitives";
import { shortDate } from "../../lots/format";

export const dynamic = "force-dynamic";

/**
 * Who holds what, right now. One card per supervisor (the karigars set under them, then everyone not yet under anyone), each karigar's open
 * bundles with how long they have been out and which are late. The question it answers: if a count is wrong tomorrow, whose hands were the
 * pieces in? No rate, wage or balance appears here.
 */
async function CustodyPage() {
  installCapabilities();
  const actor = await requireActor();
  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_ENTRY));
  if (!allowed) return <PermissionDenied what="who holds what" />;
  const { groups } = await executeQuery(actor, custodyBoard, {});
  const total = groups.reduce((s, g) => s + g.held, 0);
  const late = groups.reduce((s, g) => s + g.late, 0);

  return (
    <>
      <PageHeader
        title="Who holds what"
        description={groups.length === 0 ? "Nothing is out with anyone." : `${total} pieces are out with ${groups.reduce((s, g) => s + g.karigars.length, 0)} karigars${late > 0 ? `, ${late} bundle${late === 1 ? "" : "s"} late` : ""}.`}
      />

      {groups.length === 0 ? (
        <EmptyState title="All pieces are in" description="When a bundle is given out it appears here under the karigar and the supervisor who looks after them." />
      ) : (
        <ul className="m-0 grid list-none gap-4 p-0" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))" }}>
          {groups.map((g) => (
            <li key={g.supervisorUserId ?? "none"} className="list-none">
              <Surface className="flex h-full flex-col gap-4 p-5">
                <div className="flex items-start gap-3.5">
                  <Avatar name={g.supervisorName} size={44} />
                  <div className="min-w-0 flex-1">
                    <h2 className="m-0 truncate text-[17px] font-medium leading-[22px] tracking-[-0.02em] text-text">{g.supervisorName}</h2>
                    <p className="m-0 text-[13px] leading-[18px] text-text-secondary">{g.karigars.length} karigar{g.karigars.length === 1 ? "" : "s"}{g.supervisorUserId === null ? ", open to any supervisor" : ""}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="figure tabular m-0 text-[26px] leading-[28px] text-text">{g.held}</p>
                    <p className="m-0 text-[12px] leading-[16px]" style={g.late > 0 ? { color: "var(--color-state-blocked-ink)" } : undefined}>{g.late > 0 ? `${g.late} late` : "pieces out"}</p>
                  </div>
                </div>

                <ul className="m-0 flex list-none flex-col divide-y divide-[var(--color-line)] p-0">
                  {g.karigars.map((k) => (
                    <li key={k.workerId} className="list-none py-3 first:pt-0 last:pb-0">
                      <div className="mb-2 flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-[15px] font-medium text-text">{k.name}</span>
                        <span className="tabular shrink-0 text-[13px] text-text-secondary">{k.held} {k.held === 1 ? "pc" : "pcs"} · {k.oldestDays === 0 ? "today" : `${k.oldestDays} day${k.oldestDays === 1 ? "" : "s"}`}</span>
                      </div>
                      <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                        {k.bundles.map((b) => (
                          <li key={b.issueId} className="list-none">
                            <Link
                              href={`/lots/bundles/${b.bundleId}`}
                              className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-[var(--color-control)] px-3 text-[13px] text-text no-underline transition-colors hover:bg-[var(--color-control-strong)] active:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                              title={`${b.lotNumber} · ${b.stageLabel}${b.dueDate ? ` · due ${shortDate(b.dueDate)}` : ""}`}
                            >
                              <span className="font-medium">{b.bundleNumber}</span>
                              <span className="tabular text-text-secondary">{b.open}</span>
                              <span className="text-text-secondary">{b.stageLabel}</span>
                              {b.isRework && <span className="text-text-secondary">· rework</span>}
                              {b.late && <span className="font-medium" style={{ color: "var(--color-state-blocked-ink)" }}>· late</span>}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </Surface>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, CustodyPage);
