"use client";

import { CommandButton } from "@/components/ui/CommandAccess";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ErrorState, Field, Select } from "@/components/ui/primitives";
import { FormModal, formText, useCommand } from "@/components/ui/CommandForm";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

/**
 * State transitions offered as real platform commands.
 *
 * The buttons are generated from the transitions the capability declared out of
 * the current state, so the interface cannot offer a move the state runtime
 * would refuse. Permission is checked server-side regardless — hiding a button
 * is presentation, not authorization, and the command pipeline remains the
 * thing that decides.
 */
export function AssetActions({
  assetId,
  transitions,
  canEdit,
  isTerminal,
  locations,
  currentLocationId,
}: {
  assetId: string;
  transitions: Array<{ key: string; category: string }>;
  canEdit: boolean;
  isTerminal: boolean;
  locations: Array<{ id: string; name: string }>;
  currentLocationId: string | null;
}) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const [moving, setMoving] = useState(false);
  const move = useCommand("/assets");

  if (isTerminal || !canEdit) return null;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        <CommandButton commands="verity.asset.relocate" size="sm" variant="secondary" onClick={() => setMoving(true)} disabled={locations.length === 0}>
          Move
        </CommandButton>
        {transitions.map((target) => (
          <CommandButton commands={"verity.asset.change_state"}
            key={target.key}
            size="sm"
            // Secondary throughout, with the terminal transition marked in
            // danger INK rather than a danger fill. These are state changes, not
            // deletions, and a solid red block competes with the tint for the eye
            // while telling the reader nothing the tint was not already telling them.
            variant="secondary"
            className={target.category === "Cancelled" ? "text-danger" : undefined}
            disabled={pending}
            onClick={() => {
              setFailure(null);
              startTransition(async () => {
                const result = await runCommand(
                  "verity.asset.change_state",
                  { assetId, toState: target.key },
                  "/assets",
                );
                if (result.ok) router.refresh();
                else setFailure(result);
              });
            }}
          >
            {pending ? "Working…" : `Mark ${target.key.replace(/_/g, " ")}`}
          </CommandButton>
        ))}
      </div>
      {failure && (
        <div className="w-full sm:w-96">
          <ErrorState
            title="Could not change state"
            message={failure.message}
            issues={failure.issues}
            retryable={failure.retryable}
          />
        </div>
      )}
      <FormModal
        title="Move asset"
        description="Records the asset at a different location. The move is kept in its history."
        open={moving}
        onClose={() => {
          setMoving(false);
          move.clear();
        }}
        submitLabel="Move"
        pending={move.pending}
        failure={move.failure}
        failureTitle="Could not move the asset"
        onSubmit={(form) =>
          move.run("verity.asset.relocate", { assetId, locationId: formText(form, "locationId") }, () => setMoving(false))
        }
      >
        <Field label="New location" htmlFor="asset-move-location" required>
          <Select id="asset-move-location" name="locationId" required defaultValue="">
            <option value="" disabled>Choose a location</option>
            {locations
              .filter((l) => l.id !== currentLocationId)
              .map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
          </Select>
        </Field>
      </FormModal>
    </div>
  );
}
