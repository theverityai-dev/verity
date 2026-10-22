"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/icons";
import { EFFECTS_COOKIE, effectsAttribute, effectsChoice, type EffectsChoice } from "@/lib/effects";

type Preference = "light" | "dark" | "system";

const THEMES: Array<{ value: Preference; label: string; icon: "sun" | "moon" | "system" }> = [
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
  { value: "system", label: "System", icon: "system" },
];

const EFFECTS: Array<{ value: EffectsChoice; label: string; hint: string }> = [
  { value: "auto", label: "Automatic", hint: "Lite on slower phones and PCs" },
  { value: "full", label: "Full glass", hint: "Frosted blur everywhere" },
  { value: "lite", label: "Lite", hint: "Same look, no blur; faster" },
];

const MAX_AGE = 60 * 60 * 24 * 365;

function readCookie(name: string): string | undefined {
  return document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))?.[1];
}

function clear(name: string) {
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
}

function write(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=${MAX_AGE}; samesite=lax`;
}

/**
 * Appearance — theme.
 *
 * Theme preference is a cookie the server reads, which prevents a flash on the
 * next navigation. Accent choice is deliberately absent while the reference
 * screen's system-blue baseline is being rolled out.
 */
export function AppearanceControls() {
  const [theme, setTheme] = useState<Preference>("system");
  const [effects, setEffects] = useState<EffectsChoice>("auto");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = readCookie("verity-theme");
    if (t === "light" || t === "dark" || t === "system") setTheme(t);
    setEffects(effectsChoice(readCookie(EFFECTS_COOKIE)));
    setMounted(true);
  }, []);

  function chooseTheme(next: Preference) {
    setTheme(next);
    write("verity-theme", next);
    if (next === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", next);
  }

  // Automatic clears the cookie; the detector re-decides on the next page load, and until then the page keeps what it has.
  function chooseEffects(next: EffectsChoice) {
    setEffects(next);
    if (next === "auto") clear(EFFECTS_COOKIE);
    else write(EFFECTS_COOKIE, next);
    const attribute = next === "auto" ? undefined : effectsAttribute(next);
    if (attribute) document.documentElement.setAttribute("data-effects", attribute);
    else document.documentElement.removeAttribute("data-effects");
  }

  if (!mounted) return <div className="h-11" aria-hidden="true" />;

  return (
    <div className="flex flex-col gap-7">
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-3 p-0 text-[13px] font-medium text-text">Theme</legend>
        <div className="flex flex-wrap gap-2">
          {THEMES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => chooseTheme(t.value)}
              aria-pressed={theme === t.value}
              className={
                "inline-flex h-11 cursor-pointer items-center gap-2.5 rounded-lg px-4 text-[13.5px] transition-colors " +
                (theme === t.value
                  ? "bg-accent-subtle font-medium text-text ring-1 ring-[var(--color-accent-line)]"
                  : "bg-control text-text-secondary hover:text-text")
              }
            >
              <Icon name={t.icon} size={17} />
              {t.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-1 p-0 text-[13px] font-medium text-text">Visual effects</legend>
        <p className="mb-3 text-[12.5px] text-text-secondary">
          Lite keeps every colour and layout and removes the frosted blur, which is the heaviest thing on an older phone or PC.
        </p>
        <div className="flex flex-wrap gap-2">
          {EFFECTS.map((e) => (
            <button
              key={e.value}
              type="button"
              onClick={() => chooseEffects(e.value)}
              aria-pressed={effects === e.value}
              title={e.hint}
              className={
                "inline-flex h-11 cursor-pointer items-center rounded-lg px-4 text-[13.5px] transition-colors " +
                (effects === e.value
                  ? "bg-accent-subtle font-medium text-text ring-1 ring-[var(--color-accent-line)]"
                  : "bg-control text-text-secondary hover:text-text")
              }
            >
              {e.label}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
