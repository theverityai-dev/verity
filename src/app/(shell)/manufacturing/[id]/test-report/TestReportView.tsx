"use client";

/* eslint-disable no-restricted-syntax -- print-only document table (REQ-019): DataTable's on-screen chrome has no place on a sheet handed to a client. */

import { Button, Panel } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { ChecklistHeader, ChecklistRows, type ChecklistRow } from "@/components/ui/Checklist";
import { ProgressRing, RangeMeter } from "@/components/ui/viz";

export type TestReportCheckData = {
  key: string;
  label: string;
  verdict: "pass" | "fail" | null;
  attempts: number;
  on: string | null;
  remarks: string | null;
  unit: string | null;
  measured: { value: number; unit: string; min: number | null; max: number | null; inRange: boolean; condition: string | null; instrument: string | null } | null;
  readingNote: string | null;
  photoOnRecord: boolean;
};

export type TestReportDoc = {
  business: string;
  demo: boolean;
  reference: string;
  product: string;
  quantity: number;
  job: { reference: string; title: string; customer: string | null } | null;
  stages: Array<{ id: string; label: string; rework: boolean; checks: TestReportCheckData[] }>;
  printedOn: string;
  backHref: string;
};

const fmt = (n: number) => n.toLocaleString("en-IN");

function acceptedText(m: NonNullable<TestReportCheckData["measured"]>): string {
  if (m.min !== null && m.max !== null) return `${fmt(m.min)} to ${fmt(m.max)} ${m.unit}`;
  if (m.min !== null) return `at least ${fmt(m.min)} ${m.unit}`;
  if (m.max !== null) return `at most ${fmt(m.max)} ${m.unit}`;
  return "—";
}

/** The reading as one printable cell: the value, or a note when only a free-text reading exists. */
function readingCell(c: TestReportCheckData): string {
  if (c.measured) return `${fmt(c.measured.value)} ${c.measured.unit}${c.measured.condition ? ` · ${c.measured.condition}` : ""}`;
  if (c.readingNote) return c.readingNote;
  if (c.unit) return `Measured in ${c.unit}`;
  return "—";
}

function totals(doc: TestReportDoc) {
  const checks = doc.stages.flatMap((s) => s.checks);
  const passed = checks.filter((c) => c.verdict === "pass").length;
  const failed = checks.filter((c) => c.verdict === "fail");
  const open = checks.filter((c) => c.verdict === null).length;
  return { checks, total: checks.length, passed, failed, open };
}

/** The headline a reader needs without opening anything: what the report concludes. */
function headline(t: ReturnType<typeof totals>): { text: string; tone: "completed" | "blocked" | "pending" } {
  if (t.total === 0) return { text: "No checks were defined for this order", tone: "pending" };
  if (t.failed.length > 0) return { text: `${t.failed.length} ${t.failed.length === 1 ? "check" : "checks"} failed`, tone: "blocked" };
  if (t.open > 0) return { text: `${t.passed} of ${t.total} passed, ${t.open} not yet recorded`, tone: "pending" };
  return { text: `All ${t.total} checks passed`, tone: "completed" };
}

