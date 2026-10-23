import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import {
  ENTITY_PIECEWORK_APPROVAL, ENTITY_PIECEWORK_LOT, ENTITY_PIECEWORK_LOT_RATE, ENTITY_PIECEWORK_ROLL, ENTITY_PIECEWORK_SETTING, PIECEWORK_CAPABILITY,
  listRolls, lotDetail, lotFabric, lotRateCard, productionSettings,
} from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { CommandAccess } from "@/components/ui/CommandAccess";
import { DataTable } from "@/components/ui/DataTable";
import { FloorBoard, PieceBar } from "@/components/ui/PieceFlow";
import { ButtonLink, DefinitionList, EmptyState, PageHeader, Panel, PermissionDenied, StateBadge, Surface } from "@/components/ui/primitives";
import { ProgressBar } from "@/components/ui/viz";
import Link from "next/link";
import { CancelLot, EntryLedger, StatusActions } from "./LotActions";
import { CutLot } from "./CutLot";
import { RateCard } from "./RateCard";
import { LotRequests } from "./LotRequests";
import { LotCover } from "./LotCover";
import { Cover } from "@/components/ui/Cover";
import { floorLanes } from "../floor";
import { STATUS_CATEGORY, STATUS_LABEL, rupees, shortDate } from "../format";

export const dynamic = "force-dynamic";

