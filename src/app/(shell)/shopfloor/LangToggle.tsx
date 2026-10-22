"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setFloorLanguage } from "./actions";
import type { Lang } from "./labels";

/** Hindi or English for the floor screens, chosen on this device. */
export function LangToggle({ lang }: { lang: Lang }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const choose = (next: Lang) => {
    if (next === lang) return;
    start(async () => {
      await setFloorLanguage(next);
      router.refresh();
    });
  };
  return (
    <div role="group" aria-label="Language" className="inline-flex rounded-[10px] bg-[var(--color-control)] p-0.5" aria-busy={pending}>
      {([["en", "English"], ["hi", "हिंदी"]] as const).map(([code, name]) => (
        <button
          key={code}
          type="button"
          aria-pressed={lang === code}
          lang={code}
          onClick={() => choose(code)}
          className={`min-h-9 min-w-[4.5rem] cursor-pointer rounded-[8px] px-3 text-[14px] font-medium transition-[background-color,opacity] duration-150 active:opacity-70 ${lang === code ? "bg-accent text-accent-on" : "text-text-secondary hover:text-text"}`}
        >
          {name}
        </button>
      ))}
    </div>
  );
}
