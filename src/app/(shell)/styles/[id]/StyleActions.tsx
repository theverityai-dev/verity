"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Button, Checkbox, ErrorState } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

type Offerable = { attributeId: string; label: string; values: Array<{ id: string; label: string; code: string }> };

const GENERATE = "verity.inventory.generate_variants";
const OFFER = "verity.inventory.add_template_values";
const ARCHIVE = "verity.inventory.set_template_active";

export function StyleActions({ templateId, active, missing, offerable }: {
  templateId: string;
  active: boolean;
  missing: number;
  offerable: Offerable[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [offerOpen, setOfferOpen] = useState(false);
  const [picked, setPicked] = useState<Record<string, string[]>>({});

  const run = (command: string, input: unknown, after?: () => void) => {
    setFailure(null);
    startTransition(async () => {
      const result = await runCommand(command, input, `/styles/${templateId}`);
      if (result.ok) {
        after?.();
        router.refresh();
      } else {
        setFailure(result);
      }
    });
  };

  const chosen = Object.values(picked).reduce((n, ids) => n + ids.length, 0);

  return (
    <>
      {active && missing > 0 && (
        <CommandButton
          commands={GENERATE}
          variant="primary"
          disabled={pending}
          onClick={() => run(GENERATE, { templateId })}
        >
          {pending ? "Generating…" : `Generate ${missing} variant${missing === 1 ? "" : "s"}`}
        </CommandButton>
      )}
      {active && offerable.length > 0 && (
        <CommandButton commands={OFFER} variant="secondary" onClick={() => setOfferOpen(true)}>
          Offer in more
        </CommandButton>
      )}
      <CommandButton
        commands={ARCHIVE}
        variant={active ? "ghost" : "secondary"}
        disabled={pending}
        onClick={() => run(ARCHIVE, { templateId, active: !active })}
      >
        {active ? "Archive" : "Restore"}
      </CommandButton>

      {failure && !offerOpen && (
        <div className="basis-full">
          <ErrorState title="That did not work" message={failure.message} issues={failure.issues} retryable={failure.retryable} />
        </div>
      )}

      <Modal
        open={offerOpen}
        onClose={() => setOfferOpen(false)}
        title="Offer in more"
        description="Add colours or sizes this style also comes in. Nothing is generated until you press Generate."
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setFailure(null);
            startTransition(async () => {
              for (const [attributeId, valueIds] of Object.entries(picked)) {
                if (valueIds.length === 0) continue;
                const result = await runCommand(OFFER, { templateId, attributeId, valueIds }, `/styles/${templateId}`);
                if (!result.ok) {
                  setFailure(result);
                  return;
                }
              }
              setOfferOpen(false);
              setPicked({});
              router.refresh();
            });
          }}
        >
          {failure && <ErrorState title="Could not add those" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
          {offerable.map((list) => (
            <fieldset key={list.attributeId} className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-1 text-[13px] font-medium text-text">{list.label}</legend>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                {list.values.map((v) => (
                  <Checkbox
                    key={v.id}
                    label={`${v.label} (${v.code})`}
                    checked={picked[list.attributeId]?.includes(v.id) ?? false}
                    onChange={(e) =>
                      setPicked((p) => {
                        const set = new Set(p[list.attributeId] ?? []);
                        if (e.target.checked) set.add(v.id);
                        else set.delete(v.id);
                        return { ...p, [list.attributeId]: [...set] };
                      })
                    }
                  />
                ))}
              </div>
            </fieldset>
          ))}
          <div className="flex gap-2">
            <CommandButton commands={OFFER} type="submit" variant="primary" disabled={pending || chosen === 0}>
              {pending ? "Adding…" : `Add ${chosen || ""}`.trim()}
            </CommandButton>
            <Button type="button" variant="ghost" onClick={() => setOfferOpen(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
