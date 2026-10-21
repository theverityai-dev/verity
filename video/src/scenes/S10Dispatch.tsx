import React from "react";
import { AbsoluteFill } from "remotion";
import { DK, FONT, V } from "../film/layout";
import { Eyebrow, Statement } from "../film/engine";
import { glide, p, smooth, useTime } from "../film/ease";
import { cue, sceneLength, word } from "../film/timeline";
import { addSfx } from "../film/sfx";
import { AppWindow } from "../ui/shell";
import { Button, Footnote, LargeTitle, Panel, StateBadge, TableHead, TableRow, tab } from "../ui/kit";
import { Icon } from "../ui/icons";
import { Qr } from "../props/Qr";
import { CHECK_COUNT, COMPANY, DISPATCH, ORDER, PASSPORT, ROUTE, dateText } from "../content/fixture";
import { ProductShot, WIN, press, swap } from "./common";

const v16 = cue("s10", "v16");
const T = {
  summary: word("s10", "v15", "summary"),
  dispatch: word("s10", "v15", "dispatch"),
  photo: word("s10", "v15", "photograph"),
  vehicle: word("s10", "v15", "vehicle"),
  transporter: word("s10", "v15", "transporter"),
  send: word("s10", "v15", "transporter") + 0.9,
  scan: word("s10", "v16", "scan"),
  inspected: word("s10", "v16", "inspected"),
  privateW: word("s10", "v16", "private"),
};

addSfx([
  { scene: "s10", at: T.summary, name: "paper", gain: 0.4 },
  { scene: "s10", at: T.photo, name: "shutter", gain: 0.4 },
  { scene: "s10", at: T.vehicle, name: "tick", gain: 0.3 },
  { scene: "s10", at: T.transporter, name: "tick", gain: 0.3 },
  { scene: "s10", at: T.send, name: "confirm", gain: 0.45 },
  { scene: "s10", at: v16.start - 0.6, name: "whoosh", gain: 0.3 },
  { scene: "s10", at: T.scan + 0.3, name: "tick", gain: 0.45 },
  { scene: "s10", at: T.scan + 0.6, name: "swell", gain: 0.3 },
]);

/** Every check with its reading, in route order (the summary-first test report). */
const ROWS = ROUTE.flatMap((s) =>
  s.checks.map((c) => ({
    stage: s.label,
    check: c.label,
    reading: c.reading !== undefined ? `${c.reading} ${c.unit}` : c.photo ? "Photo" : "—",
    limits: c.min !== undefined && c.max !== undefined ? `${c.min}–${c.max}` : c.max !== undefined ? `≤ ${c.max}` : c.min !== undefined ? `≥ ${c.min}` : "",
  })),
);

const ReportAndDispatch: React.FC<{ t: number }> = ({ t }) => {
  const fields = [
    { label: "Packaging photo", value: "Photo of the packed order", at: T.photo },
    { label: "Vehicle number", value: DISPATCH.vehicle, at: T.vehicle },
    { label: "Transporter", value: DISPATCH.transporter, at: T.transporter },
    { label: "Tracking reference", value: DISPATCH.tracking, at: T.transporter + 0.4 },
  ];
  const sent = swap(t, T.send);
  return (
    <AppWindow active="orders" collapsed width={WIN.w}>
      <LargeTitle>Test report</LargeTitle>
      <div style={{ fontSize: 15, color: V.text2, margin: "6px 0 16px" }}>Read the summary first; open a check for its detail. · {ORDER.ref}</div>
      <div style={{ display: "grid", gridTemplateColumns: "590px 1fr", gap: 16, alignItems: "start" }}>
        <Panel flush>
          <div style={{ display: "flex", gap: 22, padding: "18px 20px 14px", alignItems: "baseline" }}>
            {[
              [String(CHECK_COUNT), "checks"],
              [String(CHECK_COUNT), "passing"],
              ["1", "re-inspection"],
            ].map(([n, l]) => (
              <span key={l}>
                <span style={{ fontSize: 28, fontWeight: 700, ...tab }}>{n}</span> <span style={{ fontSize: 15, color: V.text2 }}>{l}</span>
              </span>
            ))}
          </div>
          <TableHead cols="1fr 92px 82px 30px" heads={["Check", "Reading", "Limits", ""]} />
          {ROWS.map((r) => (
            <TableRow key={r.check} cols="1fr 92px 82px 30px" style={{ padding: "8px 20px", fontSize: 14 }}>
              <span>
                {r.check}
                <div style={{ fontSize: 12.5, color: V.text3 }}>{r.stage}</div>
              </span>
              <span style={tab}>{r.reading}</span>
              <span style={{ ...tab, color: V.text2 }}>{r.limits}</span>
              <Icon name="check" size={16} color={V.success} stroke={2.2} />
            </TableRow>
          ))}
        </Panel>
        <div style={{ opacity: p(t, T.dispatch - 0.3, 0.6, glide) }}>
          <Panel title="Dispatch" action={sent > 0.5 ? <StateBadge state="active" label="dispatched" /> : undefined}>
            {fields.map((f) => {
              const k = swap(t, f.at);
              return (
                <div key={f.label} style={{ padding: "8px 0", borderBottom: `1px solid ${V.line}` }}>
                  <div style={{ fontSize: 13, color: V.text2 }}>{f.label}</div>
                  <div style={{ marginTop: 4, height: 36, borderRadius: 10, background: V.control, display: "flex", alignItems: "center", gap: 8, padding: "0 12px", fontSize: 15, ...tab }}>
                    {f.label === "Packaging photo" && k > 0 && <Icon name="camera" size={16} color={V.success} />}
                    <span style={{ opacity: k }}>{f.value}</span>
                  </div>
                </div>
              );
            })}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
              <Footnote>Only a completed order can be dispatched.</Footnote>
              <Button variant="primary" size="sm" pressed={press(t, T.send - 0.25)}>
                Dispatch order
              </Button>
            </div>
          </Panel>
        </div>
      </div>
    </AppWindow>
  );
};

