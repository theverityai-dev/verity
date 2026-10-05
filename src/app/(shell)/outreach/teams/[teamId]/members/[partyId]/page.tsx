import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { hasPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_DIRECTION, ENTITY_LEAD, OUTREACH_CAPABILITY } from "@/server/capabilities/outreach";
import { withTenant } from "@/server/platform/tenancy";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { Badge, EmptyState, PageHeader, PermissionDenied, SectionHeading, Stat, StatRow, StateBadge } from "@/components/ui/primitives";
import { CoachingNotePanel } from "../../../../team/CoachingNotePanel";

export const dynamic = "force-dynamic";
const TERMINAL = ["not_a_fit", "unresponsive", "lost", "deferred", "disqualified", "closed_won"];
const HEATMAP_DAYS = 14;

/** A member's operational record, not an HR profile: progress, activity
 * heatmap, reports, coaching timeline, and assigned work with explicit
 * periods (Task 116 §8.4's member-detail bullet). */
async function MemberPage({ params }: { params: Promise<{ teamId: string; partyId: string }> }) {
  installCapabilities();
  const actor = await requireActor();
  const { teamId, partyId } = await params;
  const data = await withTenant(actor.tenantId, async (tx) => {
    if (!(await hasPermission(tx, actor.roleId, "Read", ENTITY_LEAD))) return null;
    const [user, team, core] = await Promise.all([tx.user.findUniqueOrThrow({ where: { id: actor.userId } }), tx.outreachTeam.findUnique({ where: { id: teamId }, include: { memberships: { where: { active: true } } } }), hasPermission(tx, actor.roleId, "Create", ENTITY_DIRECTION)]);
    if (!team || !team.active) return { missing: true as const };
    const memberIds = new Set([team.leaderId, ...(team.coLeaderId ? [team.coLeaderId] : []), ...team.memberships.map((m) => m.partyId)]);
    if (!memberIds.has(partyId)) return { missing: true as const };
    const isLeaderViewer = user.partyId === team.leaderId || user.partyId === team.coLeaderId;
    if (!core && !memberIds.has(user.partyId)) return { denied: true as const };

    const heatmapStart = new Date();
    heatmapStart.setHours(0, 0, 0, 0);
    heatmapStart.setDate(heatmapStart.getDate() - (HEATMAP_DAYS - 1));

    const [person, leads, states, activities, checkIns, reviews] = await Promise.all([
      tx.party.findUnique({ where: { id: partyId } }),
      tx.outreachLead.findMany({ where: { teamId, opportunityOwnerId: partyId }, orderBy: { updatedAt: "desc" } }),
      tx.stateDefinition.findMany({ where: { entityKey: ENTITY_LEAD } }),
      tx.outreachActivity.findMany({ where: { actorPartyId: partyId, occurredAt: { gte: heatmapStart } }, select: { occurredAt: true } }),
      tx.outreachCheckIn.findMany({ where: { partyId, checkInDate: { gte: heatmapStart } }, orderBy: { checkInDate: "desc" } }),
      tx.outreachCheckInReview.findMany({ where: { checkIn: { partyId, checkInDate: { gte: heatmapStart } } }, orderBy: { reviewedAt: "desc" } }),
    ]);
    if (!person) return { missing: true as const };
    const category = new Map(states.map((state) => [state.key, state.category]));
    const now = new Date();

    // One cell per day, oldest first — count of activity rows that day.
    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
    const counts = new Map<string, number>();
    for (const a of activities) counts.set(dayKey(a.occurredAt), (counts.get(dayKey(a.occurredAt)) ?? 0) + 1);
    const heatmap = Array.from({ length: HEATMAP_DAYS }, (_, i) => {
      const d = new Date(heatmapStart);
      d.setDate(d.getDate() + i);
      return { date: dayKey(d), count: counts.get(dayKey(d)) ?? 0 };
    });

    const latestReviewByCheckIn = new Map<string, (typeof reviews)[number]>();
    for (const r of reviews) if (!latestReviewByCheckIn.has(r.checkInId)) latestReviewByCheckIn.set(r.checkInId, r);
    const reports = checkIns.map((c) => ({
      id: c.id,
      date: c.checkInDate.toISOString().slice(0, 10),
      summary: c.summary,
      needsAttention: c.needsAttention,
      reviewStatus: latestReviewByCheckIn.get(c.id)?.reviewStatus ?? null,
    }));

    const openLeads = leads.filter((lead) => !TERMINAL.includes(lead.state));
    const mapped = leads.map((lead) => ({ id: lead.id, company: lead.companyName, state: lead.state.replace(/_/g, " "), category: category.get(lead.state) ?? "Draft", next: lead.nextActionNote, nextAt: lead.nextActionAt, overdue: !!(lead.nextActionAt && lead.nextActionAt < now && !TERMINAL.includes(lead.state)) }));
    const weekOut = new Date(now);
    weekOut.setDate(weekOut.getDate() + 7);
    const periods = {
      overdue: mapped.filter((l) => l.overdue),
      dueSoon: mapped.filter((l) => !l.overdue && l.nextAt && l.nextAt <= weekOut && openLeads.some((o) => o.id === l.id)),
      noNextAction: mapped.filter((l) => !l.nextAt && openLeads.some((o) => o.id === l.id)),
      onTrack: mapped.filter((l) => !l.overdue && l.nextAt && l.nextAt > weekOut && openLeads.some((o) => o.id === l.id)),
      closed: mapped.filter((l) => !openLeads.some((o) => o.id === l.id)),
    };

    return {
      team, person, isLeaderViewer: core || isLeaderViewer,
      active: openLeads.length,
      overdue: periods.overdue.length,
      heatmap, reports, periods,
    };
  });
  if (!data) return <PermissionDenied what="viewing this member" />;
  if ("missing" in data) notFound();
  if ("denied" in data) return <PermissionDenied what="viewing this member" />;

  const maxCount = Math.max(1, ...data.heatmap.map((d) => d.count));
  const cell = (n: number) => (n === 0 ? "bg-surface-sunken" : n / maxCount > 0.66 ? "bg-accent" : n / maxCount > 0.33 ? "bg-accent/60" : "bg-accent/30");

  const groups: Array<{ label: string; leads: typeof data.periods.overdue; tone?: "danger" }> = [
    { label: "Overdue", leads: data.periods.overdue, tone: "danger" },
    { label: "Due this week", leads: data.periods.dueSoon },
    { label: "No next action set", leads: data.periods.noNextAction },
    { label: "On track", leads: data.periods.onTrack },
    { label: "Closed", leads: data.periods.closed },
  ];

  return (
    <>
      <PageHeader
        title={data.person.displayName}
        description={`${data.active} active prospect${data.active === 1 ? "" : "s"} in ${data.team.name}.`}
        actions={<Link href={`/outreach/teams/${data.team.id}`} className="text-[13px] text-accent-ink no-underline hover:underline">Back to team</Link>}
      />

      <StatRow cols={3} className="mb-6">
        <Stat label="Active prospects" value={data.active} />
        <Stat label="Overdue follow-ups" value={data.overdue} hint={data.overdue ? "Needs attention" : undefined} />
        <Stat label="Activity, last 14 days" value={data.heatmap.reduce((sum, d) => sum + d.count, 0)} />
      </StatRow>

      <div className="mb-6">
        <SectionHeading>Activity, last {HEATMAP_DAYS} days</SectionHeading>
        <div className="flex items-end gap-1.5">
          {data.heatmap.map((d) => (
            <div key={d.date} className="flex flex-col items-center gap-1" title={`${d.date}: ${d.count} activit${d.count === 1 ? "y" : "ies"}`}>
              <span className={`h-6 w-6 rounded-[6px] ${cell(d.count)}`} />
              <span className="text-[10px] text-text-tertiary">{d.date.slice(8)}</span>
            </div>
          ))}
        </div>
      </div>

      {data.isLeaderViewer && (
        <div className="mb-6">
          <SectionHeading>Coaching</SectionHeading>
          <CoachingNotePanel teamId={data.team.id} aboutPartyId={data.person.id} aboutName={data.person.displayName} />
        </div>
      )}

      <div className="mb-6">
        <SectionHeading note={`${data.reports.length} in last ${HEATMAP_DAYS} days`}>Daily reports</SectionHeading>
        {data.reports.length === 0 ? (
          <EmptyState title="No reports yet" description="No daily check-ins submitted in this window." />
        ) : (
          <div className="bg-control overflow-hidden rounded-[12px]">
            {data.reports.map((r) => (
              <div key={r.id} className="flex items-start gap-4 border-b border-line px-5 py-4 last:border-none">
                <span className="w-24 shrink-0 text-[12px] text-text-tertiary">{r.date}</span>
                <span className="min-w-0 flex-1">
                  <p className="m-0 truncate text-[13px] text-text-secondary">{r.summary}</p>
                  {r.needsAttention && <p className="m-0 mt-1 text-[12px] text-danger">Flagged: {r.needsAttention}</p>}
                </span>
                <Badge tone={r.reviewStatus === "Reviewed" ? "accent" : "neutral"}>{r.reviewStatus ?? "Awaiting review"}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <SectionHeading>Assigned work</SectionHeading>
        {data.active === 0 && data.periods.closed.length === 0 ? (
          <EmptyState title="No assigned prospects" description="This member has no prospect work assigned yet." />
        ) : (
          groups.map((group) =>
            group.leads.length === 0 ? null : (
              <div key={group.label} className="mb-4">
                <p className={`m-0 mb-2 text-[13px] uppercase tracking-[0.02em] ${group.tone === "danger" ? "text-danger" : "text-text-secondary"}`}>
                  {group.label} ({group.leads.length})
                </p>
                <div className="bg-control overflow-hidden rounded-[12px]">
                  {group.leads.map((lead) => (
                    <Link key={lead.id} href={`/outreach/${lead.id}`} className="flex items-center gap-4 border-b border-line px-5 py-4 text-text no-underline transition last:border-none hover:bg-surface-sunken">
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-[14px] font-medium">{lead.company}</strong>
                        <small className={lead.overdue ? "text-danger" : "text-text-tertiary"}>{lead.next ?? "No next action set"}</small>
                      </span>
                      <StateBadge category={lead.category} label={lead.state} />
                    </Link>
                  ))}
                </div>
              </div>
            ),
          )
        )}
      </div>
    </>
  );
}
export default withCapabilityPageAccess(OUTREACH_CAPABILITY, MemberPage);
