import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import {
  OUTREACH_CAPABILITY,
  ENTITY_DIRECTION,
  ENTITY_LEAD,
  ENTITY_TEAM,
  assertTeamScopeAllowed,
  deriveLeadHealth,
  getAttentionExceptions,
  getCompanyPulse,
  getTeamComparison,
} from "@/server/capabilities/outreach";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { ForbiddenError } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { DataTable } from "@/components/ui/DataTable";
import {
  Badge,
  EmptyState,
  PageHeader,
  Panel,
  PermissionDenied,
  Row,
  RowList,
  StatTile,
  StatTileRow,
  Surface,
} from "@/components/ui/primitives";
import { NewLeadForm } from "./NewLeadForm";
import { DirectionForm } from "./DirectionForm";
import { WorkQueuePanel } from "./WorkQueuePanel";
import { ResolveEscalationButton } from "./ResolveEscalationButton";
import { Donut, Legend } from "@/components/ui/charts";
import { HeroSignal, SignalRail } from "@/components/ui/business/HeroSignal";
import { RangeSwitch } from "./RangeSwitch";
import { RANGE_LABEL, percent, rangeFromParam, windowFor } from "./range";

export const dynamic = "force-dynamic";

const TERMINAL_STATES = ["not_a_fit", "unresponsive", "lost", "deferred", "disqualified"];

/** Task 114 P1.3 — a short "vs last period" hint appended to a Stat. */
function deltaLabel(curr: number, prev: number | null | undefined): string | undefined {
  if (prev == null) return undefined;
  if (prev === 0) return curr === 0 ? "flat vs last period" : "new this period";
  const pct = Math.round(((curr - prev) / prev) * 100);
  if (pct === 0) return "flat vs last period";
  return `${pct > 0 ? "+" : ""}${pct}% vs last period`;
}

/** Task 114 P1's three-layer dashboard hierarchy — a label, not a Panel, so
 *  it groups existing sections without adding another nested card. */
function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-[13px] uppercase tracking-[0.02em] text-text-secondary">{children}</h2>;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

type LeadRow = Record<string, unknown> & {
  id: string;
  companyName: string;
  team: string;
  owner: string;
  track: string;
  state: string;
  category: string;
  health: string;
};

/**
 * PA-OMS overview — one shared lead/activity/pipeline database, one screen
 * (master-context spec §3, §100). Team- and role-specific workspaces (Junior
 * "My Workspace", Senior "Team Command") are a later slice; this is the
 * Company-Core-shaped read that proves the data end to end first.
 */
