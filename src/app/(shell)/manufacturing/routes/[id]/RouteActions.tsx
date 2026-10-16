"use client";

import { CommandButton } from "@/components/ui/CommandAccess";
import { CommandFailure, useCommand } from "@/components/ui/CommandForm";

/** Archive or restore one route (`set_route_active`), from its own page. */
export function RouteActions({ routeId, active }: { routeId: string; active: boolean }) {
  const toggle = useCommand(`/manufacturing/routes/${routeId}`);
  return (
    <>
      <CommandButton
        commands="verity.manufacturing.set_route_active"
        variant={active ? "secondary" : "primary"}
        disabled={toggle.pending}
        onClick={() => toggle.run("verity.manufacturing.set_route_active", { routeId, active: !active })}
      >
        {active ? "Archive route" : "Restore route"}
      </CommandButton>
      <CommandFailure failure={toggle.failure} title="Could not change the route" />
    </>
  );
}
