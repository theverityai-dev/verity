/* eslint-disable no-restricted-syntax -- Task 121 grandfathered debt (bare <table>), migrate to DataTable/SmartTable opportunistically. The config `ignores` array's glob for this path is a known no-op: minimatch treats a literal `[domainId]` route segment as a bracket character class, not literal text, so it never matches — this inline comment is the only mechanism that actually protects this file. Same bug likely affects every other bracketed-route entry in that list; they're currently harmless only because each of those files also carries this same inline comment. */
import Link from "next/link";
import { RenameDomainButton } from "../../OutreachForms";
import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import {
  OUTREACH_CAPABILITY,
  ENTITY_DIRECTION,
  getChannelIntelligence,
  getDomainAging,
  getDomainFunnel,
  getDomainVelocity,
  getTeamComparison,
} from "@/server/capabilities/outreach";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { EmptyState, PageHeader, Panel, PermissionDenied } from "@/components/ui/primitives";
import { RangeSwitch } from "../../RangeSwitch";
import { RANGE_LABEL, percent, rangeFromParam, windowFor } from "../../range";

export const dynamic = "force-dynamic";

function VelocityStat({ label, stat }: { label: string; stat: { average: number | null; median: number | null; sampleSize: number } }) {
  return (
    <div className="rounded-lg border border-line px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-text-tertiary">{label}</p>
      {stat.sampleSize === 0 ? (
        <p className="mt-1 text-[13px] text-text-tertiary">No pairs yet</p>
      ) : (
        <p className="mt-1 text-[20px] font-medium tabular text-text">
          {stat.average} <span className="text-[12px] font-normal text-text-tertiary">days avg</span>
        </p>
      )}
      {stat.sampleSize > 0 && (
        <p className="text-[12px] text-text-tertiary">
          median {stat.median}d · n={stat.sampleSize}
        </p>
      )}
    </div>
  );
}

/**
 * Domain detail — Task 109 Phase F (master prompt §42-50). Combines the
 * funnel, velocity, aging, and team/channel breakdown for one domain. Every
 * number here links to its underlying records via the same lead/activity
 * tables the rest of the capability reads (§78 rule) — nothing here is a
 * fake or static figure.
 */
