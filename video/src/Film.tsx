import React from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { Grade, World } from "./film/engine";
import { p, smooth, useTime } from "./film/ease";
import { TIMELINE } from "./film/timeline";
import { Soundtrack } from "./film/audio";
import { Captions } from "./film/captions";
import { SCENES } from "./scenes";

export type FilmProps = { fps: number; captions: boolean };

/** Fades a scene in over the overlap at its start and out over the overlap at its end. */
const SceneFrame: React.FC<{ len: number; first: boolean; last: boolean; children: React.ReactNode }> = ({ len, first, last, children }) => {
  const t = useTime();
  const o = TIMELINE.overlap;
  const fadeIn = first ? 1 : p(t, 0, o, smooth);
  const fadeOut = last ? 1 : 1 - p(t, len, o, smooth);
  return <AbsoluteFill style={{ opacity: fadeIn * fadeOut }}>{children}</AbsoluteFill>;
};

/**
 * The master: the dark world, sixteen scenes on the narration's clock, the grade, the soundtrack,
 * and (optionally) burned-in captions. Scenes overlap by `TIMELINE.overlap` seconds and cross-fade.
 */
export const Film: React.FC<FilmProps> = ({ captions }) => {
  const { fps } = useVideoConfig();
  const n = TIMELINE.scenes.length;
  return (
    <AbsoluteFill>
      <World />
      {TIMELINE.scenes.map((s, i) => {
        const Comp = SCENES[s.id];
        const len = s.end - s.start;
        const from = Math.round(s.start * fps);
        const dur = Math.round((len + (i === n - 1 ? 0 : TIMELINE.overlap)) * fps);
        return (
          <Sequence key={s.id} from={from} durationInFrames={dur} name={`${s.id} ${s.title}`}>
            <SceneFrame len={len} first={i === 0} last={i === n - 1}>
              <Comp />
            </SceneFrame>
          </Sequence>
        );
      })}
      <Grade />
      {captions && <Captions />}
      <Soundtrack />
    </AbsoluteFill>
  );
};
