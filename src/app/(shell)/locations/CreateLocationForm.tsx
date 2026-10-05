"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Field, Input, Select } from "@/components/ui/primitives";
import { FormModal, formOptional, formText } from "@/components/ui/CommandForm";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

/**
 * Creates a Location through the real command pipeline, optionally sited at a
 * new Place with coordinates (ADR-004: a Place is the physical point, the
 * Location is the operating site). When a place is given it is created first
 * and the location is linked to it; if the location then fails, the place is
 * left unlinked rather than silently discarded, and the error says so.
 */
export function CreateLocationForm({ organizations }: { organizations: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const close = () => {
    setOpen(false);
    setFailure(null);
  };

  function submit(form: FormData) {
    setFailure(null);
    startTransition(async () => {
      let placeId: string | undefined;
      const placeName = formOptional(form, "placeName");
      if (placeName) {
        const lat = formOptional(form, "latitude");
        const lng = formOptional(form, "longitude");
        const place = await runCommand<{ id: string }>(
          "verity.location.create_place",
          { name: placeName, latitude: lat ? Number(lat) : undefined, longitude: lng ? Number(lng) : undefined },
          "/locations",
        );
        if (!place.ok) {
          setFailure(place);
          return;
        }
        placeId = place.data.id;
      }
      const result = await runCommand(
        "verity.location.create_location",
        { name: formText(form, "name"), organizationId: formText(form, "organizationId"), placeId },
        "/locations",
      );
      if (result.ok) {
        close();
        router.refresh();
      } else {
        setFailure(result);
      }
    });
  }

  return (
    <>
      <CommandButton commands="verity.location.create_location" variant="primary" onClick={() => setOpen(true)}>
        New location
      </CommandButton>
      <FormModal
        title="New location"
        description="An operating site: an outlet, a warehouse, a branch office."
        open={open}
        onClose={close}
        submitLabel="Create location"
        pending={pending}
        failure={failure}
        failureTitle="Could not create the location"
        onSubmit={submit}
      >
        <Field label="Name" htmlFor="loc-name" required>
          <Input id="loc-name" name="name" required autoFocus maxLength={200} />
        </Field>
        <Field label="Organization" htmlFor="loc-org" required hint="Only organizations in your scope are listed.">
          <Select id="loc-org" name="organizationId" required>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Address or place name" htmlFor="loc-place" hint="Optional. Adds a physical place so geofences and evidence have coordinates.">
          <Input id="loc-place" name="placeName" maxLength={200} placeholder="Shop 12, Defence Colony Market" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Latitude" htmlFor="loc-lat">
            <Input id="loc-lat" name="latitude" type="number" step="0.000001" min={-90} max={90} inputMode="decimal" />
          </Field>
          <Field label="Longitude" htmlFor="loc-lng">
            <Input id="loc-lng" name="longitude" type="number" step="0.000001" min={-180} max={180} inputMode="decimal" />
          </Field>
        </div>
      </FormModal>
    </>
  );
}
