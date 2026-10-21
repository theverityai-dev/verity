import React from "react";
import { AbsoluteFill } from "remotion";
import { HUE, V } from "../film/layout";
import { TextColumn } from "../film/engine";
import { glide, p, useTime } from "../film/ease";
import { sceneLength, word } from "../film/timeline";
import { addSfx } from "../film/sfx";
import { AppWindow } from "../ui/shell";
import { Icon } from "../ui/icons";
import { LargeTitle, Panel, StateBadge, StatTile, TableHead, TableRow, tab } from "../ui/kit";
import { JOBS_IN_WORK, SUMMARY, dateText, inr } from "../content/fixture";
import { press, swap } from "./common";
import { Camera, cameraAt } from "../film/engine";

const T = {
  page: word("s12", "v19", "page"),
  confirmed: word("s12", "v19", "confirmed"),
  waiting: word("s12", "v19", "waiting"),
  late: word("s12", "v19", "late"),
  floor: word("s12", "v19", "floor"),
  short: word("s12", "v19", "short"),
  opens: word("s12", "v20", "opens"),
  record: word("s12", "v20", "record"),
};

addSfx([
  { scene: "s12", at: 0.3, name: "whoosh", gain: 0.3 },
  { scene: "s12", at: T.opens, name: "press", gain: 0.45 },
  { scene: "s12", at: T.record, name: "whoosh", gain: 0.2 },
]);

/** The Summary page, laid out as `src/app/(shell)/summary/page.tsx` (see the 1440px reference). */
const SummaryPage: React.FC<{ t: number }> = ({ t }) => {
  const hi = (at: number, until: number) => swap(t, at) * (1 - swap(t, until));
  return (
    <AppWindow active="summary">
      <LargeTitle>Summary</LargeTitle>
      <div style={{ fontSize: 15, color: V.text2, margin: "4px 0 18px" }}>Where every job stands today, what is on the shop floor, and what needs attention.</div>
      <Panel title={`Needs attention (${SUMMARY.attention.length})`}>
        {SUMMARY.attention.map((a, i) => (
          <div key={a.ref} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: i < SUMMARY.attention.length - 1 ? `1px solid ${V.line}` : undefined }}>
            <span style={{ width: 26, height: 26, borderRadius: 13, background: a.kind === "late" ? HUE.red.fill : a.kind === "blocked" ? HUE.red.fill : HUE.amber.fill, color: a.kind === "quote" ? HUE.amber.ink : HUE.red.ink, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
              <Icon name={a.kind === "quote" ? "quote" : "flag"} size={14} />
            </span>
            <div>
              <div style={{ fontSize: 16 }}>
                <span style={{ color: V.accent }}>{a.ref}</span> · {a.text}
              </div>
              <div style={{ fontSize: 13, color: V.text2, marginTop: 2 }}>{a.hint}</div>
            </div>
          </div>
        ))}
      </Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, margin: "16px 0" }}>
        <StatTile icon="money" hue="teal" value={inr(SUMMARY.confirmed, { compact: true })} label="Confirmed orders" hint={`Accepted quotes, ${JOBS_IN_WORK.length} jobs in work`} highlight={hi(T.confirmed - 0.2, T.waiting - 0.2)} />
        <StatTile icon="quote" hue="indigo" value={inr(SUMMARY.quotesOut, { compact: true })} label="Quotes awaiting reply" hint={`${SUMMARY.quotesSent} sent, not yet accepted`} highlight={hi(T.waiting - 0.2, T.late - 0.2)} />
        <StatTile icon="enquiry" hue="olive" value={SUMMARY.enquiries} label="New enquiries" hint="Not quoted yet" />
        <StatTile icon="flag" hue="red" value={SUMMARY.late} label="Late deliveries" hint="J-0139, past the promised date" highlight={hi(T.late - 0.2, T.floor - 0.2) + hi(T.opens - 0.5, T.record)} style={{ transform: `scale(${1 - 0.02 * press(t, T.opens)})` }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 14 }}>
        <Panel title="Jobs in work" flush>
          <TableHead cols="70px 1fr 120px 110px 50px" heads={["Job", "What", "Status", "Promised", ""]} />
          {JOBS_IN_WORK.map((j) => (
            <TableRow key={j.ref} cols="70px 1fr 120px 110px 50px" style={{ padding: "10px 20px", fontSize: 14 }}>
              <span style={{ color: V.accent, ...tab }}>{j.ref}</span>
              <span>
                {j.what}
                <div style={{ fontSize: 12.5, color: V.text3 }}>{j.customer}</div>
              </span>
              <StateBadge state={j.state} label={j.label} />
              <span style={{ ...tab, color: j.ref === "J-0139" ? V.danger : V.text2 }}>{dateText(j.promised)}</span>
              <span style={{ ...tab, textAlign: "right" }}>{j.progress}%</span>
            </TableRow>
          ))}
        </Panel>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Panel title="On the shop floor now" style={{ boxShadow: hi(T.floor - 0.2, T.short - 0.2) ? `inset 0 0 0 ${2 * hi(T.floor - 0.2, T.short - 0.2)}px ${V.accentLine}` : undefined }}>
            {[
              ["J-0139", "Pressure test", "blocked", "on hold"],
              ["J-0144", "Frame fabrication", "active", "in progress"],
              ["J-0146", "Machining", "pending", "pending"],
            ].map(([ref, stage, st, l]) => (
              <div key={ref} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", fontSize: 14 }}>
                <span>
                  <span style={{ color: V.accent }}>{ref}</span> · {stage}
                </span>
                <StateBadge state={st as "active"} label={l} />
              </div>
            ))}
          </Panel>
          <Panel title="Running short" style={{ boxShadow: hi(T.short - 0.2, T.opens - 0.5) ? `inset 0 0 0 ${2 * hi(T.short - 0.2, T.opens - 0.5)}px ${V.accentLine}` : undefined }}>
            {SUMMARY.short.map((s) => (
              <div key={s.item} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", fontSize: 14 }}>
                <span>{s.item}</span>
                <span style={{ ...tab, color: V.warning }}>
                  {s.onHand} {s.uom} · reorder at {s.reorder}
                </span>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </AppWindow>
  );
};

/** J-0139, opened from the Late deliveries tile: the record behind the figure. */
const LateJob: React.FC = () => (
  <AppWindow active="jobs">
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 16, marginBottom: 6 }}>
      <span style={{ color: V.accent }}>Jobs</span>
      <Icon name="chevronRight" size={14} color={V.text3} />
      <span style={{ color: V.text2 }}>J-0139</span>
    </div>
    <LargeTitle>Dosing skid, 3-pump</LargeTitle>
    <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0" }}>
      <StateBadge state="active" label="in progress" />
    </div>
    <div style={{ fontSize: 16, color: V.danger, marginBottom: 16 }}>Corvel Foods · promised by 14 Dec 2026 · 5 days late</div>
    <Panel title="Next up">
      <div style={{ fontSize: 17, fontWeight: 600 }}>Pressure test</div>
      <div style={{ fontSize: 14, color: V.text2, marginTop: 4 }}>On hold · Waiting for calibrated gauge</div>
    </Panel>
  </AppWindow>
);

