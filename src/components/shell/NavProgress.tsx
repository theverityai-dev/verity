"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Navigation progress (ADR-053 audit, 2026-10-22).
 *
 * A server-rendered page takes a few hundred milliseconds to arrive, and until it does a click shows nothing. This bar
 * starts on the same frame as the click, creeps toward 85% (it never claims to be finished early), then completes and
 * fades when the new pathname or query string lands. It reacts to any same-origin link that changes the address,
 * so every card, row, tab and filter chip gets feedback without each one wiring its own pending state.
 *
 * Reduced motion: the bar still appears (it carries information) but does not creep, it simply jumps to its resting width.
 */
type Phase = "idle" | "loading" | "done";

function Bar() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [phase, setPhase] = useState<Phase>("idle");
  const where = `${pathname}?${search}`;

  // The address changed: finish, then clear.
  useEffect(() => {
    setPhase((p) => (p === "loading" ? "done" : p));
    const t = setTimeout(() => setPhase("idle"), 450);
    return () => clearTimeout(t);
  }, [where]);

  // A same-origin link was activated: start immediately.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.("a");
      const href = link?.getAttribute("href");
      if (!link || !href || href.startsWith("#") || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      setPhase("loading");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Never leave a bar hanging if a navigation is cancelled or fails.
  useEffect(() => {
    if (phase !== "loading") return;
    const t = setTimeout(() => setPhase("idle"), 20_000);
    return () => clearTimeout(t);
  }, [phase]);

  const style =
    phase === "loading"
      ? { transform: "scaleX(0.85)", opacity: 1, transition: "transform 9s cubic-bezier(0.08, 0.6, 0.2, 1)" }
      : phase === "done"
        ? { transform: "scaleX(1)", opacity: 0, transition: "transform 200ms ease-out, opacity 300ms ease 150ms" }
        : { transform: "scaleX(0)", opacity: 0, transition: "none" };

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[2px]">
      <div
        className="h-full origin-left bg-[var(--color-accent)] motion-reduce:!transition-none"
        style={{ ...style, boxShadow: "0 0 10px var(--color-accent)" }}
      />
    </div>
  );
}

export function NavProgress() {
  return (
    <Suspense fallback={null}>
      <Bar />
    </Suspense>
  );
}
