import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { loadPassport } from "@/server/capabilities/manufacturing/passport-public";
import { sharedRateLimit } from "@/server/platform/shared-rate-limit";
import { Icon } from "@/components/ui/icons";
import { IconTile } from "@/components/ui/IconTile";
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
  const completed = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric" }).format(new Date(passport.completedAt));

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-5 px-4 py-8 sm:py-14">
      <section className="glass-card flex flex-col items-center gap-4 px-6 py-8 text-center">
        <span
          aria-hidden="true"
          className="grid size-16 place-items-center rounded-full"
          style={{ backgroundColor: "var(--color-state-completed-fill)", color: "var(--color-state-completed-ink)" }}
        >
          <Icon name="check" size={34} />
        </span>
        <p className="m-0 text-[13px] font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--color-state-completed-ink)" }}>
          Verified product
        </p>
        <h1 className="m-0 text-[28px] font-bold leading-[34px] tracking-[-0.02em] text-text">{passport.product}</h1>
        <p className="m-0 text-[15px] text-text-secondary">
          Made by {passport.tenant}
          {passport.reference ? ` · ${passport.reference}` : ""}
        </p>
        <dl className="m-0 mt-1 grid w-full grid-cols-2 gap-3 text-left">
          <div className="rounded-[12px] bg-[var(--color-surface-sunken)] p-3">
            <dt className="text-[12px] text-text-tertiary">Completed</dt>
            <dd className="m-0 mt-0.5 text-[15px] font-semibold text-text">{completed}</dd>
          </div>
          <div className="rounded-[12px] bg-[var(--color-surface-sunken)] p-3">
            <dt className="text-[12px] text-text-tertiary">Inspections passed</dt>
            <dd className="m-0 mt-0.5 text-[15px] font-semibold text-text">{totalChecks} of {totalChecks}</dd>
          </div>
        </dl>
      </section>

      {passport.stages.map((stage) => (
        <section key={stage.label} className="glass-card p-5" aria-label={stage.label}>
          <div className="mb-3 flex items-center gap-3">
            <IconTile kind={stageKindFor("", stage.label)} size="md" />
            <h2 className="m-0 min-w-0 flex-1 text-[17px] font-semibold text-text">{stage.label}</h2>
            <span
              className="shrink-0 rounded-full px-2.5 py-0.5 text-[13px] font-medium"
              style={{ backgroundColor: "var(--color-state-completed-fill)", color: "var(--color-state-completed-ink)" }}
            >
              All passed
            </span>
          </div>
          <ul className="m-0 flex list-none flex-col p-0">
            {stage.checks.map((check) => (
              <li key={check.label} className="flex items-start gap-3 border-t border-line py-3 first:border-0 first:pt-1">
                <span
                  aria-hidden="true"
                  className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full"
                  style={{ backgroundColor: "var(--color-state-completed-fill)", color: "var(--color-state-completed-ink)" }}
                >
                  <Icon name="check" size={13} />
                </span>
                <span className="min-w-0 flex-1 text-[15px] text-text">{check.label}</span>
                <span className="sr-only">Passed</span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <p className="m-0 px-1 text-center text-[12px] leading-[1.5] text-text-tertiary">
        Each check above was recorded as passing before this product was completed. This page shows only what{" "}
        {passport.tenant} chose to publish. If this code looks wrong, contact the seller.
      </p>
      <p className="m-0 text-center text-[12px] text-text-tertiary">Verified with Verity</p>
    </main>
  );
}
