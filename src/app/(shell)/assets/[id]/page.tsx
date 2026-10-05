import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import { ASSET_CAPABILITY, ENTITY_ASSET } from "@/server/capabilities/asset";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { ENTITY_EVIDENCE } from "@/server/capabilities/evidence";
import { entityHistory } from "@/server/platform/audit";
import {
  DefinitionList,
  EmptyState,
  PageHeader,
  Panel,
  PermissionDenied,
  Row,
  RowList,
  Stat,
  StatRow,
  StateBadge,
} from "@/components/ui/primitives";
import { AuditTrail } from "@/components/shell/AuditTrail";
import { AssetActions } from "./AssetActions";
import { EvidencePanel } from "./EvidencePanel";

export const dynamic = "force-dynamic";

/**
 * Asset detail — the full entity experience: identity, state and its permitted
 * transitions, related records, evidence, and history.
 *
 * The available actions come from the platform's own transition definitions
 * intersected with the actor's permissions. Nothing is offered that the command
 * pipeline would then refuse, and nothing is hidden that it would allow.
 */
async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  installCapabilities();
  const { id } = await params;
  const actor = await requireActor();

  const data = await withTenant(actor.tenantId, async (tx) => {
    if (!(await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_ASSET))) return { denied: true as const };

    const asset = await tx.asset.findUnique({ where: { id }, include: { location: true } });
    if (!asset) return { notFound: true as const };

    const states = await tx.stateDefinition.findMany({ where: { entityKey: ENTITY_ASSET } });
    const current = states.find((s) => s.key === asset.state);

    // Only transitions the capability actually declared from here.
    const outgoing = current
      ? await tx.transitionDefinition.findMany({
          where: { entityKey: ENTITY_ASSET, fromStateId: current.id },
        })
      : [];
    const byId = new Map(states.map((s) => [s.id, s]));

    const [canEdit, canCaptureEvidence, history, evidence, bookings, locations] = await Promise.all([
      hasTenantPermission(tx, actor.roleId, "Edit", ENTITY_ASSET),
      hasTenantPermission(tx, actor.roleId, "Create", ENTITY_EVIDENCE),
      entityHistory(tx, ENTITY_ASSET, asset.id),
      tx.evidence.findMany({ where: { entityKey: ENTITY_ASSET, entityId: asset.id }, orderBy: { capturedAt: "desc" } }),
      tx.booking.findMany({
        where: { subjectEntityKey: ENTITY_ASSET, subjectEntityId: asset.id, cancelled: false },
        orderBy: { startsAt: "asc" },
        include: { resource: true },
      }),
      tx.location.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);

    return {
      asset,
      category: current?.category ?? "Draft",
      isTerminal: current?.isTerminal ?? false,
      transitions: outgoing.map((t) => byId.get(t.toStateId)!).filter(Boolean),
      canEdit,
      canCaptureEvidence,
      history,
      evidence,
      bookings,
      locations,
    };
  });

  if ("denied" in data) return <PermissionDenied what="viewing this asset" />;
  if ("notFound" in data) notFound();

  return (
    <>
      {/*
        The asset's state is the single most important fact about it — it decides
        which transitions are offered and whether the record is writable at all
        (INV-002). It therefore sits in the masthead beside the name, not three
        rows down a definition list where it reads as one attribute among many.
      */}
      <PageHeader
        title={data.asset.name}
        description={
          data.isTerminal
            ? `At ${data.asset.location?.name ?? "no location"}. This asset is in a terminal state and is permanently read-only.`
            : `At ${data.asset.location?.name ?? "no location"}.`
        }
        actions={
          <AssetActions
            assetId={data.asset.id}
            transitions={data.transitions.map((s) => ({ key: s.key, category: s.category }))}
            canEdit={data.canEdit}
            isTerminal={data.isTerminal}
            locations={data.locations}
            currentLocationId={data.asset.locationId}
          />
        }
      />

      <StatRow className="mb-6">
        {/* State is a category, not a count, so it does not use `Stat` — but it
            sits on the same rhythm as the figures beside it: value first, label
            beneath. */}
        <div className="flex flex-col px-5 py-4">
          <span className="flex h-[26px] items-center text-[15px]">
            <StateBadge category={data.category} label={data.asset.state} />
          </span>
          <span className="mt-2 text-[12px] leading-[1.3] text-text-tertiary">State</span>
        </div>
        <Stat label="Bookings" value={data.bookings.length} />
        <Stat label="Evidence" value={data.evidence.length} />
        <Stat label="Version" value={data.asset.version} hint="Optimistic concurrency" />
      </StatRow>

      <div className="grid items-start gap-6 lg:grid-cols-[1.35fr_1fr]">
        <div className="flex flex-col gap-6">
          <Panel title="Identity">
            <DefinitionList
              items={[
                { term: "Location", value: data.asset.location?.name ?? "Unassigned" },
                { term: "Reference", value: data.asset.reference ?? "—" },
              ]}
            />
          </Panel>

          <Panel
            title="Scheduling"
            action={<span className="text-[12px] text-text-tertiary">Times in UTC</span>}
            flush
          >
            {data.bookings.length === 0 ? (
              <EmptyState
                title="Not scheduled"
                description="No booking references this asset. Bookings appear here once a resource backed by it is reserved."
              />
            ) : (
              <RowList>
                {data.bookings.map((b) => (
                  <Row key={b.id}>
                    <span className="text-[14px] text-text">{b.resource.name}</span>
                    <span className="tabular shrink-0 text-[12px] text-text-tertiary">
                      {b.startsAt.toISOString().replace("T", " ").slice(0, 16)} →{" "}
                      {b.endsAt.toISOString().slice(11, 16)}
                    </span>
                  </Row>
                ))}
              </RowList>
            )}
          </Panel>

          <EvidencePanel
            assetId={data.asset.id}
            canCapture={data.canCaptureEvidence}
            evidence={data.evidence.map((e) => ({
              id: e.id,
              kind: e.kind,
              capturedAt: e.capturedAt.toISOString(),
              withinFence: e.withinFence,
              uri: e.uri,
            }))}
          />
        </div>

        <Panel title="History" flush>
          <AuditTrail
            entries={data.history.map((h) => ({
              id: h.id,
              field: h.fieldChanged,
              from: h.oldValue,
              to: h.newValue,
              at: h.occurredAt.toISOString(),
              command: h.commandKey,
            }))}
          />
        </Panel>
      </div>
    </>
  );
}

export default withCapabilityPageAccess(ASSET_CAPABILITY, AssetDetailPage);
