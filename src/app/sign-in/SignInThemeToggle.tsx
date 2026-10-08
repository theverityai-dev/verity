"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/icons";

type Preference = "light" | "dark";

/** A year. Long enough that the choice survives, short enough to expire. */
const MAX_AGE = 60 * 60 * 24 * 365;

function readPreference(): Preference {
  const match = document.cookie.match(/(?:^|;\s*)verity-theme=(light|dark)/);
  if (match?.[1]) return match[1] as Preference;
  return typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * The reference board's segmented sun/moon pill — visually distinct from the
 * app shell's single-button `ThemeToggle`, but the SAME underlying mechanism
 * (the `verity-theme` cookie `ThemeToggle`/`app/layout.tsx` already read), so
 * a choice made here carries into the signed-in app rather than being a
 * second, disconnected preference.
 */
export function SignInThemeToggle() {
  const [preference, setPreference] = useState<Preference>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setPreference(readPreference());
    setMounted(true);
  }, []);

  function persist(next: Preference) {
    document.cookie = `verity-theme=${next}; path=/; max-age=${MAX_AGE}; samesite=lax`;
    document.documentElement.setAttribute("data-theme", next);
  }

  function chooseLight() {
    setPreference("light");
    persist("light");
  }

  function chooseDark() {
    setPreference("dark");
    persist("dark");
  }

  if (!mounted) return <div className="h-11 w-[92px]" aria-hidden="true" />;

  const buttonClass = (active: boolean) =>
    "grid size-9 max-sm:size-11 cursor-pointer place-items-center rounded-full transition-colors " +
    (active ? "bg-accent text-accent-on" : "text-text-tertiary hover:text-text-secondary");

  return (
    <div className="bg-control flex items-center gap-1 rounded-full p-1" role="radiogroup" aria-label="Theme">
      <button
        type="button"
        role="radio"
        aria-checked={preference === "light"}
        onClick={chooseLight}
        title="Light"
        className={buttonClass(preference === "light")}
      >
        <Icon name="sun" size={16} />
        <span className="sr-only">Light</span>
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={preference === "dark"}
        onClick={chooseDark}
        title="Dark"
        className={buttonClass(preference === "dark")}
      >
        <Icon name="moon" size={16} />
        <span className="sr-only">Dark</span>
      </button>
    </div>
  );
}
