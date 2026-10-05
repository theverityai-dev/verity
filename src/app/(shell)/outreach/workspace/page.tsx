import Link from "next/link";
import { RepReportingActions } from "../OutreachForms";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import { OUTREACH_CAPABILITY, ENTITY_LEAD, ENTITY_DIRECTION } from "@/server/capabilities/outreach";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { EmptyState, PermissionDenied, StateBadge } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

const TERMINAL_STATES = ["not_a_fit", "unresponsive", "lost", "deferred", "disqualified"];

/**
 * "My Workspace" — the Junior Outreach Officer's daily work console
 * (master-context spec §17-19, §101, §107). Deliberately NOT a dashboard:
 * a single-column, checklist-shaped console that answers what do I need to
 * do / who's overdue / what's active — read top to bottom like a daily
 * brief, not scanned like a BI grid (that's Team Command's job).
 *
 * 2026-09-17: the daily check-in and targets surfaces were removed from
 * outreach for every role, so this console no longer reads either.
 */
async function MyWorkspacePage() {
  installCapabilities();
  const actor = await requireActor();

  const data = await withTenant(actor.tenantId, async (tx) => {
    if (!(await hasPermission(tx, actor.roleId, "Read", ENTITY_LEAD))) return null;

    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.userId }, include: { party: true } });
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const canReadDirection = await hasPermission(tx, actor.roleId, "Read", ENTITY_DIRECTION);

    const [myLeads, todaysActivities, states, direction] = await Promise.all([
      tx.outreachLead.findMany({ where: { opportunityOwnerId: user.partyId }, orderBy: { updatedAt: "desc" } }),
      tx.outreachActivity.findMany({
        where: { actorPartyId: user.partyId, occurredAt: { gte: dayStart, lt: dayEnd } },
        orderBy: { occurredAt: "desc" },
        include: { lead: { select: { companyName: true } } },
      }),
      tx.stateDefinition.findMany({ where: { entityKey: ENTITY_LEAD } }),
      canReadDirection ? tx.outreachDirection.findFirst({ orderBy: { postedAt: "desc" } }) : null,
    ]);

    const category = new Map(states.map((s) => [s.key, s.category]));
    const overdue = myLeads.filter(
      (l) => l.nextActionAt != null && l.nextActionAt < new Date() && !TERMINAL_STATES.includes(l.state) && l.state !== "closed_won",
    );
    const active = myLeads.filter((l) => !TERMINAL_STATES.includes(l.state) && l.state !== "closed_won");

    const toItem = (l: (typeof myLeads)[number]) => ({
      id: l.id,
      companyName: l.companyName,
      state: l.state.replace(/_/g, " "),
      category: category.get(l.state) ?? "Draft",
      nextActionNote: l.nextActionNote,
    });

    return {
      firstName: user.party.displayName.split(" ")[0]!,
      leadsToday: myLeads.filter((l) => l.createdAt >= dayStart && l.createdAt < dayEnd).length,
      followUpsToday: todaysActivities.filter((a) => a.activityType === "FollowUp").length,
      overdue: overdue.map(toItem),
      active: active.filter((l) => !overdue.some((o) => o.id === l.id)).map(toItem),
      timeline: todaysActivities.slice(0, 6).map((a) => ({
        id: a.id,
        companyName: a.lead.companyName,
        activityType: a.activityType.replace(/([a-z])([A-Z])/g, "$1 $2"),
        channel: a.channel,
        occurredAt: a.occurredAt,
      })),
      direction: direction
        ? {
            weekLabel: direction.weekLabel,
            priorityVertical: direction.priorityVertical,
            strategicNote: direction.strategicNote,
          }
        : null,
    };
  });

  if (!data) return <PermissionDenied what="viewing your workspace" />;

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="mx-auto max-w-[640px]">
      {/* A greeting, not a page title — this console belongs to one person. */}
      <header className="mb-8">
        <p className="m-0 text-[13px] text-text-tertiary">{today}</p>
        <h1 className="mt-1">Hi, {data.firstName}.</h1>
      </header>

      <RepReportingActions
        leads={[...data.overdue, ...data.active].map((l) => ({ id: l.id, name: l.companyName }))}
      />

      <div className="mb-6 flex gap-8">
        <div>
          <div className="text-[28px] font-bold leading-none text-text">{data.leadsToday}</div>
          <div className="mt-1 text-[12px] text-text-tertiary">Leads today</div>
        </div>
        <div>
          <div className="text-[28px] font-bold leading-none text-text">{data.followUpsToday}</div>
          <div className="mt-1 text-[12px] text-text-tertiary">Follow-ups today</div>
        </div>
        <div>
          <div className={`text-[28px] font-bold leading-none ${data.overdue.length > 0 ? "text-danger" : "text-text"}`}>
            {data.overdue.length}
          </div>
          <div className="mt-1 text-[12px] text-text-tertiary">Overdue</div>
        </div>
      </div>

      {(() => {
        const done = data.leadsToday + data.followUpsToday;
        const remaining = data.overdue.length + data.active.length;
        const total = done + remaining;
        if (total === 0) return null;
        const pct = Math.round((done / total) * 100);
        return (
          <div className="mb-6">
            <div className="mb-1.5 flex items-baseline justify-between text-[12px] text-text-tertiary">
              <span>Today</span>
              <span className="tabular">
                {done} done · {remaining} to go
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${Math.max(pct, done > 0 ? 3 : 0)}%` }}
              />
            </div>
          </div>
        );
      })()}

      {data.direction && (
        <div className="mb-8 rounded-lg border border-line bg-surface-sunken px-4 py-3">
          <p className="m-0 text-[11px] uppercase tracking-wide text-text-tertiary">
            This week's direction · {data.direction.weekLabel}
          </p>
          <p className="mb-0 mt-1 text-[13px] text-text">
            {data.direction.priorityVertical && (
              <span className="font-medium">{data.direction.priorityVertical}</span>
            )}
            {data.direction.priorityVertical && data.direction.strategicNote && " — "}
            {data.direction.strategicNote}
          </p>
        </div>
      )}

      <h2 className="mb-3 text-[15px] font-semibold text-text">What do I need to do</h2>
      {data.overdue.length === 0 && data.active.length === 0 ? (
        data.leadsToday + data.followUpsToday > 0 ? (
          <EmptyState
            title="All caught up"
            description="Nothing left in your queue for today. Nice work."
          />
        ) : (
          <EmptyState
            title="Nothing on your list"
            description="Research a prospect and add it from Prospects."
            action={<Link href="/outreach/prospects" className="text-[13px] text-accent-ink no-underline hover:underline">Go to Prospects</Link>}
          />
        )
      ) : (
        <ol className="m-0 mb-8 flex list-none flex-col gap-1 p-0">
          {[...data.overdue, ...data.active].slice(0, 10).map((l) => (
            <li key={l.id}>
              <Link
                href={`/outreach/${l.id}`}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-text no-underline hover:bg-surface-sunken"
              >
                <span
                  aria-hidden="true"
                  className={`size-[9px] shrink-0 rounded-full border ${
                    data.overdue.some((o) => o.id === l.id) ? "border-danger bg-danger" : "border-line-strong bg-transparent"
                  }`}
                />
                <span className="flex-1 truncate text-[14px]">{l.companyName}</span>
                {l.nextActionNote && <span className="hidden truncate text-[12px] text-text-tertiary sm:inline">{l.nextActionNote}</span>}
                <StateBadge category={l.category} label={l.state} />
              </Link>
            </li>
          ))}
        </ol>
      )}

      {data.timeline.length > 0 && (
        <>
          <h2 className="mb-3 text-[15px] font-semibold text-text">Logged today</h2>
          <ol className="m-0 mb-8 flex list-none flex-col gap-1 p-0">
            {data.timeline.map((a) => (
              <li key={a.id} className="flex items-baseline gap-3 rounded-lg px-3 py-2 text-[13px]">
                <span className="tabular w-14 shrink-0 text-[11px] text-text-tertiary">
                  {a.occurredAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                </span>
                <span className="flex-1 truncate text-text-secondary">
                  <span className="text-text">{a.activityType}</span> · {a.channel} — {a.companyName}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

export default withCapabilityPageAccess(OUTREACH_CAPABILITY, MyWorkspacePage);
