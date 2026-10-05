"use client";

import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/ui/icons";

type Preference = "light" | "dark";

const ORDER: Preference[] = ["light", "dark"];
const ICON: Record<Preference, IconName> = { light: "sun", dark: "moon" };
const LABEL: Record<Preference, string> = { light: "Light", dark: "Dark" };

/** A year. Long enough that the choice survives, short enough to expire. */
const MAX_AGE = 60 * 60 * 24 * 365;

function readPreference(): Preference {
  const match = document.cookie.match(/(?:^|;\s*)verity-theme=(light|dark)/);
  if (match?.[1]) return match[1] as Preference;
  // No stored choice, or the retired "system" value: start from whatever the
  // OS is showing right now, so the first press flips rather than appearing to
  // do nothing.
  return typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * Theme control. Two states — Light and Dark.
 *
 * "System" was a third state and is gone at the product owner's request. It was
 * defensible and it was also the state nobody could read off the button: three
 * positions on one icon means the current one is a guess until you press it.
 * Two positions make the control a switch, which is what people expect a theme
 * button to be.
 *
 * A stored "system" from before simply falls through to whatever the OS is
 * showing at that moment, so nobody is stranded on a value that no longer
 * exists, and the first press flips rather than appearing to do nothing.
 *
 * The preference is a COOKIE, not localStorage, so the server can stamp
 * `data-theme` into the first byte of HTML. That is what lets the document
 * carry no theme script at all; see `app/layout.tsx` and `globals.css`.
 *
 * The attribute is also set here directly rather than waiting for a navigation,
 * so switching is instant instead of a round trip.
 *
 * Rendering is deferred until after mount. The server does not send the
 * preference down to this component, so anything drawn from it during SSR would
 * be a guess that hydration then corrects in front of the user.
 */
export function ThemeToggle() {
  const [preference, setPreference] = useState<Preference>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setPreference(readPreference());
    setMounted(true);
  }, []);

  function choose(next: Preference) {
    setPreference(next);
    document.cookie = `verity-theme=${next}; path=/; max-age=${MAX_AGE}; samesite=lax`;
    document.documentElement.setAttribute("data-theme", next);
  }

  // Placeholder holds the exact footprint so the header does not reflow when
  // the real control appears.
  if (!mounted) return <div className="size-11 lg:size-9" aria-hidden="true" />;

  const next = ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length]!;

  return (
    <button
      type="button"
      onClick={() => choose(next)}
      title={`Theme: ${LABEL[preference]}. Switch to ${LABEL[next]}.`}
      className="grid size-11 cursor-pointer place-items-center rounded-md bg-surface text-text-secondary transition-colors hover:bg-surface-sunken hover:text-text lg:size-9"
    >
      <Icon name={ICON[preference]} size={17} />
      {/* The state is carried as text as well as an icon, for assistive
          technology. */}
      <span className="sr-only">
        Theme: {LABEL[preference]}. Activate to switch to {LABEL[next]}.
      </span>
    </button>
  );
}
