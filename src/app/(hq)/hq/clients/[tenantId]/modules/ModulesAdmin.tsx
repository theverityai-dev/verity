"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorState, Panel } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { runClientCommand, upgradeCapabilityAction } from "@/server/actions/hq";
import type { ActionFailure } from "@/server/platform/action-error";
import type { ModuleRow } from "@/server/platform/administration";

const columns: Column[] = [
  { key: "name", header: "Module", sortable: true },
  { key: "version", header: "Version", sortable: true },
  { key: "dependsOn", header: "Depends on", sortable: false },
  { key: "status", header: "Status", sortable: true },
];

/**
 * Capability activation for one client.
 *
 * Three states, not two. "Not enabled" is a capability this client has never
 * had; "Suspended" is one it had and no longer runs — its data is still there,
 * and re-enabling brings it back. Collapsing them into a checkbox would make
 * those two situations indistinguishable at exactly the moment an operator most
 * needs to tell them apart.
 *
 * Disabling can be refused: a database trigger blocks suspending a capability
 * another active one depends on. That refusal is shown rather than swallowed,
 * because "Scheduling still needs this" is the useful outcome.
 */
export function ModulesAdmin({ tenantId, modules }: { tenantId: string; modules: ModuleRow[] }) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  function setState(capabilityId: string, enabled: boolean) {
    setFailure(null);
    startTransition(async () => {
      const result = await runClientCommand(tenantId, "verity.platform.set_capability_state", {
        capabilityId,
        enabled,
      });
      if (result.ok) router.refresh();
      else setFailure(result);
    });
  }

  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  // B2: move a client's pin to the installed version, one capability at a time.
  function upgrade(capabilityId: string) {
    setUpgradeError(null);
    startTransition(async () => {
      const result = await upgradeCapabilityAction(tenantId, capabilityId);
      if (result.ok) router.refresh();
      else setUpgradeError(result.message);
    });
  }

  return (
    <>
      {upgradeError && (
        <p role="alert" className="mb-4 mt-0 rounded-[12px] bg-danger-subtle px-4 py-3 text-[13px] text-danger">{upgradeError}</p>
      )}
      {failure && (
        <div className="mb-4">
          <ErrorState
            title="That change was refused"
            message={failure.message}
            issues={failure.issues}
            retryable={failure.retryable}
          />
        </div>
      )}

      <Panel title={`${modules.length} available`} flush>
        <DataTable
          columns={columns}
          rows={modules.map((module) => ({
            id: module.capabilityId,
            capabilityId: module.capabilityId,
            name: module.name,
            version:
              module.version +
              (module.pinnedVersion && module.pinnedVersion !== module.version
                ? ` (pinned ${module.pinnedVersion})`
                : ""),
            // Names, not capability ids: "Scheduling still needs this" is what an
            // operator can act on.
            dependsOn:
              module.dependencies.length === 0
                ? "—"
                : module.dependencies.map((id) => modules.find((m) => m.capabilityId === id)?.name ?? id).join(", "),
            status: module.status,
            active: module.status === "Active",
            behind: module.status === "Active" && module.pinnedVersion !== null && module.pinnedVersion !== module.version,
            installed: module.version,
          }))}
          caption="Capabilities available to this client"
          emptyTitle="No capabilities are installed on this platform"
          rowActions={(row) => (
            <div className="flex flex-wrap justify-end gap-2">
            {Boolean(row.behind) && (
              <Button size="sm" variant="primary" disabled={pending} aria-label={`Upgrade ${row.name} to ${row.installed}`} onClick={() => upgrade(String(row.capabilityId))}>
                Upgrade to {String(row.installed)}
              </Button>
            )}
            <Button
              size="sm"
              variant={row.active ? "secondary" : "primary"}
              disabled={pending}
              // Named per module, not just "Enable". A screen-reader user
              // hearing eleven identical buttons has no way to tell which
              // capability they are about to turn on.
              aria-label={`${row.active ? "Disable" : "Enable"} ${row.name}`}
              onClick={() => setState(String(row.capabilityId), !row.active)}
            >
              {row.active ? "Disable" : "Enable"}
            </Button>
            </div>
          )}
        />
      </Panel>
    </>
  );
}
