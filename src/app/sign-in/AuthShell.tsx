import type { ReactNode } from "react";
import { SignInThemeToggle } from "./SignInThemeToggle";
import { BrandPanel } from "./BrandPanel";
import { VerityLockup } from "@/components/brand/VerityMark";

/**
 * The front-door composition, shared by sign-in and the password-reset
 * pages (2026-09-15) so "Forgot password?" lands on the same screen the
 * person just left, not a different product. It deliberately inherits the
 * application-wide accent instead of maintaining a front-door exception.
 *
 * ADR-053 (2026-10-23): the form sits in a glass cell over the same blue light
 * field as the app, so the first screen is the same material as the second.
 * The page scrolls itself (`overflow-y-auto`) because the document is a fixed
 * shell with `overflow: hidden`.
 */
export function AuthShell({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <main id="main" className="grid h-dvh grid-cols-1 overflow-y-auto lg:grid-cols-[1.1fr_1fr]">
      <BrandPanel />
      <div className="relative flex min-h-dvh flex-col px-5 py-6 sm:px-12 lg:min-h-0 lg:px-16 lg:py-10">
        <div className="flex justify-end">
          <SignInThemeToggle />
        </div>
        <div className="flex flex-1 flex-col justify-center py-8">
          <div className="glass-card mx-auto w-full max-w-[440px] p-8 max-sm:p-6">
            <h1 className="m-0 text-[34px] font-extralight leading-[41px] tracking-[-0.045em] text-text">{title}</h1>
            <p className="m-0 mt-2 text-[15px] text-text-secondary">{lead}</p>
            <div className="mt-8">{children}</div>
          </div>
        </div>
        {/* The left panel carries the lockup on wide screens; below that it is hidden, so the mark is shown here instead. */}
        <div className="flex justify-center pb-2 pt-4 lg:hidden">
          <VerityLockup size={22} className="text-text" />
        </div>
      </div>
    </main>
  );
}
