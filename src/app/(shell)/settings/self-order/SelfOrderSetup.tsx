"use client";

import { useState, useTransition } from "react";
import QRCode from "qrcode";
import { CommandButton } from "@/components/ui/CommandAccess";
import { CommandFailure, useCommand } from "@/components/ui/CommandForm";
import { Button, ErrorState, Panel } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import type { SelfOrderSetupView } from "@/server/capabilities/dinein";

type Sticker = { key: string; title: string; subtitle: string; url: string; qr: string };

/**
 * One outlet's customer ordering: the switch, and the stickers.
 *
 * A sticker's link is shown once. Only its hash is stored, so making stickers again REPLACES the old
 * ones (a lost or photographed sticker is dealt with by making new ones), and the page says so before
 * it does.
 */
export function SelfOrderSetup({ outlet, origin }: { outlet: SelfOrderSetupView["outlets"][number]; origin: string | null }) {
  const toggle = useCommand("/settings/self-order");
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  function makeStickers() {
    if (!origin) return;
    setFailure(null);
    startTransition(async () => {
      const made: Sticker[] = [];
      const targets: Array<{ tableId: string | null; title: string; subtitle: string }> = [
        ...outlet.tables.map((t) => ({ tableId: t.id as string | null, title: `Table ${t.label}`, subtitle: "Scan to order from your seat" })),
        { tableId: null, title: "Order for pickup", subtitle: "Scan to order ahead" },
      ];
      for (const target of targets) {
        const result = await runCommand<{ token: string }>(
          "verity.dinein.create_self_order_link",
          { locationId: outlet.locationId, tableId: target.tableId },
          "/settings/self-order",
        );
        if (!result.ok) {
          setFailure(result);
          break;
        }
        const url = `${origin}/o/${result.data.token}`;
        made.push({ key: `${target.tableId ?? "pickup"}`, title: target.title, subtitle: target.subtitle, url, qr: await QRCode.toDataURL(url, { width: 320, margin: 1 }) });
      }
      setStickers(made);
    });
  }

  return (
    <Panel
      title={outlet.name}
      action={<span className="text-[13px] text-text-secondary">{outlet.enabled ? "On" : "Off"}</span>}
    >
      <CommandFailure failure={toggle.failure} title="Could not change customer ordering" />
      {!outlet.hasProfile ? (
        <p className="m-0 text-[15px] text-text-secondary">Set up this outlet under Settings, Outlets first. Customer ordering needs its billing identity.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3 print:hidden">
            <CommandButton
              commands={"verity.dinein.set_self_order"}
              variant={outlet.enabled ? "secondary" : "primary"}
              disabled={toggle.pending}
              onClick={() => toggle.run("verity.dinein.set_self_order", { locationId: outlet.locationId, enabled: !outlet.enabled })}
            >
              {outlet.enabled ? "Turn off" : "Turn on"}
            </CommandButton>
            {outlet.enabled && (
              <CommandButton
                commands={"verity.dinein.create_self_order_link"}
                disabled={pending || !origin}
                onClick={() => {
                  if (stickers.length > 0 || window.confirm("Making stickers replaces the ones already on your tables, which stop working. Continue?")) makeStickers();
                }}
              >
                {pending ? "Making stickers…" : stickers.length > 0 ? "Make them again" : "Make stickers"}
              </CommandButton>
            )}
            {stickers.length > 0 && (
              <Button onClick={() => window.print()}>Print</Button>
            )}
          </div>
          <p className="m-0 text-[13px] text-text-secondary print:hidden">
            {outlet.enabled
              ? "Turning it off ends every guest's visit at once. Guests can only start a visit at a table you have seated."
              : "While this is off, the stickers do nothing."}
          </p>
          {failure && <ErrorState title="Could not make the stickers" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}

          {stickers.length > 0 && (
            <ul className="m-0 grid list-none grid-cols-2 gap-4 p-0 sm:grid-cols-3 print:grid-cols-3">
              {stickers.map((sticker) => (
                <li key={sticker.key} className="flex break-inside-avoid flex-col items-center gap-1 rounded-[12px] border border-line bg-surface p-4 text-center">
                  <img src={sticker.qr} alt={`QR code for ${sticker.title}`} width={160} height={160} />
                  <strong className="text-[17px] font-semibold text-text">{sticker.title}</strong>
                  <span className="text-[13px] text-text-secondary">{sticker.subtitle}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}
