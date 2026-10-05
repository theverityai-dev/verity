"use client";

import { CommandButton } from "@/components/ui/CommandAccess";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Badge, Button, ErrorState, Field, Input, Panel } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";
import { basisPointsToPercent, percentToBasisPoints } from "@/server/platform/label";

type Parameter = {
  key: string;
  /** What resolves for this tenant right now, as JSON text. */
  value: string;
  /** True when the value comes from a platform default rather than this tenant. */
  inherited: boolean;
  groupSlug: string;
  groupLabel: string;
  fieldLabel: string;
  isBasisPoints: boolean;
};

/**
 * Setting a tenant's configuration.
 *
 * Every write goes through `verity.platform.set_configuration`, which is the
 * command HQ already registered and which carries authorization, audit and a
 * `ConfigurationChanged` security event without being asked. There is no second
 * write path here, deliberately — a settings screen that calls a helper directly
 * is the second place validation gets forgotten.
 *
 * Grouped by owning capability (Odoo-style sidebar, `HQ_UX_Redesign.md` §3)
 * rather than one flat list, and each key gets a humanized label instead of
 * its raw database string. Both are derived from the key at read time
 * (`configKeyInfo` in `label.ts`) — a capability that did not exist when this
 * file was written still gets a readable, if plainer, default label.
 *
 * An inherited value is shown with its default filled in rather than blank. The
 * difference between "the platform's 9%" and "this tenant chose 9%" matters to
 * the person reading it, so the row carries a badge saying which, and saving
 * turns the first into the second.
 *
 * Clearing is offered separately from saving an empty string. `temporal.ts`
 * treats an unset zone as UTC by decision, and an empty string would be neither
 * set nor unset — the command takes `null` for exactly that reason.
 */
export function ConfigurationEditor({ parameters }: { parameters: Parameter[] }) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();

  const groups = useMemo(() => {
    const byGroup = new Map<string, Parameter[]>();
    for (const p of parameters) {
      const list = byGroup.get(p.groupLabel) ?? [];
      list.push(p);
      byGroup.set(p.groupLabel, list);
    }
    return [...byGroup.entries()];
  }, [parameters]);

  const [activeGroup, setActiveGroup] = useState<string | null>(groups[0]?.[0] ?? null);
  const active = groups.find(([label]) => label === activeGroup) ?? groups[0];
  const reducedMotion = useReducedMotion();

  function write(key: string, value: string | null, after?: () => void) {
    setFailure(null);
    startTransition(async () => {
      const result = await runCommand(
        "verity.platform.set_configuration",
        { key, value },
        "/configuration",
      );
      if (result.ok) {
        after?.();
        router.refresh();
      } else {
        setFailure(result);
      }
    });
  }

  return (
    <>
      {failure && (
        <div className="mb-4">
          <ErrorState
            title="That setting was refused"
            message={failure.message}
            issues={failure.issues}
            retryable={failure.retryable}
          />
        </div>
      )}

      <div className="mb-4 flex justify-end">
        <CommandButton commands={"verity.platform.set_configuration"} variant="primary" onClick={() => setAdding((open) => !open)}>
          {adding ? "Cancel" : "Set another key"}
        </CommandButton>
      </div>

      {adding && (
        <div className="mb-6">
          <Panel title="Set a configuration value">
            <form
              className="flex flex-wrap items-end gap-3"
              action={(formData) =>
                write(
                  String(formData.get("key") ?? "").trim(),
                  String(formData.get("value") ?? ""),
                  () => setAdding(false),
                )
              }
            >
              <div className="min-w-[320px] flex-1">
                <Field
                  label="Key"
                  htmlFor="config-new-key"
                  required
                  hint="The key a capability reads, e.g. verity.trading.tax.state_code"
                >
                  <Input id="config-new-key" name="key" required autoFocus />
                </Field>
              </div>
              <div className="min-w-[200px]">
                <Field label="Value" htmlFor="config-new-value" required>
                  <Input id="config-new-value" name="value" required />
                </Field>
              </div>
              <CommandButton commands={"verity.platform.set_configuration"} type="submit" variant="primary" disabled={pending}>
                Save
              </CommandButton>
            </form>
          </Panel>
        </div>
      )}

      {groups.length === 0 ? (
        <Panel title="Values">
          <p className="m-0 text-[13px] text-text-secondary">No configuration parameters yet.</p>
        </Panel>
      ) : (
        <div className="flex gap-6">
          <nav className="w-[200px] shrink-0">
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {groups.map(([label, rows]) => (
                <li key={label}>
                  <button
                    type="button"
                    onClick={() => setActiveGroup(label)}
                    className={
                      "block w-full cursor-pointer rounded-md px-3 py-2 text-left text-[13px] transition-colors duration-150 " +
                      (label === active?.[0]
                        ? "bg-accent-subtle font-medium text-accent-ink"
                        : "text-text-secondary hover:bg-surface-sunken hover:text-text")
                    }
                  >
                    {label}
                    <span className="ml-1.5 text-[12px] text-text-tertiary">{rows.length}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {active && (
            <div className="min-w-0 flex-1">
              {/* Tab-switch fade — Verity_Motion_Architecture.md §2/§4: a clean,
                  subtle opacity transition over 200ms, keyed on the active
                  group so switching tabs re-triggers it rather than reusing
                  the previous group's mounted instance. */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={active[0]}
                  initial={reducedMotion ? undefined : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: reducedMotion ? 0 : 0.2 }}
                >
                  <Panel title={active[0]}>
                    <div className="flex flex-col gap-3">
                      {active[1].map((parameter) => (
                        <ConfigRow key={parameter.key} parameter={parameter} pending={pending} onWrite={write} />
                      ))}
                    </div>
                  </Panel>
                </motion.div>
              </AnimatePresence>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function ConfigRow({
  parameter,
  pending,
  onWrite,
}: {
  parameter: Parameter;
  pending: boolean;
  onWrite: (key: string, value: string | null) => void;
}) {
  // Basis points are stored and sent as the integer the command expects; only
  // the display value is a percent, so the round-trip through the number
  // input never touches what actually gets persisted except at submit time.
  const displayValue = parameter.isBasisPoints
    ? String(basisPointsToPercent(Number(parameter.value) || 0))
    : parameter.value;

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-lg bg-surface-sunken p-3"
      action={(formData) => {
        const typed = String(formData.get("value") ?? "");
        const value = parameter.isBasisPoints
          ? String(percentToBasisPoints(Number(typed) || 0))
          : typed;
        onWrite(parameter.key, value);
      }}
    >
      <div className="min-w-[300px] flex-1">
        <Field
          label={parameter.fieldLabel}
          htmlFor={`config-${parameter.key}`}
          hint={parameter.key}
        >
          <Input
            id={`config-${parameter.key}`}
            name="value"
            type={parameter.isBasisPoints ? "number" : "text"}
            step={parameter.isBasisPoints ? "0.01" : undefined}
            defaultValue={displayValue}
          />
        </Field>
      </div>
      <Badge tone={parameter.inherited ? "neutral" : "accent"}>
        {parameter.inherited ? "Platform default" : "Tenant override"}
      </Badge>
      <CommandButton commands={"verity.platform.set_configuration"} type="submit" disabled={pending}>
        Save
      </CommandButton>
      {!parameter.inherited && (
        <CommandButton commands={"verity.platform.set_configuration"}
          type="button"
          disabled={pending}
          onClick={() => onWrite(parameter.key, null)}
          title="Clear this tenant's value and fall back to the platform default"
        >
          Clear
        </CommandButton>
      )}
    </form>
  );
}
