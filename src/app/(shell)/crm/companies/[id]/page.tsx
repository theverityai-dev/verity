import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import {
  ENTITY_COMPANY,
  ENTITY_NOTE,
  ENTITY_OPPORTUNITY,
  ENTITY_PERSON,
  RELATIONSHIP_CAPABILITY,
  companyDetail,
  describeObject,
  timeline,
} from "@/server/capabilities/relationship";
import { hasTenantPermission } from "@/server/platform/authorization";
import { withTenant } from "@/server/platform/tenancy";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { EntityHeader } from "@/components/ui/EntityHeader";
import { Avatar } from "@/components/ui/Avatar";
import { IconTile } from "@/components/ui/IconTile";
import { OptionPill } from "@/components/records/RecordView";
import { moneyShort, type Described, type Row } from "@/components/records/model";
import { ArchiveButton, FactRow, MergedNotice, NewOpportunityButton, NewPersonButton, RecordFields, Timeline, type TimelineEntry } from "../../_parts/crm-ui";

export const dynamic = "force-dynamic";

/**
 * One company. Shape: a party and its relationship. The header names it; the facts row answers "how much is open,
 * how much have we won, what is waiting on us"; the left column holds who we know there and the deals; the right
 * column is the timeline of everything that happened with them, with the composer on top.
 */
async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  installCapabilities();
  const { id } = await params;
  const actor = await requireActor();
  const company = (await executeQuery(actor, companyDetail, { id })) as (Row & Record<string, unknown>) | null;
  if (!company) notFound();
  const [described, oppDescribed, personDescribed, entries, canWrite] = await Promise.all([
    executeQuery(actor, describeObject, { objectKey: ENTITY_COMPANY }) as Promise<Described>,
    executeQuery(actor, describeObject, { objectKey: ENTITY_OPPORTUNITY }) as Promise<Described>,
    executeQuery(actor, describeObject, { objectKey: ENTITY_PERSON }) as Promise<Described>,
    executeQuery(actor, timeline, { kind: "company", id }) as Promise<TimelineEntry[]>,
    withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Create", ENTITY_NOTE)),
  ]);
  const stats = company.stats as { openCount: number; openValue: number; wonCount: number; wonValue: number; openFollowUps: number };
  const people = company.people as Array<{ id: string; name: string; jobTitle: string | null; email: string | null; phone: string | null }>;
  const opportunities = company.opportunities as Array<Row & { name: string; ref: string; stageLabel: string; stageCategory: string; amount: number | null }>;
  const ref = { id: company.id, label: String(company.name) };
  const stageField = oppDescribed.fields.find((f) => f.key === "stage");

  return (
    <>
      <EntityHeader
        crumbs={[{ label: "Companies", href: "/crm/companies" }]}
        title={String(company.name)}
        state={company.archived ? { category: "Cancelled", label: "Archived" } : undefined}
        meta={[company.industry, company.city, company.domain].filter(Boolean) as string[]}
        actions={
          <div className="flex flex-wrap gap-2">
            <NewOpportunityButton described={oppDescribed} company={ref} compact />
            <NewPersonButton described={personDescribed} company={ref} compact />
            <ArchiveButton kind="companies" id={company.id} archived={Boolean(company.archived)} label={String(company.name)} />
          </div>
        }
      />

      {company.mergedInto ? <MergedNotice into={company.mergedInto as { id: string; label: string }} href={`/crm/companies/${(company.mergedInto as { id: string }).id}`} /> : null}

      <div className="mb-5">
        <FactRow
          items={[
            { label: "Open pipeline", value: moneyShort(stats.openValue) },
            { label: "Won to date", value: moneyShort(stats.wonValue), tone: stats.wonValue > 0 ? "success" : undefined },
            { label: "Open deals", value: stats.openCount },
            { label: "Follow-ups open", value: stats.openFollowUps },
          ]}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(320px,400px)_1fr]">
        <div className="flex min-w-0 flex-col gap-5">
          <section aria-label="Details" className="glass-card rounded-[12px] px-4 py-2">
            <h2 className="m-0 py-2 text-[17px] font-semibold">Details</h2>
            <RecordFields
              described={described}
              row={company}
              fieldKeys={["name", "domain", "industry", "sizeBand", "phone", "email", "taxId", "city", "region", "country", "owner", "source", ...described.fields.filter((f) => f.custom).map((f) => f.key)]}
            />
          </section>

          <section aria-label="People" className="glass-card rounded-[12px]">
            <div className="flex items-center justify-between px-4 pb-1 pt-3">
              <h2 className="m-0 text-[17px] font-semibold">People <span className="tabular text-text-secondary">{people.length}</span></h2>
            </div>
            {people.length === 0 ? (
              <p className="m-0 px-4 pb-4 pt-1 text-[15px] text-text-secondary">No one here yet. Add the people you deal with.</p>
            ) : (
              <ul className="m-0 list-none p-0">
                {people.map((p) => (
                  <li key={p.id} className="border-t border-[var(--color-separator)] first:border-t-0">
                    <Link href={`/crm/people/${p.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2 text-text no-underline hover:bg-[var(--color-surface-sunken)]">
                      <Avatar name={p.name} size={34} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold">{p.name}</span>
                        <span className="block truncate text-[14px] text-text-secondary">{[p.jobTitle, p.email ?? p.phone].filter(Boolean).join(" · ") || "No details"}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Opportunities" className="glass-card rounded-[12px]">
            <h2 className="m-0 px-4 pb-1 pt-3 text-[17px] font-semibold">Opportunities <span className="tabular text-text-secondary">{opportunities.length}</span></h2>
            {opportunities.length === 0 ? (
              <p className="m-0 px-4 pb-4 pt-1 text-[15px] text-text-secondary">No deals yet.</p>
            ) : (
              <ul className="m-0 list-none p-0">
                {opportunities.map((o) => (
                  <li key={o.id} className="border-t border-[var(--color-separator)] first:border-t-0">
                    <Link href={`/crm/opportunities/${o.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2 text-text no-underline hover:bg-[var(--color-surface-sunken)]">
                      <IconTile kind="enquiry" size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold">{o.name}</span>
                        <span className="mt-0.5 flex items-center gap-2">
                          <OptionPill option={stageField?.options?.find((s) => s.value === o.stage)} fallback={o.stageLabel} />
                          <span className="tabular text-[13px] text-text-tertiary">{o.ref}</span>
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-[15px] font-semibold">{o.amount !== null ? moneyShort(o.amount) : ""}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section aria-label="Timeline" className="min-w-0">
          <Timeline entries={entries} target={{ companyId: company.id }} members={described.members} canWrite={canWrite} />
        </section>
      </div>
    </>
  );
}

export default withCapabilityPageAccess(RELATIONSHIP_CAPABILITY, CompanyPage);
