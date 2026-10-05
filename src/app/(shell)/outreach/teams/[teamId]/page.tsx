import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { hasPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_DIRECTION, ENTITY_LEAD, OUTREACH_CAPABILITY } from "@/server/capabilities/outreach";
import { withTenant } from "@/server/platform/tenancy";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { EmptyState, PageHeader, PermissionDenied, Stat, StatRow } from "@/components/ui/primitives";
import { ReassignLeaderForm } from "./ReassignLeaderForm";
import { AddMemberForm } from "../../team/AddMemberForm";
import { RemoveMemberButton } from "../../team/RemoveMemberButton";
import { RenameTeamForm } from "../../team/RenameTeamForm";

export const dynamic = "force-dynamic";
const TERMINAL = ["not_a_fit", "unresponsive", "lost", "deferred", "disqualified", "closed_won"];

/**
 * One team's transparent roster. Core may review any team; a Senior sees a
 * led team; an individual contributor can only see a team they belong to.
 *
 * Manage actions (reassign leader, add/remove member) are Core-only here —
 * a Senior manages their OWN team from `/outreach/team` instead. Before
 * this pass Core had no manage surface for ANY team: reassigning a
 * departing leader, adding, or removing a member all required signing in
 * as that team's own leader, which is a real gap when the leader is the
 * one leaving. `verity.outreach.set_team_leader`/`add_team_member`/
 * `remove_team_member` are ordinary Edit-verb commands Founders' Office
 * already holds at Tenant scope (`prisma/seed-pa-oms.ts`'s full-CRUD
 * grant) — this page simply reaches them for the first time.
 */
