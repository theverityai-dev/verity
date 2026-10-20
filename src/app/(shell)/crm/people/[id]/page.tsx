import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { executeQuery } from "@/server/platform/query";
import { hasTenantPermission } from "@/server/platform/authorization";
import { withTenant } from "@/server/platform/tenancy";
import { installCapabilities } from "@/server/capabilities/registry";
import {
  ENTITY_NOTE,
  ENTITY_OPPORTUNITY,
  ENTITY_PERSON,
  RELATIONSHIP_CAPABILITY,
  describeObject,
  personDetail,
  timeline,
} from "@/server/capabilities/relationship";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { EntityHeader } from "@/components/ui/EntityHeader";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/icons";
import { OptionPill } from "@/components/records/RecordView";
import { moneyShort, type Described, type Row } from "@/components/records/model";
import { ArchiveButton, NewOpportunityButton, RecordFields, Timeline, type TimelineEntry } from "../../_parts/crm-ui";

export const dynamic = "force-dynamic";

/**
 * One person. The header puts the ways to reach them one tap away (call, email); the left column holds their details,
 * the deals they are the contact for and their colleagues; the right column is the timeline.
 */
async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  installCapabilities();
  const { id } = await params;
  const actor = await requireActor();
  const person = (await executeQuery(actor, personDetail, { id })) as (Row & Record<string, unknown>) | null;
  if (!person) notFound();
  const [described, oppDescribed, entries, canWrite] = await Promise.all([
    executeQuery(actor, describeObject, { objectKey: ENTITY_PERSON }) as Promise<Described>,
    executeQuery(actor, describeObject, { objectKey: ENTITY_OPPORTUNITY }) as Promise<Described>,
    executeQuery(actor, timeline, { kind: "person", id }) as Promise<TimelineEntry[]>,
    withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Create", ENTITY_NOTE)),
  ]);
  const company = person.company as { id: string; label: string } | null;
  const emails = person.emails as string[];
  const phones = person.phones as string[];
  const opportunities = person.opportunities as Array<Row & { name: string; ref: string; stageLabel: string; amount: number | null }>;
  const colleagues = person.colleagues as Array<{ id: string; name: string; jobTitle: string | null }>;
  const stageField = oppDescribed.fields.find((f) => f.key === "stage");
  const name = String(person.name);

  return (
    <>
      <div className="mb-2 flex items-center gap-4">
        <Avatar name={name} size={56} />
        <div className="min-w-0 flex-1">
          <EntityHeader
            crumbs={[{ label: "People", href: "/crm/people" }]}
            title={name}
            state={person.archived ? { category: "Cancelled", label: "Archived" } : undefined}
            meta={[person.jobTitle, company?.label].filter(Boolean) as string[]}
            actions={
              <div className="flex flex-wrap gap-2">
                {phones[0] && (
                  <a href={`tel:${phones[0].replace(/\s/g, "")}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] bg-[var(--color-control)] px-4 text-[15px] font-semibold text-accent-ink no-underline">
                    <Icon name="bell" size={16} /> Call
                  </a>
                )}
                {emails[0] && (
                  <a href={`mailto:${emails[0]}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] bg-[var(--color-control)] px-4 text-[15px] font-semibold text-accent-ink no-underline">
                    <Icon name="mail" size={16} /> Email
                  </a>
                )}
                <NewOpportunityButton described={oppDescribed} contact={{ id: person.id, label: name }} company={company ?? undefined} compact />
                <ArchiveButton kind="people" id={person.id} archived={Boolean(person.archived)} label={name} />
              </div>
            }
          />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(320px,400px)_1fr]">
        <div className="flex min-w-0 flex-col gap-5">
          <section aria-label="Details" className="glass-card rounded-[12px] px-4 py-2">
            <h2 className="m-0 py-2 text-[17px] font-semibold">Details</h2>
            <RecordFields described={described} row={person} fieldKeys={["givenName", "familyName", "jobTitle", "company", "emails", "phones", "city", "owner"]} />
          </section>

          <section aria-label="Opportunities" className="glass-card rounded-[12px]">
            <h2 className="m-0 px-4 pb-1 pt-3 text-[17px] font-semibold">Point of contact for <span className="tabular text-text-secondary">{opportunities.length}</span></h2>
            {opportunities.length === 0 ? (
              <p className="m-0 px-4 pb-4 pt-1 text-[15px] text-text-secondary">No deals name {String(person.givenName)} as the contact.</p>
            ) : (
              <ul className="m-0 list-none p-0">
                {opportunities.map((o) => (
                  <li key={o.id} className="border-t border-[var(--color-separator)] first:border-t-0">
                    <Link href={`/crm/opportunities/${o.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2 text-text no-underline hover:bg-[var(--color-surface-sunken)]">
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

          {company && colleagues.length > 0 && (
            <section aria-label="Colleagues" className="glass-card rounded-[12px]">
              <h2 className="m-0 px-4 pb-1 pt-3 text-[17px] font-semibold">Also at {company.label}</h2>
              <ul className="m-0 list-none p-0">
                {colleagues.map((c) => (
                  <li key={c.id} className="border-t border-[var(--color-separator)] first:border-t-0">
                    <Link href={`/crm/people/${c.id}`} className="flex min-h-12 items-center gap-3 px-4 py-2 text-text no-underline hover:bg-[var(--color-surface-sunken)]">
                      <Avatar name={c.name} size={28} />
                      <span className="min-w-0 flex-1 truncate text-[15px]">{c.name}</span>
                      <span className="truncate text-[14px] text-text-secondary">{c.jobTitle}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <section aria-label="Timeline" className="min-w-0">
          <Timeline entries={entries} target={{ personId: person.id }} members={described.members} canWrite={canWrite} />
        </section>
      </div>
    </>
  );
}

export default withCapabilityPageAccess(RELATIONSHIP_CAPABILITY, PersonPage);
