import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_LOT, PIECEWORK_CAPABILITY, lotDetail } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { CommandAccess } from "@/components/ui/CommandAccess";
import { DataTable } from "@/components/ui/DataTable";
import { JourneyMap, type JourneyStep } from "@/components/ui/JourneyMap";
import { ButtonLink, PageHeader, Panel, PermissionDenied, Stat, StatRow, StateBadge } from "@/components/ui/primitives";
import { CancelLot, EntryLedger, NewBundleForm, StatusActions } from "./LotActions";
import { STATUS_CATEGORY, STATUS_LABEL, shortDate } from "../format";

export const dynamic = "force-dynamic";

async function LotDetailPage({ params }: { params: Promise<{ id: string }> }) {
  installCapabilities();
  const { id } = await params;
  const actor = await requireActor();

  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_LOT));
  if (!allowed) return <PermissionDenied what="viewing this lot" />;

  const lot = await executeQuery(actor, lotDetail, { lotId: id });
  if (!lot) notFound();

  const steps: JourneyStep[] = lot.stages.map((s) => {
    const losses = [s.rejected && `${s.rejected} rejected`, s.rework && `${s.rework} rework`, s.short && `${s.short} short`].filter(Boolean).join(" · ");
    return {
      key: s.stageId,
      label: s.label,
      kind: "stage",
      description: `Issued ${s.issued} · Good ${s.good} · Pending ${s.pending}`,
      chip: losses ? { icon: "flag", label: losses } : undefined,
      status: s.issued === 0 ? "pending" : s.pending === 0 && s.reworkPool === 0 ? "done" : "active",
    };
  });
  const cancelled = lot.status === "cancelled";

  return (
    <>
      <PageHeader
        title={`${lot.number} · ${lot.name ?? lot.design}`}
        description={[lot.name ? lot.design : null, lot.fabricType, lot.dueDate ? `Due ${shortDate(lot.dueDate)}${lot.overdue ? " (overdue)" : ""}` : null].filter(Boolean).join(" · ") || lot.note || undefined}
        actions={
          cancelled ? null : (
            <>
              <StatusActions lotId={lot.id} status={lot.status} />
              {lot.status === "active" && <NewBundleForm lotId={lot.id} />}
              {lot.status === "active" && (
                <CommandAccess commands="verity.piecework.record_issue">
                  <ButtonLink href={`/lots/entry?lot=${lot.id}`} variant="primary">Record entry</ButtonLink>
                </CommandAccess>
              )}
              {lot.status === "draft" && <CancelLot lotId={lot.id} number={lot.number} />}
            </>
          )
        }
      />

      <StatRow cols={4} className="mb-6">
        <div className="flex flex-col px-5 py-4">
          <span className="flex h-[26px] items-center text-[15px]"><StateBadge category={STATUS_CATEGORY[lot.status]!} label={STATUS_LABEL[lot.status]} /></span>
          <span className="mt-2 text-[12px] leading-[1.3] text-text-tertiary">Status</span>
        </div>
        <Stat label="Cut of planned" value={`${lot.bundledPieces} of ${lot.plannedPieces}`} hint={`${lot.bundles} bundle${lot.bundles === 1 ? "" : "s"}`} />
        <Stat label="Good ready" value={lot.readyPieces} hint={lot.stageLabel ? `${lot.stageLabel} · ${lot.location}` : lot.location} />
        <Stat label="Rejected · rework · short" value={`${lot.rejectedPieces} · ${lot.reworkPieces} · ${lot.shortPieces}`} hint="Kept apart, never counted as good" />
      </StatRow>

      {cancelled && (
        <p role="status" className="mb-6 mt-0 rounded-[12px] bg-[var(--color-control)] px-4 py-3 text-[14px] text-text-secondary">
          This lot was cancelled{lot.cancelReason ? `: ${lot.cancelReason}` : ""}. Its number is not reused.
        </p>
      )}

      {steps.length > 0 && lot.bundles > 0 && (
        <section aria-label="All bundles of this lot by stage" className="mb-6">
          <JourneyMap steps={steps} label={`${lot.number} through the stages`} perRow={5} />
        </section>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Panel title="Bundles" flush>
          <DataTable
            caption="Bundles cut from this lot"
            rows={lot.bundleRows.map((b) => ({
              id: b.id, number: b.number, net: b.netPieces, stage: b.stageLabel ?? "—", location: b.location, ready: b.readyPieces,
              pending: b.pendingPieces, losses: b.rejectedPieces + b.shortPieces + b.reworkPieces === 0 ? "—" : `${b.rejectedPieces} · ${b.reworkPieces} · ${b.shortPieces}`,
            }))}
            columns={[
              { key: "number", header: "Bundle", variant: "link", href: "/lots/bundles/{id}", sortable: true },
              { key: "net", header: "Net pieces", numeric: true },
              { key: "stage", header: "Stage" },
              { key: "location", header: "Location" },
              { key: "ready", header: "Good ready", numeric: true },
              { key: "pending", header: "Pending", numeric: true },
              { key: "losses", header: "Rej · rework · short" },
            ]}
            emptyTitle="No bundles yet"
            emptyDescription={lot.status === "draft" ? "Start the lot, then cut its bundles." : "Cut a bundle to give it a number and a slip."}
          />
        </Panel>
        <Panel title="Every entry" flush>
          <EntryLedger lines={lot.entries} />
        </Panel>
      </div>
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, LotDetailPage);