/** The public verification passport (ADR-030): a frozen, minimal projection, labels only. */
const PassportPhone: React.FC<{ t: number }> = ({ t }) => {
  const k = p(t, v16.start - 0.4, 1.1, glide);
  const scanned = p(t, T.scan + 0.35, 0.7, glide);
  const brackets = p(t, T.scan - 0.4, 0.5, glide) * (1 - scanned);
  const list = ROUTE.filter((s) => s.checks.length > 0);
  return (
    <div style={{ position: "absolute", left: 1090, top: 70 + (1 - k) * 70, opacity: k, fontFamily: FONT }}>
      <div style={{ width: 470, height: 980, borderRadius: 64, padding: 13, background: "linear-gradient(160deg, #2a2d33 0%, #15171b 60%)", boxShadow: "0 40px 90px rgba(0,0,0,0.55)" }}>
        <div style={{ width: "100%", height: "100%", borderRadius: 52, overflow: "hidden", position: "relative", background: "#F2F2F7" }}>
          {/* Camera view of the skid's nameplate. */}
          <div style={{ position: "absolute", inset: 0, background: "#1a1d23", opacity: 1 - scanned, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 300, padding: 22, borderRadius: 10, background: "linear-gradient(160deg, #c9ccd1, #9ea3aa)", color: "#1c1f24", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)" }}>
              <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "0.08em" }}>{COMPANY.name.toUpperCase()}</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>{PASSPORT.product}</div>
              <div style={{ display: "flex", gap: 14, marginTop: 12, alignItems: "center" }}>
                <Qr size={104} seed="nameplate" />
                <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                  2 × 75 kW
                  <br />
                  {PASSPORT.reference}
                  <br />
                  2026
                </div>
              </div>
            </div>
            {[0, 1, 2, 3].map((c) => (
              <span key={c} style={{ position: "absolute", width: 40, height: 40, left: c % 2 ? 330 : 74, top: c < 2 ? 330 : 590, opacity: brackets, borderColor: "#FFD60A", borderStyle: "solid", borderWidth: `${c < 2 ? 3 : 0}px ${c % 2 ? 3 : 0}px ${c < 2 ? 0 : 3}px ${c % 2 ? 0 : 3}px` }} />
            ))}
          </div>
          {/* The passport page. */}
          <div style={{ position: "absolute", inset: 0, opacity: scanned, transform: `translateY(${(1 - scanned) * 30}px)`, padding: "70px 22px 0" }}>
            <div style={{ background: "#fff", borderRadius: 20, padding: 22 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 34, height: 34, borderRadius: 17, background: V.success, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name="shield" size={20} color="#fff" />
                </span>
                <div>
                  <div style={{ fontSize: 13, color: V.success, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>Verified</div>
                  <div style={{ fontSize: 13, color: V.text3 }}>Issued by {PASSPORT.issuedBy}</div>
                </div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, marginTop: 16, lineHeight: 1.2 }}>{PASSPORT.product}</div>
              <div style={{ fontSize: 15, color: V.text2, marginTop: 4 }}>{PASSPORT.reference}</div>
              <div style={{ fontSize: 15, color: V.text2 }}>Completed {dateText(PASSPORT.completed)}</div>
              <div style={{ borderTop: `1px dashed ${V.separator}`, margin: "16px -22px 12px" }} />
              <div style={{ fontSize: 13, color: V.text2, textTransform: "uppercase", letterSpacing: "0.02em", marginBottom: 8 }}>Inspection record</div>
              {list.map((s, i) => (
                <div key={s.key} style={{ padding: "7px 0", borderBottom: i < list.length - 1 ? `1px solid ${V.line}` : undefined, opacity: p(t, T.inspected - 0.4 + i * 0.12, 0.5) }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{s.label}</div>
                  {s.checks.map((c) => (
                    <div key={c.label} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5, color: V.text2, marginTop: 2 }}>
                      <Icon name="check" size={13} color={V.success} stroke={2.2} />
                      {c.label}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div style={{ fontSize: 13, color: V.text3, textAlign: "center", marginTop: 12, opacity: p(t, T.privateW - 0.3, 0.6) }}>No readings, remarks, photographs or names are published.</div>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * s10 — 06 Testing to dispatch. The summary-first test report and the dispatch form (needs a
 * packaging photo, `dispatch_order`), then the verification passport scanned from the nameplate:
 * labels only, by design (passport.ts `passportSnapshotSchema`, ADR-030).
 */
export const S10Dispatch: React.FC = () => {
  const t = useTime();
  const len = sceneLength("s10");
  const away = p(t, v16.start - 0.8, 1.0, smooth);
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", inset: 0, opacity: 1 - away, filter: away > 0 ? `blur(${away * 8}px)` : undefined }}>
        <ProductShot keys={[[0, { s: 1 }], [T.dispatch - 0.3, { s: 1.06, x: -60, y: -20 }, 1.6]]} origin={[WIN.x + 700, WIN.y + 300]}>
          <ReportAndDispatch t={t} />
        </ProductShot>
      </div>
      <PassportPhone t={t} />
      <Eyebrow n="06" label="Testing to dispatch" inAt={0.6} outAt={v16.start - 0.8} top={96} />
      <Eyebrow label="Verification passport" inAt={v16.start + 0.2} outAt={len - 0.35} top={778} color={DK.inkSoft} />
      <Statement lines={["Proof travels", "with the product."]} inAt={T.scan + 0.8} outAt={len - 0.35} />
    </AbsoluteFill>
  );
};
