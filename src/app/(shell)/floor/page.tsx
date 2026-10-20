import { withPageAccess } from "@/components/ui/PageAccess";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { installCapabilities } from "@/server/capabilities/registry";
import { executeQuery } from "@/server/platform/query";
import { listFloor, listSelfOrderInbox, type FloorTable } from "@/server/capabilities/dinein";
import { ForbiddenError } from "@/server/platform/authorization";
import { PageHeader, PermissionDenied, StatTile, StatTileRow } from "@/components/ui/primitives";
import { ProgressRing } from "@/components/ui/viz";
import { FloorPlan } from "./FloorPlan";
import { SelfOrderInbox } from "./SelfOrderInbox";

export const dynamic = "force-dynamic";

/**
 * The floor.
 *
 * A restaurant floor is a place, not a list, so this draws the plan the manager
 * laid out — tables where they actually stand, coloured by what they are doing.
 * A table list sorted by label would be quicker to build and useless during
 * service: a waiter looks up and sees the room, not row 14.
 *
 * The list is still there underneath for narrow screens and for anyone reading
 * with a screen reader, because a picture that is the only way to use the page
 * excludes people.
 */
async function FloorPage() {
  installCapabilities();
  const actor = await requireActor();

  let tables: FloorTable[];
  try {
    tables = await executeQuery(actor, listFloor, {});
  } catch (error) {
    if (error instanceof ForbiddenError) return <PermissionDenied what="the floor" />;
    throw error;
  }

  // What guests are waiting on. Someone who may not see it simply sees nothing here.
  const inbox = await executeQuery(actor, listSelfOrderInbox, {}).catch(() => ({ submissions: [], requests: [] }));
  const waiting: Record<string, number> = {};
  for (const item of [...inbox.submissions, ...inbox.requests]) {
    if (item.tableId) waiting[item.tableId] = (waiting[item.tableId] ?? 0) + 1;
  }

  const usable = tables.filter((table) => table.stage !== "out_of_service");
  const occupied = tables.filter((table) => table.state === "occupied");
  const guests = occupied.reduce((sum, table) => sum + (table.covers ?? 0), 0);
  const seatsAtThem = occupied.reduce((sum, table) => sum + table.seats, 0);
  const dishes = tables.reduce((sum, table) => sum + table.openLines, 0);

  // What needs a waiter's feet now, in the order a floor manager reads it.
  const foodReady = tables.filter((table) => table.stage === "ready").length;
  const guestCalls = Object.keys(waiting).length;
  const seatedLong = tables.filter((table) => table.needsAttention).length;
  const cleaning = tables.filter((table) => table.stage === "cleaning").length;
  const needs = foodReady + guestCalls + seatedLong + cleaning;
  const needsHint = [
    foodReady && `${foodReady} food ready`,
    guestCalls && `${guestCalls} guest call${guestCalls === 1 ? "" : "s"}`,
    seatedLong && `${seatedLong} seated long`,
    cleaning && `${cleaning} to clean`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <PageHeader
        title="Floor"
        description="Where every table is in its service, and what needs a waiter now."
      />

      <StatTileRow className="mb-6">
        <StatTile
          kind="table"
          label="Tables in use"
          value={`${occupied.length} of ${usable.length}`}
          viz={<ProgressRing value={occupied.length} total={Math.max(usable.length, 1)} tone="active" label="Tables in use" showValue={false} size={36} />}
        />
        <StatTile kind="people" label="Guests seated" value={guests} hint={occupied.length ? `at ${seatsAtThem} seats` : "No one seated"} />
        <StatTile
          icon="bell"
          state={needs > 0 ? "pending" : "completed"}
          label="Needs a waiter"
          value={needs}
          hint={needs > 0 ? needsHint : "Nothing waiting"}
        />
        <StatTile kind="dish" label="Dishes to come" value={dishes} hint="Ordered, not yet served" href="/kitchen" />
      </StatTileRow>

      <SelfOrderInbox inbox={inbox} />
      <FloorPlan tables={tables} waiting={waiting} />
    </>
  );
}

export default withPageAccess(FloorPage);
