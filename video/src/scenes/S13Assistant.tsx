import React from "react";
import { AbsoluteFill } from "remotion";
import { V } from "../film/layout";
import { TextColumn } from "../film/engine";
import { glide, p, useTime } from "../film/ease";
import { sceneLength, word } from "../film/timeline";
import { addSfx } from "../film/sfx";
import { AppWindow } from "../ui/shell";
import { Icon } from "../ui/icons";
import { LargeTitle, Panel, ui } from "../ui/kit";
import { ASSISTANT } from "../content/fixture";
import { ProductShot, WIN, press, swap } from "./common";

const T = {
  open: 0.5,
  ask: word("s13", "v21", "question"),
  send: word("s13", "v21", "language") + 0.3,
  answers: word("s13", "v21", "answers"),
  flags: word("s13", "v21", "flags"),
  asks: word("s13", "v21", "asks") - 1.2,
  preview: word("s13", "v21", "before"),
};

addSfx([
  { scene: "s13", at: T.open, name: "tick", gain: 0.35 },
  { scene: "s13", at: T.send, name: "press", gain: 0.4 },
  { scene: "s13", at: T.answers, name: "tick", gain: 0.3 },
  { scene: "s13", at: T.flags, name: "tick", gain: 0.3 },
  { scene: "s13", at: T.preview, name: "tick", gain: 0.35 },
]);

const FOLLOW_UP = "Start work on J-0148 and J-0150.";
const PREVIEW = "Start work on 2 jobs: J-0148 Cooling water skid, 2 × 30 kW; J-0150 Booster pump skid, 1 × 37 kW.";

const typed = (s: string, t: number, at: number, cps = 34) => s.slice(0, Math.max(0, Math.floor((t - at) * cps)));

/**
 * The assistant dock (`src/components/shell/AgentChatDock.tsx`): its own intro copy, a question,
 * an answer, the grounding warning the dock prints for a claim no query confirmed this turn, and
 * the confirm-before-acting preview for repeated routine commands. It runs every tool as the
 * signed-in person (ADR-017). The answer's wording is illustrative: it is model output.
 */
