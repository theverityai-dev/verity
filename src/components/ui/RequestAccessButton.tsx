"use client";

import { useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { requestAccess } from "@/server/actions/access-request";

/**
 * The actual "Request access" recovery action on `PermissionDenied` (Task
 * 114 P1.5 item 9) — client-only because it needs the current path and a
 * pending/sent state, neither of which `PermissionDenied` (server-rendered,
 * used everywhere) can hold itself.
 */
export function RequestAccessButton({ what }: { what: string }) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState<"idle" | "sent" | "none" | "error">("idle");

  if (sent === "sent") {
    return <p className="m-0 text-[13px] text-text-secondary">Request sent.</p>;
  }
  if (sent === "none") {
    return <p className="m-0 text-[13px] text-text-tertiary">No one in this workspace can grant it yet.</p>;
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await requestAccess(pathname, `Denied: ${what}`);
          if (!result.ok) {
            setSent("error");
            return;
          }
          setSent(result.data.notified > 0 ? "sent" : "none");
        })
      }
      className="inline-flex items-center rounded-[10px] bg-control px-3 py-1.5 text-[13px] max-sm:min-h-11 max-sm:px-4 max-sm:text-[15px] font-semibold text-accent-ink transition-colors hover:bg-control-strong disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Sending…" : sent === "error" ? "Couldn't send — retry" : "Request access"}
    </button>
  );
}
