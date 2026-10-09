"use client";

import { CommandFailure, useCommand } from "@/components/ui/CommandForm";
import { EmptyState, Panel } from "@/components/ui/primitives";
import type { SubscriptionView } from "@/server/platform/notification-outbox";

/** One row per kind of event, one toggle per role. A toggle is on while a subscription exists. */
export function AlertsPanel({ view }: { view: SubscriptionView }) {
  const set = useCommand("/settings/alerts");
  const on = new Set(view.subscriptions.map((s) => `${s.eventName}|${s.roleId}`));

  if (view.events.length === 0) {
    return (
      <Panel flush>
        <EmptyState compact title="No events yet" description="Events appear here once this business has recorded some activity." />
      </Panel>
    );
  }

  return (
    <>
      <CommandFailure failure={set.failure} title="Could not change the alert" />
      <div className="flex flex-col gap-4">
        {view.events.map((event) => (
          <Panel key={event.name} title={event.label}>
            <div role="group" aria-label={`Who is told when: ${event.label}`} className="flex flex-wrap gap-2">
              {view.roles.map((role) => {
                const active = on.has(`${event.name}|${role.id}`);
                return (
                  <button
                    key={role.id}
                    type="button"
                    aria-pressed={active}
                    disabled={set.pending}
                    onClick={() => set.run("verity.platform.set_notification_subscription", { eventName: event.name, roleId: role.id, enabled: !active })}
                    className={
                      "inline-flex min-h-11 cursor-pointer items-center rounded-full px-4 text-[14px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 " +
                      (active ? "bg-accent text-accent-on" : "bg-[var(--color-control)] text-text hover:bg-[var(--color-control-strong)]")
                    }
                  >
                    {role.name}
                  </button>
                );
              })}
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}
