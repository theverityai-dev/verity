import React from "react";
import { AbsoluteFill } from "remotion";
import { PAPER, V } from "../film/layout";
import { TextColumn } from "../film/engine";
import { countTo, glide, mix, p, smooth, useTime } from "../film/ease";
import { cue, sceneLength, word } from "../film/timeline";
import { addSfx } from "../film/sfx";
import { AppWindow } from "../ui/shell";
import { Panel, Ring, StateBadge, StatTile, TableRow, tab } from "../ui/kit";
import { JOB_TABS, JobHeader, JobStepper, Tabs } from "../ui/job";
import { BILLING, COST, JOB, dateText, inr } from "../content/fixture";
import { ProductShot, Reveal, WIN, pageChange, swap } from "./common";

const v18 = cue("s11", "v18");
const T = {
  approved: word("s11", "v17", "approved"),
  materials: word("s11", "v17", "materials"),
  hours: word("s11", "v17", "hours"),
  outside: word("s11", "v17", "outside"),
  margin: word("s11", "v17", "margin"),
  look: word("s11", "v17", "look"),
  invoices: v18.start - 0.5,
  file: word("s11", "v18", "file"),
  reports: word("s11", "v18", "reports"),
  papers: word("s11", "v18", "dispatch"),
  photos: word("s11", "v18", "photographs"),
};

addSfx([
  { scene: "s11", at: T.materials, name: "tick", gain: 0.3 },
  { scene: "s11", at: T.hours, name: "tick", gain: 0.3 },
  { scene: "s11", at: T.outside, name: "tick", gain: 0.3 },
  { scene: "s11", at: T.margin, name: "confirm", gain: 0.35 },
  { scene: "s11", at: T.invoices, name: "whoosh", gain: 0.25 },
  { scene: "s11", at: T.reports, name: "paper", gain: 0.35 },
  { scene: "s11", at: T.papers, name: "paper", gain: 0.35 },
  { scene: "s11", at: T.photos, name: "paper", gain: 0.35 },
]);

const SOURCES = [
  { label: "Material", note: "Consumed quantities at moving-average cost (an estimate)", amount: COST.material, at: T.materials, color: "#58687E" },
  { label: "Labour", note: `${COST.labourHours} h logged against the job`, amount: COST.labour, at: T.hours, color: "#117456" },
  { label: "Other", note: `${COST.otherLines.length} entries: galvanising, freight, calibration`, amount: COST.other, at: T.outside, color: "#9C37BE" },
];

/** One printed page of the project file. */
const Page: React.FC<{ title: string; lines: number; photo?: boolean }> = ({ title, lines, photo }) => (
  <div style={{ width: 300, height: 410, background: PAPER.sheet, borderRadius: 4, padding: 22, boxShadow: "0 2px 3px rgba(0,0,0,0.25), 0 24px 50px rgba(0,0,0,0.35)", fontFamily: "Inter, sans-serif", color: PAPER.ink }}>
    <div style={{ fontSize: 11, color: PAPER.soft, letterSpacing: "0.08em" }}>{JOB.ref} · PROJECT FILE</div>
    <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>{title}</div>
    <div style={{ borderTop: `1px solid ${PAPER.rule}`, margin: "12px 0" }} />
    {photo ? (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ height: 96, background: `linear-gradient(${120 + i * 40}deg, #3a3f49, #1a1d23)`, borderRadius: 3 }} />
        ))}
      </div>
    ) : (
      Array.from({ length: lines }, (_, i) => <div key={i} style={{ height: 7, borderRadius: 3, background: "rgba(29,31,36,0.12)", margin: "9px 0", width: `${60 + ((i * 37) % 40)}%` }} />)
    )}
  </div>
);

/**
 * s11 — 07 Cost. The job's cost built from records (`jobCosting`, project/reads.ts): agreed
 * value, material, labour, other, margin derived on every read. Then billing as recorded
 * (project/billing.ts) and the printable project file (one record of the job).
 */
