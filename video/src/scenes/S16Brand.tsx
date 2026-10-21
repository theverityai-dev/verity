import React from "react";
import { AbsoluteFill } from "remotion";
import { DK, FEATURES, FONT, TYPE } from "../film/layout";
import { glide, p, smooth, useTime } from "../film/ease";
import { cue, sceneLength } from "../film/timeline";
import { addSfx } from "../film/sfx";
import { VeritySymbol } from "../ui/shell";

const v25 = cue("s16", "v25");

addSfx([{ scene: "s16", at: 0.5, name: "low", gain: 0.5 }]);

/**
 * s16 — Verity for Manufacturing. One object, centred (the only centred composition in the film):
 * the mark assembles top then bottom, the wordmark follows, then the positioning line and the
 * next step. Monochrome mark (ADR-012), never tinted.
 */
export const S16Brand: React.FC = () => {
  const t = useTime();
  const len = sceneLength("s16");
  const top = p(t, 0.3, 1.0, glide);
  const bottom = p(t, 0.65, 1.0, glide);
  const word = p(t, 1.1, 1.0, glide);
  const sub = p(t, v25.start + 0.1, 0.9, glide);
  const line = p(t, v25.end + 1.0, 0.9, glide);
  const cta = p(t, v25.end + 2.0, 0.9, glide);
  const end = p(t, len - 1.4, 1.3, smooth);
  const size = 120;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", fontFamily: FONT, fontFeatureSettings: FEATURES, opacity: 1 - end }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", transform: `translateY(${-40 * line}px)` }}>
        <div style={{ display: "flex", alignItems: "center", gap: size * 0.38 }}>
          <div style={{ transform: `translateY(${(1 - top) * -10}px)` }}>
            <VeritySymbol size={size * 0.865} color={DK.ink} top={top} bottom={bottom} />
          </div>
          <span style={{ fontSize: size * 0.95, fontWeight: 300, letterSpacing: "-0.04em", lineHeight: 1, color: DK.ink, opacity: word, transform: `translateX(${(1 - word) * -14}px)` }}>verity</span>
        </div>
        <div style={{ fontSize: TYPE.support + 4, fontWeight: 400, letterSpacing: "-0.01em", color: DK.inkSoft, marginTop: 30, opacity: sub }}>for Manufacturing</div>
      </div>
      <div style={{ position: "absolute", top: 700, width: "100%", textAlign: "center", fontSize: TYPE.support, fontWeight: 300, letterSpacing: "-0.01em", color: DK.ink, opacity: line }}>
        From enquiry to dispatch, every handoff on record.
      </div>
      <div style={{ position: "absolute", top: 860, width: "100%", textAlign: "center", fontSize: TYPE.label, fontWeight: 500, letterSpacing: "0.14em", textTransform: "uppercase", color: DK.inkSoft, opacity: cta }}>
        Book a walkthrough · theverityai.xyz
      </div>
    </AbsoluteFill>
  );
};
