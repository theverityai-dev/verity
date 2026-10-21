import React from "react";
import { AbsoluteFill } from "remotion";
import { BASELINE, DK, TEXT } from "../film/layout";
import { Camera, Eyebrow, Support } from "../film/engine";
import { linear, p, smooth, useTime } from "../film/ease";
import { cue, sceneLength } from "../film/timeline";
import { Skid } from "../props/Skid";
import { COMPANY } from "../content/fixture";

/**
 * s01 — The work. Focal point: the skid, drawing itself in warm line on the dark world.
 * No statement: the object is the opening statement. A title-block caption anchors bottom-left at
 * the shared baseline, like the title block of the drawing it will later become (s06).
 * Camera: slow push 1.0 -> 1.12 towards the discharge header over the whole shot.
 * Hand-off: on v02 the drawing dims, leaving dark space for the phone (s02).
 */
export const S01Work: React.FC = () => {
  const t = useTime();
  const len = sceneLength("s01");
  const v02 = cue("s01", "v02");
  const draw = p(t, 0.4, 9.5, smooth);
  const push = 1 + 0.12 * p(t, 0, len + 0.7, linear);
  const dim = p(t, v02.start + 0.6, 2.4, smooth);
  return (
    <AbsoluteFill>
      <Camera move={{ s: push }} origin={[1240, 520]}>
        {/* Anchor: the base frame's lower edge sits near the shared baseline; the skid bleeds right. */}
        <div style={{ position: "absolute", left: 640, top: 70, opacity: 1 - 0.75 * dim }}>
          <Skid width={1500} draw={draw} stroke={1.25} />
        </div>
      </Camera>
      <Eyebrow label="Booster pump skid · 2 × 75 kW" inAt={4.6} outAt={v02.start + 0.4} top={BASELINE - 58} x={TEXT.x} color={DK.inkSoft} />
      <Support text={COMPANY.name} inAt={5.0} outAt={v02.start + 0.4} top={BASELINE - 30} color={DK.inkFaint} />
    </AbsoluteFill>
  );
};
