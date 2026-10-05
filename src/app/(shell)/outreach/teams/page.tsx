import Link from "next/link";
import { requireActor } from "@/server/platform/auth";
import { hasPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_DIRECTION, ENTITY_LEAD, OUTREACH_CAPABILITY } from "@/server/capabilities/outreach";
import { withTenant } from "@/server/platform/tenancy";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { EmptyState, PageHeader, PermissionDenied, StateBadge } from "@/components/ui/primitives";
import { CreateTeamForm } from "./CreateTeamForm";

export const dynamic = "force-dynamic";
const TERMINAL = ["not_a_fit", "unresponsive", "lost", "deferred", "disqualified", "closed_won"];

/** Company-wide team directory. Deliberately Core-only: it is the oversight
 * surface; members use My Team and cannot enumerate another team's people. */
async function TeamsPage() {
  installCapabilities();
  const actor = await requireActor();
  const data = await withTenant(actor.tenantId, async (tx) => {
    if (!(await hasPermission(tx, actor.roleId, "Create", ENTITY_DIRECTION))) return null;
    const [teams, states] = await Promise.all([
      tx.outreachTeam.findMany({ where: { active: true }, include: { memberships: { where: { active: true } } }, orderBy: { name: "asc" } }),
      tx.stateDefinition.findMany({ where: { entityKey: ENTITY_LEAD } }),
    ]);
    const people = await tx.party.findMany({ where: { id: { in: [...new Set(teams.flatMap((t) => [t.leaderId, ...(t.coLeaderId ? [t.coLeaderId] : []), ...t.memberships.map((m) => m.partyId)]))] } } });
    const leads = await tx.outreachLead.findMany({ where: { teamId: { in: teams.map((t) => t.id) } } });
    const names = new Map(people.map((p) => [p.id, p.displayName]));
    const categories = new Map(states.map((s) => [s.key, s.category]));
    const now = new Date();

    // Same "who's unassigned anywhere" pool AddMemberForm already uses
    // (`outreach/team/page.tsx`'s own comment explains why) — a new team's
    // leader comes from here too, not a fresh login.
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
    const available: Array<{ id: string; name: string }> = [];
    for (const m of allMemberships) {
      const party = m.user.party;
      if (taken.has(party.id) || seen.has(party.id)) continue;
      seen.add(party.id);
      available.push({ id: party.id, name: party.displayName });
    }
    available.sort((a, b) => a.name.localeCompare(b.name));

    const rows = teams.map((team) => {
      const teamLeads = leads.filter((lead) => lead.teamId === team.id);
      const memberIds = new Set([team.leaderId, ...(team.coLeaderId ? [team.coLeaderId] : []), ...team.memberships.map((m) => m.partyId)]);
      return {
        id: team.id, name: team.name, members: memberIds.size, leader: names.get(team.leaderId) ?? "Unknown",
        active: teamLeads.filter((lead) => !TERMINAL.includes(lead.state)).length,
        overdue: teamLeads.filter((lead) => lead.nextActionAt && lead.nextActionAt < now && !TERMINAL.includes(lead.state)).length,
        state: teamLeads[0]?.state.replace(/_/g, " ") ?? "No prospects",
        category: teamLeads[0] ? categories.get(teamLeads[0].state) ?? "Draft" : "Draft",
      };
    });
    return { rows, available };
  });
  if (!data) return <PermissionDenied what="viewing every outreach team" />;
  return <><PageHeader title="Teams" description="Company-wide outreach structure. Open a team to review its people and operational work." actions={<CreateTeamForm candidates={data.available} />} />
    {data.rows.length === 0 ? <EmptyState title="No teams yet" description="Create the first outreach team before issuing team credentials." /> :
      <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-2 xl:grid-cols-3">{data.rows.map((team) => <li key={team.id}><Link href={`/outreach/teams/${team.id}`} className="glass-card flex min-h-48 flex-col rounded-xl border border-line p-5 text-text no-underline shadow-sm transition hover:border-line-strong hover:shadow-md"><div className="flex items-start justify-between gap-3"><div><h2 className="text-[17px] font-medium">{team.name}</h2><p className="m-0 mt-1 text-[13px] text-text-secondary">Led by {team.leader}</p></div>{team.overdue > 0 && <span className="rounded-full bg-danger-subtle px-2 py-1 text-[12px] font-medium text-danger">{team.overdue} overdue</span>}</div><div className="mt-auto grid grid-cols-2 gap-3 pt-6 text-[13px]"><span><strong className="tabular block text-[20px] font-medium">{team.members}</strong><span className="text-text-tertiary">Members</span></span><span><strong className="tabular block text-[20px] font-medium">{team.active}</strong><span className="text-text-tertiary">Active prospects</span></span></div><div className="mt-4"><StateBadge category={team.category} label={team.state} /></div></Link></li>)}</ul>}</>;
}
export default withCapabilityPageAccess(OUTREACH_CAPABILITY, TeamsPage);