async function TeamPage({ params }: { params: Promise<{ teamId: string }> }) {
  installCapabilities();
  const actor = await requireActor();
  const { teamId } = await params;
  const data = await withTenant(actor.tenantId, async (tx) => {
    if (!(await hasPermission(tx, actor.roleId, "Read", ENTITY_LEAD))) return null;
    const [user, team, core] = await Promise.all([
      tx.user.findUniqueOrThrow({ where: { id: actor.userId } }),
      tx.outreachTeam.findUnique({ where: { id: teamId }, include: { memberships: { where: { active: true } } } }),
      hasPermission(tx, actor.roleId, "Create", ENTITY_DIRECTION),
    ]);
    if (!team || !team.active) return { missing: true as const };
    const memberIds = new Set([team.leaderId, ...(team.coLeaderId ? [team.coLeaderId] : []), ...team.memberships.map((m) => m.partyId)]);
    const canView = core || memberIds.has(user.partyId);
    if (!canView) return { denied: true as const };
    const [people, leads, activities] = await Promise.all([
      tx.party.findMany({ where: { id: { in: [...memberIds] } } }),
      tx.outreachLead.findMany({ where: { teamId } }),
      tx.outreachActivity.findMany({ where: { actorPartyId: { in: [...memberIds] } } }),
    ]);
    const now = new Date();

    // Same unassigned-anywhere pool `AddMemberForm`/`CreateTeamForm` already
    // use — only computed for Core, who is the only viewer who can act on it.
    let available: Array<{ id: string; name: string }> = [];
    if (core) {
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
      for (const m of allMemberships) {
        const party = m.user.party;
        if (taken.has(party.id) || seen.has(party.id)) continue;
        seen.add(party.id);
        available.push({ id: party.id, name: party.displayName });
      }
      available.sort((a, b) => a.name.localeCompare(b.name));
    }

    return {
      team,
      core,
      available,
      members: people
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .map((person) => {
          const owned = leads.filter((lead) => lead.opportunityOwnerId === person.id);
          return {
            id: person.id,
            name: person.displayName,
            role: person.id === team.leaderId ? "Team lead" : person.id === team.coLeaderId ? "Co-lead" : "Member",
            active: owned.filter((lead) => !TERMINAL.includes(lead.state)).length,
            overdue: owned.filter((lead) => lead.nextActionAt && lead.nextActionAt < now && !TERMINAL.includes(lead.state)).length,
            touches: activities.filter((activity) => activity.actorPartyId === person.id).length,
          };
        }),
      active: leads.filter((lead) => !TERMINAL.includes(lead.state)).length,
      overdue: leads.filter((lead) => lead.nextActionAt && lead.nextActionAt < now && !TERMINAL.includes(lead.state)).length,
    };
  });
  if (!data) return <PermissionDenied what="viewing this outreach team" />;
  if ("missing" in data) notFound();
  if ("denied" in data) return <PermissionDenied what="viewing this outreach team" />;

  const revalidatePath = `/outreach/teams/${data.team.id}`;

  return (
    <>
      <PageHeader
        title={data.team.name}
        description="People, ownership, and follow-up health for this outreach team."
        actions={
          <span className="flex items-center gap-4">
            {data.core && <RenameTeamForm teamId={data.team.id} currentName={data.team.name} revalidatePath={revalidatePath} />}
            <Link href="/outreach/teams" className="text-[13px] text-accent-ink no-underline hover:underline">
              All teams
            </Link>
          </span>
        }
      />
      <StatRow cols={3} className="mb-6">
        <Stat label="Members" value={data.members.length} />
        <Stat label="Active prospects" value={data.active} />
        <Stat label="Overdue follow-ups" value={data.overdue} hint={data.overdue ? "Needs attention" : undefined} />
      </StatRow>

      {data.core && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <ReassignLeaderForm
            teamId={data.team.id}
            currentLeaderName={data.members.find((m) => m.role === "Team lead")?.name ?? "Unassigned"}
            candidates={data.members.filter((m) => m.role !== "Team lead")}
          />
          <AddMemberForm teamId={data.team.id} candidates={data.available} revalidatePath={revalidatePath} />
        </div>
      )}

      {data.members.length === 0 ? (
        <EmptyState title="No members" description="Add people to this team before assigning prospect work." />
      ) : (
        <div className="verity-solid overflow-hidden rounded-xl border border-line shadow-sm">
          <div className="grid grid-cols-[minmax(0,1fr)_80px_80px_80px_40px] gap-3 border-b border-line px-5 py-3 text-[13px] uppercase tracking-[0.02em] text-text-secondary">
            <span>Member</span>
            <span className="text-right">Active</span>
            <span className="text-right">Touches</span>
            <span className="text-right">Overdue</span>
            <span />
          </div>
          {data.members.map((member) => (
            <div key={member.id} className="grid grid-cols-[minmax(0,1fr)_80px_80px_80px_40px] items-center gap-3 border-b border-line px-5 py-4 last:border-none">
              <Link href={`/outreach/teams/${data.team.id}/members/${member.id}`} className="min-w-0 text-text no-underline hover:underline">
                <strong className="block text-[14px] font-medium">{member.name}</strong>
                <small className="text-[12px] text-text-tertiary">{member.role}</small>
              </Link>
              <span className="tabular text-right text-[14px]">{member.active}</span>
              <span className="tabular text-right text-[14px]">{member.touches}</span>
              <span className={`tabular text-right text-[14px] ${member.overdue ? "font-medium text-danger" : "text-text-secondary"}`}>{member.overdue}</span>
              <span className="text-right">
                {/* Leader/co-lead removal is `setTeamLeader`/`setTeamCoLeader`
                    reassignment, not this — they carry no OutreachTeamMembership
                    row, so this command doesn't apply to them (see removeTeamMember's
                    own `findFirstOrThrow`). */}
                {data.core && member.role === "Member" && (
                  <RemoveMemberButton teamId={data.team.id} partyId={member.id} name={member.name} revalidatePath={revalidatePath} />
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
export default withCapabilityPageAccess(OUTREACH_CAPABILITY, TeamPage);
