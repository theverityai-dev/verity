import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import { SCHEDULING_CAPABILITY, ENTITY_BOOKING } from "@/server/capabilities/scheduling";
import { ENTITY_ASSET } from "@/server/capabilities/asset";
import { ENTITY_LOCATION } from "@/server/capabilities/location";
import { runQuery } from "@/server/actions/platform";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import {
  EmptyState,
  PageHeader,
  Panel,
  PermissionDenied,
  Stat,
  StatRow,
  Surface,
} from "@/components/ui/primitives";
import { ScheduleGrid } from "./ScheduleGrid";
import { ScheduleActions } from "./ScheduleActions";

export const dynamic = "force-dynamic";

type BookingRow = {
  id: string;
  resourceId: string;
  subjectEntityKey: string;
  subjectEntityId: string;
  startsAt: string;
  endsAt: string;
};

/**
 * Scheduling (§20) — the one place the brief encourages specialisation.
 *
 * A booking is a period, and a period is badly served by a row in a table: the
 * questions an operator asks are "what overlaps", "where is the gap", "who is
 * free", and a list answers none of them. So this is a resource-by-time grid,
 * with the actions that change it above it.
 *
 * Times are rendered in UTC with the offset stated. Bible V4 §5.B expects
 * schedulers to work in a local project context, but the platform has no
 * per-tenant timezone setting yet, and silently rendering UTC as though it were
 * local would misplace every booking by the offset. Stating the zone is honest;
 * guessing it is not. Recorded as a gap.
 */
async function SchedulingPage() {
  installCapabilities();
  const actor = await requireActor();

  const data = await withTenant(actor.tenantId, async (tx) => {
    if (!(await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_BOOKING))) return null;
    const [resources, unavailable, parties, assets, locations] = await Promise.all([
      tx.resource.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      tx.availabilityWindow.findMany({ where: { available: false } }),
      tx.party.findMany({ select: { id: true, displayName: true }, orderBy: { displayName: "asc" } }),
      tx.asset.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      tx.location.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);
    return { resources, unavailable, parties, assets, locations };
  });
  if (!data) return <PermissionDenied what="reading the schedule" />;

  // Bookings through the capability's own query, which carries the read rule.
  const bookingResult = await runQuery<BookingRow[]>("verity.scheduling.list_bookings", {});
  const bookings = bookingResult.ok ? bookingResult.data : [];

  // A booking names what it is for; show that thing's name, not its key.
  const subjectName = new Map<string, string>([
    ...data.assets.map((a) => [a.id, a.name] as const),
    ...data.locations.map((l) => [l.id, l.name] as const),
  ]);
  const resources = data.resources.map((r) => ({
    id: r.id,
    name: r.name,
    // ADR-008: exactly one backing, so this is never ambiguous.
    backing: r.partyId ? "Person" : "Asset",
  }));

  return (
    <>
      <PageHeader
        title="Scheduling"
        description="Resources across time. A resource is a single schedulable unit backed by exactly one person or asset."
      />

      <ScheduleActions
        resources={resources.map((r) => ({ id: r.id, name: r.name }))}
        parties={data.parties.map((p) => ({ id: p.id, name: p.displayName }))}
        assets={data.assets}
        subjects={[
          { key: ENTITY_LOCATION, label: "Location", options: data.locations },
          { key: ENTITY_ASSET, label: "Asset", options: data.assets },
        ]}
      />

      {resources.length === 0 ? (
        <Surface>
          <EmptyState
            title="No schedulable resources"
            description="Add a resource backed by a person or an asset, then book it or block its time."
          />
        </Surface>
      ) : (
        <>
          <StatRow cols={3} className="mb-6">
            <Stat label="Resources" value={resources.length} hint="Schedulable units" />
            <Stat label="Bookings" value={bookings.length} hint="Active" />
            <Stat label="Unavailable" value={data.unavailable.length} hint="Declared windows" />
          </StatRow>

          <ScheduleGrid
            resources={resources}
            bookings={bookings.map((b) => ({
              id: b.id,
              resourceId: b.resourceId,
              startsAt: new Date(b.startsAt).toISOString(),
              endsAt: new Date(b.endsAt).toISOString(),
              subject: subjectName.get(b.subjectEntityId) ?? "Booked",
            }))}
            unavailable={data.unavailable.map((w) => ({
              id: w.id,
              resourceId: w.resourceId,
              startsAt: w.startsAt.toISOString(),
              endsAt: w.endsAt.toISOString(),
            }))}
          />

          <div className="mt-6">
            <Panel title="Conflict rules">
              <p className="m-0 max-w-[70ch] text-[15px] leading-relaxed text-text-secondary">
                Overlaps are refused by the database, not by this screen. Intervals are half-open,
                so a booking that ends at 10:00 does not conflict with one that starts at 10:00.
              </p>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}

export default withCapabilityPageAccess(SCHEDULING_CAPABILITY, SchedulingPage);