export function TestReportView({ doc }: { doc: TestReportDoc }) {
  const t = totals(doc);
  const head = headline(t);

  const screenRows = (checks: TestReportCheckData[]): ChecklistRow[] =>
    checks.map((c) => {
      const m = c.measured;
      return {
        key: c.key,
        label: c.label,
        verdict: c.verdict ?? "none",
        requirement: c.attempts > 1 ? `Recorded ${c.attempts} times; the latest result stands` : undefined,
        detail:
          m || c.readingNote || c.unit ? (
            <div className="flex flex-col gap-1.5">
              {m ? (
                <>
                  <p className="m-0 flex flex-wrap items-baseline gap-x-2">
                    <span className="tabular text-[20px] font-bold leading-[24px] text-text">
                      {fmt(m.value)} <span className="text-[14px] font-semibold text-text-secondary">{m.unit}</span>
                    </span>
                    {m.condition && (
                      <span className="rounded-full bg-[var(--color-control)] px-2.5 py-0.5 text-[12px] font-medium text-text-secondary">{m.condition}</span>
                    )}
                  </p>
                  <RangeMeter value={m.value} min={m.min} max={m.max} unit={m.unit} />
                </>
              ) : c.readingNote ? (
                <p className="m-0 text-[14px] text-text">{c.readingNote}</p>
              ) : (
                <p className="m-0 text-[13px] text-text-tertiary">Measured in {c.unit}. The reading is not shown to this account.</p>
              )}
            </div>
          ) : undefined,
        expanded:
          c.on || c.remarks || m?.instrument || c.photoOnRecord ? (
            <details className="text-[13px] text-text-secondary">
              <summary className="cursor-pointer text-accent-ink">Detail</summary>
              <dl className="m-0 mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                {c.on && (<><dt className="text-text-tertiary">Recorded</dt><dd className="m-0">{c.on}</dd></>)}
                {m?.instrument && (<><dt className="text-text-tertiary">Instrument</dt><dd className="m-0">{m.instrument}</dd></>)}
                {m && (<><dt className="text-text-tertiary">Accepted</dt><dd className="m-0">{acceptedText(m)}</dd></>)}
                {c.remarks && (<><dt className="text-text-tertiary">Remarks</dt><dd className="m-0">{c.remarks}</dd></>)}
                {c.photoOnRecord && (<><dt className="text-text-tertiary">Evidence</dt><dd className="m-0">Photo or reading is on record</dd></>)}
              </dl>
            </details>
          ) : undefined,
      };
    });

  const printable = (
    <article className="text-[12.5px] leading-[18px] text-text">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-text pb-3">
        <div className="min-w-0">
          <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.1em] text-text-secondary">{doc.business}</p>
          <p className="m-0 text-[22px] font-bold tracking-[-0.01em]">Test report</p>
          <p className="m-0 tabular text-[16px] font-semibold">{doc.reference}</p>
        </div>
        <div className="text-right text-text-secondary">
          <p className="m-0">{doc.product} × {doc.quantity}</p>
          {doc.job && <p className="m-0">{doc.job.reference} · {doc.job.title}</p>}
          {doc.job?.customer && <p className="m-0">{doc.job.customer}</p>}
          <p className="m-0">Printed {doc.printedOn}</p>
        </div>
      </header>

      <p className="m-0 my-3 border-y border-line py-2 text-[14px] font-semibold">Summary: {head.text}.</p>

      {doc.stages.map((s) => (
        <section key={s.id} className="mb-3 break-inside-avoid">
          <p className="m-0 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">{s.label}{s.rework ? " (re-work)" : ""}</p>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-y border-line bg-[var(--color-surface-sunken)] text-[11px] uppercase tracking-[0.05em] text-text-secondary">
                <th className="px-2 py-1.5 font-semibold">Check</th>
                <th className="w-20 px-2 py-1.5 font-semibold">Result</th>
                <th className="px-2 py-1.5 font-semibold">Reading and condition</th>
                <th className="px-2 py-1.5 font-semibold">Accepted</th>
                <th className="w-24 px-2 py-1.5 font-semibold">Date</th>
              </tr>
            </thead>
            <tbody>
              {s.checks.map((c) => (
                <tr key={c.key} className="break-inside-avoid border-b border-line align-top">
                  <td className="px-2 py-1.5">{c.label}{c.remarks ? <span className="block text-text-secondary">{c.remarks}</span> : null}</td>
                  <td className="px-2 py-1.5 font-medium">{c.verdict === "pass" ? "Passed" : c.verdict === "fail" ? "Failed" : "Not recorded"}</td>
                  <td className="tabular px-2 py-1.5">{readingCell(c)}</td>
                  <td className="tabular px-2 py-1.5">{c.measured ? acceptedText(c.measured) : "—"}</td>
                  <td className="px-2 py-1.5 text-text-secondary">{c.on ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <p className="m-0 mt-1 text-[10.5px] text-text-tertiary">
        Results are the inspection findings and readings recorded in Verity. This sheet is not a certificate issued by an accredited laboratory.
      </p>
      <footer className="mt-8 grid grid-cols-2 gap-8 border-t border-line pt-3">
        <p className="m-0 border-t border-text pt-1 text-[11px] font-medium">Tested by, signature and date</p>
        <p className="m-0 border-t border-text pt-1 text-[11px] font-medium">Approved by, signature, stamp and date</p>
      </footer>
      {doc.demo && <p className="m-0 mt-3 text-[10.5px] text-text-tertiary">Demo data: every name, number and value on this sheet is fictional.</p>}
    </article>
  );

  return (
    <>
      <section className="hidden print:block">{printable}</section>
      <div className="flex flex-col gap-4 print:hidden">
        <Panel>
          <div className="flex flex-wrap items-center gap-4">
            <ProgressRing value={t.passed} total={Math.max(t.total, 1)} label="Checks passed" size={64} tone={head.tone} />
            <div className="min-w-0 flex-1">
              <h2 className="m-0 text-[20px] font-bold leading-[26px] text-text">{head.text}</h2>
              <p className="m-0 text-[14px] text-text-secondary">
                {doc.product} × {doc.quantity} · <span className="tabular">{doc.reference}</span>
                {doc.job ? ` · ${doc.job.reference}${doc.job.customer ? ` · ${doc.job.customer}` : ""}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => window.print()}>Print report</Button>
              <a href={doc.backHref} className="inline-flex h-11 items-center px-2 text-[15px]">Back to the order</a>
            </div>
          </div>
          {t.failed.length > 0 && (
            <div role="alert" className="mt-3 rounded-[12px] bg-danger-subtle px-3 py-2.5">
              <p className="m-0 flex items-center gap-1.5 text-[14px] font-semibold text-[var(--color-danger-ink)]">
                <Icon name="close" size={14} /> Needs attention
              </p>
              <ul className="m-0 mt-1 list-disc pl-5 text-[14px] text-text">
                {t.failed.map((c) => (<li key={c.key}>{c.label}{c.remarks ? `: ${c.remarks}` : ""}</li>))}
              </ul>
            </div>
          )}
        </Panel>

        {doc.stages.length === 0 ? (
          <Panel><p className="m-0 text-[14px] text-text-secondary">No stage of this order has a checklist, so there is nothing to report.</p></Panel>
        ) : (
          doc.stages.map((s) => (
            <Panel key={s.id}>
              <ChecklistHeader
                title={`${s.label}${s.rework ? " (re-work)" : ""}`}
                passed={s.checks.filter((c) => c.verdict === "pass").length}
                total={s.checks.length}
              />
              <ChecklistRows rows={screenRows(s.checks)} />
            </Panel>
          ))
        )}
        {doc.demo && <p className="m-0 text-[12px] text-text-tertiary">Demo data: every name, number and value here is fictional.</p>}
      </div>
    </>
  );
}
