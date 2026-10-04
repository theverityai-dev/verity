"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Icon } from "@/components/ui/icons";
import { signOut } from "@/server/actions/platform";

/**
 * Top-bar identity control. Was a static, unclickable avatar — Sign out lived
 * only in the desktop sidebar's own footer (overlapping the assistant dock at
 * small viewport heights) and there was no single reachable "Settings" entry
 * point at all. This replaces the avatar with the actual menu: Account
 * (`/account`, every role, no gate) and Settings (`/settings`) — also
 * ungated, deliberately: `/settings`'s own Appearance section is a per-user
 * cookie preference (theme/accent), not tenant policy, so every actor needs
 * to reach it. Sections inside `/settings` that ARE tenant-admin-only
 * (Business, Tax, Advanced configuration) gate themselves at that page, the
 * same pattern `PermissionDenied` already covers elsewhere on this platform.
 */
export function ProfileMenu({
  userLabel,
  userInitials,
}: {
  userLabel: string;
  userInitials: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // APPLE-P1-02: the three focusable menu items, in visual order, so Arrow
  // keys can cycle them and opening can focus the first one.
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  // Right-edge-anchored position for the portalled menu — see the portal
  // comment below for why this exists at all.
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);

  const measure = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const box = trigger.getBoundingClientRect();
    setAnchor({ top: box.bottom + 8, right: window.innerWidth - box.right });
  }, []);

  function close() {
    setOpen(false);
  }

  function closeAndRestoreFocus() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  // Before paint, so the menu never appears at the wrong place for a frame.
  useLayoutEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    // Opening moves focus INTO the menu — a menu you can only reach visually
    // is not reachable by keyboard at all.
    itemRefs.current[0]?.focus();
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      // The menu now lives on <body> (see the portal below) — "inside" is
      // the trigger's root OR the portalled menu itself.
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      closeAndRestoreFocus();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeAndRestoreFocus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const items = itemRefs.current.filter(Boolean) as HTMLElement[];
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(currentIndex + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(currentIndex - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={userLabel}
        className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-accent-subtle text-[13px] font-medium text-accent-ink shadow-[var(--shadow-sm)] ring-1 ring-[var(--color-accent-line)] transition-transform duration-150 hover:-translate-y-px"
      >
        <span aria-hidden="true">{userInitials}</span>
        <span className="sr-only">Account menu — signed in as {userLabel}</span>
      </button>

      {open &&
        anchor &&
        createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
          // Portalled onto <body>, not rendered inside the header. The header
          // itself is `.glass-shell` (its own `backdrop-filter`), and a
          // `backdrop-filter` element nested inside another one is a known
          // Chromium compositing bug: the inner blur silently no-ops, so the
          // menu rendered with its tint but none of its blur — page text
          // behind it stayed crisp and readable. Portalling to `document.body`
          // puts the menu's backdrop-filter outside that ancestor's stacking
          // context so it samples the real page again.
          style={{ position: "fixed", top: anchor.top, right: anchor.right }}
          className="glass-overlay z-50 w-56 rounded-xl p-1.5"
        >
          <div className="truncate px-3 py-2 text-[12.5px] text-text-tertiary">{userLabel}</div>
          <Link
            ref={(el) => {
              itemRefs.current[0] = el;
            }}
            href="/account"
            role="menuitem"
            onClick={close}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[14px] text-text no-underline transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:bg-surface-sunken"
          >
            <Icon name="parties" size={17} className="shrink-0 text-text-tertiary" />
            Account
          </Link>
          <Link
            ref={(el) => {
              itemRefs.current[1] = el;
            }}
            href="/settings"
            role="menuitem"
            onClick={close}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[14px] text-text no-underline transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:bg-surface-sunken"
          >
            <Icon name="configuration" size={17} className="shrink-0 text-text-tertiary" />
            Settings
          </Link>
          <div className="my-1.5 border-t border-line" />
          <form action={signOut}>
            <button
              ref={(el) => {
                itemRefs.current[2] = el;
              }}
              type="submit"
              role="menuitem"
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-3 py-2 text-left text-[14px] text-text-secondary transition-colors hover:bg-surface-sunken hover:text-text focus-visible:outline-none focus-visible:bg-surface-sunken"
            >
              <Icon name="signOut" size={17} className="shrink-0 text-text-tertiary" />
              Sign out
            </button>
          </form>
        </div>,
        document.body,
      )}
    </div>
  );
}
