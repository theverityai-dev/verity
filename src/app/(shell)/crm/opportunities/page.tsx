import { requireActor } from "@/server/platform/auth";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_OPPORTUNITY, RELATIONSHIP_CAPABILITY, listStages, pipelineSummary } from "@/server/capabilities/relationship";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { EmptyState, PageHeader, PermissionDenied, StatTile, StatTileRow } from "@/components/ui/primitives";
import { StackedBar } from "@/components/ui/viz";
import { RecordView } from "@/components/records/RecordView";
import { moneyShort } from "@/components/records/model";
import { loadRecordPage } from "../_parts/load";
import { NewOpportunityButton, PipelineSettingsButton, SetupPipelineButton } from "../_parts/crm-ui";

export const dynamic = "force-dynamic";

/**
 * The pipeline. The job is to see what is open, what it is worth, what is slipping and what to move next, so the
 * first viewport answers those with real figures: open value and the stage-weighted forecast, won this month, the
 * win rate over 90 days, and overdue follow-ups; the bar splits open value across the stages it sits in. The board
 * is the default view because a pipeline is lanes; the same records are a table one tap away.
 */
async function OpportunitiesPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  installCapabilities();
  const { view } = await searchParams;
  const data = await loadRecordPage(ENTITY_OPPORTUNITY, view ?? "default-board");
  if (!data.ok) return <PermissionDenied what="reading opportunities" />;
  const actor = await requireActor();
  const [summary, stages] = await Promise.all([executeQuery(actor, pipelineSummary, {}), executeQuery(actor, listStages, {})]);
  const lost = stages.filter((s) => s.category === "Cancelled").map((s) => s.id);
  const openStages = summary.stages.filter((s) => s.category === "Active" && s.value > 0);
  const { described } = data;
  const any = summary.openCount + summary.wonThisMonth.count + summary.lostThisMonth > 0;

  return (
    <>
      <PageHeader
        title="Pipeline"
        description="Every open deal by stage, what it is worth, and what to move next."
        actions={
          <>
            {stages.length > 0 && <PipelineSettingsButton stages={stages} />}
            <NewOpportunityButton described={described} />
          </>
        }
      />

      {any && (
        <>
          <StatTileRow className="mb-4">
            <StatTile kind="sales" label="Open pipeline" value={moneyShort(summary.openValue)} hint={`${summary.openCount} open deal${summary.openCount === 1 ? "" : "s"}`} />
            <StatTile kind="quote" label="Weighted forecast" value={moneyShort(summary.weightedValue)} hint="value × each stage's chance of closing" />
            <StatTile
              state="completed"
              icon="check"
              label="Won this month"
              value={moneyShort(summary.wonThisMonth.value)}
              hint={`${summary.wonThisMonth.count} won · ${summary.lostThisMonth} lost${summary.winRate90 !== null ? ` · ${summary.winRate90}% win rate, 90 days` : ""}`}
            />
            <StatTile
              state={summary.followUpsOverdue > 0 ? "blocked" : "active"}
              icon="clock"
              label="Overdue follow-ups"
              value={summary.followUpsOverdue}
              hint={summary.closingThisMonth ? `${summary.closingThisMonth} deal${summary.closingThisMonth === 1 ? "" : "s"} due to close this month` : "nothing due to close this month"}
              href="/crm/follow-ups?scope=all"
            />
          </StatTileRow>
          {openStages.length > 1 && (
            <section aria-label="Open value by stage" className="glass-card mb-5 rounded-[12px] px-4 py-3.5">
              <StackedBar label="Open pipeline value by stage" segments={openStages.map((s) => ({ label: s.label, value: s.value }))} format={(n) => moneyShort(n)} />
            </section>
          )}
        </>
      )}

      {stages.length === 0 ? (
        <div className="glass-card rounded-[12px]">
          <EmptyState
            title="Set up your sales pipeline"
            description="Start with enquiry, qualified, technical quote, negotiation, won and lost. Rename, reorder or add stages any time from Pipeline settings."
            action={<SetupPipelineButton />}
          />
        </div>
      ) : (
      <RecordView
        described={described}
        views={data.views}
        initialViewId={data.viewId}
        initial={data.initial}
        reasonRule={{ groups: lost, field: "lostReason", noteField: "lostNote", title: "Why was it lost?" }}
        bulkActions={[
          { kind: "field", label: "Assign owner", command: "verity.relationship.bulk_update_opportunities", field: "owner" },
          { kind: "field", label: "Move stage", command: "verity.relationship.bulk_update_opportunities", field: "stage" },
          {
            kind: "simple", label: "Archive", command: "verity.relationship.archive_opportunities", destructive: true,
            confirm: "They leave the pipeline and keep their history.",
          },
        ]}
        emptyState={
          <div className="glass-card rounded-[12px]">
            <EmptyState
              title="Start your pipeline"
              description="Add the first enquiry or tender you are working on. It lands in the first stage; drag it along the board as it moves."
              action={<NewOpportunityButton described={described} />}
            />
          </div>
        }
      />
      )}
    </>
  );
}

export default withCapabilityPageAccess(RELATIONSHIP_CAPABILITY, OpportunitiesPage);
