import Link from "next/link";
import { withPageAccess } from "@/components/ui/PageAccess";
import { requireActor } from "@/server/platform/auth";
import { installCapabilities } from "@/server/capabilities/registry";
import { executeQuery } from "@/server/platform/query";
import { ForbiddenError } from "@/server/platform/authorization";
import {
  kitchenCancelled,
  kitchenQueue,
  listKitchenSetup,
  listUnprintedTickets,
  type CancelledDish,
  type KitchenTicket,
  type UnprintedTicket,
} from "@/server/capabilities/dinein";
import { PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { KitchenBoard } from "./KitchenBoard";

export const dynamic = "force-dynamic";

/**
 * The kitchen.
 *
 * Permitted by ADR-014, inside the four boundaries it sets: capability-private,
 * no kitchen vocabulary in the platform, no recipe or inventory logic, and
 * timing that rides the existing SLA substrate rather than a bespoke timer.
 * DEC-001 still excludes a Kitchen Display System from Verity's core, and this
 * screen is not one — nothing here is reusable by another capability, which is
 * exactly what makes it permitted.
 *
 * A STATION is a view: `?station=` shows one station's dishes. It is not a
 * permission, so anyone who may see the kitchen may switch (ADR-041).
 */
async function KitchenPage({ searchParams }: { searchParams: Promise<{ station?: string }> }) {
  installCapabilities();
  const actor = await requireActor();
  const params = await searchParams;

  // Station names need the floor-setup read; a cook without it simply sees no chips.
  const setup = await executeQuery(actor, listKitchenSetup, {}).catch(() => null);
  const stations = (setup?.outlets ?? []).flatMap((o) =>
    o.stations.filter((s) => s.active).map((s) => ({ id: s.id, name: setup!.outlets.length > 1 ? `${o.locationName}: ${s.name}` : s.name })),
  );
  const stationId = stations.some((s) => s.id === params.station) ? params.station : undefined;

  let tickets: KitchenTicket[];
  let cancelled: CancelledDish[];
  let recent: UnprintedTicket[];
  let unprinted: UnprintedTicket[];
  try {
    [tickets, cancelled, recent, unprinted] = await Promise.all([
      executeQuery(actor, kitchenQueue, { stationId }),
      executeQuery(actor, kitchenCancelled, { stationId }),
      executeQuery(actor, listUnprintedTickets, { stationId, includePrinted: true }),
      executeQuery(actor, listUnprintedTickets, { stationId }),
    ]);
  } catch (error) {
    if (error instanceof ForbiddenError) return <PermissionDenied what="the kitchen queue" />;
    throw error;
  }

  return (
    <>
      <PageHeader
        title="Kitchen"
        description="What is waiting, what is on, and what is ready to go out. Oldest first, starters before mains."
        actions={
          <Link href="/kitchen/setup" className="text-[13px] text-text-secondary underline-offset-4 hover:underline">
            Stations and courses
          </Link>
        }
      />
      <KitchenBoard
        tickets={tickets}
        cancelled={cancelled}
        stations={stations}
        activeStationId={stationId ?? null}
        recent={recent.map((t) => ({ id: t.id, number: t.number, kind: t.kind, stationName: t.stationName, prints: t.prints }))}
        nextUnprintedId={unprinted[0]?.id ?? null}
      />
    </>
  );
}

export default withPageAccess(KitchenPage);
