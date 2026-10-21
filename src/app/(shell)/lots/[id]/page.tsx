import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_LOT, ENTITY_PIECEWORK_PAYMENT, PIECEWORK_CAPABILITY, lotDetail } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { CommandAccess } from "@/components/ui/CommandAccess";
import { DataTable } from "@/components/ui/DataTable";
import { JourneyMap, type JourneyStep } from "@/components/ui/JourneyMap";
import { ButtonLink, PageHeader, Panel, PermissionDenied, Stat, StatRow, StateBadge } from "@/components/ui/primitives";
import { CancelLot, EntryLedger } from "./LotActions";
import { PHASE_CATEGORY, PHASE_LABEL } from "../format";

export const dynamic = "force-dynamic";

async function LotDetailPage({ params }: { params: Promise<{ id: string }> }) {
  installCapabilities();
  const { id } = await params;
  const actor = await requireActor();

  const { allowed, canWage } = await withTenant(actor.tenantId, async (tx) => ({
    allowed: await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_LOT),
    // Wages are the workers' money: shown on a lot only to someone who may read payments.
    canWage: await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_PAYMENT),
  }));
  if (!allowed) return <PermissionDenied what="viewing this lot" />;

  const lot = await executeQuery(actor, lotDetail, { lotId: id });
  if (!lot) notFound();

  const steps: JourneyStep[] = lot.stages.map((s) => ({
    key: s.stageId,
    label: s.label,
    kind: "stage",
    description: `Issued ${s.issued} · Received ${s.received} · Pending ${s.pending}`,
    chip: s.days === null ? undefined : { icon: "clock", label: `${s.days} day${s.days === 1 ? "" : "s"} here` },
    status: s.issued === 0 ? "pending" : s.pending === 0 && s.received === s.issued ? "done" : "active",
  }));

  const holders = lot.stages.flatMap((s) => s.workers.filter((w) => w.issued > 0).map((w) => ({ id: `${s.stageId}:${w.workerId}`, stage: s.label, karigar: w.name, issued: w.issued, received: w.received, pending: w.pending })));

  return (
    <>
      <PageHeader
        title={`${lot.number} · ${lot.design}`}
        description={lot.note ?? `${lot.totalPieces} pieces, ${lot.bundleSize} to a bundle.`}
        actions={
          lot.phase === "cancelled" ? null : (
            <>
              <CommandAccess commands="verity.piecework.record_entry">
                <ButtonLink href={`/lots/entry?lot=${lot.id}`} variant="primary">Record entry</ButtonLink>
              </CommandAccess>
              <CancelLot lotId={lot.id} number={lot.number} />
            </>
          )
        }
      />

      <StatRow cols={4} className="mb-6">
        <div className="flex flex-col px-5 py-4">
          <span className="flex h-[26px] items-center text-[15px]">
            <StateBadge category={PHASE_CATEGORY[lot.phase]!} label={PHASE_LABEL[lot.phase]} />
          </span>
          <span className="mt-2 text-[12px] leading-[1.3] text-text-tertiary">State</span>
        </div>
        <Stat label="Stage" value={lot.stageLabel ?? "—"} hint={lot.location} />
        <Stat label="Days here" value={lot.daysHere ?? "—"} hint={lot.daysSinceMovement === null ? undefined : `Last moved ${lot.daysSinceMovement} days ago`} />
        <Stat label="Ready" value={lot.readyPieces} hint={`${lot.readyBundles} bundles of ${lot.bundleSize}`} />
      </StatRow>

      {lot.phase === "cancelled" && (
        <p role="status" className="mb-6 mt-0 rounded-[12px] bg-[var(--color-control)] px-4 py-3 text-[14px] text-text-secondary">
          This lot was cancelled{lot.cancelReason ? `: ${lot.cancelReason}` : ""}. Its number is not reused.
        </p>
      )}

      <section aria-label="Where the pieces are" className="mb-6">
        <JourneyMap steps={steps} label={`${lot.number} through the stages`} perRow={5} />
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Panel title="Who holds what" flush>
          <DataTable
            caption="Pieces with each karigar at each stage"
            rows={holders}
            columns={[
              { key: "stage", header: "Stage" },
              { key: "karigar", header: "Karigar" },
              { key: "issued", header: "Given", numeric: true },
              { key: "received", header: "Returned", numeric: true },
              { key: "pending", header: "Pending", numeric: true, sortable: true },
            ]}
            emptyTitle="Nothing issued yet"
            emptyDescription="Pieces appear here as they are given to a karigar."
          />
        </Panel>
        <Panel title="Every entry" flush>
          <EntryLedger lines={lot.entries} canWage={canWage} />
        </Panel>
      </div>
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, LotDetailPage);
