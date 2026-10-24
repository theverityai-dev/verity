"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "@/components/ui/icons";
import { runQuery } from "@/server/actions/platform";
import { prefersReducedMotion, reducedMotionFade, springDefault } from "@/lib/motion";

type Result = { id: string; type: "lead" | "domain" | "team" | "company" | "person" | "opportunity" | "bundle" | "lot" | "roll" | "karigar" | "challan"; label: string; sublabel: string; href: string };

const TYPE_LABEL: Record<Result["type"], string> = {
  lead: "Lead", domain: "Domain", team: "Team", company: "Company", person: "Person", opportunity: "Deal",
  bundle: "Bundle", lot: "Lot", roll: "Roll", karigar: "Karigar", challan: "Challan",
};

type CrmHit = { kind: "company" | "person" | "opportunity"; id: string; label: string; sub: string | null; href: string };
type PieceHit = { kind: "bundle" | "lot" | "roll" | "karigar" | "challan"; id: string; label: string; sub: string | null; href: string };
const START_ACTION = { label: "Create prospect", detail: "Start a researched prospect", href: "/outreach/prospects?create=1" };
/** Where a garment maker's people go from an empty search. */
const PIECE_SHORTCUTS = [
  { label: "Scan a bundle or roll", href: "/shopfloor/scan" }, { label: "Lots", href: "/lots" }, { label: "Karigars", href: "/karigars" },
  { label: "Fabric", href: "/fabric" }, { label: "Cases", href: "/shopfloor/cases" }, { label: "Reports", href: "/lots/reports" },
];

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
  // Which sources this workspace has, learned the first time the palette opens (an inactive capability's query simply fails).
  const [sources, setSources] = useState<{ outreach: boolean; piecework: boolean } | null>(null);
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
    if (!open || sources) return;
    void Promise.all([
      runQuery("verity.outreach.command_palette_search", { q: "zz" }),
      runQuery("verity.piecework.search", { term: "zz" }),
    ]).then(([o, w]) => setSources({ outreach: o.ok, piecework: w.ok }));
  }, [open, sources]);

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
        // Each source answers only for a tenant that has it: an inactive capability's query fails and adds nothing.
        const [outreach, crm, piece] = await Promise.all([
          runQuery<Result[]>("verity.outreach.command_palette_search", { q: q.trim() }),
          runQuery<CrmHit[]>("verity.relationship.search", { term: q.trim() }),
          runQuery<PieceHit[]>("verity.piecework.search", { term: q.trim() }),
        ]);
        setResults([
          ...(piece.ok ? piece.data.map((h) => ({ id: h.id, type: h.kind, label: h.label, sublabel: h.sub ?? "", href: h.href })) : []),
          ...(crm.ok ? crm.data.map((h) => ({ id: h.id, type: h.kind, label: h.label, sublabel: h.sub ?? "", href: h.href })) : []),
          ...(outreach.ok ? outreach.data : []),
        ]);
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
  const searchWords = sources?.piecework && !sources.outreach ? "Search a bundle, lot, karigar, roll or challan" : sources?.piecework ? "Search bundles, lots, karigars, companies, deals" : sources?.outreach ? "Search companies, people, deals, leads" : "Search";

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
            aria-label={searchWords}
            className="glass-overlay relative flex w-full max-w-[560px] flex-col overflow-hidden rounded-[14px]"
            onKeyDown={(e) => {
          onTrapKeyDown(e);
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            if (q.trim().length < 2) { if (sources?.outreach) go(START_ACTION.href); }
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
            placeholder={`${searchWords}…`}
            className="h-8 w-full border-0 bg-transparent text-[14px] text-text placeholder:text-text-tertiary focus:outline-none"
          />
          <kbd className="hidden shrink-0 rounded px-1.5 py-0.5 text-[12px] text-text-tertiary sm:inline bg-control">Esc</kbd>
        </div>
        <div className="max-h-[360px] overflow-y-auto p-2">
          {q.trim().length < 2 ? (
            <div className="flex flex-col gap-1">
              {sources?.outreach && (
                <button
                  onClick={() => go(START_ACTION.href)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-3 text-left text-[13px] text-text hover:bg-accent-subtle"
                >
                  <span>{START_ACTION.label}<span className="ml-2 text-text-tertiary">{START_ACTION.detail}</span></span>
                  <span className="text-text-tertiary">↵</span>
                </button>
              )}
              {sources?.piecework && (
                <>
                  <p className="m-0 px-3 pb-1 pt-2 text-[12px] text-text-tertiary">Type a number from the paper (B-0004, R-0003, LOT-0002, CH-0021), a name or a phone number. Or go to:</p>
                  <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0 px-2 pb-2">
                    {PIECE_SHORTCUTS.map((x) => (
                      <li key={x.href} className="list-none">
                        <button onClick={() => go(x.href)} className="min-h-10 rounded-[10px] bg-control px-3 text-[13px] text-text hover:bg-accent-subtle">{x.label}</button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {sources && !sources.outreach && !sources.piecework && <p className="px-3 py-4 text-center text-[13px] text-text-tertiary">Type a name or a number to search.</p>}
            </div>
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
                    <span className="shrink-0 text-[13px] uppercase tracking-[0.02em] text-text-secondary">{TYPE_LABEL[r.type]}</span>
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
                          className="rounded-[10px] px-2 py-1 text-[12px] text-text-secondary hover:bg-accent-subtle hover:text-text bg-control"
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