async function LotDetailPage({ params }: { params: Promise<{ id: string }> }) {
  installCapabilities();
  const { id } = await params;
  const actor = await requireActor();

  const { allowed, canChange, canRequest, canPhoto, canRates, canEditRates, canFabric, canSettings } = await withTenant(actor.tenantId, async (tx) => ({
    canRates: await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_LOT_RATE),
    canEditRates: await hasTenantPermission(tx, actor.roleId, "Edit", ENTITY_PIECEWORK_LOT_RATE),
    canFabric: await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_ROLL),
    canSettings: await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_SETTING),
    allowed: await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_LOT),
    canChange: await hasTenantPermission(tx, actor.roleId, "ActionExecute", ENTITY_PIECEWORK_LOT),
    canRequest: await hasTenantPermission(tx, actor.roleId, "Create", ENTITY_PIECEWORK_APPROVAL),
    canPhoto: await hasTenantPermission(tx, actor.roleId, "Create", "verity.evidence.evidence"),
  }));
  if (!allowed) return <PermissionDenied what="viewing this lot" />;

  const lot = await executeQuery(actor, lotDetail, { lotId: id });
  if (!lot) notFound();

  const cancelled = lot.status === "cancelled";
  // Money and fabric live on their own entities: a supervisor can open the lot and sees neither the rate card nor the metres.
  const [card, fabric, stock, settings] = await Promise.all([
    canRates ? executeQuery(actor, lotRateCard, { lotId: id }) : null,
    canFabric ? executeQuery(actor, lotFabric, { lotId: id }) : null,
    canFabric && (lot.status === "draft" || lot.status === "active") ? executeQuery(actor, listRolls, {}) : null,
    canSettings ? executeQuery(actor, productionSettings, {}) : null,
  ]);
  const rollChoices = stock ? stock.rolls.filter((r) => !r.cancelled && r.balanceCenti > 0).map((r) => ({ id: r.id, number: r.number, fabricType: r.fabricType, unit: r.unit, balanceCenti: r.balanceCenti })) : null;
  const lanes = floorLanes(lot.stages.map((s) => ({ id: s.stageId, label: s.label })), lot.placements, false);
  const facts: Array<{ term: string; value: ReactNode }> = [
    { term: "Design", value: lot.design },
    ...(lot.fabricType ? [{ term: "Fabric", value: lot.fabricType }] : []),
    ...(lot.startDate ? [{ term: "Started", value: shortDate(lot.startDate) }] : []),
    { term: "Due", value: lot.dueDate ? <span className={lot.overdue ? "font-semibold text-[var(--color-state-blocked)]" : undefined}>{shortDate(lot.dueDate)}{lot.overdue ? " · overdue" : ""}</span> : "Not set" },
    { term: "Now", value: lot.stageLabel ? `${lot.stageLabel} · ${lot.location}` : lot.location },
  ];

  return (
    <>
      <PageHeader
        back={{ href: "/lots", label: "Lots" }}
        title={`${lot.number} · ${lot.name ?? lot.design}`}
        description={lot.note ?? undefined}
        actions={
          cancelled ? null : (
            <>
              <StatusActions lotId={lot.id} status={lot.status} />
              {!canChange && canRequest && <LotRequests lotId={lot.id} status={lot.status} />}
              {(lot.status === "draft" || lot.status === "active") && <CutLot lotId={lot.id} lotNumber={lot.number} rolls={rollChoices} label={lot.bundles === 0 ? "Cut the lot" : "Cut more bundles"} />}
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

      {cancelled && (
        <p role="status" className="mb-6 mt-0 rounded-[12px] bg-[var(--color-control)] px-4 py-3 text-[14px] text-text-secondary">
          This lot was cancelled{lot.cancelReason ? `: ${lot.cancelReason}` : ""}. Its number is not reused.
        </p>
      )}

      <Surface className="mb-6 p-5">
        <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr] lg:gap-10">
          <div className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <Cover src={lot.cover} label={lot.number} size={72} rounded={16} />
              <StateBadge category={STATUS_CATEGORY[lot.status]!} label={STATUS_LABEL[lot.status]} />
              <span className="text-[15px] text-text-secondary">
                {lot.bundles === 0 ? "No bundle cut yet" : `${lot.bundles} bundle${lot.bundles === 1 ? "" : "s"}, ${lot.bundledPieces} pieces`}
              </span>
            </div>
            {lot.bundledPieces > 0 ? (
              <PieceBar
                size="lg"
                label={`${lot.number} pieces`}
                total={lot.bundledPieces}
                counts={{ ready: lot.readyPieces, out: lot.pendingPieces, rework: lot.reworkPieces, rejected: lot.rejectedPieces, short: lot.shortPieces }}
              />
            ) : (
              <p className="m-0 text-[15px] text-text-secondary">{lot.status === "draft" ? "Start the lot, then cut its bundles." : "Cut a bundle to give it a number and a slip."}</p>
            )}
            <div className="mt-5">
              <ProgressBar
                label="Cut against planned"
                value={lot.bundledPieces}
                total={Math.max(lot.plannedPieces, 1)}
                tone={lot.bundledPieces >= lot.plannedPieces ? "completed" : "active"}
                figures={`${lot.bundledPieces} of ${lot.plannedPieces} planned pieces cut`}
              />
            </div>
          </div>
          <div className="flex flex-col gap-4">
            <DefinitionList items={facts} />
            {canPhoto && !cancelled && <LotCover lotId={lot.id} hasCover={lot.cover !== null} />}
          </div>
        </div>
      </Surface>

      {lot.bundles > 0 && (
        <section aria-labelledby="floor-heading" className="mb-6">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3 px-1">
            <h2 id="floor-heading" className="m-0 text-[17px] font-semibold leading-[22px] tracking-[-0.02em]">Where every bundle is</h2>
            <Link href={`/lots/${lot.id}/slips`} className="text-[14px] font-medium text-accent-ink no-underline hover:underline">Print all slips</Link>
          </div>
          <FloorBoard lanes={lanes} label={`${lot.number} bundles by stage`} />
        </section>
      )}

      {lot.bundles === 0 && !cancelled && (
        <div className="mb-6">
          <EmptyState title="No bundles yet" description={lot.status === "draft" ? "Start the lot, then cut its bundles." : "Cut a bundle to give it a number and a slip."} />
        </div>
      )}

      {(card || fabric) && !cancelled && (
        <div className="mb-6 grid items-start gap-6 lg:grid-cols-[1.5fr_1fr]">
          {card && (
            <Panel title="Rate card">
              <RateCard lotId={lot.id} rows={card} factoryCharge={settings?.lostPieceChargeMinor ?? null} canEdit={canEditRates && lot.status !== "closed"} />
            </Panel>
          )}
          {fabric && (
            <Panel title="Fabric used">
              {fabric.rows.length === 0 ? (
                <p className="m-0 text-[14px] leading-[21px] text-text-secondary">No fabric has been taken from a roll for this lot. Cut it with its rolls and the metres appear here.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  <ul className="m-0 flex list-none flex-col divide-y divide-[var(--color-line)] p-0">
                    {fabric.rows.map((r) => (
                      <li key={r.rollId} className="flex items-baseline justify-between gap-3 py-2.5 first:pt-0">
                        <Link href={`/fabric/${r.rollId}`} className="text-[15px] font-medium text-text no-underline hover:underline">{r.rollNumber} <span className="font-normal text-text-secondary">· {r.fabricType}</span></Link>
                        <span className="text-[15px] text-text">{(r.netCenti / 100).toLocaleString("en-IN")} {r.unit}{r.costMinor !== null && <span className="ml-2 text-[13px] text-text-secondary">{rupees(r.costMinor)}</span>}</span>
                      </li>
                    ))}
                  </ul>
                  {lot.bundledPieces > 0 && fabric.totals.length === 1 && (
                    <p className="m-0 text-[13px] text-text-secondary">{(fabric.totals[0]!.netCenti / 100 / lot.bundledPieces).toFixed(2)} {fabric.totals[0]!.unit} per piece cut.{fabric.costMinor !== null && ` Fabric ${rupees(fabric.costMinor)}.`}</p>
                  )}
                </div>
              )}
            </Panel>
          )}
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[1.1fr_1fr]">
        <Panel title="Stage by stage" flush>
          <DataTable
            caption="What each stage has taken and returned"
            rows={lot.stages.map((s) => ({
              id: s.stageId, stage: s.label, issued: s.issued, good: s.good, pending: s.pending,
              losses: s.rejected + s.rework + s.short === 0 ? "—" : `${s.rejected} · ${s.rework} · ${s.short}`,
            }))}
            columns={[
              { key: "stage", header: "Stage" },
              { key: "issued", header: "Issued", numeric: true },
              { key: "good", header: "Good", numeric: true },
              { key: "pending", header: "Pending", numeric: true },
              { key: "losses", header: "Rej · rework · short" },
            ]}
            emptyTitle="No stages"
            emptyDescription="Add the stages first."
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
