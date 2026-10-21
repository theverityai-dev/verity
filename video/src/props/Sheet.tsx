import React from "react";
import { FONT, PAPER } from "../film/layout";
import { Skid } from "./Skid";
import { COMPANY, DRAWING } from "../content/fixture";

/**
 * The general-arrangement drawing as a printed A3 sheet: border, the skid in ink, and a title
 * block carrying the same number and revision the document register holds.
 */
export const Sheet: React.FC<{ width: number; draw?: number; rev?: string }> = ({ width, draw = 1, rev = "R02" }) => {
  const h = width * 0.707;
  const u = width / 1000;
  return (
    <div style={{ width, height: h, background: PAPER.sheet, position: "relative", boxShadow: "0 2px 3px rgba(0,0,0,0.3), 0 30px 70px rgba(0,0,0,0.45)", fontFamily: FONT, color: PAPER.ink }}>
      <div style={{ position: "absolute", inset: 18 * u, border: `${1.5 * u}px solid ${PAPER.ink}` }} />
      <div style={{ position: "absolute", left: 60 * u, top: 40 * u }}>
        <Skid width={720 * u} mode="paper" draw={draw} stroke={1.1} pad={20} />
      </div>
      <div
        style={{
          position: "absolute",
          right: 18 * u,
          bottom: 18 * u,
          width: 330 * u,
          borderLeft: `${1.5 * u}px solid ${PAPER.ink}`,
          borderTop: `${1.5 * u}px solid ${PAPER.ink}`,
          fontSize: 13 * u,
          lineHeight: 1.35,
        }}
      >
        <div style={{ padding: `${8 * u}px ${12 * u}px`, borderBottom: `${1 * u}px solid ${PAPER.rule}` }}>
          <div style={{ fontWeight: 600 }}>{COMPANY.name}</div>
          <div style={{ color: PAPER.soft }}>{DRAWING.title}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", padding: `${8 * u}px ${12 * u}px` }}>
          <span style={{ fontWeight: 600, letterSpacing: "0.02em" }}>{DRAWING.number}</span>
          <span style={{ fontWeight: 700 }}>{rev}</span>
        </div>
      </div>
    </div>
  );
};
