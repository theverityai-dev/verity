import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { executeQuery } from "@/server/platform/query";
import { hasTenantPermission } from "@/server/platform/authorization";
import { withTenant } from "@/server/platform/tenancy";
import { installCapabilities } from "@/server/capabilities/registry";
import {
  ENTITY_NOTE,
  ENTITY_OPPORTUNITY,
  LOST_REASONS,
  RELATIONSHIP_CAPABILITY,
  describeObject,
  opportunityDetail,
  timeline,
} from "@/server/capabilities/relationship";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { EntityHeader } from "@/components/ui/EntityHeader";
import { dayLabel, moneyShort, relativeDay, type Described, type Row } from "@/components/records/model";
import Link from "next/link";
import { jobForOpportunity } from "@/server/capabilities/project";
import { IconTile } from "@/components/ui/IconTile";
import { Icon } from "@/components/ui/icons";
import { ArchiveButton, FactRow, OpenJobButton, RecordFields, StageTrack, Timeline, type TimelineEntry } from "../../_parts/crm-ui";

export const dynamic = "force-dynamic";

/**
 * One opportunity. Shape: ordered stages, so the stage track leads (stage n of m, the way out to won or lost); the
 * facts row gives value, probability, the weighted value and how far off the close date is; then details and the
 * timeline. A lost deal shows why it was lost before anything else.
 */
async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  installCapabilities();
  const { id } = await params;
  const actor = await requireActor();
  const opp = (await executeQuery(actor, opportunityDetail, { id })) as (Row & Record<string, unknown>) | null;
  if (!opp) notFound();
  const [described, entries, canWrite] = await Promise.all([
    executeQuery(actor, describeObject, { objectKey: ENTITY_OPPORTUNITY }) as Promise<Described>,
    executeQuery(actor, timeline, { kind: "opportunity", id }) as Promise<TimelineEntry[]>,
    withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Create", ENTITY_NOTE)),
  ]);
  const stages = opp.stages as Array<{ id: string; label: string; category: string; probability: number }>;
  const amount = typeof opp.amount === "number" ? opp.amount : null;
  const probability = Number(opp.probability ?? 0);
  const close = typeof opp.expectedCloseOn === "string" ? opp.expectedCloseOn : null;
  const company = opp.company as { id: string; label: string } | null;
  const category = String(opp.stageCategory);
  const lostReason = LOST_REASONS.find((r) => r.value === opp.lostReason)?.label;

  // A won deal becomes a job when the workspace has Jobs: either the job it became, or the way to open one.
  // Jobs are another capability, so their absence (or no permission) simply hides this.
  const handover =
    category === "Completed"
      ? await executeQuery(actor, jobForOpportunity, { opportunityId: opp.id })
          .then(async (job) => {
            if (job) return { job, customers: [] as Array<{ id: string; displayName: string }> };
            const customers = await withTenant(actor.tenantId, (tx) =>
              tx.tradingCustomer.findMany({ where: { active: true }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true } }),
            );
            return { job: null, customers };
          })
          .catch(() => null)
      : null;
  const firstWord = (s: string) => s.toLowerCase().replace(/\(demo\)/g, "").trim().split(/\s+/).slice(0, 2).join(" ");
  const suggested = handover && company ? handover.customers.find((c) => firstWord(c.displayName) === firstWord(company.label))?.id : undefined;

  return (
    <>
      <EntityHeader
        crumbs={[{ label: "Pipeline", href: "/crm/opportunities" }, ...(company ? [{ label: company.label, href: `/crm/companies/${company.id}` }] : [])]}
        title={String(opp.name)}
        code={String(opp.ref)}
        state={{ category: opp.archived ? "Cancelled" : category, label: opp.archived ? "Archived" : String(opp.stageLabel) }}
        meta={[company?.label, (opp.owner as { label: string } | null)?.label ? `Owner ${(opp.owner as { label: string }).label}` : null].filter(Boolean) as string[]}
        actions={
          <div className="flex flex-wrap gap-2">
            {handover && !handover.job && <OpenJobButton opportunityId={opp.id} title={String(opp.name)} customers={handover.customers} suggestedCustomerId={suggested} />}
            <ArchiveButton kind="opportunities" id={opp.id} archived={Boolean(opp.archived)} label={String(opp.ref)} />
          </div>
        }
      />

      {handover?.job && (
        <Link
          href={`/jobs/${handover.job.id}`}
          className="glass-card mb-4 flex min-h-14 items-center gap-3 rounded-[12px] px-4 py-3 text-text no-underline hover:bg-[var(--color-surface-sunken)]"
        >
          <IconTile kind="job" size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] text-text-secondary">Became job {handover.job.reference}</span>
            <span className="block truncate text-[15px] font-semibold">{handover.job.title}</span>
          </span>
          <span className="text-[13px] capitalize text-text-secondary">{handover.job.state.replace(/_/g, " ")}</span>
          <Icon name="chevronRight" size={16} className="text-text-tertiary" />
        </Link>
      )}

      {category === "Cancelled" && lostReason && (
        <p className="mb-4 mt-0 rounded-[12px] bg-[var(--color-state-blocked-fill)] px-4 py-3 text-[15px] text-[var(--color-state-blocked-on)]">
          <strong>Lost: {lostReason}.</strong> {typeof opp.lostNote === "string" ? opp.lostNote : ""}
        </p>
      )}

      <div className="mb-5 flex flex-col gap-4">
        <StageTrack described={described} opportunity={opp} stages={stages} />
        <FactRow
          items={[
            { label: "Amount", value: amount !== null ? moneyShort(amount) : "—" },
            { label: "Chance of closing", value: category === "Active" ? `${probability}%` : category === "Completed" ? "Won" : "Lost", tone: category === "Completed" ? "success" : category === "Cancelled" ? "danger" : undefined },
            { label: "Weighted value", value: amount !== null && category === "Active" ? moneyShort((amount * probability) / 100) : "—" },
            {
              label: close ? `Close ${dayLabel(close)}` : "Expected close",
              value: close ? relativeDay(close) : "Not set",
              tone: close && category === "Active" && new Date(`${close}T23:59:59Z`) < new Date() ? "danger" : undefined,
            },
          ]}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(320px,400px)_1fr]">
        <section aria-label="Details" className="glass-card h-fit rounded-[12px] px-4 py-2">
          <h2 className="m-0 py-2 text-[17px] font-semibold">Details</h2>
          <RecordFields
            described={described}
            row={opp}
            fieldKeys={["name", "company", "contact", "amount", "expectedCloseOn", "submissionDueOn", "source", "owner", "createdAt", ...(category === "Cancelled" ? ["lostReason"] : []), ...described.fields.filter((f) => f.custom).map((f) => f.key)]}
          />
        </section>
        <section aria-label="Timeline" className="min-w-0">
          <Timeline entries={entries} target={{ opportunityId: opp.id }} members={described.members} canWrite={canWrite} />
        </section>
      </div>
    </>
  );
}

export default withCapabilityPageAccess(RELATIONSHIP_CAPABILITY, OpportunityPage);
