"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Panel } from "@/components/ui/primitives";
import { createClientAction } from "@/server/actions/hq";
import { Modal } from "@/components/ui/Modal";

/**
 * Creates a client.
 *
 * Collapsed until asked for, because the list is what an operator came to read
 * and a permanently open form pushes it down the page for the one visit in ten
 * that needs it.
 *
 * The time zone is optional and, when left blank, is left NULL rather than
 * defaulted to the operator's own zone. `temporal.ts` resolves an absent zone to
 * UTC explicitly; guessing it here from the browser would put every deadline in
 * that client's records off by an offset nobody chose.
 */
export function CreateClientForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();


  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        New client
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="New client">
    <div>
      <form
        className="flex flex-col gap-4 sm:max-w-md"
        action={(formData) => {
          setError(null);
          startTransition(async () => {
            const result = await createClientAction(null, formData);
            if (result.ok) {
              setOpen(false);
              router.refresh();
            } else {
              setError(result.message);
            }
          });
        }}
      >
        {error && (
          <p role="alert" className="m-0 text-[13px] text-danger">
            {error}
          </p>
        )}

        <Field label="Client name" htmlFor="client-name" required>
          <Input id="client-name" name="name" required autoFocus />
        </Field>

        <Field
          label="Time zone"
          htmlFor="client-tz"
          hint="IANA name, e.g. Asia/Kolkata. Left blank means UTC, recorded as a choice rather than a guess."
        >
          <Input id="client-tz" name="timeZone" placeholder="Asia/Kolkata" />
        </Field>

        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Creating…" : "Create client"}
          </Button>
          <Button type="button" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
      </Modal>
    </>
  );
}
