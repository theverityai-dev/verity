"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorState, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import { Modal } from "@/components/ui/Modal";

const TRACKS = ["Undetermined", "Agency", "Verity", "Both"] as const;

/**
 * Posts a new company direction (master-context spec §10). APPEND-ONLY —
 * `postCompanyDirection` closes the prior Active row rather than editing it
 * (ADR-009). Founder-only, gated by the parent page's own permission check.
 */
export function DirectionForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();


  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Post new direction
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Post new direction">
    <form
      className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setFailure(null);
        startTransition(async () => {
          const result = await runCommand(
            "verity.outreach.post_direction",
            {
              weekLabel: String(form.get("weekLabel") ?? ""),
              priorityVertical: String(form.get("priorityVertical") ?? "") || undefined,
              primaryTrack: String(form.get("primaryTrack") ?? "Undetermined"),
              companyProspectingTarget: form.get("companyProspectingTarget")
                ? Number(form.get("companyProspectingTarget"))
                : undefined,
              strategicNote: String(form.get("strategicNote") ?? "") || undefined,
              // Task 106 Phase 7 (spec §91). Comma-separated in the field,
              // a list on the wire — the server never parses product copy.
              priorityIndustries: String(form.get("priorityIndustries") ?? "")
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean),
              secondaryOpportunity: String(form.get("secondaryOpportunity") ?? "") || undefined,
              geographicFocus: String(form.get("geographicFocus") ?? "") || undefined,
              targetCompanyProfile: String(form.get("targetCompanyProfile") ?? "") || undefined,
            },
            "/outreach",
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
      <Field label="Week label" htmlFor="weekLabel" required hint="e.g. 21–27 September">
        <Input id="weekLabel" name="weekLabel" required />
      </Field>
      <Field label="Priority vertical" htmlFor="priorityVertical">
        <Input id="priorityVertical" name="priorityVertical" placeholder="Manufacturing + Distributors" />
      </Field>
      <Field label="Primary track" htmlFor="primaryTrack">
        <Select id="primaryTrack" name="primaryTrack" defaultValue="Undetermined">
          {TRACKS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Prospecting target" htmlFor="companyProspectingTarget">
        <Input id="companyProspectingTarget" name="companyProspectingTarget" type="number" min="1" />
      </Field>
      <Field label="Priority industries" htmlFor="priorityIndustries" hint="Comma-separated; matched against each lead's industry">
        <Input id="priorityIndustries" name="priorityIndustries" placeholder="Manufacturing, Distributors" />
      </Field>
      <Field label="Secondary opportunity" htmlFor="secondaryOpportunity">
        <Input id="secondaryOpportunity" name="secondaryOpportunity" placeholder="Agency digital systems" />
      </Field>
      <Field label="Geographic focus" htmlFor="geographicFocus">
        <Input id="geographicFocus" name="geographicFocus" placeholder="Delhi NCR, Jaipur" />
      </Field>
      <Field label="Target company profile" htmlFor="targetCompanyProfile">
        <Input id="targetCompanyProfile" name="targetCompanyProfile" placeholder="50–500 staff, fragmented purchasing" />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Strategic note" htmlFor="strategicNote">
          <Textarea id="strategicNote" name="strategicNote" rows={2} />
        </Field>
      </div>
      {failure && (
        <div className="sm:col-span-2">
          <ErrorState title="Could not post direction" message={failure.message} issues={failure.issues} retryable={failure.retryable} />
        </div>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Posting…" : "Post direction"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
      </Modal>
    </>
  );
}
