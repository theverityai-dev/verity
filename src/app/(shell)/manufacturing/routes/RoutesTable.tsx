"use client";

import Link from "next/link";
import { CommandButton } from "@/components/ui/CommandAccess";
import { CommandFailure, useCommand } from "@/components/ui/CommandForm";
import { IconTile } from "@/components/ui/IconTile";
import { EmptyState, StateBadge, Surface } from "@/components/ui/primitives";
import { stageKindFor } from "@/components/ui/business/domains";

type RouteStage = { key: string; label: string; checks: number };
type RouteRow = {
  id: string;
  code: string;
  name: string;
  stages: RouteStage[];
  state: string;
  category: string;
};

/**
 * The routes as cards (Task 127 §4.1): each route shows its stage chain as a strip of kind tiles, so
 * two routes can be compared by shape at a glance. Archive / Restore per route (`set_route_active`).
 */
export function RoutesTable({ rows }: { rows: RouteRow[] }) {
  const toggle = useCommand("/manufacturing/routes");
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No routes yet"
        description="Create one to plan orders into stages such as cutting, winding and testing."
      />
    );
  }
  return (
    <>
      <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 xl:grid-cols-2">
        {rows.map((route) => {
          const active = route.state === "active";
          const checks = route.stages.reduce((n, s) => n + s.checks, 0);
          return (
            <li key={route.id}>
              <Surface className="flex h-full flex-col gap-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/manufacturing/routes/${route.id}`}
                      className="text-[17px] font-semibold text-text no-underline hover:underline focus-visible:underline"
                    >
                      {route.name}
                    </Link>
                    <p className="m-0 mt-0.5 text-[13px] text-text-secondary">{route.code}</p>
                  </div>
                  <StateBadge category={route.category} label={route.state} />
                </div>

                <ol
                  aria-label={`Stages of ${route.name}`}
                  className="m-0 flex list-none items-center gap-0 overflow-x-auto p-0 pb-1"
                >
                  {route.stages.map((s, i) => (
                    <li key={s.key} className="flex shrink-0 items-center">
                      {i > 0 && <span aria-hidden="true" className="h-0.5 w-4 bg-[var(--color-control-strong)]" />}
                      <span title={`${i + 1}. ${s.label}${s.checks ? ` (${s.checks} checks)` : ""}`}>
                        <IconTile kind={stageKindFor(s.key, s.label)} size="md" />
                        <span className="sr-only">{`${i + 1}. ${s.label}`}</span>
                      </span>
                    </li>
                  ))}
                </ol>

                <p className="m-0 text-[13px] text-text-secondary">
                  {route.stages.length} {route.stages.length === 1 ? "stage" : "stages"}
                  {checks > 0 ? ` · ${checks} ${checks === 1 ? "check" : "checks"}` : " · no checks"}
                </p>

                <div className="mt-auto flex items-center justify-between gap-2">
                  <Link href={`/manufacturing/routes/${route.id}`} className="text-[15px] font-medium text-accent-ink no-underline hover:underline">
                    View route
                  </Link>
                  <CommandButton
                    commands="verity.manufacturing.set_route_active"
                    size="sm"
                    variant={active ? "ghost" : "secondary"}
                    disabled={toggle.pending}
                    onClick={() => toggle.run("verity.manufacturing.set_route_active", { routeId: route.id, active: !active })}
                  >
                    {active ? "Archive" : "Restore"}
                  </CommandButton>
                </div>
              </Surface>
            </li>
          );
        })}
      </ul>
      <CommandFailure failure={toggle.failure} title="Could not change the route" />
    </>
  );
}
