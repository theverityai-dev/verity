"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";
import { ProfileMenu } from "./ProfileMenu";
import { Icon, type IconName } from "@/components/ui/icons";
import { VerityLockup } from "@/components/brand/VerityMark";
import { signOut } from "@/server/actions/platform";
import { AgentChatDock } from "./AgentChatDock";
import { CommandPalette } from "./CommandPalette";

export type NavItem = { href: string; label: string; icon?: IconName };
export type NavArea = { group: string; items: NavItem[] };

/**
 * The Verity application shell.
 *
 * Geometry, palette and composition follow the approved product mockups.
 *
 * WHAT THE MOCKUP'S SHELL IS
 * A 234px sidebar carrying the lockup, a NAMED navigation list, and the signed-
 * in person at the bottom. It is LEVEL 1 of the material system (ADR-011): the
 * quietest glass, separated from the content by an alpha hairline rather than a
 * fill, so it reads as part of the same environment rather than as a docked
 * panel. The top bar is level 2/4 — floating controls over the atmosphere, not
 * a toolbar with a background. Navigation items are icon plus label at a 63px pitch; the current
 * one sits on a pale accent bed with an accent glyph and near-black label.
 *
 * Labels are not optional. An icon-only rail makes an operator learn nine
 * glyphs before they can find anything, and every one of those glyphs is a
 * guess until they hover it.
 *
 * The content column opens with a top bar — search, operating context, and the
 * account controls — and the page's own title sits beneath it. That ordering is
 * the mockup's: the bar belongs to the application, the title belongs to the
 * page.
 *
 * Responsive by RESTRUCTURING, not shrinking. Below `lg` the sidebar becomes a
 * sheet, because a permanent 234px panel would eat two thirds of a phone.
 */