export const S11Cost: React.FC = () => {
  const t = useTime();
  const len = sceneLength("s11");
  const shown = SOURCES.reduce((s, x) => s + x.amount * p(t, x.at, 1.0, smooth), 0);
  const margin = COST.quoted - shown;
  const [costK, billK] = pageChange(t, T.invoices);
  const file = p(t, T.file - 0.2, 0.9, glide);
  return (
    <AbsoluteFill>
      <ProductShot
        keys={[
          [0, { s: 1 }],
          [T.approved - 0.6, { s: 1.08, x: -20, y: -60 }, 1.6],
          [T.margin - 0.3, { s: 1.12, x: -30, y: -40 }, 1.4],
          [T.invoices, { s: 1.04, x: 0, y: -30 }, 1.2],
        ]}
        origin={[WIN.x + 760, WIN.y + 300]}
      >
        <AppWindow active="jobs" collapsed width={WIN.w}>
          <JobHeader state="active" stateLabel="in progress" />
          <JobStepper at={3} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginTop: 16, maxWidth: 950 }}>
            <StatTile icon="lock" hue="green" value={inr(COST.quoted)} label="Order value" hint="From the approved quote" highlight={swap(t, T.approved) * (1 - swap(t, T.materials))} />
            <StatTile icon="money" hue="teal" value={inr(Math.round(shown / 100) * 100)} label="Actual cost to date" hint={`Material, labour and other costs; ${COST.labourHours} h logged`} />
            <StatTile
              icon="flag"
              hue="indigo"
              value={inr(Math.round(margin / 100) * 100)}
              label="Margin so far"
              hint={`${(Math.round((margin / COST.quoted) * 1000) / 10).toFixed(1)}% of the order value, before costs still to come`}
              highlight={swap(t, T.margin) * (1 - swap(t, T.invoices))}
              viz={<Ring k={mix(1, margin / COST.quoted, p(t, T.materials, T.outside + 1 - T.materials, smooth))} color={V.success} />}
            />
          </div>
          <Tabs tabs={JOB_TABS} active={billK > 0.5 ? "Billing" : "Costs"} />
          <div style={{ position: "relative", maxWidth: 950 }}>
            <div style={{ opacity: costK }}>
              <Panel title="Where the cost comes from">
                <div style={{ display: "flex", height: 14, borderRadius: 7, overflow: "hidden", background: V.track, marginBottom: 12 }}>
                  {SOURCES.map((s) => (
                    <div key={s.label} style={{ width: `${(100 * s.amount * p(t, s.at, 1.0, smooth)) / COST.quoted}%`, background: s.color }} />
                  ))}
                </div>
                {SOURCES.map((s) => (
                  <Reveal key={s.label} at={s.at - 0.1}>
                    <div style={{ display: "grid", gridTemplateColumns: "14px 1fr 150px", gap: 12, alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${V.line}` }}>
                      <span style={{ width: 10, height: 10, borderRadius: 5, background: s.color }} />
                      <span>
                        <span style={{ fontSize: 15, fontWeight: 500 }}>{s.label}</span>
                        <div style={{ fontSize: 13, color: V.text3 }}>{s.note}</div>
                      </span>
                      <span style={{ fontSize: 16, textAlign: "right", ...tab }}>{inr(countTo(t, s.at, 1.0, s.amount / 100) * 100)}</span>
                    </div>
                  </Reveal>
                ))}
              </Panel>
            </div>
            {billK > 0 && (
              <div style={{ position: "absolute", inset: 0, opacity: billK }}>
                <Panel title="Billing and collection" flush>
                  {BILLING.map((b) => (
                    <TableRow key={b.kind} cols="1fr 150px 160px">
                      <span>
                        {b.kind} invoice
                        <div style={{ fontSize: 13, color: V.text3 }}>Raised {dateText(b.raised)}</div>
                      </span>
                      <span style={{ ...tab, textAlign: "right" }}>{inr(b.amount)}</span>
                      <span style={{ textAlign: "right" }}>
                        <StateBadge state={b.received ? "completed" : "pending"} label={b.received ? `received ${dateText(b.received).replace(" 2026", "")}` : "awaiting payment"} />
                      </span>
                    </TableRow>
                  ))}
                  <div style={{ padding: "12px 20px 16px", fontSize: 14, color: V.text2 }}>Recorded as raised and received. Nothing here is computed.</div>
                </Panel>
              </div>
            )}
          </div>
        </AppWindow>
      </ProductShot>
      {/* The project file: one printable record of the job, fanning out of the window. */}
      {file > 0 && (
        <div style={{ position: "absolute", left: 1040, top: 560, opacity: file * (1 - p(t, len - 0.2, 0.5)) }}>
          {[
            { title: "Test report", lines: 12, at: T.reports },
            { title: "Dispatch pack", lines: 9, at: T.papers },
            { title: "Photographs", lines: 0, photo: true, at: T.photos },
          ].map((pg, i) => {
            const k = p(t, pg.at - 0.2, 0.8, glide);
            return (
              <div key={pg.title} style={{ position: "absolute", left: i * 170 * k, top: (1 - k) * 60 - i * 14 * k, transform: `rotate(${(i - 1) * 4 * k}deg)`, opacity: k }}>
                <Page title={pg.title} lines={pg.lines} photo={pg.photo} />
              </div>
            );
          })}
        </div>
      )}
      <TextColumn n="07" label="Cost" lines={["Margin, from what", "actually happened."]} labelAt={0.6} statementAt={T.invoices + 1.3} outAt={len - 0.35} />
    </AbsoluteFill>
  );
};
