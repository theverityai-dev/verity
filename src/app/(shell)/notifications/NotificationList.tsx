"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, EmptyState, Panel } from "@/components/ui/primitives";
import { markNotificationsRead } from "@/server/actions/notifications";

type Item = { id: string; subject: string; body: string; at: string; unread: boolean };

export function NotificationList({ items }: { items: Item[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const unread = items.filter((i) => i.unread).length;

  function mark(id?: string) {
    startTransition(async () => {
      await markNotificationsRead(id);
      router.refresh();
    });
  }

  if (items.length === 0) {
    return (
      <Panel flush>
        <EmptyState compact title="Nothing yet" description="Alerts your administrator turns on for your role will appear here." />
      </Panel>
    );
  }

  return (
    <>
      {unread > 0 && (
        <div className="mb-4">
          <Button variant="secondary" disabled={pending} onClick={() => mark()}>
            Mark all {unread} as read
          </Button>
        </div>
      )}
      <Panel flush>
        <ul className="m-0 flex list-none flex-col p-0">
          {items.map((item) => (
            <li key={item.id} className="flex min-h-11 items-start justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0">
              <span className="min-w-0">
                <span className={`block text-[15px] ${item.unread ? "font-semibold text-text" : "text-text-secondary"}`}>{item.subject}</span>
                {item.body && <span className="block text-[13px] text-text-secondary">{item.body}</span>}
                <span className="block text-[12px] text-text-tertiary">{item.at.slice(0, 16).replace("T", " ")} UTC</span>
              </span>
              {item.unread && (
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => mark(item.id)}>
                  Mark read
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
