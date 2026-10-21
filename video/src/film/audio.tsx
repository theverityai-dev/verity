import React from "react";
import { Audio, Sequence, staticFile, useVideoConfig } from "remotion";
import { allCues, TIMELINE } from "./timeline";
import { SFX, sfxTime } from "./sfx";

/** Music sits under the voice: full level between lines, ducked by DUCK while anyone speaks. */
const MUSIC_GAIN = 0.62;
const AMBIENCE_GAIN = 0.5;
const DUCK = 0.42;
const RAMP = 0.35;

function duckAt(t: number): number {
  let k = 0;
  for (const c of allCues()) {
    if (t >= c.start - RAMP && t <= c.end + RAMP) {
      const inK = Math.min(1, (t - (c.start - RAMP)) / RAMP);
      const outK = Math.min(1, (c.end + RAMP - t) / RAMP);
      k = Math.max(k, Math.min(inK, outK));
    }
  }
  return 1 - (1 - DUCK) * k;
}

export const Soundtrack: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <>
      <Audio src={staticFile("audio/music.wav")} volume={(f) => MUSIC_GAIN * duckAt(f / fps)} />
      <Audio src={staticFile("audio/ambience.wav")} volume={AMBIENCE_GAIN} />
      {allCues().map((c) => (
        <Sequence key={c.id} from={Math.round(c.start * fps)} durationInFrames={Math.ceil((c.end - c.start + 0.2) * fps)} name={`vo ${c.id}`} layout="none">
          <Audio src={staticFile(`audio/vo/${c.id}.wav`)} volume={1} />
        </Sequence>
      ))}
      {SFX.map((e, i) => (
        <Sequence key={i} from={Math.round(sfxTime(e) * fps)} durationInFrames={Math.round(3 * fps)} name={`sfx ${e.name}`} layout="none">
          <Audio src={staticFile(`audio/sfx/${e.name}.wav`)} volume={e.gain ?? 0.6} />
        </Sequence>
      ))}
      <div data-total={TIMELINE.total} />
    </>
  );
};
