import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { loadPassport } from "@/server/capabilities/manufacturing/passport-public";
import { sharedRateLimit } from "@/server/platform/shared-rate-limit";
import { Icon } from "@/components/ui/icons";
import { IconTile } from "@/components/ui/IconTile";
import { ProgressRing } from "@/components/ui/viz";
import { VerityLockup, VeritySymbol } from "@/components/brand/VerityMark";
import { stageKindFor } from "@/components/ui/business/domains";

export const dynamic = "force-dynamic";

// Never indexed, never cached: a revocation must take effect at once (ADR-030).
export const metadata = { title: "Verification", robots: { index: false, follow: false } };

/**
 * Public verification passport (ADR-030). No sign-in, no session, read-only.
 *
 * It shows only what the tenant published at issue time: who made it, what it
 * is, when it was completed and which inspections it passed, by label. A wrong,
 * malformed or revoked link all render the same "not found", so the page cannot
 * be used to learn which tokens exist.
 */
export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const source = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = await sharedRateLimit(`verify:${source}`, "query");
  if (!limit.allowed) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16">
        <p className="text-[15px] text-text-secondary">Too many requests. Please try again in {limit.retryAfterSeconds} seconds.</p>
      </main>
    );
  }

  const passport = await loadPassport(token);
  if (!passport) notFound();

  const totalChecks = passport.stages.reduce((n, st) => n + st.checks.length, 0);
  const completed = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(passport.completedAt));

  // The pass is a fixed dark object in both themes, like a Wallet pass: its own surface, not the app's.
  const ink = "#0b1220";
  const mute = "rgba(255,255,255,0.62)";

  return (
    <main className="mx-auto flex max-w-[430px] flex-col gap-5 px-4 py-8 sm:py-12">
      <section
        className="passport-rise relative overflow-hidden rounded-[28px] text-white shadow-[0_24px_60px_-24px_rgba(11,18,32,0.55)]"
        style={{ backgroundColor: ink }}
        aria-label="Verified product pass"
      >
        <div className="flex items-center justify-between gap-3 px-6 pt-6">
          <span className="inline-flex min-w-0 items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.1em]" style={{ color: mute }}>
            <VeritySymbol size={16} />
            <span className="truncate">{passport.tenant}</span>
          </span>
          <span
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold"
            style={{ backgroundColor: "rgba(52,199,89,0.16)", color: "#6ee79a" }}
          >
            <Icon name="check" size={13} />
            Verified
          </span>
        </div>

        <div className="flex flex-col items-center px-6 pb-7 pt-8 text-center">
          <span className="relative grid size-24 place-items-center" aria-hidden="true">
            <span className="absolute inset-0 rounded-full" style={{ border: "1.5px solid rgba(110,231,154,0.28)" }} />
            <span className="absolute inset-2 rounded-full" style={{ border: "1.5px solid rgba(110,231,154,0.5)" }} />
            <span className="grid size-14 place-items-center rounded-full" style={{ backgroundColor: "#34c759", color: ink }}>
              <Icon name="check" size={30} />
            </span>
          </span>
          <h1 className="m-0 mt-6 text-[30px] font-bold leading-[35px] tracking-[-0.025em]">{passport.product}</h1>
          {passport.reference && (
            <p className="m-0 mt-2 font-mono text-[13px] tracking-[0.04em]" style={{ color: mute }}>
              {passport.reference}
            </p>
          )}
        </div>

        {/* Perforation: a dashed tear line with notches cut into the card edge. */}
        <div className="relative h-0" aria-hidden="true">
          <span className="absolute -left-3 -top-3 size-6 rounded-full" style={{ backgroundColor: "var(--color-canvas)" }} />
          <span className="absolute -right-3 -top-3 size-6 rounded-full" style={{ backgroundColor: "var(--color-canvas)" }} />
          <span className="absolute inset-x-6 top-0 border-t border-dashed" style={{ borderColor: "rgba(255,255,255,0.22)" }} />
        </div>

        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-5 px-6 pb-7 pt-8">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: mute }}>Completed</dt>
            <dd className="m-0 mt-1 text-[17px] font-semibold">{completed}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: mute }}>Inspections</dt>
            <dd className="m-0 mt-1 text-[17px] font-semibold">{totalChecks} of {totalChecks} passed</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: mute }}>Made by</dt>
            <dd className="m-0 mt-1 text-[17px] font-semibold">{passport.tenant}</dd>
          </div>
        </dl>
      </section>

      <section className="passport-rise-2 glass-card overflow-hidden rounded-[22px]" aria-label="Inspection record">
        <div className="flex items-center gap-4 px-5 pb-3 pt-5">
          <ProgressRing value={totalChecks} total={totalChecks} size={52} label={`${totalChecks} of ${totalChecks} inspections passed`} />
          <div className="min-w-0">
            <h2 className="m-0 text-[19px] font-semibold leading-[24px] text-text">Inspection record</h2>
            <p className="m-0 text-[13px] text-text-secondary">Every check passed before this product was completed.</p>
          </div>
        </div>
        {passport.stages.map((stage) => (
          <div key={stage.label} className="border-t border-line px-5 py-4">
            <div className="mb-2 flex items-center gap-2.5">
              <IconTile kind={stageKindFor("", stage.label)} size="sm" />
              <h3 className="m-0 min-w-0 flex-1 text-[15px] font-semibold text-text">{stage.label}</h3>
              <span className="text-[13px] font-medium" style={{ color: "var(--color-state-completed-ink)" }}>{stage.checks.length} passed</span>
            </div>
            <ul className="m-0 flex list-none flex-col p-0">
              {stage.checks.map((check) => (
                <li key={check.label} className="flex items-start gap-3 py-2">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full"
                    style={{ backgroundColor: "var(--color-state-completed-fill)", color: "var(--color-state-completed-ink)" }}
                  >
                    <Icon name="check" size={12} />
                  </span>
                  <span className="min-w-0 flex-1 text-[15px] leading-[21px] text-text">{check.label}</span>
                  <span className="sr-only">Passed</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <footer className="flex flex-col items-center gap-2 px-2 pb-2 text-center">
        <p className="m-0 text-[12px] leading-[1.5] text-text-tertiary">
          This page shows only what {passport.tenant} chose to publish. If this code looks wrong, contact the seller.
        </p>
        <span className="inline-flex items-center gap-1.5 text-[12px] text-text-tertiary">
          Verified live with <VerityLockup size={13} />
        </span>
      </footer>
    </main>
  );
}
