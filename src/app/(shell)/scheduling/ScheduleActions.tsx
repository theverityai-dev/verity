"use client";

import { useState } from "react";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Checkbox, Field, Input, Select } from "@/components/ui/primitives";
import { FormModal, formText, useCommand } from "@/components/ui/CommandForm";

type Option = { id: string; name: string };
export type BookingSubjectType = { key: string; label: string; options: Option[] };

const ROUTE = "/scheduling";
/** `datetime-local` gives local wall time with no zone; the grid states UTC, so send UTC. */
const toIso = (local: string) => new Date(local).toISOString();

/**
 * The scheduling actions: register a resource, group resources, block time,
 * and book a resource for a subject. Overlaps are refused by the database; the
 * command returns a named error that this surface shows.
 */
export function ScheduleActions({
  resources,
  parties,
  assets,
  subjects,
}: {
  resources: Option[];
  parties: Option[];
  assets: Option[];
  subjects: BookingSubjectType[];
}) {
  const [open, setOpen] = useState<"resource" | "group" | "unavailable" | "book" | null>(null);
  const [backing, setBacking] = useState<"party" | "asset">("party");
  const [selection, setSelection] = useState<"AnyOf" | "AllOf" | "NOf">("AnyOf");
  const [subjectKey, setSubjectKey] = useState(subjects[0]?.key ?? "");
  const command = useCommand(ROUTE);
  const close = () => {
    setOpen(null);
    command.clear();
  };
  const subject = subjects.find((s) => s.key === subjectKey);

  return (
    <>
      <div className="mb-6 flex flex-wrap gap-2">
        <CommandButton commands="verity.scheduling.book" variant="primary" onClick={() => setOpen("book")} disabled={resources.length === 0}>
          Book
        </CommandButton>
        <CommandButton commands="verity.scheduling.declare_unavailable" onClick={() => setOpen("unavailable")} disabled={resources.length === 0}>
          Mark unavailable
        </CommandButton>
        <CommandButton commands="verity.scheduling.create_resource" onClick={() => setOpen("resource")}>
          Add resource
        </CommandButton>
        <CommandButton commands="verity.scheduling.create_group" onClick={() => setOpen("group")} disabled={resources.length < 2}>
          Group resources
        </CommandButton>
      </div>

      <FormModal
        title="Add resource"
        description="A resource is one schedulable person or asset."
        open={open === "resource"}
        onClose={close}
        submitLabel="Add resource"
        pending={command.pending}
        failure={command.failure}
        failureTitle="Could not add the resource"
        onSubmit={(form) =>
          command.run(
            "verity.scheduling.create_resource",
            {
              name: formText(form, "name"),
              partyId: backing === "party" ? formText(form, "backingId") : undefined,
              assetId: backing === "asset" ? formText(form, "backingId") : undefined,
            },
            close,
          )
        }
      >
        <Field label="Name" htmlFor="sr-name" required>
          <Input id="sr-name" name="name" required maxLength={120} autoFocus placeholder="Ravi (cook) or Delivery bike 2" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Backed by" htmlFor="sr-backing" required>
            <Select id="sr-backing" value={backing} onChange={(e) => setBacking(e.target.value as "party" | "asset")}>
              <option value="party">A person</option>
              <option value="asset" disabled={assets.length === 0}>An asset</option>
            </Select>
          </Field>
          <Field label={backing === "party" ? "Person" : "Asset"} htmlFor="sr-backing-id" required>
            <Select id="sr-backing-id" name="backingId" required defaultValue="" key={backing}>
              <option value="" disabled>Choose</option>
              {(backing === "party" ? parties : assets).map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </Select>
          </Field>
        </div>
      </FormModal>

      <FormModal
        title="Group resources"
        description="A group books as one: any one member, all members, or a set number of them."
        open={open === "group"}
        onClose={close}
        submitLabel="Create group"
        pending={command.pending}
        failure={command.failure}
        failureTitle="Could not create the group"
        onSubmit={(form) =>
          command.run(
            "verity.scheduling.create_group",
            {
              name: formText(form, "name"),
              selection,
              requiredCount: selection === "NOf" ? Number.parseInt(formText(form, "count"), 10) : undefined,
              resourceIds: form.getAll("resourceIds").map(String),
            },
            close,
          )
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name" htmlFor="sg-name" required>
            <Input id="sg-name" name="name" required maxLength={120} autoFocus placeholder="Evening kitchen crew" />
          </Field>
          <Field label="Books" htmlFor="sg-selection" required>
            <Select id="sg-selection" value={selection} onChange={(e) => setSelection(e.target.value as "AnyOf" | "AllOf" | "NOf")}>
              <option value="AnyOf">Any one member</option>
              <option value="AllOf">All members</option>
              <option value="NOf">A set number</option>
            </Select>
          </Field>
        </div>
        {selection === "NOf" && (
          <Field label="How many" htmlFor="sg-count" required>
            <Input id="sg-count" name="count" type="number" min={1} max={resources.length} step={1} required />
          </Field>
        )}
        <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
          <legend className="mb-2 px-1 text-[13px] text-text-secondary">Members</legend>
          {resources.map((r) => (
            <Checkbox key={r.id} name="resourceIds" value={r.id} label={r.name} />
          ))}
        </fieldset>
      </FormModal>

      <FormModal
        title="Mark unavailable"
        description="Blocks the resource for the period. Bookings that overlap it are refused."
        open={open === "unavailable"}
        onClose={close}
        submitLabel="Mark unavailable"
        pending={command.pending}
        failure={command.failure}
        failureTitle="Could not block the time"
        onSubmit={(form) =>
          command.run(
            "verity.scheduling.declare_unavailable",
            { resourceId: formText(form, "resourceId"), startsAt: toIso(formText(form, "start")), endsAt: toIso(formText(form, "end")) },
            close,
          )
        }
      >
        <Field label="Resource" htmlFor="su-resource" required>
          <Select id="su-resource" name="resourceId" required defaultValue="">
            <option value="" disabled>Choose a resource</option>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="From" htmlFor="su-start" required>
            <Input id="su-start" name="start" type="datetime-local" required />
          </Field>
          <Field label="To" htmlFor="su-end" required>
            <Input id="su-end" name="end" type="datetime-local" required />
          </Field>
        </div>
      </FormModal>

      <FormModal
        title="Book a resource"
        description="Reserves the resource for the period and records what it is for."
        open={open === "book"}
        onClose={close}
        submitLabel="Book"
        pending={command.pending}
        failure={command.failure}
        failureTitle="Could not book"
        onSubmit={(form) =>
          command.run(
            "verity.scheduling.book",
            {
              resourceId: formText(form, "resourceId"),
              subjectEntityKey: subjectKey,
              subjectEntityId: formText(form, "subjectId"),
              startsAt: toIso(formText(form, "start")),
              endsAt: toIso(formText(form, "end")),
            },
            close,
          )
        }
      >
        <Field label="Resource" htmlFor="sb-resource" required>
          <Select id="sb-resource" name="resourceId" required defaultValue="">
            <option value="" disabled>Choose a resource</option>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="For" htmlFor="sb-subject-type" required>
            <Select id="sb-subject-type" value={subjectKey} onChange={(e) => setSubjectKey(e.target.value)}>
              {subjects.map((s) => (
                <option key={s.key} value={s.key} disabled={s.options.length === 0}>{s.label}</option>
              ))}
            </Select>
          </Field>
          <Field label={subject?.label ?? "Subject"} htmlFor="sb-subject" required>
            <Select id="sb-subject" name="subjectId" required defaultValue="" key={subjectKey}>
              <option value="" disabled>Choose</option>
              {(subject?.options ?? []).map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="From" htmlFor="sb-start" required>
            <Input id="sb-start" name="start" type="datetime-local" required />
          </Field>
          <Field label="To" htmlFor="sb-end" required>
            <Input id="sb-end" name="end" type="datetime-local" required />
          </Field>
        </div>
      </FormModal>
    </>
  );
}
