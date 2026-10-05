"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Panel } from "@/components/ui/primitives";
import { Modal, ModalCancel } from "@/components/ui/Modal";
import { applyPackAction, removePackAction, rollbackPackAction } from "@/server/actions/hq";
import type { PackInstanceView, PackReleaseView } from "@/server/platform/operator";

const KIND_LABEL: Record<PackReleaseView["kind"], string> = {
  Apply: "Apply",
  Upgrade: "Upgrade to this version",
  Reapply: "Reapply",
};

function DiffList({ release }: { release: PackReleaseView }) {
  if (release.previewError) {
    return <p className="m-0 text-[13px] text-danger">{release.previewError.replace(/^E_[A-Z_]+:\s*/, "")}</p>;
  }
  const d = release.diff;
  if (!d) return null;
  const lines = [
    d.newCapabilities.length > 0 && `Turns on ${d.newCapabilities.length} ${d.newCapabilities.length === 1 ? "capability" : "capabilities"}: ${d.newCapabilities.join(", ")}`,
    d.newRoles.length > 0 && `Adds roles: ${d.newRoles.map((r) => r.split(".").pop()).join(", ")}`,
    d.newContributions.length > 0 && `Adds ${d.newContributions.length} screens or forms`,
    d.removedContributions.length > 0 && `Removes ${d.removedContributions.length} screens or forms`,
    d.dataMigrations.length > 0 && `Runs ${d.dataMigrations.length} data ${d.dataMigrations.length === 1 ? "change" : "changes"}`,
    d.irreversible && "Cannot be undone once applied",
  ].filter(Boolean) as string[];
  return lines.length === 0 ? (
    <p className="m-0 text-[13px] text-text-secondary">No changes for this client.</p>
  ) : (
    <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[13px] text-text-secondary">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

export function PacksAdmin({
  tenantId,
  releases,
  instances,
}: {
  tenantId: string;
  releases: PackReleaseView[];
  instances: PackInstanceView[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PackReleaseView | null>(null);

  function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        after?.();
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p role="alert" className="m-0 rounded-[12px] bg-danger-subtle px-4 py-3 text-[13px] text-danger">{error}</p>
      )}

      <Panel title={instances.length === 0 ? "This client runs no pack" : "Packs this client runs"}>
        {instances.length === 0 ? (
          <p className="m-0 text-[13px] text-text-secondary">Apply a pack below to set this client up from a template.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {instances.map((instance) => (
              <li key={instance.instanceId} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3 last:border-b-0">
                <div className="min-w-0">
                  <div className="text-[15px] font-medium">{instance.packKey}</div>
                  <div className="text-[13px] text-text-secondary">
                    {instance.state === "Active" ? `Version ${instance.appliedVersion ?? "unknown"}` : instance.state}
                  </div>
                </div>
                {instance.state === "Active" && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => rollbackPackAction(tenantId, instance.instanceId))}>
                      Roll back
                    </Button>
                    <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => removePackAction(tenantId, instance.instanceId))}>
                      Remove
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Available packs">
        <ul className="m-0 flex list-none flex-col p-0">
          {releases.map((release) => (
            <li key={release.releaseId} className="flex flex-col gap-2 border-b border-line py-3 last:border-b-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[15px] font-medium">{release.name}</div>
                  <div className="text-[13px] text-text-secondary">
                    {release.key} · version {release.version} · signed by {release.publisher}
                  </div>
                </div>
                <Button size="sm" variant="primary" disabled={pending || Boolean(release.previewError)} onClick={() => setConfirm(release)}>
                  {KIND_LABEL[release.kind]}
                </Button>
              </div>
              <DiffList release={release} />
            </li>
          ))}
        </ul>
      </Panel>

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm ? `${KIND_LABEL[confirm.kind]}: ${confirm.name}` : "Apply pack"}
        description="The plan is recomputed on the server when you confirm. If it no longer matches, nothing is applied."
        footer={
          <>
            <ModalCancel onClose={() => setConfirm(null)} disabled={pending} />
            <Button
              variant="primary"
              disabled={pending}
              onClick={() => confirm && run(() => applyPackAction(tenantId, confirm.releaseId, confirm.kind), () => setConfirm(null))}
            >
              {pending ? "Applying…" : "Confirm"}
            </Button>
          </>
        }
      >
        {confirm && <DiffList release={confirm} />}
      </Modal>
    </div>
  );
}
