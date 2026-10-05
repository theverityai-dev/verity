import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import { OUTREACH_CAPABILITY, ENTITY_LEAD, listTeamDailyWorkStatus } from "@/server/capabilities/outreach";
import { executeQuery } from "@/server/platform/query";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { DataTable } from "@/components/ui/DataTable";
import { Badge, EmptyState, PageHeader, Panel, PermissionDenied, Stat, StatRow } from "@/components/ui/primitives";
import { RemoveMemberButton } from "./RemoveMemberButton";
import { AddMemberForm } from "./AddMemberForm";
import { RenameTeamForm } from "./RenameTeamForm";
import { ResolveEscalationButton } from "../ResolveEscalationButton";
import { TeamLeadActions } from "../OutreachForms";
import { LeadQueuePanel } from "./LeadQueuePanel";
import { TeamOpsPanels } from "./TeamOpsPanels";
import { runQuery } from "@/server/actions/platform";
import { CoachingNotePanel } from "./CoachingNotePanel";

export const dynamic = "force-dynamic";

const TERMINAL_STATES = ["not_a_fit", "unresponsive", "lost", "deferred", "disqualified"];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]![0] : "")).toUpperCase();
}

/**
 * "Team Command" — the Senior Outreach Officer's cockpit (master-context
 * spec §13-16, §102, §106). Shows exactly this Senior's own led team(s) —
 * never another team's, per taskplan 105's Phase 3 fix — target, people,
 * pipeline, exceptions.
 */
