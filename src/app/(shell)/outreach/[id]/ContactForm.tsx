"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorState, Field, Input, Panel, Select, Textarea } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import { Modal } from "@/components/ui/Modal";

const CLASSIFICATIONS = ["Unknown", "DecisionMaker", "Influencer", "Champion", "Gatekeeper"] as const;

/**
 * Add a contact person to a prospect (Task 106 Phase 3/4, spec §24-25).
 * Same toggle-open-form shape as `NewLeadForm` — required-at-creation is
 * just a name; everything else is a follow-up edit, same posture as leads.
 */
export function ContactForm({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();


  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        + Add contact
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add contact">
    <div>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          setFailure(null);
          startTransition(async () => {
            const result = await runCommand(
              "verity.outreach.create_contact",
              {
                leadId,
                fullName: String(form.get("fullName") ?? ""),
                designation: String(form.get("designation") ?? "") || undefined,
                department: String(form.get("department") ?? "") || undefined,
                email: String(form.get("email") ?? "") || undefined,
                phone: String(form.get("phone") ?? "") || undefined,
                linkedinUrl: String(form.get("linkedinUrl") ?? "") || undefined,
                classification: String(form.get("classification") ?? "Unknown"),
                notes: String(form.get("notes") ?? "") || undefined,
              },
              `/outreach/${leadId}`,
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
        <Field label="Full name" htmlFor="fullName" required>
          <Input id="fullName" name="fullName" required />
        </Field>
        <Field label="Designation" htmlFor="designation">
          <Input id="designation" name="designation" />
        </Field>
        <Field label="Department" htmlFor="department">
          <Input id="department" name="department" />
        </Field>
        <Field label="Classification" htmlFor="classification">
          <Select id="classification" name="classification" defaultValue="Unknown">
            {CLASSIFICATIONS.map((c) => (
              <option key={c} value={c}>
                {c.replace(/([A-Z])/g, " $1").trim()}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" />
        </Field>
        <Field label="Phone" htmlFor="phone">
          <Input id="phone" name="phone" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="LinkedIn" htmlFor="linkedinUrl">
            <Input id="linkedinUrl" name="linkedinUrl" placeholder="https://linkedin.com/in/…" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Notes" htmlFor="notes">
            <Textarea id="notes" name="notes" rows={2} />
          </Field>
        </div>

        {failure && (
          <div className="sm:col-span-2">
            <ErrorState title="Could not add contact" message={failure.message} issues={failure.issues} retryable={failure.retryable} />
          </div>
        )}

        <div className="flex items-center gap-2 sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save contact"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
      </Modal>
    </>
  );
}
