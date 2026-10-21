import React from "react";
import { AbsoluteFill } from "remotion";
import { DK, FONT, V } from "../film/layout";
import { Eyebrow, Statement } from "../film/engine";
import { glide, p, smooth, useTime } from "../film/ease";
import { cue, word } from "../film/timeline";
import { addSfx } from "../film/sfx";
import { AppWindow } from "../ui/shell";
import { Button, LargeTitle, Panel, StateBadge, tab } from "../ui/kit";
import { Icon } from "../ui/icons";
import { Skid, solidCentre } from "../props/Skid";
import { FAILURE, ORDER, PEOPLE, ROUTE } from "../content/fixture";
import { ProductShot, Reveal, WIN, swap } from "./common";

const v14 = cue("s09", "v14");
const T = {
  measured: word("s09", "v13", "measured"),
  limits: word("s09", "v13", "limits"),
  weeping: word("s09", "v13", "weeping"),
  back: word("s09", "v13", "back"),
  record: word("s09", "v13", "record"),
  retest: word("s09", "v14", "retest"),
  photo: word("s09", "v14", "photograph"),
  phone: word("s09", "v14", "phone"),
  belongs: word("s09", "v14", "belongs"),
  other: word("s09", "v14", "other"),
};

addSfx([
  { scene: "s09", at: T.limits, name: "confirm", gain: 0.35 },
  { scene: "s09", at: T.weeping + 0.2, name: "refuse", gain: 0.45 },
  { scene: "s09", at: T.back, name: "whoosh", gain: 0.25 },
  { scene: "s09", at: T.retest + 0.4, name: "confirm", gain: 0.35 },
  { scene: "s09", at: T.phone, name: "shutter", gain: 0.55 },
  { scene: "s09", at: T.belongs + 0.5, name: "confirm", gain: 0.45 },
]);

const hydro = ROUTE[3];

type Verdict = "none" | "pass" | "fail";
const CheckRow: React.FC<{ label: string; sub: string; verdict: Verdict; detail?: string; typing?: string; photo?: number; k?: number }> = ({ label, sub, verdict, detail, typing, photo = 0, k = 1 }) => (
  <div style={{ background: V.canvas, borderRadius: 12, padding: "14px 16px", marginBottom: 10 }}>
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <span
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          flex: "none",
          border: verdict === "none" ? `1.5px solid ${V.separator}` : undefined,
          background: verdict === "pass" ? V.success : verdict === "fail" ? V.danger : undefined,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: verdict === "none" ? 1 : k,
        }}
      >
        {verdict === "pass" && <Icon name="check" size={14} color="#FFF" stroke={2.4} />}
        {verdict === "fail" && <Icon name="x" size={14} color="#FFF" stroke={2.4} />}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 16, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 14, color: V.text3, marginTop: 2 }}>{sub}</div>
        {typing !== undefined && verdict === "none" && (
          <div style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 8, height: 36, padding: "0 12px", borderRadius: 10, background: V.control, fontSize: 16, minWidth: 150, ...tab }}>
            {typing}
            <span style={{ width: 1.5, height: 18, background: V.accent }} />
            <span style={{ color: V.text3, marginLeft: "auto" }}>bar</span>
          </div>
        )}
        {detail && verdict !== "none" && <div style={{ fontSize: 14, marginTop: 6, color: verdict === "fail" ? V.danger : V.success, opacity: k }}>{detail}</div>}
        {photo > 0 && (
          <div style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 8, opacity: photo }}>
            <span style={{ width: 44, height: 44, borderRadius: 8, overflow: "hidden", background: "#11151c", position: "relative" }}>
              <span style={{ position: "absolute", left: -300, top: -170 }}>
                <Skid width={720} />
              </span>
            </span>
            <span style={{ fontSize: 14, color: V.text2 }}>Photo · captured for this stage of {ORDER.ref}</span>
          </div>
        )}
      </div>
      <span style={{ fontSize: 14, color: verdict === "none" ? V.text3 : V.text2 }}>{verdict === "none" ? "Not recorded" : verdict === "pass" ? "Passed" : "Failed"}</span>
    </div>
  </div>
);

