"use client";

import { useId, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalCancel } from "./Modal";
import { Button, ErrorState } from "./primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

/**
 * Runs one registered command at a time from a client screen and refreshes the
 * server-rendered data on success. `revalidate` is the route to revalidate.
 *
 * Shared by the operator desks (HR, inventory, accounting, billing, roster) so
 * each one does not grow its own copy of the same pending/failure handling.
 */
export function useCommand(revalidate: string) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  function run<T = unknown>(key: string, input: unknown, onDone?: (data: T) => void) {
    setFailure(null);
    startTransition(async () => {
      const result = await runCommand<T>(key, input, revalidate);
      if (result.ok) {
        onDone?.(result.data);
        router.refresh();
      } else {
        setFailure(result);
      }
    });
  }

  return { run, pending, failure, clear: () => setFailure(null) };
}

/** A refused command, rendered the same way on every desk. */
export function CommandFailure({ failure, title }: { failure: ActionFailure | null; title: string }) {
  if (!failure) return null;
  return <ErrorState title={title} message={failure.message} issues={failure.issues} retryable={failure.retryable} />;
}

/** A form inside a sheet; the submit button sits in the footer, tied to the form by id. */
export function FormModal({
  title,
  description,
  open,
  onClose,
  submitLabel,
  pending,
  failure,
  failureTitle,
  onSubmit,
  width,
  destructive = false,
  children,
}: {
  title: string;
  description: string;
  open: boolean;
  onClose: () => void;
  submitLabel: string;
  pending: boolean;
  failure: ActionFailure | null;
  failureTitle: string;
  onSubmit: (form: FormData) => void;
  width?: "sm" | "md" | "lg";
  /** Renders the submit as a destructive action (reversals, voids). */
  destructive?: boolean;
  children: ReactNode;
}) {
  const formId = useId();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      width={width}
      footer={
        <>
          <ModalCancel onClose={onClose} disabled={pending} />
          <Button type="submit" form={formId} variant={destructive ? "danger" : "primary"} disabled={pending}>
            {pending ? "Saving…" : submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(new FormData(event.currentTarget));
        }}
      >
        {children}
        <CommandFailure failure={failure} title={failureTitle} />
      </form>
    </Modal>
  );
}

/** Reads a trimmed text field. */
export function formText(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}
/** Blank becomes undefined so optional inputs stay absent. */
export function formOptional(form: FormData, name: string): string | undefined {
  return formText(form, name) || undefined;
}
/** Rupees as typed (`220.50`) to paise. Blank stays undefined rather than zero. */
export function formPaise(form: FormData, name: string): number | undefined {
  const raw = formText(form, name);
  return raw === "" ? undefined : Math.round(Number(raw) * 100);
}
