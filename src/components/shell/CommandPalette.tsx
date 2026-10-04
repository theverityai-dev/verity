"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "@/components/ui/icons";
import { runQuery } from "@/server/actions/platform";
import { prefersReducedMotion, reducedMotionFade, springDefault } from "@/lib/motion";

type Result = { id: string; type: "lead" | "domain" | "team"; label: string; sublabel: string; href: string };

const TYPE_LABEL: Record<Result["type"], string> = { lead: "Lead", domain: "Domain", team: "Team" };
const START_ACTION = { label: "Create prospect", detail: "Start a researched prospect", href: "/outreach/prospects?create=1" };

/**
 * Global Cmd/Ctrl+K search (Task 109 Phase G §2). Mounted unconditionally in
 * `ShellChrome`, like `AgentChatDock` — but stays capability-agnostic itself:
 * it dispatches to a registered query BY STRING KEY through the platform's
 * existing `runQuery`, the same decoupling `runCommand` already uses, rather
 * than importing an outreach module into the generic shell.
 *
 * Outreach's P2 expansion makes this an execution surface too: it can start a
 * prospect from an empty palette and exposes record-scoped actions alongside a
 * searched lead. Every action deep-links into the existing, authorized form;
 * the palette never duplicates mutation logic or bypasses server commands.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // APPLE-P1-03: whatever had focus before the palette opened (the search
  // trigger, a keyboard-focused link, ...) — restored on close so closing
  // the palette doesn't strand focus on `document.body`.
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const close = () => {
    setOpen(false);
    previousFocusRef.current?.focus();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) close();
        else setOpen(true);
      } else if (e.key === "Escape" && open) {
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // APPLE-P0-01: the top bar's "Search this page" field is a trigger, not its
  // own search implementation — clicking/focusing it opens this palette,
  // exactly like pressing Cmd/Ctrl+K, rather than the field silently doing
  // nothing when someone types into it. A DOM event, not a prop or context,
  // because `ShellChrome` and this component are siblings mounted once each
  // with no natural parent to lift shared state into (`AgentChatDock` follows
  // the same standalone-mount shape).
  useEffect(() => {
    const onOpenRequest = () => setOpen(true);
    window.addEventListener("verity:open-command-palette", onOpenRequest);
    return () => window.removeEventListener("verity:open-command-palette", onOpenRequest);
  }, []);

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      setQ("");
      setResults([]);
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // APPLE-P1-03: a focus trap — Tab/Shift+Tab cycle WITHIN the dialog rather
  // than escaping to the page underneath, matching `aria-modal="true"`'s own
  // promise (a modal dialog that lets Tab leave it isn't actually modal).
  const onTrapKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'input, button, a[href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute("disabled"));
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      startTransition(async () => {
        const result = await runQuery<Result[]>("verity.outreach.command_palette_search", { q: q.trim() });
        setResults(result.ok ? result.data : []);
        setActiveIndex(0);
      });
    }, 200);
    return () => clearTimeout(handle);
  }, [q]);

  const go = (href: string) => {
    close();
    router.push(href);
  };

  const transition = prefersReducedMotion() ? reducedMotionFade : springDefault;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition}
            className="verity-scrim absolute inset-0 border-0"
            aria-label="Close search"
            onClick={close}
          />
          <motion.div
            ref={dialogRef}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={transition}
            role="dialog"
            aria-modal="true"
            aria-label="Search Outreach leads, domains, and teams"
            className="glass-overlay relative flex w-full max-w-[560px] flex-col overflow-hidden rounded-2xl"
            onKeyDown={(e) => {
          onTrapKeyDown(e);
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            if (q.trim().length < 2) go(START_ACTION.href);
            else if (results[activeIndex]) go(results[activeIndex]!.href);
          }
        }}
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Icon name="search" size={18} className="shrink-0 text-text-tertiary" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search leads, domains, teams…"
            className="h-8 w-full border-0 bg-transparent text-[14px] text-text placeholder:text-text-tertiary focus:outline-none"
          />
          <kbd className="hidden shrink-0 rounded border border-line px-1.5 py-0.5 text-[11px] text-text-tertiary sm:inline">Esc</kbd>
        </div>
        <div className="max-h-[360px] overflow-y-auto p-2">
          {q.trim().length < 2 ? (
            <button
              onClick={() => go(START_ACTION.href)}
              className="flex w-full items-center justify-between rounded-lg px-3 py-3 text-left text-[13px] text-text hover:bg-accent-subtle"
            >
              <span>{START_ACTION.label}<span className="ml-2 text-text-tertiary">{START_ACTION.detail}</span></span>
              <span className="text-text-tertiary">↵</span>
            </button>
          ) : pending ? (
            <p className="px-3 py-6 text-center text-[13px] text-text-tertiary">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-text-tertiary">No matches</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {results.map((r, i) => (
                <li key={`${r.type}-${r.id}`} className="rounded-lg">
                  <button
                    onClick={() => go(r.href)}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-[13px] ${
                      i === activeIndex ? "bg-accent-subtle text-text" : "text-text-secondary hover:bg-surface-sunken"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {r.label} <span className="text-text-tertiary">· {r.sublabel}</span>
                    </span>
                    <span className="shrink-0 text-[11px] uppercase tracking-wide text-text-tertiary">{TYPE_LABEL[r.type]}</span>
                  </button>
                  {r.type === "lead" && (
                    <div className="flex gap-1 px-3 pb-2">
                      {[
                        ["Log activity", "log"],
                        ["Add task", "task"],
                        ["Schedule meeting", "meeting"],
                      ].map(([label, action]) => (
                        <button
                          key={action}
                          onClick={() => go(`${r.href}?action=${action}`)}
                          className="rounded-md border border-line px-2 py-1 text-[11px] text-text-secondary hover:bg-accent-subtle hover:text-text"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          </div>
        </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
