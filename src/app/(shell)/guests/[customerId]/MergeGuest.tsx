"use client";

import { useState } from "react";
import { CommandFailure, FormModal, formText, useCommand } from "@/components/ui/CommandForm";
import { Button, Field, Select } from "@/components/ui/primitives";

/**
 * Task 125 item 5.1 — merge a duplicate guest into this one. Nothing is deleted
 * and no past order or points entry is edited (ADR-007): the other phone number
 * becomes part of this guest, and visits, spend and points are counted together.
 */
export function MergeGuest({
  customerId,
  others,
}: {
  customerId: string;
  /** Every other guest that could be a duplicate of this one. */
  others: Array<{ id: string; name: string | null; phone: string }>;
}) {
  const [open, setOpen] = useState(false);
  const merge = useCommand(`/guests/${customerId}`);

  if (others.length === 0) return null;

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Merge a duplicate</Button>
      <CommandFailure failure={open ? null : merge.failure} title="Could not merge guests" />
      <FormModal
        title="Merge a duplicate into this guest"
        description="Pick the other record for the same person. Its phone number joins this guest; visits, spend and points are counted together. Past orders are not changed."
        open={open}
        onClose={() => {
          setOpen(false);
          merge.clear();
        }}
        submitLabel="Merge guests"
        pending={merge.pending}
        failure={merge.failure}
        failureTitle="Could not merge guests"
        onSubmit={(form) =>
          merge.run("verity.crm.merge_customers", { keepId: customerId, mergeId: formText(form, "mergeId") }, () => setOpen(false))
        }
      >
        <Field label="The duplicate" htmlFor="merge-guest" required hint="This cannot be undone from the screen.">
          <Select id="merge-guest" name="mergeId" required defaultValue="">
            <option value="" disabled>Choose a guest</option>
            {others.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name ? `${g.name} · ${g.phone}` : g.phone}
              </option>
            ))}
          </Select>
        </Field>
      </FormModal>
    </>
  );
}
