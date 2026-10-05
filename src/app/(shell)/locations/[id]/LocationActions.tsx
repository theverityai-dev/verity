"use client";

import { useState } from "react";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Field, Input, Select } from "@/components/ui/primitives";
import { FormModal, formText, useCommand } from "@/components/ui/CommandForm";

/**
 * Site actions: a geofence (a policy boundary, ADR-004 — not a place) and
 * assigning a person to work at this site, which scopes what they see.
 */
export function LocationActions({
  locationId,
  people,
  defaultCentre,
}: {
  locationId: string;
  people: Array<{ userId: string; name: string }>;
  defaultCentre: { lat: string; lng: string } | null;
}) {
  const [open, setOpen] = useState<"fence" | "assign" | null>(null);
  const command = useCommand(`/locations/${locationId}`);
  const close = () => {
    setOpen(null);
    command.clear();
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <CommandButton commands="verity.location.assign_user" size="sm" variant="secondary" onClick={() => setOpen("assign")} disabled={people.length === 0}>
          Assign person
        </CommandButton>
        <CommandButton commands="verity.location.add_geofence" size="sm" variant="secondary" onClick={() => setOpen("fence")}>
          Add geofence
        </CommandButton>
      </div>

      <FormModal
        title="Assign person"
        description="The person works at this site. Location-scoped roles then apply to it."
        open={open === "assign"}
        onClose={close}
        submitLabel="Assign"
        pending={command.pending}
        failure={command.failure}
        failureTitle="Could not assign the person"
        onSubmit={(form) => command.run("verity.location.assign_user", { locationId, userId: formText(form, "userId") }, close)}
      >
        <Field label="Person" htmlFor="loc-assign-user" required>
          <Select id="loc-assign-user" name="userId" required defaultValue="">
            <option value="" disabled>Choose a person</option>
            {people.map((p) => (
              <option key={p.userId} value={p.userId}>{p.name}</option>
            ))}
          </Select>
        </Field>
      </FormModal>

      <FormModal
        title="Add geofence"
        description="A circle around a point. Evidence captured here records whether it was taken inside it."
        open={open === "fence"}
        onClose={close}
        submitLabel="Add geofence"
        pending={command.pending}
        failure={command.failure}
        failureTitle="Could not add the geofence"
        onSubmit={(form) =>
          command.run(
            "verity.location.add_geofence",
            {
              locationId,
              name: formText(form, "name"),
              centreLat: Number(formText(form, "lat")),
              centreLng: Number(formText(form, "lng")),
              radiusMetres: Number.parseInt(formText(form, "radius"), 10),
            },
            close,
          )
        }
      >
        <Field label="Name" htmlFor="fence-name" required>
          <Input id="fence-name" name="name" required maxLength={120} autoFocus placeholder="Shop floor" />
        </Field>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Latitude" htmlFor="fence-lat" required>
            <Input id="fence-lat" name="lat" type="number" step="0.000001" min={-90} max={90} required defaultValue={defaultCentre?.lat} />
          </Field>
          <Field label="Longitude" htmlFor="fence-lng" required>
            <Input id="fence-lng" name="lng" type="number" step="0.000001" min={-180} max={180} required defaultValue={defaultCentre?.lng} />
          </Field>
          <Field label="Radius (m)" htmlFor="fence-radius" required>
            <Input id="fence-radius" name="radius" type="number" min={1} step={1} required defaultValue={100} />
          </Field>
        </div>
      </FormModal>
    </>
  );
}
