import type { ReactNode } from "react";
import { SignInThemeToggle } from "./SignInThemeToggle";
import { BrandPanel } from "./BrandPanel";
import { VerityLockup } from "@/components/brand/VerityMark";

/**
 * The front-door composition, shared by sign-in and the password-reset
 * pages (2026-09-15) so "Forgot password?" lands on the same screen the
 * person just left, not a different product. It deliberately inherits the
 * application-wide accent instead of maintaining a front-door exception.
 */
export function AuthShell({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <main id="main" className="grid min-h-dvh grid-cols-1 bg-canvas lg:grid-cols-2">
        <BrandPanel />
        <div className="relative flex flex-col px-6 py-10 sm:px-16 lg:px-20 lg:py-14">
          <div className="flex justify-end">
            <SignInThemeToggle />
          </div>
          <div className="flex flex-1 flex-col justify-center">
            <div className="mx-auto w-full max-w-[400px]">
              <h1 className="m-0 text-[32px] font-normal leading-tight tracking-[-0.02em] text-text">{title}</h1>
              <p className="m-0 mt-2 text-[15px] text-text-secondary">{lead}</p>
              <div className="mt-9">{children}</div>
            </div>
          </div>
          <div className="flex flex-col items-center gap-2 pb-2 pt-10">
            <VerityLockup size={20} className="text-text" />
            <p className="m-0 text-[13px] uppercase tracking-[0.02em] text-text-secondary">Operate. Optimize. Outperform.</p>
          </div>
        </div>
    </main>
  );
}
