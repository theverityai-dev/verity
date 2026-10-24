import Link from "next/link";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_SETTING, HISTORY_GROUPS, PIECEWORK_CAPABILITY, pieceworkHistory, type HistoryGroup } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { EmptyState, PageHeader, PermissionDenied, Row, RowList, Surface } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

const GROUP_LABEL: Record<HistoryGroup, string> = { work: "Work", fabric: "Fabric", money: "Money", lots: "Lots", settings: "Settings" };

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
const dayHead = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Change history: everything anyone did in production, newest first, with who and when. Nothing here can be edited or removed: it is
 * the platform's own log of commands, and a wrong posting is corrected by a reversal that appears here as its own line. Filtered by
 * kind of work; each line opens the record it was about.
 */
async function AuditPage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  installCapabilities();
  const actor = await requireActor();
  const q = await searchParams;
  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_SETTING));
  if (!allowed) return <PermissionDenied what="the change history" />;
  const group = (HISTORY_GROUPS as readonly string[]).includes(q.group ?? "") ? (q.group as HistoryGroup) : undefined;
  const h = await executeQuery(actor, pieceworkHistory, { group });

  const byDay = new Map<string, typeof h.rows>();
  for (const r of h.rows) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r]);
  const total = HISTORY_GROUPS.reduce((s, g) => s + h.counts[g], 0);

  return (
    <>
      <PageHeader title="Change history" description="Who did what, and when. Nothing here can be edited; a mistake is corrected by a reversal, which shows as its own line." />
      <nav aria-label="Kind of change" className="mb-6 flex flex-wrap gap-1.5">
        {([[undefined, "Everything", total], ...HISTORY_GROUPS.map((g) => [g, GROUP_LABEL[g], h.counts[g]] as const)] as const).map(([g, label, n]) => (
          <Link key={label} href={g ? `/lots/audit?group=${g}` : "/lots/audit"} aria-current={group === g ? "page" : undefined}
            className={`inline-flex min-h-11 items-center gap-2 rounded-[12px] px-4 text-[15px] font-medium no-underline transition-[background-color,transform] duration-150 active:scale-[0.98] ${group === g ? "bg-accent text-accent-on" : "bg-[var(--color-control)] text-text-secondary hover:text-text"}`}>
            {label}<span className="text-[13px] opacity-75">{n}</span>
          </Link>
        ))}
      </nav>

      {h.rows.length === 0 ? (
        <EmptyState title="Nothing recorded yet" description="Every command anyone runs in production appears here with their name." />
      ) : (
        <div className="flex flex-col gap-6">
          {[...byDay].map(([day, rows]) => (
            <section key={day} aria-label={dayHead(day)}>
              <h2 className="micro m-0 mb-2 px-1">{dayHead(day)}</h2>
              <Surface className="p-0">
                <RowList>
                  {rows.map((r) => (
                    <Row key={r.id}>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-[15px] font-medium text-text">{r.what}</span>
                        {r.subject && (r.href ? <Link href={r.href} className="truncate text-[14px] text-accent-ink no-underline hover:underline">{r.subject}</Link> : <span className="truncate text-[14px] text-text-secondary">{r.subject}</span>)}
                      </div>
                      <span className="shrink-0 text-right text-[13px] leading-[18px] text-text-secondary">{r.by}<br />{time(r.at)}</span>
                    </Row>
                  ))}
                </RowList>
              </Surface>
            </section>
          ))}
          {h.truncated && <p className="m-0 px-1 text-[13px] text-text-tertiary">Showing the latest {h.rows.length}. Choose a kind above to narrow it.</p>}
        </div>
      )}
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, AuditPage);