/** The failed flange, large, on the dark world: the physical fact the fail record describes. */
const FlangeMacro: React.FC<{ t: number }> = ({ t }) => {
  const k = p(t, 0.2, 1.0, glide) * (1 - p(t, T.record - 0.2, 0.7, smooth));
  if (k <= 0) return null;
  const W = 2700;
  const [fx, fy] = solidCentre("joint3");
  const h = W * 0.62;
  const mark = p(t, T.weeping, 0.5, glide);
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: 760, height: 1080, overflow: "hidden", opacity: k, WebkitMaskImage: "linear-gradient(90deg, #000 70%, transparent 100%)" }}>
      <div style={{ position: "absolute", left: 420 - fx * W, top: 400 - fy * h * 0.98, transform: `scale(${1 + 0.04 * p(t, 0, 10)})`, transformOrigin: `${fx * W}px ${fy * h}px` }}>
        <Skid width={W} stroke={1.5} mark={["joint3", "dh-spool"]} markK={mark} markColor="#FF6961" />
      </div>
      {mark > 0 && (
        <div style={{ position: "absolute", left: 120, top: 880, fontFamily: FONT, color: DK.ink, opacity: mark }}>
          <div style={{ fontSize: 17, fontWeight: 500, letterSpacing: "0.14em", textTransform: "uppercase", color: "#FF8A80" }}>Joint 3 · discharge header</div>
          <div style={{ fontSize: 28, marginTop: 8, color: DK.inkSoft }}>{FAILURE.remarks.split(",")[0]}</div>
        </div>
      )}
    </div>
  );
};

