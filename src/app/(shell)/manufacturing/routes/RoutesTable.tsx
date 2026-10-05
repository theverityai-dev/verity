"use client";

import { DataTable } from "@/components/ui/DataTable";
import { CommandButton } from "@/components/ui/CommandAccess";
import { CommandFailure, useCommand } from "@/components/ui/CommandForm";

type RouteRow = {
  id: string;
  code: string;
  name: string;
  chain: string;
  stages: number;
  state: string;
  category: string;
};

/** The routes list with Archive / Restore per row (`set_route_active`). */
export function RoutesTable({ rows }: { rows: RouteRow[] }) {
  const toggle = useCommand("/manufacturing/routes");
  return (
    <>
      <DataTable
        caption="Production routes"
        rows={rows}
        columns={[
          { key: "code", header: "Code", sortable: true, subKey: "name" },
          { key: "chain", header: "Stages" },
          { key: "stages", header: "Count", numeric: true },
          { key: "state", header: "State", variant: "state", categoryKey: "category" },
        ]}
        emptyTitle="No routes yet"
        emptyDescription="Create one to plan orders into stages such as cutting, stitching and packing."
        rowActions={(row) => {
          const route = row as unknown as RouteRow;
          const active = route.state === "active";
          return (
            <CommandButton
              commands="verity.manufacturing.set_route_active"
              size="sm"
              variant={active ? "ghost" : "secondary"}
              disabled={toggle.pending}
              onClick={() => toggle.run("verity.manufacturing.set_route_active", { routeId: route.id, active: !active })}
            >
              {active ? "Archive" : "Restore"}
            </CommandButton>
          );
        }}
      />
      <CommandFailure failure={toggle.failure} title="Could not change the route" />
    </>
  );
}