async function DomainDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ domainId: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  installCapabilities();
  const actor = await requireActor();
  const { domainId } = await params;
  const range = rangeFromParam((await searchParams).range, "month");

  const data = await withTenant(actor.tenantId, async (tx) => {
    if (!(await hasPermission(tx, actor.roleId, "Create", ENTITY_DIRECTION))) return { allowed: false as const };
    const domain = await tx.outreachDomain.findUnique({
      where: { id: domainId },
      select: { name: true, group: { select: { name: true } } },
    });
    if (!domain) return { allowed: true as const, domain: null };

    const tenant = await tx.tenant.findUnique({ where: { id: actor.tenantId }, select: { timeZone: true } });
    const window = windowFor(range, tenant?.timeZone ?? "Asia/Kolkata");
    const [funnel, velocity, aging, teams, channels] = await Promise.all([
      executeQuery(actor, getDomainFunnel, { domainId, ...window }),
      executeQuery(actor, getDomainVelocity, { domainId }),
      executeQuery(actor, getDomainAging, { domainId }),
      executeQuery(actor, getTeamComparison, { domainId, ...window }),
      executeQuery(actor, getChannelIntelligence, { domainId, ...window }),
    ]);
    return { allowed: true as const, domain, funnel, velocity, aging, teams, channels };
  });

  if (!data.allowed) return <PermissionDenied what="reading the domain workspace" />;
  if (!data.domain) notFound();

  const maxReached = Math.max(1, ...data.funnel!.stages.map((s) => s.reached));
  const activeTeams = data.teams!.filter((t) => t.leads > 0 || t.outreach > 0);

  return (
    <>
      <PageHeader
        title={data.domain.name}
        description={`${data.domain.group.name} · funnel, velocity, and aging for this domain only.`}
        actions={
          <>
            <Link
              href="/outreach/domains"
              className="rounded-md border border-line px-3 py-1 text-[13px] text-text no-underline transition-colors hover:bg-surface-sunken"
            >
              Back to Domains
            </Link>
            <RangeSwitch basePath={`/outreach/domains/${domainId}`} active={range} />
            <RenameDomainButton domainId={domainId} currentName={data.domain.name} />
          </>
        }
      />

      <div className="mb-6">
        <Panel title={`Funnel · leads added ${RANGE_LABEL[range].toLowerCase()}`} flush>
          {data.funnel!.stages[0]!.reached === 0 ? (
            <EmptyState title="No leads in this window" description="Widen the range — this domain has no leads created in it yet." compact />
          ) : (
            <>
              {data.funnel!.bottleneck && (
                <p className="mx-6 mt-4 mb-1 rounded-lg border border-danger/25 bg-danger-subtle px-4 py-3 text-[13px] text-text">
                  <span className="font-medium">Bottleneck.</span> {data.funnel!.bottleneck}
                </p>
              )}
              <div className="overflow-x-auto px-6 pb-2">
                <table className="w-full min-w-[640px] border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-text-tertiary">
                      <th className="py-2 font-medium">Stage</th>
                      <th className="w-[40%] py-2 font-medium">Reached</th>
                      <th className="py-2 text-right font-medium">At stage now</th>
                      <th className="py-2 text-right font-medium">From previous</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.funnel!.stages.map((s) => (
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

      <div className="mb-6">
        <Panel title="Velocity">
          <p className="mb-3 text-[12px] text-text-tertiary">
            Days between the checkpoints actually recorded — a coarser breakdown than stage-by-stage, stated rather than
            hidden.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <VelocityStat label="Lead → Opportunity" stat={data.velocity!.leadToOpportunity} />
            <VelocityStat label="Opportunity → Proposal" stat={data.velocity!.opportunityToProposal} />
            <VelocityStat label="Proposal → Closed" stat={data.velocity!.proposalToClosed} />
            <VelocityStat label="Lead → Closed" stat={data.velocity!.leadToClosed} />
          </div>
        </Panel>
      </div>

      <div className="mb-6">
        <Panel title="Aging — open leads by staleness" flush>
          <div className="grid grid-cols-3 gap-3 px-6 pt-4 pb-2 sm:grid-cols-3">
            <div className="rounded-lg border border-line px-4 py-3 text-center">
              <p className="text-[20px] font-medium tabular text-text">{data.aging!.over7d}</p>
              <p className="text-[11px] text-text-tertiary">7-14 days idle</p>
            </div>
            <div className="rounded-lg border border-line px-4 py-3 text-center">
              <p className="text-[20px] font-medium tabular text-text">{data.aging!.over14d}</p>
              <p className="text-[11px] text-text-tertiary">14-30 days idle</p>
            </div>
            <div className="rounded-lg border border-danger/25 bg-danger-subtle px-4 py-3 text-center">
              <p className="text-[20px] font-medium tabular text-text">{data.aging!.over30d}</p>
              <p className="text-[11px] text-text-tertiary">30+ days idle</p>
            </div>
          </div>
          {data.aging!.leads.length === 0 ? (
            <EmptyState title="Nothing aging" description="Every open lead in this domain has activity within the last week." compact />
          ) : (
            <ul className="divide-y divide-line px-6">
              {data.aging!.leads.slice(0, 10).map((l) => (
                <li key={l.id} className="flex items-center justify-between py-2 text-[13px]">
                  <Link href={`/outreach/${l.id}`} className="text-text no-underline hover:underline">
                    {l.companyName}
                  </Link>
                  <span className="tabular text-text-tertiary">{l.daysIdle}d idle</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="By team" flush>
          {activeTeams.length === 0 ? (
            <EmptyState title="No team activity" description="No team has touched a lead in this domain, in this window." compact />
          ) : (
            <div className="overflow-x-auto px-6">
              <table className="w-full min-w-[480px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-text-tertiary">
                    <th className="py-2 font-medium">Team</th>
                    <th className="py-2 text-right font-medium">Leads</th>
                    <th className="py-2 text-right font-medium">Outreach</th>
                    <th className="py-2 text-right font-medium">Rate</th>
                    <th className="py-2 text-right font-medium">Closed</th>
                  </tr>
                </thead>
                <tbody>
                  {activeTeams.map((t) => (
                    <tr key={t.teamId} className="border-b border-line last:border-none">
                      <td className="py-2.5">
                        <Link href={`/outreach/teams/${t.teamId}`} className="text-text no-underline hover:text-accent-ink hover:underline">
                          {t.teamName}
                        </Link>
                      </td>
                      <td className="tabular py-2.5 text-right text-text-secondary">{t.leads}</td>
                      <td className="tabular py-2.5 text-right text-text-secondary">{t.outreach}</td>
                      <td className="tabular py-2.5 text-right text-text-secondary">{percent(t.responseRate)}</td>
                      <td className="tabular py-2.5 text-right font-medium text-text">{t.closed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title="By channel" flush>
          {data.channels!.length === 0 ? (
            <EmptyState title="No channel activity" description="No outreach logged in this domain, in this window." compact />
          ) : (
            <div className="overflow-x-auto px-6">
              <table className="w-full min-w-[480px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-text-tertiary">
                    <th className="py-2 font-medium">Channel</th>
                    <th className="py-2 text-right font-medium">Outreach</th>
                    <th className="py-2 text-right font-medium">Rate</th>
                    <th className="py-2 text-right font-medium">Closed</th>
                  </tr>
                </thead>
                <tbody>
                  {data.channels!.map((c) => (
                    <tr key={c.key} className="border-b border-line last:border-none">
                      <td className="py-2.5 text-text">{c.key}</td>
                      <td className="tabular py-2.5 text-right text-text-secondary">{c.outreach}</td>
                      <td className="tabular py-2.5 text-right text-text-secondary">
                        {percent(c.responseRate)}
                        {c.thinSample && c.responseRate != null && <span className="ml-1 text-[11px] text-text-tertiary">thin</span>}
                      </td>
                      <td className="tabular py-2.5 text-right font-medium text-text">{c.closed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

export default withCapabilityPageAccess(OUTREACH_CAPABILITY, DomainDetailPage);
