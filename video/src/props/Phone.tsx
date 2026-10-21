import React from "react";
import { FONT, STATE, type StateKey } from "../film/layout";
import { glide, p } from "../film/ease";

/**
 * A generic phone lock screen (no brand, no real messaging app): a large clock and a stack of
 * notifications from the people around the owner. In Act IV each notification carries the record
 * that answers it.
 */

export type Note = { from: string; text: string; at: number; time: string; answer?: string; answerState?: StateKey; answerAt?: number };

const PHONE_W = 470;
const PHONE_H = 980;

const initials = (s: string) =>
  s
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

export const Phone: React.FC<{
  t: number;
  clock: string;
  notes: Note[];
  dim?: number;
  style?: React.CSSProperties;
}> = ({ t, clock, notes, dim = 0, style }) => {
  // Newest on top: each arrival pushes the earlier ones down by one card.
  const arrived = notes.map((n) => p(t, n.at, 0.55, glide));
  return (
    <div
      style={{
        width: PHONE_W,
        height: PHONE_H,
        borderRadius: 64,
        padding: 13,
        background: "linear-gradient(160deg, #2a2d33 0%, #15171b 60%)",
        boxShadow: "0 1px 0 rgba(255,255,255,0.08) inset, 0 40px 90px rgba(0,0,0,0.55), 0 2px 4px rgba(0,0,0,0.4)",
        fontFamily: FONT,
        ...style,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 52,
          overflow: "hidden",
          position: "relative",
          background: "radial-gradient(ellipse 120% 70% at 30% 10%, #3a3f49 0%, #1a1d23 55%, #0f1115 100%)",
        }}
      >
        <div style={{ position: "absolute", top: 14, left: "50%", width: 120, height: 34, marginLeft: -60, borderRadius: 20, background: "#000" }} />
        <div style={{ position: "absolute", top: 92, width: "100%", textAlign: "center", color: "rgba(255,255,255,0.92)" }}>
          <div style={{ fontSize: 19, fontWeight: 500, letterSpacing: "0.01em" }}>Monday</div>
          <div style={{ fontSize: 104, fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.05, fontVariantNumeric: "tabular-nums" }}>{clock}</div>
        </div>
        <div style={{ position: "absolute", left: 14, right: 14, top: 300 }}>
          {notes.map((n, i) => {
            const k = arrived[i];
            if (k <= 0) return null;
            const above = arrived.slice(i + 1).reduce((s, v) => s + v, 0);
            const ans = n.answerAt !== undefined ? p(t, n.answerAt, 0.6, glide) : 0;
            const cardH = 92 + 34 * ans;
            const y = above * (cardH + 10);
            const st = STATE[n.answerState ?? "completed"];
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: y,
                  opacity: Math.min(1, k * 1.5) * (1 - dim * 0.6),
                  transform: `translateY(${(1 - k) * -24}px) scale(${0.96 + 0.04 * k})`,
                  borderRadius: 24,
                  padding: "14px 16px",
                  background: "rgba(245, 245, 247, 0.84)",
                  backdropFilter: "blur(20px) saturate(1.6)",
                  display: "flex",
                  gap: 12,
                }}
              >
                <span
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 19,
                    background: "#D1D1D6",
                    color: "#3A3A3C",
                    fontSize: 14,
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flex: "none",
                  }}
                >
                  {initials(n.from)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16 }}>
                    <span style={{ fontWeight: 600, color: "#111" }}>{n.from}</span>
                    <span style={{ color: "#6E6E73", fontSize: 14 }}>{n.time}</span>
                  </div>
                  <div style={{ fontSize: 17, color: "#1C1C1E", marginTop: 3, lineHeight: 1.3 }}>{n.text}</div>
                  {ans > 0 && n.answer && (
                    <div style={{ marginTop: 9, opacity: ans, display: "inline-flex", alignItems: "center", gap: 7, borderRadius: 999, padding: "4px 11px 4px 9px", background: st.fill, color: st.ink, fontSize: 14.5, fontWeight: 600 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 4, background: st.dot }} />
                      {n.answer}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export const PHONE_SIZE = { w: PHONE_W, h: PHONE_H };
