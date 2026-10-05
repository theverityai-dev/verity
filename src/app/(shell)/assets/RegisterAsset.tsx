"use client";

import { useState } from "react";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Field, Input, Select } from "@/components/ui/primitives";
import { FormModal, formOptional, formText, useCommand } from "@/components/ui/CommandForm";

/** Registers a piece of equipment. Equipment-specific detail lives in custom fields. */
export function RegisterAsset({ locations }: { locations: Array<{ id: string; name: string }> }) {
  const [open, setOpen] = useState(false);
  const register = useCommand("/assets");
  const close = () => {
    setOpen(false);
    register.clear();
  };

  return (
    <>
      <CommandButton commands="verity.asset.register" variant="primary" onClick={() => setOpen(true)}>
        Register asset
      </CommandButton>
      <FormModal
        title="Register asset"
        description="Physical equipment the business tracks: machines, vehicles, appliances."
        open={open}
        onClose={close}
        submitLabel="Register"
        pending={register.pending}
        failure={register.failure}
        failureTitle="Could not register the asset"
        onSubmit={(form) =>
          register.run(
            "verity.asset.register",
            { name: formText(form, "name"), reference: formOptional(form, "reference"), locationId: formOptional(form, "locationId") },
            close,
          )
        }
      >
        <Field label="Name" htmlFor="asset-name" required>
          <Input id="asset-name" name="name" required maxLength={200} autoFocus placeholder="Tandoor oven 2" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Tag or serial" htmlFor="asset-ref">
            <Input id="asset-ref" name="reference" maxLength={120} />
          </Field>
          <Field label="Location" htmlFor="asset-location">
            <Select id="asset-location" name="locationId" defaultValue="">
              <option value="">Unassigned</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </Select>
          </Field>
        </div>
      </FormModal>
    </>
  );
}