/** A phone held up to the flange: the camera capture of `reserveEvidenceFile` / `captureEvidenceFile`. */
const CameraPhone: React.FC<{ t: number }> = ({ t }) => {
  const k = p(t, T.photo - 0.3, 0.9, glide) * (1 - p(t, T.belongs + 0.4, 0.6, smooth));
  if (k <= 0) return null;
  const flash = Math.max(0, 1 - Math.abs(t - T.phone - 0.05) / 0.12);
  const [fx, fy] = solidCentre("joint3");
  return (
    <div style={{ position: "absolute", left: 250, top: 150 + (1 - k) * 60, opacity: k, transform: "rotate(-3deg)" }}>
      <div style={{ width: 330, height: 690, borderRadius: 48, padding: 10, background: "linear-gradient(160deg, #2a2d33, #15171b)", boxShadow: "0 40px 80px rgba(0,0,0,0.55)" }}>
        <div style={{ width: "100%", height: "100%", borderRadius: 40, overflow: "hidden", position: "relative", background: "#0b0f16" }}>
          <div style={{ position: "absolute", left: 155 - fx * 1900, top: 300 - fy * 1900 * 0.62 }}>
            <Skid width={1900} stroke={1.6} />
          </div>
          {/* Focus brackets. */}
          {[0, 1, 2, 3].map((c) => (
            <span key={c} style={{ position: "absolute", width: 28, height: 28, left: c % 2 ? 210 : 70, top: c < 2 ? 220 : 360, borderColor: "#FFD60A", borderStyle: "solid", borderWidth: `${c < 2 ? 2 : 0}px ${c % 2 ? 2 : 0}px ${c < 2 ? 0 : 2}px ${c % 2 ? 0 : 2}px` }} />
          ))}
          <div style={{ position: "absolute", bottom: 26, left: "50%", marginLeft: -34, width: 68, height: 68, borderRadius: 34, border: "4px solid #fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ width: 52, height: 52, borderRadius: 26, background: "#fff", transform: `scale(${1 - 0.15 * flash})` }} />
          </div>
          <div style={{ position: "absolute", inset: 0, background: "#fff", opacity: flash * 0.85 }} />
        </div>
      </div>
    </div>
  );
};

/**
 * s09 — 05 Quality. A measured check passes inside its limits; the leak check fails at the flange
 * (shown on the drawing, left); the order is sent back to assembly and the fail stays on record
 * (append-only results, `send_back`); the retest passes with a phone photo that must be evidence
 * about THIS operation (manufacturing/stages.ts `recordCheckpoint`).
 */
export const S09Quality: React.FC = () => {
  const t = useTime();
  const typed = "15.2".slice(0, Math.max(0, Math.floor((t - T.measured) / 0.22)));
  const pass1 = swap(t, T.limits);
  const fail2 = swap(t, T.weeping + 0.2);
  const retest = swap(t, T.retest);
  const retestPass1 = swap(t, T.retest + 0.4);
  const photoIn = swap(t, T.belongs);
  const pass2 = swap(t, T.belongs + 0.5);
  const reworkRun = retest > 0.5;
  return (
    <AbsoluteFill>
      <ProductShot keys={[[0, { s: 1 }], [T.measured - 0.5, { s: 1.08, x: -10, y: -40 }, 1.6]]} origin={[WIN.x + 400, WIN.y + 400]}>
        <AppWindow active="floor" collapsed width={WIN.w}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <LargeTitle>{reworkRun ? "Pressure test · rework" : "Pressure test"}</LargeTitle>
            <StateBadge state="active" label="in progress" />
          </div>
          <div style={{ fontSize: 16, color: V.text2, marginBottom: 16 }}>
            {ORDER.ref} · Stage {reworkRun ? "8 of 10" : "4 of 6"} · quantity {ORDER.qty}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "600px 1fr", gap: 16, alignItems: "start" }}>
            <Panel title="Quality checks" action={<span style={{ fontSize: 14, color: V.text3, ...tab }}>{reworkRun ? (pass2 > 0.5 ? 2 : retestPass1 > 0.5 ? 1 : 0) : pass1 > 0.5 ? 1 : 0} of 2 passed</span>}>
              {!reworkRun ? (
                <>
                  <CheckRow
                    label={hydro.checks[0].label}
                    sub={`${hydro.checks[0].min}–${hydro.checks[0].max} ${hydro.checks[0].unit} · measured`}
                    verdict={pass1 > 0.5 ? "pass" : "none"}
                    k={pass1}
                    typing={t > T.measured ? typed : ""}
                    detail={`${hydro.checks[0].reading} bar · within ${hydro.checks[0].min}–${hydro.checks[0].max}`}
                  />
                  <CheckRow label={hydro.checks[1].label} sub="Photo required" verdict={fail2 > 0.5 ? "fail" : "none"} k={fail2} detail={FAILURE.remarks} />
                </>
              ) : (
                <>
                  <CheckRow label={hydro.checks[0].label} sub={`${hydro.checks[0].min}–${hydro.checks[0].max} ${hydro.checks[0].unit} · measured`} verdict={retestPass1 > 0.5 ? "pass" : "none"} k={retestPass1} detail="15.2 bar · within 15.0–15.5" />
                  <CheckRow label={hydro.checks[1].label} sub="Photo required" verdict={pass2 > 0.5 ? "pass" : "none"} k={pass2} detail="No visible leak after 30 min" photo={photoIn} />
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
                    <Button variant="primary" size="sm" style={{ opacity: 0.4 + 0.6 * pass2 }}>
                      Complete stage
                    </Button>
                  </div>
                </>
              )}
            </Panel>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Reveal at={T.back}>
                <Panel title="Stages">
                  {[
                    { l: "Assembly and alignment", s: "completed" as const, n: "done" },
                    { l: "Pressure test", s: "cancelled" as const, n: "sent back" },
                    { l: "Assembly and alignment", s: reworkRun ? ("completed" as const) : ("pending" as const), n: reworkRun ? "done · rework" : "rework" },
                    { l: "Pressure test", s: reworkRun ? ("active" as const) : ("draft" as const), n: reworkRun ? "in progress" : "pending" },
                  ].map((r, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: i < 3 ? `1px solid ${V.line}` : undefined, opacity: i >= 2 ? p(t, T.back + 0.3 + (i - 2) * 0.2, 0.5) : 1 }}>
                      <span style={{ fontSize: 15, textDecoration: r.s === "cancelled" ? "line-through" : undefined, color: r.s === "cancelled" ? V.text3 : V.text }}>{r.l}</span>
                      <StateBadge state={r.s} label={r.n} />
                    </div>
                  ))}
                </Panel>
              </Reveal>
              <Reveal at={T.record - 0.3}>
                <Panel title="On record">
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <span style={{ width: 22, height: 22, borderRadius: 11, background: V.danger, display: "flex", alignItems: "center", justifyContent: "center", flex: "none", marginTop: 1 }}>
                      <Icon name="x" size={12} color="#FFF" stroke={2.4} />
                    </span>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 500 }}>Failed · {FAILURE.check}</div>
                      <div style={{ fontSize: 14, color: V.text2, marginTop: 2 }}>
                        {PEOPLE.inspector.name} · 3 Dec 2026, 15:42 · kept after the retest
                      </div>
                    </div>
                  </div>
                </Panel>
              </Reveal>
            </div>
          </div>
        </AppWindow>
      </ProductShot>
      <FlangeMacro t={t} />
      <CameraPhone t={t} />
      <Eyebrow n="05" label="Quality" inAt={0.6} outAt={T.weeping - 0.6} top={96} />
      <Statement lines={["The failure stays", "in the history."]} inAt={T.record + 0.5} outAt={v14.start + 1.4} />
    </AbsoluteFill>
  );
};
