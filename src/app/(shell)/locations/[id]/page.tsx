import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { assertRowInScope, ForbiddenError } from "@/server/platform/authorization";
import { LOCATION_CAPABILITY, ENTITY_LOCATION } from "@/server/capabilities/location";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { installCapabilities } from "@/server/capabilities/registry";
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
} from "@/components/ui/primitives";
import { AuditTrail } from "@/components/shell/AuditTrail";
import { buildFormDescriptor } from "@/server/platform/experience";
import { hasTenantPermission } from "@/server/platform/authorization";
import { CustomFieldsPanel } from "./CustomFieldsPanel";
import { LocationActions } from "./LocationActions";

export const dynamic = "force-dynamic";

/**
 * Location detail — the reusable entity experience shape (§12):
 * identity, related records, history.
 *
 * Row-level authorization is re-checked here rather than assumed from the list.
 * A list filters, but a detail page can be reached by typing a URL, and the
 * platform must be the thing that says no.
 */
async function LocationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  installCapabilities();
  const { id } = await params;
  const actor = await requireActor();

  const data = await withTenant(actor.tenantId, async (tx) => {
    const location = await tx.location.findUnique({
      where: { id },
      include: { place: true, organization: true, geofences: true, assets: true, assignments: true },
    });
    if (!location) return { notFound: true as const };

    try {
      await assertRowInScope(tx, actor, ENTITY_LOCATION, "Read", {
        organizationId: location.organizationId,
        locationId: location.id,
      });
    } catch (error) {
      if (error instanceof ForbiddenError) return { denied: true as const };
      throw error;
    }

    const history = await entityHistory(tx, ENTITY_LOCATION, location.id);
    // Built from the tenant's own declarations, so a newly declared field
    // appears without this page changing (PLA-EXT-002).
    const descriptor = await buildFormDescriptor(tx, ENTITY_LOCATION);
    const canEdit = await hasTenantPermission(tx, actor.roleId, "Edit", ENTITY_LOCATION);
    // People who can be assigned: users of this tenant not already at this site.
    const assigned = new Set(location.assignments.map((a) => a.userId));
    const users = await tx.user.findMany({ select: { id: true, party: { select: { displayName: true } } } });
    const people = users
      .filter((u) => !assigned.has(u.id))
      .map((u) => ({ userId: u.id, name: u.party.displayName }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { location, history, descriptor, canEdit, people };
  });

  if ("notFound" in data) notFound();
  if ("denied" in data) return <PermissionDenied what="viewing this location" />;

  const { location, history } = data;

  return (
    <>
      {/*
        A detail page is an operational record, not a stack of equal cards. The
        title is the site's own name and the description carries the parent, so
        the masthead reads as one statement rather than a label stacked above a
        heading. The identity block sits at full width above the split — it is
        what the page is ABOUT, and burying it in a left column beside a history
        feed gives it the same weight as an audit row.
      */}
      <PageHeader
        title={location.name}
        description={
          location.place
            ? `${location.organization.name} · sited at ${location.place.name}.`
            : `${location.organization.name} · no place linked, so this site has no physical coordinates.`
        }
        actions={
          data.canEdit ? (
            <LocationActions
              locationId={location.id}
              people={data.people}
              defaultCentre={
                location.place?.latitude && location.place?.longitude
                  ? { lat: String(location.place.latitude), lng: String(location.place.longitude) }
                  : null
              }
            />
          ) : undefined
        }
      />

      <StatRow className="mb-6">
        <Stat label="Assets on site" value={location.assets.length} />
        <Stat label="Assigned users" value={location.assignments.length} />
        <Stat label="Geofences" value={location.geofences.length} />
        <Stat
          label="Coordinates"
          value={
            location.place?.latitude
              ? `${Number(location.place.latitude).toFixed(3)}, ${Number(location.place.longitude).toFixed(3)}`
              : "—"
          }
        />
      </StatRow>

      <div className="grid items-start gap-6 lg:grid-cols-[1.35fr_1fr]">
        <div className="flex flex-col gap-6">
          <Panel title="Identity">
            <DefinitionList
              items={[
                { term: "Organization", value: location.organization.name },
                {
                  term: "Place",
                  value: location.place ? location.place.name : "No place linked",
                },
              ]}
            />
          </Panel>

          <Panel
            title="Geofences"
            action={
              <span className="text-[12px] text-text-tertiary">Policies, not places</span>
            }
            flush
          >
            {location.geofences.length === 0 ? (
              <EmptyState
                title="No geofence defined"
                description="Evidence captured here will record coordinates but no boundary verdict."
              />
            ) : (
              <RowList>
                {location.geofences.map((fence) => (
                  <Row key={fence.id}>
                    <span className="text-[14px] text-text">{fence.name}</span>
                    <span className="tabular shrink-0 text-[12px] text-text-tertiary">
                      {Number(fence.centreLat).toFixed(4)}, {Number(fence.centreLng).toFixed(4)} ·{" "}
                      {fence.radiusMetres} m
                    </span>
                  </Row>
                ))}
              </RowList>
            )}
          </Panel>

          <CustomFieldsPanel
            entityKey={ENTITY_LOCATION}
            entityId={location.id}
            descriptor={data.descriptor}
            values={(location.customFields as Record<string, unknown>) ?? {}}
            canEdit={data.canEdit}
          />
        </div>

        <Panel title="History" flush>
          <AuditTrail
            entries={history.map((h) => ({
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

export default withCapabilityPageAccess(LOCATION_CAPABILITY, LocationDetailPage);
