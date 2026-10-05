"use client";

import { CommandButton } from "@/components/ui/CommandAccess";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Button, EmptyState, ErrorState, Field, Input, Panel, Select,
} from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

/**
 * Evidence attached to a record (§21).
 *
 * Immutability is shown, not merely enforced: evidence rows carry no edit or
 * delete control anywhere in the interface, because the platform refuses those
 * operations at the database. Offering a control the backend rejects would
 * teach users to distrust the interface.
 *
 * The geofence verdict is displayed as recorded at capture time. It is a
 * historical fact, not a live computation, so a fence moved afterwards does not
 * change what this says.
 */
export function EvidencePanel({
  assetId,
  canCapture,
  evidence,
}: {
  assetId: string;
  canCapture: boolean;
  evidence: Array<{
    id: string;
    kind: string;
    capturedAt: string;
    withinFence: boolean | null;
    uri: string | null;
  }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <section>
      {/* The capture action sits in the panel header rather than below the list.
          A button floating under a card reads as unattached once the list grows;
          in the header it stays put and stays obviously scoped to this record. */}
      <Panel
        title="Evidence"
        action={
          canCapture && !open ? (
            <CommandButton commands={"verity.evidence.capture"} size="sm" onClick={() => setOpen(true)}>
              Capture
            </CommandButton>
          ) : (
            <span className="text-[12px] text-text-tertiary">Immutable once recorded</span>
          )
        }
        flush
      >
        {evidence.length === 0 ? (
          <EmptyState
            compact
            title="No evidence captured"
            description="Evidence is immutable field data recorded against this asset. Nothing has been captured yet."
          />
        ) : (
          <ul className="m-0 list-none divide-y divide-line p-0">
            {evidence.map((item) => (
              <li key={item.id} className="px-5 py-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[14px] text-text">{item.kind}</span>
                  <time dateTime={item.capturedAt} className="tabular shrink-0 text-[12px] text-text-tertiary">
                    {item.capturedAt.replace("T", " ").slice(0, 16)}
                  </time>
                </div>
                <p className="m-0 mt-1 text-[12.5px] leading-relaxed text-text-secondary">
                  {item.withinFence === null
                    ? "No geofence evaluated at capture"
                    : item.withinFence
                      ? "Inside the geofence at capture time"
                      : "Outside the geofence at capture time"}
                  {item.uri ? ` · ${item.uri}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {canCapture && open && (
        <form
          className="mt-3 flex max-w-md flex-col gap-4 rounded-[12px] bg-surface p-5"
          action={(formData) => {
            setFailure(null);
            startTransition(async () => {
              const kind = String(formData.get("kind") ?? "Reading");
              const lat = formData.get("latitude");
              const lng = formData.get("longitude");

              const result = await runCommand(
                "verity.evidence.capture",
                {
                  entityKey: "verity.asset.asset",
                  entityId: assetId,
                  kind,
                  uri: String(formData.get("uri") ?? "") || undefined,
                  latitude: lat ? Number(lat) : undefined,
                  longitude: lng ? Number(lng) : undefined,
                  capturedAt: new Date().toISOString(),
                },
                `/assets/${assetId}`,
              );
              if (result.ok) {
                setOpen(false);
                router.refresh();
              } else {
                setFailure(result);
              }
            });
          }}
        >
          {failure && (
            <ErrorState
              title="Could not capture evidence"
              message={failure.message}
              issues={failure.issues}
              retryable={failure.retryable}
            />
          )}

          <Field label="Kind" htmlFor="kind" required>
            <Select id="kind" name="kind" defaultValue="Reading">
              <option value="Reading">Reading</option>
              <option value="GeoPoint">Geo point</option>
              <option value="Photo">Photo</option>
              <option value="Document">Document</option>
              <option value="Signature">Signature</option>
            </Select>
          </Field>

          <Field label="Artefact reference" htmlFor="uri" hint="Required for a photo or document.">
            <Input id="uri" name="uri" placeholder="storage://…" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude" htmlFor="latitude">
              <Input id="latitude" name="latitude" type="number" step="any" />
            </Field>
            <Field label="Longitude" htmlFor="longitude">
              <Input id="longitude" name="longitude" type="number" step="any" />
            </Field>
          </div>

          <div className="flex gap-2">
            <CommandButton commands={"verity.evidence.capture"} type="submit" variant="primary" disabled={pending}>
              {pending ? "Capturing…" : "Capture"}
            </CommandButton>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
