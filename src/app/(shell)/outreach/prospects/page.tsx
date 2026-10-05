import Link from "next/link";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import {
  OUTREACH_CAPABILITY,
  ENTITY_DIRECTION,
  ENTITY_LEAD,
  deriveLeadHealth,
} from "@/server/capabilities/outreach";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { Badge, EmptyState, HealthBadge, PageHeader, PermissionDenied, StateBadge } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { NewLeadForm } from "../NewLeadForm";
import { WorkQueuePanel } from "../WorkQueuePanel";
import { ProspectFilters, type ProspectFilterOptions } from "./ProspectFilters";
import { BulkActionBar } from "./BulkActionBar";

export const dynamic = "force-dynamic";

const TRACKS = ["Undetermined", "Agency", "Verity", "Both"];
const HEALTHS = [
  { value: "Hot", label: "Hot" },
  { value: "Healthy", label: "Healthy" },
  { value: "AtRisk", label: "At risk" },
  { value: "Stale", label: "Stale" },
  { value: "Closed", label: "Closed" },
];
const TERMINAL_STATES = ["not_a_fit", "unresponsive", "lost", "deferred", "disqualified", "closed_won"];
const LIMIT = 300;

const PROSPECT_COLUMNS: Column[] = [
  { key: "companyName", header: "Prospect", variant: "link", href: "/outreach/{id}", subKey: "domainLabel" },
  { key: "state", header: "Stage", variant: "state", categoryKey: "category" },
  { key: "health", header: "Health", variant: "health" },
  { key: "owner", header: "Owner", sortable: true },
  { key: "nextActionDisplay", header: "Next action", sortable: true },
  { key: "lastActivityAt", header: "Last touch", sortable: true },
  { key: "fitDisplay", header: "Fit", numeric: true },
];

type Search = {
  q?: string;
  status?: string;
  domain?: string;
  track?: string;
  health?: string;
  team?: string;
  owner?: string;
  sort?: string;
  needsAction?: string;
  view?: string;
  create?: string;
};

type Viewer = "founder" | "senior" | "junior";

/**
 * Prospects — every outreach role's card view of the prospects they manage
 * (2026-09-17). One page, three scopes, decided structurally rather than by
 * role name (same approach as `assertTeamScopeAllowed`):
 *
 * - Founders' Office (holds Create on Direction): every prospect, filterable
 *   by team, domain, status, track, owner and health.
 * - Senior (leads or co-leads a team): every prospect in the team(s) they
 *   lead, plus any they personally own or originated; can add a prospect and
 *   assign it to anyone on those teams.
 * - Junior (everyone else): prospects they own or originated; can add a
 *   prospect and assign it within their own team.
 *
 * Every URL filter is ANDed onto the scope, so a hand-edited `?team=` or
 * `?owner=` can only narrow a viewer's own set, never widen it.
 */
