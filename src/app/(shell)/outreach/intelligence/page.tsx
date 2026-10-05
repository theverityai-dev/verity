import Link from "next/link";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import {
  OUTREACH_CAPABILITY,
  ENTITY_DIRECTION,
  getChannelIntelligence,
  getConversionFunnel,
  getVerticalIntelligence,
} from "@/server/capabilities/outreach";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { EmptyState, PageHeader, Panel, PermissionDenied } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { RangeSwitch } from "../RangeSwitch";
import { RANGE_LABEL, percent, rangeFromParam, windowFor } from "../range";
import { IntelligenceFilters } from "./IntelligenceFilters";

export const dynamic = "force-dynamic";

/**
 * Intelligence — Company Core's "which markets, channels and stages are
 * actually converting" screen (Task 106 Phase 7, spec §90; master-context
 * §52-54, §63). Three reads over the same activity log and lead table the
 * rest of the capability writes; nothing here is typed in or stored.
 *
 * Core-only: Create on Direction is the same structural signal the
 * Outreach page uses for its Core view — a Senior reaches Team Command's
 * own per-team numbers instead, never a company-wide comparison.
 */
async function IntelligencePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; team?: string; owner?: string }>;
}) {
  installCapabilities();
  const actor = await requireActor();
  const sp = await searchParams;
  const range = rangeFromParam(sp.range, "month");
  const teamId = sp.team || undefined;
  const ownerId = sp.owner || undefined;

  const data = await withTenant(actor.tenantId, async (tx) => {
    if (!(await hasPermission(tx, actor.roleId, "Create", ENTITY_DIRECTION))) return null;
    const [tenant, teams] = await Promise.all([
      tx.tenant.findUnique({ where: { id: actor.tenantId }, select: { timeZone: true } }),
      tx.outreachTeam.findMany({
        where: { active: true },
        include: { memberships: { where: { active: true } } },
        orderBy: { name: "asc" },
      }),
    ]);
    const memberPartyIds = [
      ...new Set(teams.flatMap((t) => [t.leaderId, ...(t.coLeaderId ? [t.coLeaderId] : []), ...t.memberships.map((m) => m.partyId)])),
    ];
    const parties = memberPartyIds.length ? await tx.party.findMany({ where: { id: { in: memberPartyIds } } }) : [];
    const partyName = new Map(parties.map((p) => [p.id, p.displayName]));

    const window = { ...windowFor(range, tenant?.timeZone ?? "Asia/Kolkata"), teamId, ownerId };
    const [funnel, verticals, channels] = await Promise.all([
      executeQuery(actor, getConversionFunnel, window),
      executeQuery(actor, getVerticalIntelligence, window),
      executeQuery(actor, getChannelIntelligence, window),
    ]);
    return {
      funnel,
      verticals,
      channels,
      teamOptions: teams.map((t) => ({ value: t.id, label: t.name })),
      ownerOptions: memberPartyIds
        .map((id) => ({ value: id, label: partyName.get(id) ?? "Unknown" }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    };
  });

  if (!data) return <PermissionDenied what="reading company intelligence" />;

  const maxReached = Math.max(1, ...data.funnel.stages.map((s) => s.reached));
  const anyThin = data.verticals.some((r) => r.thinSample) || data.channels.some((r) => r.thinSample);

  return (
    <>
      <PageHeader
        title="Intelligence"
        description="Where the pipeline actually converts — by stage, by industry, by channel. Read from the outreach log and the lead table for the chosen window; nothing here is typed in."
        actions={
          <>
            <Link
              href="/outreach"
              className="rounded-[10px] bg-control px-3 py-1 text-[13px] font-semibold text-accent-ink no-underline transition-colors hover:bg-control-strong"
            >
              Back to Outreach
            </Link>
            <RangeSwitch basePath="/outreach/intelligence" active={range} />
          </>
        }
      />

      <IntelligenceFilters teams={data.teamOptions} owners={data.ownerOptions} />

      {/* Funnel first: the one reading that answers "where do we lose them"
          before "who". Reach-or-beyond bars, so each stage is a share of the
          same population and the drop between two bars IS the conversion. */}
      <div className="mb-6">
        <Panel title={`Conversion funnel · leads added ${RANGE_LABEL[range].toLowerCase()}`} flush>
          {data.funnel.stages[0]!.reached === 0 ? (
            <EmptyState
              title="No leads in this window"
              description="Widen the range, or add leads — the funnel reads leads by the date they were added."
              compact
            />
          ) : (
            <>
              {data.funnel.bottleneck && (
                <p className="mx-6 mt-4 mb-1 rounded-lg border border-danger/25 bg-danger-subtle px-4 py-3 text-[13px] text-text">
                  <span className="font-medium">Bottleneck.</span> {data.funnel.bottleneck}
                </p>
              )}
              <div className="overflow-x-auto px-6 pb-2">
                <table className="w-full min-w-[640px] border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[13px] uppercase tracking-[0.02em] text-text-secondary">
                      <th className="py-2 font-medium">Stage</th>
                      <th className="w-[40%] py-2 font-medium">Reached</th>
                      <th className="py-2 text-right font-medium">At stage now</th>
                      <th className="py-2 text-right font-medium">From previous</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.funnel.stages.map((s) => (
                      <tr key={s.key} className="border-b border-line last:border-none">
                        <td className="py-2 capitalize text-text">{s.key.replace(/_/g, " ")}</td>
                        <td className="py-2">
                          <div className="flex items-center gap-3">
                            <div
                              className="h-2 rounded-full bg-accent"
                              style={{ width: `${Math.max(2, (s.reached / maxReached) * 100)}%` }}
                              aria-hidden
                            />
                            <span className="tabular text-text-secondary">{s.reached}</span>
                          </div>
                        </td>
                        <td className="tabular py-2 text-right text-text-secondary">{s.atStage}</td>
                        <td className="tabular py-2 text-right text-text-secondary">{percent(s.conversionFromPrevious)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <IntelligenceTable
          title="By industry"
          keyHeader="Industry"
          rows={data.verticals}
          empty="No activity by industry in this window — industry is set on each lead."
          // Drills through to the prospects this row's number came from —
          // §8.6 requires the industry visual to drill through, and the key
          // here is free text (domain name or raw industry field, no id to
          // link to), so a filtered prospect search is the honest target.
          drillHref
        />
        <IntelligenceTable
          title="By channel"
          keyHeader="Channel"
          rows={data.channels}
          empty="No outreach logged in this window."
        />
      </div>

      {anyThin && (
        <p className="mt-4 text-[12px] text-text-tertiary">
          Rates marked <span className="text-text-secondary">thin</span> rest on fewer than 20 first outreaches — read them as
          a hint, not a finding.
        </p>
      )}
    </>
  );
}

export default withCapabilityPageAccess(OUTREACH_CAPABILITY, IntelligencePage);

function IntelligenceTable({
  title,
  keyHeader,
  rows,
  empty,
  drillHref,
}: {
  title: string;
  keyHeader: string;
  rows: Array<{
    key: string;
    leads: number;
    outreach: number;
    responses: number;
    meetings: number;
    proposals: number;
    closed: number;
    responseRate: number | null;
    thinSample: boolean;
  }>;
  empty: string;
  /** Link the key column to a filtered prospect search for this row. */
  drillHref?: boolean;
}) {
  const columns: Column[] = [
    drillHref
      ? { key: "key", header: keyHeader, sortable: true, variant: "link", href: "/outreach/prospects?{qs}" }
      : { key: "key", header: keyHeader, sortable: true },
    { key: "leads", header: "Leads", numeric: true, sortable: true },
    { key: "outreach", header: "Outreach", numeric: true, sortable: true },
    { key: "responses", header: "Responses", numeric: true, sortable: true },
    { key: "rate", header: "Rate", numeric: true, sortable: true },
    { key: "meetings", header: "Meetings", numeric: true, sortable: true },
    { key: "proposals", header: "Proposals", numeric: true, sortable: true },
    { key: "closed", header: "Closed", numeric: true, sortable: true },
  ];

  return (
    <Panel title={title} flush>
      {rows.length === 0 ? (
        <EmptyState title="Nothing to read yet" description={empty} compact />
      ) : (
        <DataTable
          columns={columns}
          rows={rows.map((r) => ({
            id: r.key,
            key: r.key,
            // "Unspecified" is the placeholder for leads with no domain and no
            // industry text, not a value any lead contains, so a text search for
            // it always returns nothing. The domain filter's `none` is the
            // real "no domain" query.
            qs: r.key === "Unspecified" ? "domain=none" : `q=${encodeURIComponent(r.key)}`,
            leads: r.leads,
            outreach: r.outreach,
            responses: r.responses,
            rate: percent(r.responseRate) + (r.thinSample && r.responseRate != null ? " (thin)" : ""),
            meetings: r.meetings,
            proposals: r.proposals,
            closed: r.closed,
          }))}
          caption={title}
        />
      )}
    </Panel>
  );
}
