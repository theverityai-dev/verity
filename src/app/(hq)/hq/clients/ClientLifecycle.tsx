"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalCancel } from "@/components/ui/Modal";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { enterClientAction, setClientStatusAction } from "@/server/actions/hq";
import { STATUS_LABEL } from "./status-label";


/**
 * Enter a client as Verity support (ADR-034 item 4). Entering is a privileged
 * act recorded in the client's own security trail, so it asks why first. The
 * reason is what the client will read if they ask who was in their workspace.
 */
export function EnterClientButton({ tenantId, name }: { tenantId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formId = `enter-${tenantId}`;

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Enter client</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Enter ${name}`}
        description="You will act inside this client with the support role. Your reason is recorded in their audit trail, and they can read it."
        footer={
          <>
            <ModalCancel onClose={() => setOpen(false)} disabled={pending} />
            <Button type="submit" form={formId} variant="primary" disabled={pending}>
              {pending ? "Entering…" : "Enter client"}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          className="flex flex-col gap-3"
          action={(formData) => {
            setError(null);
            startTransition(async () => {
              const result = await enterClientAction(null, formData);
              // On success the action redirects; a returned value is always a refusal.
              if (result && !result.ok) setError(result.message);
            });
          }}
        >
          <input type="hidden" name="tenantId" value={tenantId} />
          <Field label="Why are you entering?" htmlFor={`${formId}-reason`} required>
            <Input id={`${formId}-reason`} name="reason" required minLength={5} maxLength={300} autoFocus placeholder="Owner asked for help setting up outlets" />
          </Field>
          {error && <p role="alert" className="m-0 text-[13px] text-danger">{error}</p>}
        </form>
      </Modal>
    </>
  );
}

/**
 * Move a client through onboarding, active and suspended (ADR-034 item 2).
 * Suspending stops the client's own people from signing in to it; nothing in
 * the client is changed or deleted, and Verity support can still enter.
 */
export function ClientLifecycle({ tenantId, status }: { tenantId: string; status: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(status === "active" ? "suspended" : "active");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formId = `lifecycle-${tenantId}`;
  const options = Object.keys(STATUS_LABEL).filter((s) => s !== status);

  return (
    <>
      <Button size="sm" variant={status === "suspended" ? "primary" : "secondary"} onClick={() => setOpen(true)}>
        Change status
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Change client status"
        description={`Now ${STATUS_LABEL[status] ?? status}. Suspending stops this client's people from signing in; no data is changed and support can still enter.`}
        footer={
          <>
            <ModalCancel onClose={() => setOpen(false)} disabled={pending} />
            <Button type="submit" form={formId} variant={target === "suspended" ? "danger" : "primary"} disabled={pending}>
              {pending ? "Saving…" : target === "suspended" ? "Suspend client" : `Mark ${STATUS_LABEL[target]?.toLowerCase()}`}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          className="flex flex-col gap-3"
          action={(formData) => {
            setError(null);
            startTransition(async () => {
              const result = await setClientStatusAction(null, formData);
              if (result.ok) {
                setOpen(false);
                router.refresh();
              } else {
                setError(result.message);
              }
            });
          }}
        >
          <input type="hidden" name="tenantId" value={tenantId} />
          <Field label="New status" htmlFor={`${formId}-status`} required>
            <Select id={`${formId}-status`} name="status" value={target} onChange={(e) => setTarget(e.target.value)}>
              {options.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Reason" htmlFor={`${formId}-reason`} required hint="Recorded in the client's audit trail.">
            <Input id={`${formId}-reason`} name="reason" required minLength={5} maxLength={300} placeholder="Invoice unpaid for 60 days" />
          </Field>
          {error && <p role="alert" className="m-0 text-[13px] text-danger">{error}</p>}
        </form>
      </Modal>
    </>
  );
}
