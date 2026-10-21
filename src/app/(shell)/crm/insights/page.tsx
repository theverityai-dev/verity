import { requireActor } from "@/server/platform/auth";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { RELATIONSHIP_CAPABILITY, pipelineInsights, pipelineSummary } from "@/server/capabilities/relationship";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { EmptyState, PageHeader, StatTile, StatTileRow } from "@/components/ui/primitives";
import { ProgressBar } from "@/components/ui/viz";
import { moneyShort } from "@/components/records/model";

export const dynamic = "force-dynamic";

const monthName = (key: string) =>
  new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${key}-01T00:00:00.000Z`));

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="glass-card rounded-[12px] p-4">
      <h2 className="m-0 text-[17px] font-semibold">{title}</h2>
      {note && <p className="m-0 mt-0.5 text-[13px] text-text-secondary">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * How the pipeline is doing, from the deals themselves: the job here is to see where deals drop out, why they are
 * lost, what is coming in each month, and what has been sitting too long. Every bar is a count or a sum over real
 * records; nothing is projected beyond the stage probabilities the business set.
 */
async function InsightsPage() {
  installCapabilities();
  const actor = await requireActor();
  const [insights, summary] = await Promise.all([executeQuery(actor, pipelineInsights, {}), executeQuery(actor, pipelineSummary, {})]);
  const top = Math.max(1, ...insights.funnel.map((f) => f.entered));
  const lostTotal = insights.lostReasons.reduce((n, r) => n + r.count, 0);
  const monthMax = Math.max(1, ...insights.months.map((m) => m.wonCount + m.lostCount));
  const forecastMax = Math.max(1, ...insights.forecast.map((f) => f.value));
  const ageMax = Math.max(1, ...insights.ageing.map((a) => a.count));
  const anything = insights.funnel.some((f) => f.entered > 0);

  return (
    <>
      <PageHeader title="Pipeline insights" description="Where deals drop out, why they are lost, what should close when, and what has waited too long." />
      {!anything ? (
        <div className="glass-card rounded-[12px]">
          <EmptyState title="Nothing to show yet" description="Insights appear once deals are moving through the pipeline." />
        </div>
      ) : (
        <>
          <StatTileRow className="mb-4">
            <StatTile kind="sales" label="Open pipeline" value={moneyShort(summary.openValue)} hint={`${summary.openCount} open`} href="/crm/opportunities" />
            <StatTile kind="quote" label="Weighted forecast" value={moneyShort(summary.weightedValue)} hint="by each stage's chance of closing" />
            <StatTile state="completed" icon="check" label="Win rate" value={summary.winRate90 === null ? "—" : `${summary.winRate90}%`} hint="of deals closed in 90 days" />
            <StatTile kind="milestone" label="Days to win" value={insights.avgDaysToWin ?? "—"} hint="average, from opening to won" />
          </StatTileRow>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Funnel" note="How many deals ever reached each stage.">
              <ol className="m-0 flex list-none flex-col gap-3 p-0">
                {insights.funnel.map((f, i) => {
                  const prev = insights.funnel[i - 1];
                  const kept = prev && prev.entered ? Math.round((f.entered / prev.entered) * 100) : null;
                  return (
                    <li key={f.label}>
                      <p className="m-0 mb-1 text-[14px] font-medium text-text">{f.label}</p>
                      <ProgressBar
                        value={f.entered}
                        total={top}
                        label={f.label}
                        tone={i === insights.funnel.length - 1 ? "completed" : "active"}
                        figures={`${f.entered}${kept !== null ? ` · ${kept}% of the stage before` : ""}`}
                      />
                    </li>
                  );
                })}
              </ol>
            </Section>

            <Section title="Why deals are lost" note="Last six months.">
              {insights.lostReasons.length === 0 ? (
                <p className="m-0 text-[15px] text-text-secondary">No deals lost in the last six months.</p>
              ) : (
                <ol className="m-0 flex list-none flex-col gap-3 p-0">
                  {insights.lostReasons.map((r) => (
                    <li key={r.reason}>
                      <p className="m-0 mb-1 text-[14px] font-medium text-text">{r.reason}</p>
                      <ProgressBar value={r.count} total={lostTotal} label={r.reason} tone="blocked" figures={`${r.count} · ${moneyShort(r.value)}`} />
                    </li>
                  ))}
                </ol>
              )}
            </Section>

            <Section title="Won and lost by month" note="Deals closed in each of the last six months.">
              <div className="flex h-44 items-end gap-2" role="img" aria-label={insights.months.map((m) => `${monthName(m.month)}: ${m.wonCount} won, ${m.lostCount} lost`).join("; ")}>
                {insights.months.map((m) => (
                  <div key={m.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                    <span className="tabular text-[12px] text-text-secondary">{m.wonCount ? moneyShort(m.wonValue) : ""}</span>
                    <div
                      className="flex w-full max-w-[44px] flex-col-reverse overflow-hidden rounded-[6px]"
                      style={{ height: `${((m.wonCount + m.lostCount) / monthMax) * 100}%`, minHeight: m.wonCount + m.lostCount ? 6 : 0 }}
                    >
                      <span style={{ flexGrow: m.wonCount, backgroundColor: "var(--color-state-completed)" }} />
                      <span style={{ flexGrow: m.lostCount, backgroundColor: "var(--color-state-blocked)" }} />
                    </div>
                    <span className="text-[12px] text-text-secondary">{monthName(m.month)}</span>
                  </div>
                ))}
              </div>
              <p className="m-0 mt-3 flex gap-4 text-[13px] text-text-secondary">
                <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-[var(--color-state-completed)]" />Won</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-[var(--color-state-blocked)]" />Lost</span>
              </p>
            </Section>

            <Section title="Expected to close" note="Open deals by expected close month; overdue ones count in this month.">
              <ol className="m-0 flex list-none flex-col gap-3 p-0">
                {insights.forecast.map((f) => (
                  <li key={f.month}>
                      <p className="m-0 mb-1 text-[14px] font-medium text-text">{monthName(f.month)}</p>
                    <ProgressBar
                      value={f.value}
                      total={forecastMax}
                      label={monthName(f.month)}
                      tone="active"
                      figures={f.count ? `${moneyShort(f.value)} · ${moneyShort(f.weighted)} weighted · ${f.count} deal${f.count === 1 ? "" : "s"}` : "nothing expected"}
                    />
                  </li>
                ))}
              </ol>
            </Section>

            <Section title="How long open deals have waited" note="Since each deal was opened.">
              <ol className="m-0 flex list-none flex-col gap-3 p-0">
                {insights.ageing.map((a, i) => (
                  <li key={a.bucket}>
                      <p className="m-0 mb-1 text-[14px] font-medium text-text">{a.bucket}</p>
                    <ProgressBar value={a.count} total={ageMax} label={a.bucket} tone={i >= 2 ? "pending" : "active"} figures={`${a.count} · ${moneyShort(a.value)}`} />
                  </li>
                ))}
              </ol>
            </Section>
          </div>
        </>
      )}
    </>
  );
}

export default withCapabilityPageAccess(RELATIONSHIP_CAPABILITY, InsightsPage);
