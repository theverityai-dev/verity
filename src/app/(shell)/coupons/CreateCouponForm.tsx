"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorState, Field, Input, Panel, Select } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import { Modal } from "@/components/ui/Modal";

export function CreateCouponForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();


  return (
    <>
      <div className="mb-6">
        <Button size="sm" onClick={() => setOpen(true)}>+ Create coupon</Button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Create coupon">
    <div>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const discountType = String(form.get("discountType"));
          const rawValue = Number(form.get("value"));
          // Percent stored in basis points (25% -> 2500); Flat stored in paise.
          const value = discountType === "Percent" ? rawValue * 100 : rawValue * 100;
          const expiresAt = String(form.get("expiresAt") ?? "");
          setFailure(null);
          startTransition(async () => {
            const result = await runCommand(
              "verity.coupon.create_coupon",
              {
                code: String(form.get("code") ?? "").toUpperCase(),
                discountType,
                value,
                expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
              },
              "/coupons",
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
        <Field label="Code" htmlFor="code" required>
          <Input id="code" name="code" required placeholder="e.g. WELCOME10" />
        </Field>
        <Field label="Type" htmlFor="discountType">
          <Select id="discountType" name="discountType" defaultValue="Percent">
            <option value="Percent">Percent off</option>
            <option value="Flat">Flat amount off (₹)</option>
          </Select>
        </Field>
        <Field label="Value" htmlFor="value" required hint="Percent (e.g. 10) or rupees (e.g. 100)">
          <Input id="value" name="value" type="number" min={1} required />
        </Field>
        <Field label="Expires" htmlFor="expiresAt" hint="Optional">
          <Input id="expiresAt" name="expiresAt" type="date" />
        </Field>
        {failure && (
          <div className="sm:col-span-2">
            <ErrorState title="Could not create coupon" message={failure.message} issues={failure.issues} retryable={failure.retryable} />
          </div>
        )}
        <div className="flex items-center gap-2 sm:col-span-2">
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Create"}</Button>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </form>
    </div>
      </Modal>
    </>
  );
}