/**
 * s12 — 07 Management. The pull-back to the Summary (context UI, expanded sidebar): each figure
 * lights as it is named, then the Late deliveries tile opens J-0139, the record behind it.
 */
export const S12Summary: React.FC = () => {
  const t = useTime();
  const len = sceneLength("s12");
  const arrive = p(t, 0, 1.4, glide);
  const toJob = swap(t, T.record - 0.3);
  const cam = cameraAt(t, [
    [0, { s: 0.92 }],
    [0.2, { s: 1 }, 1.6],
    [T.opens - 0.3, { s: 1.04, x: -20, y: 0 }, 1.0],
  ]);
  return (
    <AbsoluteFill>
      <Camera move={cam} origin={[1300, 520]}>
        <div style={{ position: "absolute", left: 780, top: 110, transform: "scale(0.8)", transformOrigin: "0 0", opacity: arrive }}>
          <div style={{ position: "relative" }}>
            <div style={{ opacity: 1 - toJob }}>
              <SummaryPage t={t} />
            </div>
            {toJob > 0 && (
              <div style={{ position: "absolute", inset: 0, opacity: toJob }}>
                <LateJob />
              </div>
            )}
          </div>
        </div>
      </Camera>
      <TextColumn n="07" label="Management" lines={["Exceptions", "first."]} labelAt={0.6} statementAt={T.page + 0.2} outAt={len - 0.35} />
    </AbsoluteFill>
  );
};