export function ShellChrome({
  areas,
  userLabel,
  userInitials,
  canAudit,
  unreadCount = 0,
  children,
}: {
  areas: NavArea[];
  userLabel: string;
  userInitials: string;
  /** Task 114 P0.6 — the top-bar "Recent activity" bell link to `/audit` was
   *  unconditional, so an actor without `Read` on `verity.platform.activity`
   *  hit a bare permission-denied page with no warning. The sidebar's own
   *  Audit entry already gates on this; the bell didn't. */
  canAudit: boolean;
  /** Task 114 P1.5 item 1 — unread in-app notification count for the bell. */
  unreadCount?: number;
  children: ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();

  // Escape closes the mobile sheet — a sheet you can only leave by finding its
  // close button is a trap for keyboard users.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setNavOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  /**
   * P1-04 — the 240px rail is a third of a 1280px laptop viewport spent on
   * navigation an operator has already memorised. Collapse is reversible
   * (toggle button + Cmd/Ctrl+B) and remembered per browser via
   * `localStorage`, not per session, so it doesn't reset on every reload.
   *
   * Starts `false` on both server and first client render — reading
   * `localStorage` in the initializer would run during SSR too (where it
   * doesn't exist) and desync the hydrated DOM from the server-rendered one.
   * The one-frame "starts expanded" flash is the accepted trade-off for a
   * client-only preference; the effect below corrects it before paint settles.
   */
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (window.localStorage.getItem("verity:sidebar-collapsed") === "1") {
      setCollapsed(true);
    }
  }, []);
  const toggleCollapsed = () =>
    setCollapsed((v) => {
      const next = !v;
      window.localStorage.setItem("verity:sidebar-collapsed", next ? "1" : "0");
      return next;
    });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * Which nav item LOOKS active, tracked separately from `pathname`.
   *
   * `usePathname()` only updates once the target page has actually committed
   * — the whole gap this exists to close is that a click felt like it did
   * nothing until the new page's server work finished. Set optimistically on
   * click, so the highlight moves in the same frame as the click; cleared the
   * moment `pathname` catches up, so a cancelled or redirected navigation
   * doesn't strand it lit. `(shell)/loading.tsx` covers the content area for
   * the same gap; this covers the nav.
   */
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  // Every registered href, flattened once — needed so a sub-route (e.g.
  // `/outreach/workspace`) highlights only its own, most specific nav entry,
  // not every ancestor prefix it also happens to start with (`/outreach`).
  // Surfaced by Task 105's outreach capability, which is the first one to
  // register sibling nav items sharing a path prefix — a real bug, not
  // outreach-specific, so fixed here rather than by avoiding the prefix.
  const allHrefs = areas.flatMap((a) => a.items.map((i) => i.href));

  const isCurrent = (href: string) => {
    if (pendingHref) return pendingHref === href;
    if (href === "/") return pathname === "/";
    if (!pathname.startsWith(href)) return false;
    const bestMatch = allHrefs
      .filter((h) => h !== "/" && pathname.startsWith(h))
      .sort((a, b) => b.length - a.length)[0];
    return href === bestMatch;
  };

  /**
   * P1-05 — the mobile bottom tab bar's 4 primary destinations.
   *
   * `areas` is already the platform's own priority order: Overview first,
   * then the business groups a client reads in (taskplans/45 §8 — Trade,
   * Inventory, Money, Insights), Administration last. There is no per-role
   * usage telemetry to rank by, so the first four items in that declared
   * order stand in for "most-used" — a defensible default, not a guess, and
   * every item not in the bar is one tap away behind "More" regardless.
   */
  const MOBILE_TAB_COUNT = 4;
  const mobileTabItems = areas.flatMap((a) => a.items).slice(0, MOBILE_TAB_COUNT);

  /**
   * The navigation list.
   *
   * Group headings are DRAWN, not merely announced to a screen reader.
   *
   * They were `sr-only` because nine items did not need three headings to be
   * scannable, and that was true of nine items. The plywood workflow brings
   * fifteen across five business areas — Trade, Inventory, Money, Insights,
   * Administration (taskplans/45 §8) — and an unlabelled list of fifteen is
   * exactly the failure the grouping existed to prevent. A sighted user was
   * being given strictly less structure than a screen-reader user, which is a
   * strange way round.
   *
   * A single-item group still gets no heading: a heading over one link is
   * noise, and "Overview" sits alone at the top.
   */
  function navList(rail = false) {
    return (
      <nav aria-label="Platform" className="flex flex-col gap-1">
        {areas.map((area) => (
          <ul key={area.group} className="m-0 flex list-none flex-col gap-1 p-0">
            {area.items.length > 1 && !rail ? (
              <li
                aria-hidden="true"
                className="px-3 pt-5 pb-1 text-[13px] font-semibold text-text-secondary"
              >
                {area.group}
              </li>
            ) : (
              <li className="sr-only" aria-hidden="true">
                {area.group}
              </li>
            )}
            {area.items.map((item) => {
              const current = isCurrent(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    title={rail ? item.label : undefined}
                    onClick={() => {
                      setNavOpen(false);
                      if (!current) setPendingHref(item.href);
                    }}
                    aria-current={current ? "page" : undefined}
                    className={
                      // 52px per item put ~1200px of navigation into a 626px
                      // column on a 800px-tall window, so half the menu sat
                      // below the fold behind a SECOND scrollbar. Reaching it
                      // meant scrolling the sidebar, and once that hit its end
                      // the wheel did nothing at all while the pointer stayed
                      // over it — which reads as the page being stuck, and a
                      // reload does not help because the pointer has not moved.
                      // 42px and a tighter icon gap fit the whole menu without
                      // dropping below the 40px comfortable-target floor.
                      // iPadOS sidebar row: the selected row is a tint fill
                      // with white label and glyph; the rest are plain label
                      // text with tinted glyphs (ADR-033).
                      "flex h-10 items-center rounded-[10px] text-[15px] no-underline " +
                      "transition-[background-color,color] duration-200 " +
                      (rail ? "justify-center px-0 " : "gap-3 px-3 ") +
                      (current
                        ? "bg-accent font-semibold text-accent-on"
                        : "text-text hover:bg-[var(--color-control)]")
                    }
                  >
                    {item.icon && (
                      <Icon
                        name={item.icon}
                        size={20}
                        className={current ? "text-accent-on" : "text-accent-ink"}
                      />
                    )}
                    <span className={rail ? "sr-only" : "truncate"}>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ))}
      </nav>
    );
  }

  /**
   * Sign out, at the foot of the sidebar.
   *
   * It used to show the signed-in person's name and role and sign them out when
   * pressed — a control that named one thing and did another, which is the one
   * thing a destructive-ish action must never do. It says what it does now.
   *
   * The identity it displayed is not lost: the header carries the avatar and
   * the organisation the session is acting in, which is the part that actually
   * changes and the part worth checking.
   */
  function accountCard() {
    return (
      <form action={signOut} className="mt-auto pt-4">
        <button
          type="submit"
          className="flex w-full cursor-pointer items-center gap-3 rounded-[10px] border-0 bg-transparent px-3 py-2.5 text-left text-[15px] text-danger transition-colors hover:bg-[var(--color-control)]"
        >
          <Icon name="signOut" size={19} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">Sign out</span>
        </button>
      </form>
    );
  }

  return (
    /**
     * SCROLL OWNERSHIP (ADR-012; work plan D11–D14).
     *
     * The shell is fixed and the CONTENT scrolls, rather than the document
     * scrolling as one long page. That is why the top bar, the sidebar and the
     * account card stay put: they are not sticky elements racing the viewport,
     * they simply never move because nothing under them is the scroller.
     *
     * `h-dvh` plus `overflow-hidden` here, `min-h-0` on every flex descendant
     * that must be allowed to shrink, and exactly one `overflow-y-auto` per
     * region. Omitting `min-h-0` is what makes a flex child refuse to scroll and
     * push the page taller instead — the failure this replaces.
     */
    <div
      data-shell-root=""
      className="flex h-dvh flex-col overflow-hidden lg:grid"
      style={{
        gridTemplateColumns: collapsed ? "76px 1fr" : "240px 1fr",
        transition: "grid-template-columns 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {/* ----------------------------- sidebar -----------------------------
          Header and account card are stable; the NAVIGATION REGION ALONE
          scrolls, and only when the list outgrows the viewport (D12). Hidden
          from print entirely — see globals.css's `@media print` block for
          why hiding it here isn't enough on its own (the grid/height chain
          this root sits in needs resetting too, or the sidebar's gone but
          the content still clips to one screen-height page). */}
      {/* ADR-024: structural chrome uses the glass ladder, not .verity-solid
          — this is persistent chrome, not dense content. */}
      <aside
        className={
          "glass-shell hidden min-h-0 flex-col rounded-none border-r border-line pb-5 pt-6 print:hidden lg:flex " +
          (collapsed ? "px-3" : "px-4")
        }
      >
        <div className={"mb-7 flex shrink-0 items-center " + (collapsed ? "flex-col gap-3" : "justify-between px-2")}>
          <Link href="/" aria-label="Verity" className="block no-underline">
            <VerityLockup collapsed={collapsed} size={collapsed ? 22 : 30} className="text-text" />
          </Link>
          {/* P1-04: reversible, not a one-way door — same control collapses
              and expands. Cmd/Ctrl+B mirrors the convention VS Code and Slack
              already trained operators on for "toggle the sidebar". */}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-pressed={collapsed}
            title={collapsed ? "Expand sidebar (Ctrl/Cmd+B)" : "Collapse sidebar (Ctrl/Cmd+B)"}
            className="grid size-7 shrink-0 place-items-center rounded-md text-text-tertiary transition-colors duration-200 hover:bg-surface-sunken hover:text-text"
          >
            <Icon name={collapsed ? "expand" : "collapse"} size={16} />
            <span className="sr-only">{collapsed ? "Expand sidebar" : "Collapse sidebar"}</span>
          </button>
        </div>

        {/* Sign out moved to the header's ProfileMenu (desktop) — accountCard()
            is now mobile-sheet-only, below, where there is no header dropdown. */}
        <div className="min-h-0 flex-1 overflow-y-auto">{navList(collapsed)}</div>
      </aside>

      {/* ------------------------------ main ------------------------------- */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Mobile top bar: identity + theme only. Navigation lives in the
            bottom tab bar below (P1-05) — no duplicate "Menu" trigger. */}
        <div className="glass-shell z-30 flex h-14 shrink-0 items-center justify-between gap-3 rounded-none border-b border-line px-4 print:hidden lg:hidden">
          <Link href="/" aria-label="Verity" className="no-underline">
            <VerityLockup size={22} className="text-text" />
          </Link>
          <ThemeToggle />
        </div>

        {navOpen && (
          <div className="fixed inset-0 z-40 flex flex-col print:hidden lg:hidden">
            {/* A scrim behind a temporary sheet. Under ADR-011 glass is a
                material system rather than an exception, but this surface's
                treatment is unchanged. */}
            <button
              className="verity-scrim absolute inset-0 border-0"
              aria-label="Close navigation"
              onClick={() => setNavOpen(false)}
            />
            <div
              id="mobile-nav"
              className="glass-shell relative mt-14 mb-16 flex max-h-[calc(100dvh-7.5rem)] flex-col gap-5 overflow-y-auto rounded-none border-t border-line p-4 shadow-lg"
            >
              {navList()}
              {accountCard()}
            </div>
          </div>
        )}

        {/* -------------------------- top bar ---------------------------
            Persistent chrome, as the boards draw it. It needs no `sticky`:
            the main region below owns the scroll, so this never travels. */}
        <div className="hidden h-20 shrink-0 items-center gap-5 px-7 print:hidden lg:flex">
          {/* APPLE-P0-01: this used to be a real-looking `<input>` that did
              nothing with what was typed into it — a false affordance. It is
              now a button that opens the actual global search surface
              (`CommandPalette`, Cmd/Ctrl+K), styled to match the field it
              replaces so the masthead's geometry is unchanged. */}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("verity:open-command-palette"))}
            className="glass-control relative flex h-9 w-full max-w-[560px] cursor-pointer items-center rounded-[10px] pl-9 pr-14 text-left text-[15px] text-text-tertiary transition-[box-shadow] duration-200 focus-visible:shadow-[0_0_0_3px_var(--color-accent-subtle)] focus-visible:outline-none"
          >
            <Icon
              name="search"
              size={16}
              className="pointer-events-none absolute left-3 text-text-tertiary"
            />
            <span className="truncate">Search</span>
            <kbd className="pointer-events-none absolute right-3 rounded px-1.5 py-0.5 text-[12px] text-text-tertiary">
              ⌘K
            </kbd>
          </button>

          <div className="flex shrink-0 items-center gap-3">
            <ThemeToggle />
            {canAudit && (
              <Link
                href="/audit"
                title="Recent activity"
                className="glass-control relative grid size-11 place-items-center rounded-full text-accent-ink no-underline transition-opacity duration-200 active:opacity-70"
              >
                <Icon name="bell" size={19} />
                {unreadCount > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[10px] font-medium leading-none text-accent-on"
                  >
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
                <span className="sr-only">Recent activity{unreadCount > 0 ? ` — ${unreadCount} unread` : ""}</span>
              </Link>
            )}
            {/* The one place Account, Settings and Sign out all live — was a
                static, unclickable avatar with Sign out stranded in the
                sidebar footer instead. */}
            <ProfileMenu userLabel={userLabel} userInitials={userInitials} />
          </div>
        </div>

        {/* The one scroller in the application. Pages compose inside it and do
            not create a second one unless a dense region owns its own (D13).
            Bottom padding on mobile clears the fixed tab bar below (its own
            height plus the device's safe-area inset) — `lg:pb-10` reverts to
            the desktop figure where no tab bar exists. */}
        <main
          id="main"
          // The page's real scroll container: html and body are 100dvh with
          // overflow hidden, so nothing scrolls the document. Marked so a modal
          // can freeze THIS while it is open — locking document.body, which is
          // what a dialog normally does, achieves nothing here.
          data-shell-scroll=""
          className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 pb-[calc(4.5rem+env(safe-area-inset-bottom))] pt-6 print:p-0 sm:px-8 lg:px-8 lg:pb-10 lg:pt-0"
        >
          {children}
        </main>

        {/* P1-05 — mobile bottom tab bar. Replaces the old sheet-only nav: the
            top 4 destinations (declared priority order, see `mobileTabItems`
            above) are one tap away, everything else is one tap behind "More",
            which reuses the existing sheet rather than a second overflow
            surface. Safe-area padding keeps it clear of notches/gesture bars
            on devices that need it; `env()` resolves to 0 elsewhere. */}
        <nav
          aria-label="Primary"
          // z-40, matching the sheet's own wrapper, and placed after it in the
          // DOM: the sheet's scrim (`fixed inset-0`) would otherwise sit over
          // this bar and swallow taps on "Close" — same stacking level, later
          // paint wins, so the bar stays reachable while the sheet is open.
          className="glass-shell fixed inset-x-0 bottom-0 z-40 flex h-16 shrink-0 items-stretch justify-around border-t border-line px-1 pb-[env(safe-area-inset-bottom)] print:hidden lg:hidden"
        >
          {mobileTabItems.map((item) => {
            const current = isCurrent(item.href) && !navOpen;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => {
                  setNavOpen(false);
                  if (!isCurrent(item.href)) setPendingHref(item.href);
                }}
                aria-current={current ? "page" : undefined}
                className={
                  // iOS tab bar item: 10pt medium label under a 24pt glyph,
                  // tint when selected, gray otherwise.
                  "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium no-underline " +
                  "transition-colors duration-200 " +
                  (current ? "text-accent-ink" : "text-text-tertiary")
                }
              >
                {item.icon && <Icon name={item.icon} size={24} />}
                <span className="max-w-full truncate px-1">{item.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            aria-expanded={navOpen}
            aria-controls="mobile-nav"
            onClick={() => setNavOpen((v) => !v)}
            className={
              "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium " +
              "transition-colors duration-200 " +
              (navOpen ? "text-accent-ink" : "text-text-tertiary")
            }
          >
            <Icon name="moreHorizontal" size={24} />
            <span>{navOpen ? "Close" : "More"}</span>
          </button>
        </nav>
      </div>

      <AgentChatDock />
      <CommandPalette />
    </div>
  );
}
