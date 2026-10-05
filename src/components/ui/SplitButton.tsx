"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./primitives";
import { Icon } from "./icons";

/**
 * Split primary action — Authority: ADR-025 pattern 1.
 *
 * A filled `Button` with an attached chevron opening a menu of related
 * creation actions. Lives in its own client file rather than inside
 * `primitives.tsx` — that file has no "use client" directive and 161
 * importers, many rendered directly from Server Components; adding hook
 * state there would force the whole shared file into a client boundary
 * for one new component. Same reasoning as `ProfileMenu`/
 * `RequestAccessButton`, both already split out this session.
 *
 * Bind per ADR-025: use this where a page currently shows exactly one
 * "+ Add X" button but the same capability already exposes 2+ creation
 * commands. A page with genuinely one creation path stays a plain
 * `Button` — this is not mandatory decoration.
 */
export function SplitButton({
  label,
  onClick,
  items,
  variant = "primary",
  size = "md",
}: {
  /** The primary (most common) action's label — what a plain click does. */
  label: string;
  onClick: () => void;
  items: Array<{ label: string; onClick: () => void }>;
  variant?: "primary" | "secondary";
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const heights = size === "sm" ? "h-10" : "h-11";

  return (
    <div ref={rootRef} className="relative inline-flex">
      <Button variant={variant} size={size} onClick={onClick} className="rounded-r-none pr-4">
        {label}
      </Button>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More ${label.toLowerCase()} options`}
        onClick={() => setOpen((v) => !v)}
        className={
          heights +
          " cursor-pointer rounded-r-lg border-l border-l-[color-mix(in_srgb,black_12%,transparent)] px-2.5 transition-transform duration-150 active:scale-[0.97] " +
          (variant === "primary"
            ? "bg-accent text-accent-on hover:bg-accent-hover"
            : "bg-control text-text hover:border-line-strong")
        }
      >
        <Icon name="chevronDown" size={15} />
      </button>

      {open && (
        <div
          role="menu"
          className="glass-overlay absolute right-0 top-[calc(100%+8px)] z-50 min-w-[180px] rounded-xl p-1.5"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className="flex w-full cursor-pointer items-center rounded-lg border-0 bg-transparent px-3 py-2 text-left text-[14px] text-text transition-colors hover:bg-surface-sunken"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