async function TeamCommandPage() {
  installCapabilities();
  const actor = await requireActor();

  const data = await withTenant(actor.tenantId, async (tx) => {
    if (!(await hasPermission(tx, actor.roleId, "Read", ENTITY_LEAD))) return null;

    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.userId } });
    const ledTeams = await tx.outreachTeam.findMany({
      where: { OR: [{ leaderId: user.partyId }, { coLeaderId: user.partyId }], active: true },
      include: { memberships: { where: { active: true } } },
    });
    const memberTeams = ledTeams.length > 0 ? [] : await tx.outreachTeam.findMany({
      where: { active: true, memberships: { some: { partyId: user.partyId, active: true } } },
      include: { memberships: { where: { active: true } } },
    });
    const visibleTeams = ledTeams.length > 0 ? ledTeams : memberTeams;
    if (visibleTeams.length === 0) return { noTeam: true as const };

    // Senior leads exactly one team in this roster; if a future tenant gives
    // one Senior multiple teams, this takes the first — a picker is a real
    // gap, not silently handled.
    const team = visibleTeams[0]!;
    const canManage = ledTeams.some((led) => led.id === team.id);
    const memberPartyIds = [...new Set([team.leaderId, ...(team.coLeaderId ? [team.coLeaderId] : []), ...team.memberships.map((m) => m.partyId)])];
    const [members, leads, states] = await Promise.all([
      tx.party.findMany({ where: { id: { in: memberPartyIds } } }),
      tx.outreachLead.findMany({ where: { teamId: team.id } }),
      tx.stateDefinition.findMany({ where: { entityKey: ENTITY_LEAD } }),
    ]);
    const memberName = new Map(members.map((p) => [p.id, p.displayName]));
    const category = new Map(states.map((s) => [s.key, s.category]));

    const activities = await tx.outreachActivity.findMany({
      where: { actorPartyId: { in: memberPartyIds } },
    });

    const memberRows = memberPartyIds.map((partyId) => {
      const ownedLeads = leads.filter((l) => l.opportunityOwnerId === partyId);
      const acts = activities.filter((a) => a.actorPartyId === partyId);
      return {
        id: partyId,
        name: memberName.get(partyId) ?? "Unknown",
        leads: ownedLeads.length,
        outreach: acts.filter((a) => a.activityType === "FirstOutreach").length,
        closed: ownedLeads.filter((l) => l.state === "closed_won").length,
        overdue: ownedLeads.filter(
          (l) => l.nextActionAt != null && l.nextActionAt < new Date() && !TERMINAL_STATES.includes(l.state) && l.state !== "closed_won",
        ).length,
      };
    });

    const overdueLeads = leads.filter(
      (l) => l.nextActionAt != null && l.nextActionAt < new Date() && !TERMINAL_STATES.includes(l.state) && l.state !== "closed_won",
    );

    // Roster management: who could be added — reachable in the tenant,
    // not already on an active roster anywhere (never a pool for creating
    // new logins — see the query's own doc comment).
    const [takenMemberships, takenLeaders, allMemberships] = await Promise.all([
      tx.outreachTeamMembership.findMany({ where: { active: true }, select: { partyId: true } }),
      tx.outreachTeam.findMany({ where: { active: true }, select: { leaderId: true, coLeaderId: true } }),
      tx.tenantMembership.findMany({ include: { user: { include: { party: true } } } }),
    ]);
    const taken = new Set([
      ...takenMemberships.map((m) => m.partyId),
      ...takenLeaders.map((l) => l.leaderId),
      ...takenLeaders.flatMap((l) => (l.coLeaderId ? [l.coLeaderId] : [])),
    ]);
    const seen = new Set<string>();
    const availableParties: Array<{ id: string; name: string }> = [];
    for (const m of allMemberships) {
      const party = m.user.party;
      if (taken.has(party.id) || seen.has(party.id)) continue;
      seen.add(party.id);
      availableParties.push({ id: party.id, name: party.displayName });
    }
    availableParties.sort((a, b) => a.name.localeCompare(b.name));

    // Escalations reach the Team Leader first (2026-09-13 hierarchical-
    // architecture doc §38-39: Junior -> Senior -> Core), not Core
    // directly — this team's own leads already carry the escalation
    // fields, no separate query needed.
    const escalations = leads
      .filter((l) => l.escalated)
      .map((l) => ({
        id: l.id,
        companyName: l.companyName,
        note: l.escalationNote,
        type: l.escalationType,
        urgency: l.escalationUrgency,
        by: l.escalatedById ? memberName.get(l.escalatedById) ?? "Unknown" : "Unknown",
      }));

    return {
      noTeam: false as const,
      teamId: team.id,
      teamName: team.name,
      canManage,
      availableParties,
      memberCount: memberPartyIds.length,
      activeLeads: leads.filter((l) => !TERMINAL_STATES.includes(l.state) && l.state !== "closed_won").length,
      closedWon: leads.filter((l) => l.state === "closed_won").length,
      overdue: overdueLeads.map((l) => ({
        id: l.id,
        companyName: l.companyName,
        state: l.state.replace(/_/g, " "),
        category: category.get(l.state) ?? "Draft",
      })),
      memberRows,
      escalations,
    };
  });

  if (!data) return <PermissionDenied what="viewing team command" />;
  if (data.noTeam) {
    return (
      <>
        <PageHeader title="My Team" description="Your outreach team, roster, and work visibility." />
        <EmptyState title="You are not assigned to a team" description="Ask a team lead or Core administrator to add you before beginning prospect work." />
      </>
    );
  }

  const dailyWork = await executeQuery(actor, listTeamDailyWorkStatus, {
    teamId: data.teamId,
    date: new Date().toISOString(),
  });

  const weekOf = new Date().toLocaleDateString(undefined, { month: "long", day: "numeric" });

  // A lead's operating lists, each through the capability's own query so its
  // team-scope rule applies. Loaded only for someone who manages the team.
  type Rec = Record<string, unknown>;
  const memberName = new Map(data.memberRows.map((m) => [m.id, m.name]));
  const ops = data.canManage
    ? await Promise.all([
        runQuery<Rec[]>("verity.outreach.list_team_check_ins", { teamId: data.teamId, date: new Date().toISOString() }),
        runQuery<Rec[]>("verity.outreach.list_assignments", { teamId: data.teamId }),
        runQuery<Rec[]>("verity.outreach.list_targets", { teamId: data.teamId }),
        runQuery<Rec[]>("verity.outreach.list_escalations", { teamId: data.teamId }),
      ])
    : null;
  const rows = (result: { ok: boolean; data?: Rec[] } | undefined) => (result && result.ok && result.data ? result.data : []);
  const nameOf = (id: unknown) => (typeof id === "string" ? memberName.get(id) ?? "Unknown" : "Team");
  const day = (value: unknown) => (value ? new Date(String(value)).toISOString().slice(0, 10) : "");

  return (
    <>
      {/* Cockpit framing: team name is the identity, week is the operating
          window — a manager's console reads as "right now, my team," not a
          generic page title (contrast Company Core's "Outreach" masthead). */}
      <header className="mb-6">
        <p className="m-0 text-[12px] uppercase tracking-wide text-text-tertiary">Week of {weekOf}</p>
        <h1 className="mt-1">{data.teamName}</h1>
        <p className="mb-0 mt-2 max-w-[62ch] text-[14px] text-text-secondary">
          Is my team executing the company direction effectively?
        </p>
        {data.canManage && <div className="mt-3">
          <RenameTeamForm teamId={data.teamId} currentName={data.teamName} />
          <div className="mt-3">
            <TeamLeadActions teamId={data.teamId} members={data.memberRows.map((m) => ({ id: m.id, name: m.name }))} />
          </div>
        </div>}
      </header>

      <StatRow cols={4} className="mb-6">
        <Stat label="Members" value={data.memberCount} />
        <Stat label="Active leads" value={data.activeLeads} />
        <Stat label="Closed Won" value={data.closedWon} />
        <Stat label="Overdue" value={data.overdue.length} hint={data.overdue.length > 0 ? "Needs attention" : undefined} />
      </StatRow>

      <div className="mb-6">
        <Panel title="Today's work" flush>
          <div className="flex flex-col divide-y divide-line px-6">
            {dailyWork.map((member) => {
              const status = {
                Worked: { label: "Worked", className: "text-success" },
                ActivityOnly: { label: "Activity, no check-in", className: "text-warning" },
                CheckInOnly: { label: "Check-in, no activity", className: "text-warning" },
                NotStarted: { label: "No work recorded", className: "text-danger" },
              }[member.status];
              return (
                <div key={member.partyId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-[13px]">
                  <span className="min-w-40 flex-1 font-medium text-text">{member.name}</span>
                  <span className={`font-medium ${status.className}`}>{status.label}</span>
                  <span className="text-text-tertiary">
                    {member.metrics.activities} {member.metrics.activities === 1 ? "activity" : "activities"}
                    {member.metrics.leadsGenerated > 0 ? ` · ${member.metrics.leadsGenerated} lead${member.metrics.leadsGenerated === 1 ? "" : "s"}` : ""}
                  </span>
                  {member.reviewStatus && <Badge>{member.reviewStatus}</Badge>}
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      {data.escalations.length > 0 && (
        <div className="mb-6 rounded-xl border border-danger/25 bg-danger-subtle">
          <Panel title="Escalations" flush className="border-none bg-transparent">
            <div className="flex flex-col divide-y divide-line px-6">
              {data.escalations.map((e) => (
                <div key={e.id} className="flex items-center gap-4 py-3">
                  <span className="flex flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-2 text-[14px] text-text">
                      {e.companyName}
                      {e.type && <span className="text-[11px] text-text-tertiary">· {e.type.replace(/([A-Z])/g, " $1").trim()}</span>}
                      {e.urgency === "Critical" && <span className="text-[11px] font-medium text-danger">Critical</span>}
                      {e.urgency === "High" && <span className="text-[11px] font-medium text-warning">High</span>}
                    </span>
                    {e.note && <span className="text-[12px] text-text-secondary">{e.note}</span>}
                    <span className="text-[11px] text-text-tertiary">Flagged by {e.by}</span>
                  </span>
                  <ResolveEscalationButton leadId={e.id} />
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      <div className="mb-6">
        <LeadQueuePanel teamId={data.teamId} />
        {ops && (
          <TeamOpsPanels
            checkIns={rows(ops[0]).map((c) => {
              const review = c.currentReview as { reviewStatus?: string } | null;
              return {
                id: String(c.id),
                member: nameOf(c.partyId),
                summary: String(c.summary ?? ""),
                blocker: String(c.blocker ?? ""),
                review: review?.reviewStatus === "NeedsClarification" ? "Needs clarification" : review?.reviewStatus ?? "Not reviewed",
              };
            })}
            assignments={rows(ops[1])
              .filter((a) => a.active !== false)
              .map((a) => ({ id: String(a.id), member: nameOf(a.partyId), kind: String(a.scope), value: String(a.value) }))}
            targets={rows(ops[2]).map((t) => ({
              id: String(t.id),
              who: t.partyId ? nameOf(t.partyId) : "Whole team",
              metric: String(t.metric).replace(/([a-z])([A-Z])/g, "$1 $2"),
              target: String(t.targetValue),
              period: `${String(t.period)} · ${day(t.periodStart)} – ${day(t.periodEnd)}`,
            }))}
            escalations={rows(ops[3]).map((e) => ({
              id: String(e.id),
              company: String((e.lead as { companyName?: string } | undefined)?.companyName ?? "Lead"),
              note: String(e.note ?? ""),
              status: e.status === "InReview" ? "In review" : String(e.status),
            }))}
          />
        )}
      </div>

      <div className="mb-6">
        <Panel title="Team members" flush action={data.canManage ? <AddMemberForm teamId={data.teamId} candidates={data.availableParties} /> : undefined}>
          <div className="flex flex-col divide-y divide-line px-6">
            <div className="flex items-center gap-4 py-2 text-[11px] uppercase tracking-wide text-text-tertiary">
              <span className="w-8" />
              <span className="flex-1">Member</span>
              <span className="w-16 text-right">Leads</span>
              <span className="w-20 text-right">Outreach</span>
              <span className="w-16 text-right">Closed</span>
              <span className="w-16 text-right">Overdue</span>
              <span className="w-8" />
            </div>
            {data.memberRows.map((m) => (
              <div key={m.id} className="py-2.5">
                <div className="flex items-center gap-4">
                  {/* A cockpit reads people, not just rows — an initials badge
                      (never used on Founder's aggregate team table) keeps this
                      screen about the individuals a Senior manages. Overdue
                      still carries its own signal below via color, not a
                      second dot competing with the badge. */}
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-[11px] font-medium text-accent-ink"
                  >
                    {initials(m.name)}
                  </span>
                  <a href={`/outreach/teams/${data.teamId}/members/${m.id}`} className="flex-1 text-[14px] text-text no-underline hover:underline">{m.name}</a>
                  <span className="tabular w-16 text-right text-[13px] text-text-secondary">{m.leads}</span>
                  <span className="tabular w-20 text-right text-[13px] text-text-secondary">{m.outreach}</span>
                  <span className="tabular w-16 text-right text-[13px] text-text-secondary">{m.closed}</span>
                  <span className={`tabular w-16 text-right text-[13px] ${m.overdue > 0 ? "font-medium text-danger" : "text-text-secondary"}`}>
                    {m.overdue}
                  </span>
                  <span className="w-8 text-right">{data.canManage && <RemoveMemberButton teamId={data.teamId} partyId={m.id} name={m.name} />}</span>
                </div>
                {data.canManage && <div className="pl-12">
                  <CoachingNotePanel teamId={data.teamId} aboutPartyId={m.id} aboutName={m.name} />
                </div>}
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* An alert strip, not a plain panel, when there's something the
          Senior needs to act on — the cockpit's own "master caution" idea,
          drawn with the same warning/danger tokens as everywhere else. */}
      <div
        className={
          data.overdue.length > 0
            ? "rounded-xl border border-danger/25 bg-danger-subtle"
            : "rounded-xl border border-line bg-surface"
        }
      >
        <Panel title="Overdue follow-ups" flush className="border-none bg-transparent">
          {data.overdue.length === 0 ? (
            <EmptyState title="Nothing overdue" description="Every active lead in this team has a current next action." compact />
          ) : (
            <DataTable
              caption="Overdue"
              rows={data.overdue}
              columns={[
                { key: "companyName", header: "Company", variant: "link", href: "/outreach/{id}" },
                { key: "state", header: "Stage", variant: "state", categoryKey: "category" },
              ]}
              emptyTitle="Nothing overdue"
            />
          )}
        </Panel>
      </div>
    </>
  );
}

export default withCapabilityPageAccess(OUTREACH_CAPABILITY, TeamCommandPage);