const Dock: React.FC<{ t: number }> = ({ t }) => {
  const k = p(t, T.open, 0.6, glide);
  const asked = t >= T.send;
  const thinking = asked && t < T.answers;
  const lines = ASSISTANT.answer.map((_, i) => p(t, T.answers + i * 0.9, 0.5, glide));
  const warn = swap(t, T.flags);
  const second = t >= T.asks + 0.9;
  const preview = swap(t, T.preview);
  const input = !asked ? typed(ASSISTANT.question, t, T.ask - 0.6, 30) : t > T.asks && !second ? typed(FOLLOW_UP, t, T.asks, 40) : "";
  return (
    <div
      style={{
        ...ui,
        position: "absolute",
        right: 24,
        bottom: 24,
        width: 470,
        height: 720,
        borderRadius: 16,
        background: "rgba(250, 250, 252, 0.97)",
        boxShadow: "0 18px 50px rgba(0,0,0,0.22), 0 0 0 1px rgba(60,60,67,0.12)",
        opacity: k,
        transform: `translateY(${(1 - k) * 20}px)`,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 16px", borderBottom: `1px solid ${V.line}` }}>
        <Icon name="chat" size={18} color={V.accent} />
        <span style={{ fontSize: 15, fontWeight: 500 }}>Assistant</span>
      </div>
      <div style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column", gap: 10, overflow: "hidden", justifyContent: "flex-end" }}>
        {!asked && <div style={{ fontSize: 14, color: V.text2, lineHeight: 1.45 }}>Ask about your Work, Parties, or anything else in this workspace. I can only see and do what your own role can.</div>}
        {asked && <div style={{ alignSelf: "flex-end", maxWidth: "85%", borderRadius: 12, padding: "9px 13px", background: V.accent, color: "#fff", fontSize: 14.5, lineHeight: 1.45 }}>{ASSISTANT.question}</div>}
        {thinking && <div style={{ fontSize: 14, color: V.text3 }}>Thinking…</div>}
        {lines[0] > 0 && (
          <div style={{ maxWidth: "92%", borderRadius: 12, padding: "10px 13px", background: "#fff", fontSize: 14.5, lineHeight: 1.5, boxShadow: "0 0 0 1px rgba(60,60,67,0.08)" }}>
            {ASSISTANT.answer.map((l, i) => (
              <p key={i} style={{ margin: i ? "8px 0 0" : 0, opacity: lines[i], background: i === 2 && warn > 0 ? `rgba(255, 149, 0, ${0.14 * warn})` : undefined, borderRadius: 4 }}>
                {l}
              </p>
            ))}
          </div>
        )}
        {warn > 0 && (
          <div style={{ fontSize: 13, color: V.text3, opacity: warn }}>Double-check: {ASSISTANT.unconfirmed} — not confirmed against a query this turn.</div>
        )}
        {second && <div style={{ alignSelf: "flex-end", maxWidth: "85%", borderRadius: 12, padding: "9px 13px", background: V.accent, color: "#fff", fontSize: 14.5 }}>{FOLLOW_UP}</div>}
        {preview > 0 && (
          <div style={{ background: V.control, borderRadius: 12, padding: "12px 14px", fontSize: 14.5, opacity: preview, transform: `translateY(${(1 - preview) * 8}px)` }}>
            <div style={{ marginBottom: 10, lineHeight: 1.45 }}>{PREVIEW}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <span style={{ background: V.accent, color: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 13.5, fontWeight: 500 }}>Confirm</span>
              <span style={{ background: "#fff", borderRadius: 10, padding: "6px 12px", fontSize: 13.5, fontWeight: 500, color: V.text2 }}>Cancel</span>
            </div>
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, padding: 12, borderTop: `1px solid ${V.line}` }}>
        <div style={{ flex: 1, height: 44, borderRadius: 10, background: "#fff", boxShadow: "0 0 0 1px rgba(60,60,67,0.1)", display: "flex", alignItems: "center", padding: "0 14px", fontSize: 14, color: input ? V.text : V.text3 }}>
          {input || "Ask the assistant…"}
          {input && <span style={{ width: 1.5, height: 18, background: V.accent, marginLeft: 1 }} />}
        </div>
        <span style={{ width: 44, height: 44, borderRadius: 10, background: V.accent, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${1 - 0.06 * press(t, T.send - 0.2)})` }}>
          <Icon name="chevronRight" size={18} color="#fff" stroke={2} />
        </span>
      </div>
    </div>
  );
};

/** s13 — 08 Search to decisions. Focal point: the dock, right; the page behind it is context. */
export const S13Assistant: React.FC = () => {
  const t = useTime();
  const len = sceneLength("s13");
  return (
    <AbsoluteFill>
      <ProductShot keys={[[0, { s: 1 }], [T.answers - 0.5, { s: 1.06, y: -40 }, 1.8]]} origin={[WIN.x, WIN.y + 700]}>
        <AppWindow active="summary" collapsed width={1080} assistantOn={p(t, T.open - 0.2, 0.4)} overlay={<Dock t={t} />}>
          <div style={{ opacity: 0.55 }}>
            <LargeTitle>Summary</LargeTitle>
            <div style={{ fontSize: 15, color: V.text2, margin: "4px 0 18px" }}>Where every job stands today, what is on the shop floor, and what needs attention.</div>
            <Panel title="Needs attention (3)">
              <div style={{ fontSize: 15, padding: "6px 0" }}>J-0139 · Milestone “Dispatch” was due 14 Dec 2026</div>
              <div style={{ fontSize: 15, padding: "6px 0" }}>J-0146 · Task “Receive motor from supplier” is blocked</div>
            </Panel>
          </div>
        </AppWindow>
      </ProductShot>
      <TextColumn n="08" label="Search to decisions" lines={["Answers you", "can check."]} labelAt={0.6} statementAt={T.flags + 0.5} outAt={len - 0.35} />
    </AbsoluteFill>
  );
};
