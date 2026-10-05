import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { loadPassport } from "@/server/capabilities/manufacturing/passport-public";
import { sharedRateLimit } from "@/server/platform/shared-rate-limit";

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

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-8 px-4 py-16">
      <header className="flex flex-col gap-2">
        <p className="m-0 text-[12px] uppercase tracking-[0.12em] text-text-tertiary">Verified product</p>
        <h1 className="m-0 text-[32px] font-bold leading-[40px] tracking-[-0.02em] text-text">{passport.product}</h1>
        <p className="m-0 text-[15px] text-text-secondary">
          Made by {passport.tenant}
          {passport.reference ? ` · ${passport.reference}` : ""}
        </p>
        <p className="m-0 text-[13px] text-text-tertiary">Completed {passport.completedAt.slice(0, 10)}</p>
      </header>

      <section aria-labelledby="inspection" className="glass-card rounded-xl border border-line p-6">
        <h2 id="inspection" className="m-0 mb-1 text-[17px] font-medium text-text">Passed inspection</h2>
        <p className="m-0 mb-5 text-[13px] text-text-secondary">
          Every check below was recorded as passing before this product was completed.
        </p>
        {passport.stages.map((stage) => (
          <div key={stage.label} className="border-t border-line py-4 first:border-0 first:pt-0">
            <h3 className="m-0 mb-2 text-[14px] font-medium text-text">{stage.label}</h3>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {stage.checks.map((check) => (
                <li key={check.label} className="flex items-baseline justify-between gap-3 text-[14px] text-text-secondary">
                  <span>{check.label}</span>
                  <span className="shrink-0 text-[12px] font-medium text-success">Passed</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <p className="m-0 text-[12px] leading-[1.5] text-text-tertiary">
        This page shows only the information {passport.tenant} chose to publish. If you were expecting more, or
        believe this code is wrong, contact the seller.
      </p>
    </main>
  );
}