async function ProspectsPage({ searchParams }: { searchParams: Promise<Search> }) {
  installCapabilities();
  const actor = await requireActor();
  const filters = await searchParams;

  const data = await withTenant(actor.tenantId, async (tx) => {
    if (!(await hasPermission(tx, actor.roleId, "Read", ENTITY_LEAD))) return null;

    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.userId } });
    const me = user.partyId;

    const [isFounder, canCreate, allTeams, myMemberships, states, domainRows, tenant] = await Promise.all([
      hasPermission(tx, actor.roleId, "Create", ENTITY_DIRECTION),
      hasPermission(tx, actor.roleId, "Create", ENTITY_LEAD),
      tx.outreachTeam.findMany({
        where: { active: true },
        include: { memberships: { where: { active: true } } },
        orderBy: { name: "asc" },
      }),
      tx.outreachTeamMembership.findMany({ where: { partyId: me, active: true } }),
      tx.stateDefinition.findMany({ where: { entityKey: ENTITY_LEAD }, orderBy: { key: "asc" } }),
      tx.outreachDomain.findMany({ include: { group: true }, orderBy: [{ group: { order: "asc" } }, { order: "asc" }] }),
      tx.tenant.findUnique({ where: { id: actor.tenantId }, select: { timeZone: true } }),
    ]);

    const ledTeams = allTeams.filter((t) => t.leaderId === me || t.coLeaderId === me);
    const viewer: Viewer = isFounder ? "founder" : ledTeams.length > 0 ? "senior" : "junior";

    // The teams this viewer works in: everything for Founders, led teams for
    // a Senior, the rostered team(s) for a Junior.
    const myTeamIds = new Set(myMemberships.map((m) => m.teamId));
    const scopeTeams =
      viewer === "founder" ? allTeams : viewer === "senior" ? ledTeams : allTeams.filter((t) => myTeamIds.has(t.id));

    const scope =
      viewer === "founder"
        ? {}
        : viewer === "senior"
          ? { OR: [{ teamId: { in: scopeTeams.map((t) => t.id) } }, { opportunityOwnerId: me }, { leadOriginatorId: me }] }
          : { OR: [{ opportunityOwnerId: me }, { leadOriginatorId: me }] };

    const now = new Date();
    const q = filters.q?.trim();
    // An AND-array of independent clauses, not a single flat object — a flat
    // object can only hold one `OR` key, and the free-text search clause and
    // the "needs action" chip clause each need their own `OR`. Combining them
    // into one object would silently drop whichever was spread in first.
    const clauses: Array<Record<string, unknown>> = [];
    if (filters.status) clauses.push({ state: filters.status });
    if (filters.domain === "none") clauses.push({ domainId: null });
    else if (filters.domain) clauses.push({ domainId: filters.domain });
    if (filters.track) clauses.push({ track: filters.track });
    if (viewer !== "junior" && filters.team) clauses.push({ teamId: filters.team });
    if (viewer !== "junior" && filters.owner) clauses.push({ opportunityOwnerId: filters.owner });
    if (q) {
      clauses.push({
        OR: [
          { companyName: { contains: q, mode: "insensitive" as const } },
          { contactName: { contains: q, mode: "insensitive" as const } },
          { location: { contains: q, mode: "insensitive" as const } },
          { industry: { contains: q, mode: "insensitive" as const } },
          { website: { contains: q, mode: "insensitive" as const } },
        ],
      });
    }
    if (filters.needsAction === "1") {
      clauses.push({
        state: { notIn: TERMINAL_STATES },
        OR: [{ nextActionAt: null }, { nextActionAt: { lt: now } }],
      });
    }

    const orderBy =
      filters.sort === "created"
        ? [{ createdAt: "desc" as const }]
        : filters.sort === "name"
          ? [{ companyName: "asc" as const }]
          : filters.sort === "score"
            ? [{ qualityScore: { sort: "desc" as const, nulls: "last" as const } }, { updatedAt: "desc" as const }]
            : filters.sort === "nextAction"
              ? [{ nextActionAt: { sort: "asc" as const, nulls: "last" as const } }, { updatedAt: "desc" as const }]
              : [{ updatedAt: "desc" as const }];

    const [leads, totalInScope] = await Promise.all([
      tx.outreachLead.findMany({ where: { AND: [scope, ...clauses] }, orderBy, take: LIMIT }),
      tx.outreachLead.count({ where: scope }),
    ]);

    const category = new Map(states.map((s) => [s.key, s.category]));
    const teamName = new Map(allTeams.map((t) => [t.id, t.name]));
    const domainById = new Map(domainRows.map((d) => [d.id, { name: d.name, group: d.group.name }]));

    // Everyone a prospect can be assigned to in this viewer's teams (leaders
    // included — a Senior can own a prospect too), plus every name a visible
    // card needs.
    const assignable = scopeTeams.flatMap((t) => [
      { id: t.leaderId, teamId: t.id },
      ...(t.coLeaderId ? [{ id: t.coLeaderId, teamId: t.id }] : []),
      ...t.memberships.map((m) => ({ id: m.partyId, teamId: t.id })),
    ]);
    const partyIds = [
      ...new Set([...assignable.map((a) => a.id), ...leads.flatMap((l) => [l.opportunityOwnerId, l.leadOriginatorId])]),
    ];
    const parties = partyIds.length ? await tx.party.findMany({ where: { id: { in: partyIds } } }) : [];
    const partyName = new Map(parties.map((p) => [p.id, p.displayName]));

    const timeZone = tenant?.timeZone ?? "Asia/Kolkata";
    const fmt = (d: Date | null) =>
      d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone }) : null;

    let cards = leads.map((l) => {
      const cat = category.get(l.state) ?? "Draft";
      const domain = l.domainId ? domainById.get(l.domainId) : undefined;
      return {
        id: l.id,
        companyName: l.companyName,
        website: l.website,
        location: l.location,
        domainLabel: domain ? `${domain.group} · ${domain.name}` : l.industry ?? null,
        track: l.track,
        state: l.state.replace(/_/g, " "),
        category: cat,
        health: deriveLeadHealth({
          category: cat,
          lastActivityAt: l.lastActivityAt,
          nextActionAt: l.nextActionAt,
          createdAt: l.createdAt,
        }),
        qualityScore: l.qualityScore,
        whatTheyDo: l.whatTheyDo,
        whyRelevant: l.whyRelevant,
        potentialNeed: l.potentialNeed,
        salesHypothesis: l.salesHypothesis,
        contactName: l.contactName,
        contactDesignation: l.contactDesignation,
        contactEmail: l.contactEmail,
        contactPhone: l.contactPhone,
        linkedinUrl: l.linkedinUrl,
        team: teamName.get(l.teamId) ?? "—",
        teamId: l.teamId,
        ownerId: l.opportunityOwnerId,
        owner: partyName.get(l.opportunityOwnerId) ?? "Unknown",
        originator: partyName.get(l.leadOriginatorId) ?? "Unknown",
        nextActionNote: l.nextActionNote,
        nextActionAt: fmt(l.nextActionAt),
        overdue: l.nextActionAt != null && l.nextActionAt < now && !TERMINAL_STATES.includes(l.state),
        lastActivityAt: fmt(l.lastActivityAt),
        createdAt: fmt(l.createdAt),
        escalated: l.escalated,
      };
    });
    // Health is derived, not stored — so it can only filter after the read.
    if (filters.health) cards = cards.filter((c) => c.health === filters.health);
    // Table-view-only derived text — the card view composes these inline in
    // JSX instead, so this stays out of the shared card object above.
    const rows = cards.map((c) => ({
      ...c,
      nextActionDisplay: c.nextActionAt ? `${c.overdue ? "Overdue" : "Due"} ${c.nextActionAt}` : "None set",
      fitDisplay: c.qualityScore != null ? `${c.qualityScore}/10` : "—",
    }));

    const options: ProspectFilterOptions = {
      statuses: states.map((s) => ({ value: s.key, label: s.key.replace(/_/g, " ") })),
      domains: [
        ...domainRows.map((d) => ({ value: d.id, label: d.name, group: d.group.name })),
        { value: "none", label: "Unspecified", group: "Other" },
      ],
      tracks: TRACKS.map((t) => ({ value: t, label: t })),
      healths: HEALTHS,
      ...(viewer !== "junior"
        ? {
            teams: scopeTeams.map((t) => ({ value: t.id, label: t.name })),
            owners: [...new Map(assignable.map((a) => [a.id, a])).values()]
              .map((a) => ({ value: a.id, label: partyName.get(a.id) ?? "Unknown" }))
              .sort((a, b) => a.label.localeCompare(b.label)),
          }
        : {}),
    };

    return {
      viewer,
      me,
      cards,
      rows,
      totalInScope,
      truncated: leads.length === LIMIT,
      options,
      canCreate: canCreate && scopeTeams.length > 0,
      formTeams: scopeTeams.map((t) => ({ id: t.id, name: t.name })),
      formMembers: [...new Map(assignable.map((a) => [`${a.teamId}:${a.id}`, a])).values()].map((a) => ({
        id: a.id,
        teamId: a.teamId,
        name: partyName.get(a.id) ?? "Unknown",
      })),
      formDomains: domainRows.map((d) => ({ id: d.id, name: d.name, group: d.group.name })),
    };
  });

  if (!data) return <PermissionDenied what="reading prospects" />;

  const description = {
    founder: "Every prospect across the company. Filter by team, domain, status, owner and more.",
    senior: "Every prospect in the team you lead. Add prospects and assign them to your officers.",
    junior: "The prospects you own or added. Add a prospect and assign it to keep your pipeline in one place.",
  }[data.viewer];

  return (
    <>
      <PageHeader title="Prospects" description={description} />

      <div className="mb-6">
        <WorkQueuePanel teamIds={data.formTeams.map((t) => t.id)} />
      </div>

      {data.canCreate && (
        <NewLeadForm
          teams={data.formTeams}
          members={data.formMembers}
          domains={data.formDomains}
          defaultOwnerId={data.viewer === "junior" ? data.me : undefined}
          revalidatePath="/outreach/prospects"
          initiallyOpen={filters.create === "1"}
        />
      )}

      <ProspectFilters options={data.options} viewerId={data.me} />

      <p className="mb-4 text-[13px] text-text-tertiary">
        Showing <span className="tabular text-text">{data.cards.length}</span> of{" "}
        <span className="tabular text-text">{data.totalInScope}</span> prospect{data.totalInScope === 1 ? "" : "s"}
        {data.truncated ? ` · first ${LIMIT} only — narrow the filters to see the rest` : ""}
      </p>

      {data.cards.length === 0 ? (
        <EmptyState
          title={data.totalInScope === 0 ? "No prospects yet" : "No prospects match these filters"}
          description={
            data.totalInScope === 0
              ? "A prospect is a researched company with a stated reason it's relevant. Add the first one above."
              : "Clear or change a filter to widen the view."
          }
        />
      ) : filters.view === "table" ? (
        <DataTable
          caption="Prospects"
          rows={data.rows}
          columns={PROSPECT_COLUMNS}
          filterable={false}
          bulkActions={(selectedIds, clear) => (
            <BulkActionBar
              selectedIds={selectedIds}
              rows={data.rows.map((r) => ({ id: String(r.id), companyName: r.companyName, teamId: r.teamId, ownerId: r.ownerId }))}
              owners={(data.options.owners ?? []).map((o) => ({ id: o.value, name: o.label }))}
              clear={clear}
            />
          )}
        />
      ) : (
        <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-2 2xl:grid-cols-3">
          {data.cards.map((c) => {
            const websiteHref = c.website ? (c.website.startsWith("http") ? c.website : `https://${c.website}`) : null;
            return (
              <li key={c.id}>
                {/* Solid, not glass: each card is dense text a reader scans to
                    decide without opening the record — ADR-011 keeps that off
                    the glass. */}
                <article className="glass-card flex h-full flex-col gap-4 rounded-xl border border-line p-5 shadow-sm">
                  <header className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="m-0 truncate text-[16px] font-medium">
                        <Link
                          href={`/outreach/${c.id}`}
                          className="rounded-sm text-text no-underline hover:text-accent-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                        >
                          {c.companyName}
                        </Link>
                      </h2>
                      <p className="m-0 mt-0.5 truncate text-[12px] text-text-tertiary">
                        {[c.domainLabel ?? "No domain", c.location].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    {c.qualityScore != null && (
                      <span className="shrink-0 text-right" title="Fit score">
                        <span className="tabular text-[20px] font-bold leading-none text-text">{c.qualityScore}</span>
                        <span className="text-[12px] text-text-tertiary">/10</span>
                      </span>
                    )}
                  </header>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <StateBadge category={c.category} label={c.state} />
                    <HealthBadge health={c.health} />
                    <Badge>{c.track}</Badge>
                    {c.escalated && <span className="text-[12px] font-medium text-danger">Escalated</span>}
                  </div>

                  {/* Task 114 P1.5 item 5 (card verbosity): was four detail
                      fields at up to 3 lines each — every one of them is
                      already on the record's own Overview tab. A scanning
                      card needs the one field that answers "why does this
                      matter", not the full qualification writeup. */}
                  {c.whyRelevant && (
                    <dl className="m-0 text-[13px]">
                      <Detail term="Why relevant" value={c.whyRelevant} clamp={2} />
                    </dl>
                  )}

                  <div className="border-t border-line pt-3 text-[13px]">
                    <span className="text-text">
                      {c.contactName ?? <span className="text-text-tertiary">No contact yet</span>}
                      {c.contactDesignation && <span className="text-text-tertiary"> · {c.contactDesignation}</span>}
                    </span>
                    <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-text-secondary">
                      {c.contactEmail && <span className="break-all">{c.contactEmail}</span>}
                      {c.contactPhone && <span className="tabular">{c.contactPhone}</span>}
                      {c.linkedinUrl && (
                        <a href={c.linkedinUrl} target="_blank" rel="noreferrer" className="text-accent-ink no-underline hover:underline">
                          LinkedIn
                        </a>
                      )}
                      {websiteHref && (
                        <a href={websiteHref} target="_blank" rel="noreferrer" className="text-accent-ink no-underline hover:underline">
                          Website
                        </a>
                      )}
                    </span>
                  </div>

                  <div className={`rounded-lg px-3 py-2 text-[12px] ${c.overdue ? "bg-danger-subtle" : "bg-surface-sunken"}`}>
                    <span className={c.overdue ? "font-medium text-danger" : "text-text-secondary"}>
                      {c.nextActionAt ? `${c.overdue ? "Overdue" : "Next action"} · ${c.nextActionAt}` : "No next action set"}
                    </span>
                    {c.nextActionNote && <span className="text-text"> — {c.nextActionNote}</span>}
                  </div>

                  {/* Added/Added by dropped from the card — still on the
                      record's own Attribution/Commercial tab; a scanning
                      card needs who owns it and how stale it is, not
                      provenance. */}
                  <footer className="mt-auto grid grid-cols-3 gap-x-4 gap-y-1 text-[12px]">
                    <Meta term="Assigned to" value={c.owner} />
                    <Meta term="Team" value={c.team} />
                    <Meta term="Last activity" value={c.lastActivityAt ?? "None yet"} />
                  </footer>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function Detail({ term, value, clamp = 3 }: { term: string; value: string; clamp?: 1 | 2 | 3 }) {
  const clampClass = clamp === 1 ? "line-clamp-1" : clamp === 2 ? "line-clamp-2" : "line-clamp-3";
  return (
    <div>
      <dt className="text-[13px] uppercase tracking-[0.02em] text-text-secondary">{term}</dt>
      <dd className={`m-0 mt-0.5 text-text ${clampClass}`}>{value}</dd>
    </div>
  );
}

function Meta({ term, value }: { term: string; value: string }) {
  return (
    <div className="min-w-0 truncate">
      <span className="text-text-tertiary">{term} </span>
      <span className="text-text">{value}</span>
    </div>
  );
}

export default withCapabilityPageAccess(OUTREACH_CAPABILITY, ProspectsPage);
