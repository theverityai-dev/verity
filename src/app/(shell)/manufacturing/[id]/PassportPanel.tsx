"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Button, ErrorState, Field, Input } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

/**
 * Publishing a verification passport (ADR-030).
 *
 * The link is shown exactly once, here, because only a fingerprint of it is
 * stored: there is nothing to look up later. To reprint a lost code, revoke the
 * passport and issue a new one, which also takes the old link offline at once.
 * Publishing is a deliberate disclosure, so nothing is public until this button.
 */
export function PassportPanel({
  orderId,
  orderState,
  active,
}: {
  orderId: string;
  orderState: string;
  active: { id: string; issuedAt: string; reference: string | null } | null;
}) {
  const router = useRouter();
  const [issued, setIssued] = useState<{ url: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!issued) return setQr(null);
    let live = true;
    QRCode.toDataURL(issued.url, { width: 240, margin: 1 }).then((data) => live && setQr(data));
    return () => {
      live = false;
    };
  }, [issued]);

  if (issued) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <p className="m-0 text-[13px] text-text-secondary">
          Published. Print or save this code now: it cannot be shown again. If it is lost, revoke the passport and issue a new one.
        </p>
        {qr && (
          <img src={qr} alt="QR code linking to this product's verification page" width={240} height={240} className="rounded-md bg-white p-2" />
        )}
        <code className="break-all rounded-md bg-surface-sunken p-2 text-[12px] text-text">{issued.url}</code>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => navigator.clipboard.writeText(issued.url).then(() => setCopied(true))}
          >
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => { setIssued(null); router.refresh(); }}>
            I have saved it
          </Button>
        </div>
      </div>
    );
  }

  if (active) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <p className="m-0 text-[13px] text-text-secondary">
          A passport is published{active.reference ? ` as ${active.reference}` : ""} since {active.issuedAt.slice(0, 10)}. Its link cannot be
          shown again. To reprint it, revoke this passport and issue a new one.
        </p>
        {failure && <ErrorState title="Could not revoke" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
        {confirmRevoke ? (
          <div className="flex gap-2">
            <CommandButton
              commands="verity.manufacturing.revoke_passport"
              size="sm"
              variant="primary"
              className="text-danger"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setFailure(null);
                  const result = await runCommand("verity.manufacturing.revoke_passport", { passportId: active.id }, "/manufacturing");
                  if (result.ok) {
                    setConfirmRevoke(false);
                    router.refresh();
                  } else {
                    setFailure(result);
                  }
                })
              }
            >
              {pending ? "Revoking…" : "Revoke now"}
            </CommandButton>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRevoke(false)} disabled={pending}>
              Keep it
            </Button>
          </div>
        ) : (
          <div>
            <CommandButton commands="verity.manufacturing.revoke_passport" size="sm" variant="secondary" className="text-danger" onClick={() => setConfirmRevoke(true)}>
              Revoke passport
            </CommandButton>
          </div>
        )}
      </div>
    );
  }

  if (orderState !== "completed") {
    return (
      <p className="m-0 p-4 text-[13px] text-text-secondary">
        A passport can be published once this order is completed and every inspection check passes.
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 p-4"
      action={(fd) =>
        startTransition(async () => {
          setFailure(null);
          const result = await runCommand<{ id: string; token: string }>(
            "verity.manufacturing.issue_passport",
            { orderId, reference: String(fd.get("reference") ?? "").trim() || undefined },
            "/manufacturing",
          );
          if (result.ok) setIssued({ url: `${window.location.origin}/verify/${result.data.token}` });
          else setFailure(result);
        })
      }
    >
      <p className="m-0 text-[13px] text-text-secondary">
        Publish a public page, reached by QR code, showing the product, who made it and the inspections it passed. It shows labels only:
        no remarks, photos, staff or customer details.
      </p>
      {failure && <ErrorState title="Could not publish" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
      <Field label="Reference to show (optional)" htmlFor="passport-ref" hint="For example your order or batch number.">
        <Input id="passport-ref" name="reference" maxLength={100} />
      </Field>
      <div>
        <CommandButton commands="verity.manufacturing.issue_passport" type="submit" variant="primary" disabled={pending}>
          {pending ? "Publishing…" : "Publish passport"}
        </CommandButton>
      </div>
    </form>
  );
}
