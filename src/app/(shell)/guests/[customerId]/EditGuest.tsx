"use client";

import { useState } from "react";
import { CommandFailure, FormModal, formText, useCommand } from "@/components/ui/CommandForm";
import { Button, Field, Input } from "@/components/ui/primitives";

/**
 * Task 125 item 5.1 — correct what staff know about a guest. The phone number
 * is the identity key, so it is shown but not editable here.
 */
export function EditGuest({
  customerId,
  phone,
  name,
  email,
  birthday,
  marketingConsent,
}: {
  customerId: string;
  phone: string;
  name: string | null;
  email: string | null;
  /** `YYYY-MM-DD` or null. */
  birthday: string | null;
  marketingConsent: boolean;
}) {
  const [open, setOpen] = useState(false);
  const edit = useCommand(`/guests/${customerId}`);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Edit details</Button>
      <CommandFailure failure={open ? null : edit.failure} title="Could not update guest" />
      <FormModal
        title="Edit guest"
        description={`Phone ${phone} identifies this guest and cannot be changed here.`}
        open={open}
        onClose={() => {
          setOpen(false);
          edit.clear();
        }}
        submitLabel="Save"
        pending={edit.pending}
        failure={edit.failure}
        failureTitle="Could not update guest"
        onSubmit={(form) =>
          edit.run(
            "verity.crm.update_customer",
            {
              customerId,
              // A blank field clears it; the command treats null as "remove".
              name: formText(form, "name") || null,
              email: formText(form, "email") || null,
              birthday: formText(form, "birthday") || null,
              marketingConsent: form.get("marketingConsent") === "on",
            },
            () => setOpen(false),
          )
        }
      >
        <Field label="Name" htmlFor="guest-name">
          <Input id="guest-name" name="name" defaultValue={name ?? ""} maxLength={120} />
        </Field>
        <Field label="Email" htmlFor="guest-email">
          <Input id="guest-email" name="email" type="email" defaultValue={email ?? ""} maxLength={200} />
        </Field>
        <Field label="Birthday" htmlFor="guest-birthday">
          <Input id="guest-birthday" name="birthday" type="date" defaultValue={birthday ?? ""} />
        </Field>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] text-text">
          <input
            type="checkbox"
            name="marketingConsent"
            defaultChecked={marketingConsent}
            className="size-[18px] accent-[var(--color-accent)]"
          />
          Happy to receive offers and messages
        </label>
      </FormModal>
    </>
  );
}