async function OutreachPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; state?: string; range?: string }>;
}) {
  installCapabilities();
  const actor = await requireActor();
  const filters = await searchParams;
  const range = rangeFromParam(filters.range);

  const data = await withTenant(actor.tenantId, async (tx) => {
    if (!(await hasPermission(tx, actor.roleId, "Read", ENTITY_LEAD))) return null;
    // 2026-09-17: the summary overview is Senior + Founders' Office only.
    // Edit on Team is the structural signal both hold and a Junior never
    // does — same gate as this page's nav entry. A Junior's home for
    // prospects is /outreach/prospects.
    if (!(await hasPermission(tx, actor.roleId, "Edit", ENTITY_TEAM))) return "junior" as const;

    // Phase 3 fix (taskplan 105): a Senior may only view a `?team=` scope
    // they actually lead — see `assertTeamScopeAllowed`'s own doc comment
    // for why this is structural (leader-of-record), not a role-name check.
    try {
      await assertTeamScopeAllowed(tx, actor.userId, filters.team);
    } catch (error) {
      if (error instanceof ForbiddenError) return "forbidden" as const;
      throw error;
    }

    const canPostDirection = await hasPermission(tx, actor.roleId, "Create", ENTITY_DIRECTION);
    // Task 116 §8.2 — a Senior's default landing is "your team today," not
    // this page's company-wide shape (which has nothing to show them: no
    // direction-post rights, no company pulse, and an unfiltered cross-team
    // lead list until they hand-craft a `?team=` URL themselves). Team
    // Command (`/outreach/team`) already exists and already matches §8.2's
    // checklist — same redirect pattern this page already uses for a
    // Junior below, just for the other non-Core role. A Senior who follows
    // an explicit `?team=` deep link (e.g. from Core's team-comparison
    // drill-through) is left alone — that's a deliberate scoped visit to
    // this page, not the bare landing this redirect targets.
    if (!canPostDirection && !filters.team) return "senior" as const;

    const [teams, leads, states, canCreate, directionHistory, tenant] = await Promise.all([
      tx.outreachTeam.findMany({
        where: { active: true },
        include: { _count: { select: { memberships: true } }, memberships: { where: { active: true } } },
        orderBy: { name: "asc" },
      }),
      tx.outreachLead.findMany({
        where: {
          ...(filters.team ? { teamId: filters.team } : {}),
          ...(filters.state ? { state: filters.state } : {}),
        },
        orderBy: { updatedAt: "desc" },
        take: 200,
      }),
      tx.stateDefinition.findMany({ where: { entityKey: ENTITY_LEAD }, orderBy: { key: "asc" } }),
      hasPermission(tx, actor.roleId, "Create", ENTITY_LEAD),
      tx.outreachDirection.findMany({ orderBy: { postedAt: "desc" }, take: 20 }),
      tx.tenant.findUnique({ where: { id: actor.tenantId }, select: { timeZone: true } }),
    ]);
    // The direction table is append-only, so "current" is derived: the
    // latest posted (Task 106 Phase 7 correction — see `listDirections`).
    const currentDirection = directionHistory[0] ?? null;
    const window = windowFor(range, tenant?.timeZone ?? "Asia/Kolkata");

    // Company-wide reads — attention/exceptions (spec §9), the pulse and
    // the team comparison (Task 106 Phase 7, 2026-09-13 doc §4-5) — are only
    // meaningful, and only shown, when nobody's narrowed the view to one
    // team. `canPostDirection` (Founder-only, per the permission grant)
    // doubles as this screen's signal for "this is the Company Core view,"
    // same idea as `assertTeamScopeAllowed`'s structural-not-role-name
    // approach. Each is the registered query, run as this actor — the
    // page holds no second copy of the arithmetic.
    const isCoreView = !filters.team && canPostDirection;
    const [exceptions, pulse, teamComparison] = isCoreView
      ? await Promise.all([
          executeQuery(actor, getAttentionExceptions, {}),
          executeQuery(actor, getCompanyPulse, window),
          executeQuery(actor, getTeamComparison, window),
        ])
      : [[], null, []];

    // Task 114 P1.3 — trend deltas. Period default is the range picker's own
    // current selection, windowed a second time for the immediately
    // preceding period of equal length, per the taskplan's own suggested
    // default; "all time" has no meaningful previous period, so it's
    // skipped rather than showing a nonsensical comparison.
    const previousPulse =
      isCoreView && window.from && window.to
        ? await executeQuery(actor, getCompanyPulse, {
            from: new Date(
              new Date(window.from).getTime() - (new Date(window.to).getTime() - new Date(window.from).getTime()),
            ).toISOString(),
            to: window.from,
          })
        : null;

    const category = new Map(states.map((s) => [s.key, s.category]));
    const teamName = new Map(teams.map((t) => [t.id, t.name]));

    // Every team member plus every team's leader — either can be an
    // Opportunity Owner (master-context §16: Senior "help move opportunities
    // forward" too), and every current lead owner even if now inactive.
    const memberPartyIds = teams.flatMap((t) => [
      t.leaderId,
      ...(t.coLeaderId ? [t.coLeaderId] : []),
      ...t.memberships.map((m) => m.partyId),
    ]);
    const ownerIds = [...new Set([...memberPartyIds, ...leads.map((l) => l.opportunityOwnerId)])];
    const owners = ownerIds.length ? await tx.party.findMany({ where: { id: { in: ownerIds } } }) : [];
    const ownerName = new Map(owners.map((p) => [p.id, p.displayName]));

    const members = teams.flatMap((t) => [
      { id: t.leaderId, name: ownerName.get(t.leaderId) ?? "Unknown", teamId: t.id },
      ...(t.coLeaderId ? [{ id: t.coLeaderId, name: ownerName.get(t.coLeaderId) ?? "Unknown", teamId: t.id }] : []),
      ...t.memberships.map((m) => ({ id: m.partyId, name: ownerName.get(m.partyId) ?? "Unknown", teamId: t.id })),
    ]);

    const rows: LeadRow[] = leads.map((l) => ({
      id: l.id,
      companyName: l.companyName,
      team: teamName.get(l.teamId) ?? "—",
      owner: ownerName.get(l.opportunityOwnerId) ?? "—",
      track: l.track,
      state: l.state.replace(/_/g, " "),
      category: category.get(l.state) ?? "Draft",
      health: deriveLeadHealth({
        category: category.get(l.state) ?? "Draft",
        lastActivityAt: l.lastActivityAt,
        nextActionAt: l.nextActionAt,
        createdAt: l.createdAt,
      }),
    }));

    const funnel = states
      .filter((s) => !TERMINAL_STATES.includes(s.key) && s.key !== "closed_won")
      .map((s) => ({
        key: s.key,
        label: s.key.replace(/_/g, " "),
        count: leads.filter((l) => l.state === s.key).length,
      }));

    // Pipeline distribution by ADR-009 category (Draft/Pending/Active/Blocked/
    // Completed/Cancelled), same tonal-accent-ladder-not-semantic-color choice
    // as the platform overview's asset-state donut — a distribution, not a
    // single record's status.
    const countByCategory = (cat: string) => leads.filter((l) => category.get(l.state) === cat).length;
    const pipelineSegments = [
      { label: "Active", value: countByCategory("Active"), color: "var(--accent-500)" },
      { label: "Pending", value: countByCategory("Pending"), color: "var(--accent-400)" },
      { label: "Blocked", value: countByCategory("Blocked"), color: "var(--accent-300)" },
      { label: "Completed", value: countByCategory("Completed"), color: "var(--accent-200)" },
      { label: "Cancelled", value: countByCategory("Cancelled"), color: "var(--color-text-tertiary)" },
    ].filter((s) => s.value > 0);

    // Founder Escalation Queue (spec §57) — company-wide, Founder-only.
    const escalated = canPostDirection
      ? await tx.outreachLead.findMany({ where: { escalated: true }, orderBy: { escalatedAt: "desc" } })
      : [];
    const escalatedByIds = [...new Set(escalated.map((l) => l.escalatedById).filter((x): x is string => Boolean(x)))];
    const escalators = escalatedByIds.length ? await tx.party.findMany({ where: { id: { in: escalatedByIds } } }) : [];
    const escalatorName = new Map(escalators.map((p) => [p.id, p.displayName]));
    const escalations = escalated.map((l) => ({
      id: l.id,
      companyName: l.companyName,
      note: l.escalationNote,
      by: l.escalatedById ? escalatorName.get(l.escalatedById) ?? "—" : "—",
    }));

    return {
      teams: teams.map((t) => ({ id: t.id, name: t.name, members: t._count.memberships })),
      members,
      rows,
      funnel,
      pipelineSegments,
      totalLeads: leads.length,
      activeLeads: leads.filter((l) => !TERMINAL_STATES.includes(l.state) && l.state !== "closed_won").length,
      closedWon: leads.filter((l) => l.state === "closed_won").length,
      overdue: leads.filter(
        (l) => l.nextActionAt != null && l.nextActionAt < new Date() && !TERMINAL_STATES.includes(l.state) && l.state !== "closed_won",
      ).length,
      canCreate,
      canPostDirection,
      currentDirection,
      directionHistory: isCoreView ? directionHistory : [],
      exceptions,
      pulse,
      previousPulse,
      teamComparison,
      escalations,
    };
  });

  if (!data) return <PermissionDenied what="reading the outreach pipeline" />;
  if (data === "junior") redirect("/outreach/prospects");
  if (data === "senior") redirect("/outreach/team");
  if (data === "forbidden") return <PermissionDenied what="viewing another team's pipeline" />;

  return (
    <>
      <PageHeader
        title="Outreach"
        description={
          data.canPostDirection
            ? "PlotArmour's client-acquisition pipeline — one lead database, one activity history, one pipeline. Company Core view."
            : "PlotArmour's client-acquisition pipeline, scoped to one team."
        }
        actions={
          data.pulse ? (
            <>
              <Link
                href={`/outreach/intelligence?range=${range}`}
                className="rounded-[10px] bg-control px-3 py-1 text-[13px] font-semibold text-accent-ink no-underline transition-colors hover:bg-control-strong"
              >
                Intelligence
              </Link>
              <RangeSwitch basePath="/outreach" active={range} />
            </>
          ) : undefined
        }
      />

      {/* Operations Room framing (spec §105): the company's own direction is
          the first thing on the screen, drawn as a directive banner — not a
          panel among panels — because everything below exists to execute
          against it. Accent-tinted per ADR-011/012's existing token, never a
          new color. */}
      {/* ADR-024: accent is tint/interactive-only, never a large filled
          background — this banner was the concrete defect the constraint
          names. Solid surface (dense content, not chrome), accent moved to
          a left edge stripe instead of the whole fill. */}
      {data.canPostDirection && (
        <div
          className={
            data.currentDirection
              ? "mb-6 rounded-[12px] bg-surface px-6 py-5"
              : "mb-6 rounded-[12px] bg-surface px-6 py-5"
          }
        >
          {data.currentDirection ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="m-0 text-[13px] uppercase tracking-[0.02em] text-text-secondary">
                    Current direction · {data.currentDirection.weekLabel}
                  </p>
                  <p className="m-0 mt-1 text-[18px] font-bold text-text">
                    {data.currentDirection.priorityVertical ?? "No priority vertical set"}
                  </p>
                </div>
                <Badge tone="accent">{data.currentDirection.primaryTrack}</Badge>
              </div>
              {(data.currentDirection.priorityIndustries.length > 0 ||
                data.currentDirection.secondaryOpportunity ||
                data.currentDirection.geographicFocus ||
                data.currentDirection.targetCompanyProfile) && (
                <dl className="mt-3 grid gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2">
                  {data.currentDirection.priorityIndustries.length > 0 && (
                    <div className="flex flex-wrap items-baseline gap-2">
                      <dt className="text-text-tertiary">Priority industries</dt>
                      <dd className="m-0 flex flex-wrap gap-1.5">
                        {data.currentDirection.priorityIndustries.map((i) => (
                          <Badge key={i}>{i}</Badge>
                        ))}
                      </dd>
                    </div>
                  )}
                  {data.currentDirection.secondaryOpportunity && (
                    <div className="flex flex-wrap items-baseline gap-2">
                      <dt className="text-text-tertiary">Secondary opportunity</dt>
                      <dd className="m-0 text-text">{data.currentDirection.secondaryOpportunity}</dd>
                    </div>
                  )}
                  {data.currentDirection.geographicFocus && (
                    <div className="flex flex-wrap items-baseline gap-2">
                      <dt className="text-text-tertiary">Geographic focus</dt>
                      <dd className="m-0 text-text">{data.currentDirection.geographicFocus}</dd>
                    </div>
                  )}
                  {data.currentDirection.targetCompanyProfile && (
                    <div className="flex flex-wrap items-baseline gap-2">
                      <dt className="text-text-tertiary">Target company profile</dt>
                      <dd className="m-0 text-text">{data.currentDirection.targetCompanyProfile}</dd>
                    </div>
                  )}
                </dl>
              )}
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
                {data.currentDirection.companyProspectingTarget != null && (
                  <span className="text-[13px] text-text-secondary">
                    Target: <b className="text-text">{data.currentDirection.companyProspectingTarget}</b> qualified businesses
                  </span>
                )}
                {data.currentDirection.strategicNote && (
                  <span className="text-[13px] text-text-tertiary">{data.currentDirection.strategicNote}</span>
                )}
              </div>
              <div className="mt-4">
                <DirectionForm />
              </div>
            </>
          ) : (
            <>
              <p className="m-0 text-[15px] text-text">No direction posted for this week.</p>
              <p className="m-0 mt-1 text-[13px] text-text-tertiary">
                Post this week's priority — it's the first thing every team sees.
              </p>
              <div className="mt-4">
                <DirectionForm />
              </div>
            </>
          )}
        </div>
      )}

      {data.directionHistory.length > 1 && (
        <div className="mb-6">
          <Panel title="Direction history" flush>
            <RowList>
              {data.directionHistory.map((d, i) => (
                <Row key={d.id}>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[14px] text-text">{d.weekLabel}</span>
                    <span className="text-[12px] text-text-secondary">
                      {d.priorityVertical ?? "No priority vertical set"}
                      {d.geographicFocus ? ` · ${d.geographicFocus}` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge>{d.primaryTrack}</Badge>
                    <Badge tone={i === 0 ? "accent" : undefined}>{i === 0 ? "Active" : "Closed"}</Badge>
                  </span>
                </Row>
              ))}
            </RowList>
          </Panel>
        </div>
      )}

      {/* Task 114 P1 — three-layer dashboard hierarchy. Direction stays above
          this (Spec §105's "first thing on the screen" framing predates and
          outranks this restructure — everything below still executes
          against it, so it isn't re-parented into a layer). */}
      <SectionLabel>Today's execution</SectionLabel>
      <div className="mb-6">
        <WorkQueuePanel teamIds={data.teams.map((t) => t.id)} />
      </div>

      {data.canPostDirection && (
        <div className="mb-6">
          <Panel title="Needs attention" flush>
            {data.exceptions.length === 0 ? (
              <EmptyState title="Nothing waiting" description="No exceptions right now — records appear here as they occur." compact />
            ) : (
              <div className="flex flex-col divide-y divide-line px-6">
                {data.exceptions.map((e, i) => (
                  <div key={i} className="flex items-center gap-3 py-3">
                    <Badge>{e.kind.replace(/_/g, " ")}</Badge>
                    <span className="text-[13px] text-text">{e.message}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      )}

      {data.escalations.length > 0 && (
        <div className="mb-6 rounded-xl border border-danger/25 bg-danger-subtle">
          <Panel title="Founder escalation queue" flush className="border-none bg-transparent">
            <RowList>
              {data.escalations.map((e) => (
                <Row key={e.id}>
                  <span className="flex flex-col gap-0.5">
                    <Link href={`/outreach/${e.id}`} className="text-[14px] text-text no-underline hover:text-accent-ink">
                      {e.companyName}
                    </Link>
                    {e.note && <span className="text-[12px] text-text-secondary">{e.note}</span>}
                    <span className="text-[12px] text-text-tertiary">Flagged by {e.by}</span>
                  </span>
                  <ResolveEscalationButton leadId={e.id} />
                </Row>
              ))}
            </RowList>
          </Panel>
        </div>
      )}

      <SectionLabel>Pipeline health</SectionLabel>
      {data.pulse ? (
        /* Task 116 §8.1: one execution story rather than two equal rows of
           eight numbers. Every displayed value is still the same registered
           query result; only the hierarchy changes. */
        <div className="mb-6 grid items-stretch gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.8fr)]">
          <HeroSignal
            icon="parties"
            label={`${RANGE_LABEL[range]} execution`}
            value={data.pulse.outreach + data.pulse.followUps + data.pulse.responses + data.pulse.meetings}
            context={`${data.pulse.activeMembers} member${data.pulse.activeMembers === 1 ? "" : "s"} across ${data.pulse.activeTeams} active team${data.pulse.activeTeams === 1 ? "" : "s"}`}
            delta={(() => {
              if (!data.previousPulse) return undefined;
              const current = data.pulse.outreach + data.pulse.followUps + data.pulse.responses + data.pulse.meetings;
              const previous = data.previousPulse.outreach + data.previousPulse.followUps + data.previousPulse.responses + data.previousPulse.meetings;
              const label = deltaLabel(current, previous);
              if (!label) return undefined;
              return {
                label,
                direction: current === previous ? "flat" as const : current > previous ? "up" as const : "down" as const,
              };
            })()}
            visual={
              <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-5">
                {[
                  ["Leads", data.pulse.leads],
                  ["Outreach", data.pulse.outreach],
                  ["Follow-ups", data.pulse.followUps],
                  ["Meetings", data.pulse.meetings],
                  ["Proposals", data.pulse.proposals],
                ].map(([label, value]) => (
                  <div key={String(label)} className="min-w-0">
                    <p className="tabular m-0 text-[20px] font-bold leading-none text-text">{value}</p>
                    <p className="m-0 mt-1.5 truncate text-[11.5px] text-text-tertiary">{label}</p>
                  </div>
                ))}
              </div>
            }
          />
          <SignalRail
            title="Pipeline now"
            items={[
              {
                icon: "workspace",
                label: "Active pipeline",
                value: data.pulse.activePipeline,
                hint: deltaLabel(data.pulse.activePipeline, data.previousPulse?.activePipeline) ?? "Open now",
                href: "/outreach/prospects",
              },
              {
                icon: "mail",
                label: "Responses",
                value: data.pulse.responses,
                hint: `${percent(data.pulse.responseRate)} response rate`,
                href: "/outreach/prospects",
              },
              {
                icon: "bell",
                label: "Overdue follow-ups",
                value: data.overdue,
                hint: data.overdue === 0 ? "Nothing overdue" : "Needs attention",
                href: "/outreach/prospects?view=needs-action",
                tone: data.overdue > 0 ? "danger" : "neutral",
              },
            ]}
          />
        </div>
      ) : (
        // ADR-025 pattern 2 (icon-chip stat tile) — only this summary row
        // migrated: its four concepts have exact-match icons already in the
        // vocabulary (workspace/parties/check/bell). The 8-metric pulse view
        // above stays `Stat`/`StatRow` — it has no clean icon per concept
        // (Outreach, Follow-ups, Responses, Proposals would force duplicate
        // or decorative-not-meaningful icon reuse), so it's not migrated.
        <StatTileRow className="mb-6">
          <StatTile icon="workspace" label="Teams" value={data.teams.length} />
          <StatTile icon="parties" label="Active leads" value={data.activeLeads} />
          <StatTile icon="check" label="Closed Won" value={data.closedWon} />
          <StatTile icon="bell" label="Follow-ups overdue" value={data.overdue} />
        </StatTileRow>
      )}

      <SectionLabel>Management intelligence</SectionLabel>
      {data.teamComparison.length > 0 && (
        <div className="mb-6">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="m-0 text-[15px] font-medium text-text">Team performance</h3>
              <p className="m-0 mt-1 text-[12px] text-text-tertiary">{RANGE_LABEL[range]} · compare execution and pipeline load</p>
            </div>
            <Link href="/outreach/teams" className="text-[12px] text-accent-ink no-underline hover:underline">
              Open teams →
            </Link>
          </div>
          <div className="grid items-stretch gap-4 lg:grid-cols-2">
            {data.teamComparison.map((team) => {
              const progress = team.target && team.target > 0 ? Math.min(100, Math.round((team.leads / team.target) * 100)) : null;
              return (
                <Link key={team.teamId} href={`/outreach?team=${team.teamId}`} className="group block no-underline">
                  <Surface className="h-full p-5 transition-[border-color,transform] duration-200 group-hover:-translate-y-0.5 group-hover:border-line-strong">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-subtle text-[12px] font-medium text-accent-ink">
                          {initials(team.leaderName)}
                        </span>
                        <div className="min-w-0">
                          <h3 className="m-0 truncate text-[16px] font-medium text-text">{team.teamName}</h3>
                          <p className="m-0 mt-0.5 truncate text-[12px] text-text-tertiary">
                            {team.leaderName} · {team.memberCount} member{team.memberCount === 1 ? "" : "s"}
                          </p>
                        </div>
                      </div>
                      <span className="tabular text-[24px] font-bold text-text">{team.pipeline}</span>
                    </div>

                    {progress != null ? (
                      <div className="mt-5">
                        <div className="flex items-center justify-between text-[11.5px] text-text-tertiary">
                          <span>Prospecting target</span>
                          <span className="tabular">{team.leads} / {team.target}</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-track)]">
                          <div className="h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-5 grid grid-cols-4 gap-3 border-t border-line pt-4">
                      {[
                        ["Outreach", team.outreach],
                        ["Responses", team.responses],
                        ["Meetings", team.meetings],
                        ["Closed", team.closed],
                      ].map(([label, value]) => (
                        <div key={String(label)} className="min-w-0">
                          <p className="tabular m-0 text-[17px] font-bold text-text">{value}</p>
                          <p className="m-0 mt-1 truncate text-[10.5px] text-text-tertiary">{label}</p>
                        </div>
                      ))}
                    </div>
                  </Surface>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div className="mb-6 grid items-stretch gap-6 lg:grid-cols-2">
        <Panel title="Pipeline">
          {data.pipelineSegments.length > 0 ? (
            <div className="flex items-center gap-5">
              <div className="min-w-0 flex-1">
                <Legend segments={data.pipelineSegments} />
              </div>
              <Donut
                segments={data.pipelineSegments}
                centreValue={data.totalLeads}
                centreLabel="Total leads"
                size={130}
                thickness={9}
              />
            </div>
          ) : (
            <p className="py-6 text-center text-[13px] text-text-tertiary">No leads in the pipeline yet.</p>
          )}
        </Panel>

        <Panel title="Funnel" flush>
          <div className="flex flex-col divide-y divide-line px-6">
            {data.funnel.map((f) => (
              <Link
                key={f.key}
                href={`/outreach?state=${f.key}${filters.team ? `&team=${filters.team}` : ""}`}
                className="flex items-center justify-between py-2.5 text-text no-underline hover:text-accent-ink"
              >
                <span className="text-[13px] capitalize">{f.label}</span>
                <span className="tabular text-[13px] text-text-secondary">{f.count}</span>
              </Link>
            ))}
          </div>
        </Panel>
      </div>

      {data.canCreate && (
        <NewLeadForm teams={data.teams} members={data.members} defaultTeamId={filters.team} />
      )}

      <div className="mt-6">
        <DataTable
          caption={filters.state ? `Leads — ${filters.state.replace(/_/g, " ")}` : "Leads"}
          rows={data.rows}
          columns={[
            { key: "companyName", header: "Company", variant: "link", href: "/outreach/{id}", subKey: "track" },
            { key: "team", header: "Team" },
            { key: "owner", header: "Owner" },
            { key: "state", header: "Stage", variant: "state", categoryKey: "category" },
            { key: "health", header: "Health", variant: "health" },
          ]}
          emptyTitle="No leads yet"
          emptyDescription="A lead is a researched prospect company with a stated reason it's relevant. None exists in this scope yet."
        />
      </div>
    </>
  );
}

export default withCapabilityPageAccess(OUTREACH_CAPABILITY, OutreachPage);
