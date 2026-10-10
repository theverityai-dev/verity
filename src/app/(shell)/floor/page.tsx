import { withPageAccess } from "@/components/ui/PageAccess";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { installCapabilities } from "@/server/capabilities/registry";
import { executeQuery } from "@/server/platform/query";
import { listFloor, listSelfOrderInbox, type FloorTable } from "@/server/capabilities/dinein";
import { ForbiddenError } from "@/server/platform/authorization";
import { PageHeader, PermissionDenied, Stat, StatRow } from "@/components/ui/primitives";
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

  const occupied = tables.filter((table) => table.state === "occupied").length;
  const cleaning = tables.filter((table) => table.state === "cleaning").length;
  const seatsInUse = tables
    .filter((table) => table.state === "occupied")
    .reduce((sum, table) => sum + (table.covers ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Floor"
        description="Where every table is and what it is doing right now."
      />

      <StatRow className="mb-6">
        <Stat label="Tables occupied" value={`${occupied} of ${tables.length}`} />
        <Stat label="Guests seated" value={seatsInUse} />
        <Stat label="Awaiting cleaning" value={cleaning} />
        <Stat
          label="Dishes outstanding"
          value={tables.reduce((sum, table) => sum + table.openLines, 0)}
        />
      </StatRow>

      <SelfOrderInbox inbox={inbox} />
      <FloorPlan tables={tables} waiting={waiting} />
    </>
  );
}

export default withPageAccess(FloorPage);
