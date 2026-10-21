import React from "react";
import { AbsoluteFill } from "remotion";
import { BASELINE } from "../film/layout";
import { Camera, Statement } from "../film/engine";
import { glide, linear, p, useTime } from "../film/ease";
import { cue, sceneLength } from "../film/timeline";
import { Phone, type Note } from "../props/Phone";
import { QUESTIONS } from "../content/fixture";

/** The six questions arrive 0.85 s apart, before the narration speaks (tension through sound). */
export const QUESTION_TIMES = QUESTIONS.map((_, i) => 0.7 + i * 0.85);
const CLOCK_TIMES = ["8:41", "8:44", "8:47", "8:50", "8:53", "8:57"];

export const questionNotes = (answers = false, answerAt = 0): Note[] =>
  QUESTIONS.map((q, i) => ({
    from: q.from,
    text: q.text,
    at: QUESTION_TIMES[i],
    time: CLOCK_TIMES[i],
    answer: answers ? q.answer : undefined,
    answerState: q.state,
    answerAt: answers ? answerAt + i * 0.45 : undefined,
  }));

/** Phone position, shared with s15 so Act IV returns to the same object. */
export const PHONE_POS = { x: 1130, y: 120 };

/**
 * s02 — Every question, one person. Focal point: the phone (right, cropped at the bottom edge).
 * Statement (left column, bottom on the shared baseline): the count, not a paraphrase.
 * Camera: lateral drift 30 px. Each arrival nudges the phone 2 px (a buzz, no bounce).
 */
export const S02Questions: React.FC = () => {
  const t = useTime();
  const len = sceneLength("s02");
  const v03 = cue("s02", "v03");
  const buzz = QUESTION_TIMES.reduce((s, at) => {
    const d = t - at;
    return d > 0 && d < 0.18 ? s + Math.sin(d * 140) * 2 * (1 - d / 0.18) : s;
  }, 0);
  const arrive = p(t, 0, 1.0, glide);
  return (
    <AbsoluteFill>
      <Camera move={{ x: -30 * p(t, 0, len, linear) }}>
        <div
          style={{
            position: "absolute",
            left: PHONE_POS.x + buzz,
            top: PHONE_POS.y + (1 - arrive) * 40,
            opacity: arrive,
            transform: "rotate(-2deg)",
          }}
        >
          <Phone t={t} clock="8:58" notes={questionNotes()} />
        </div>
      </Camera>
      <Statement lines={["Six questions.", "One phone.", "Before nine."]} inAt={v03.start + 1.2} outAt={len - 0.2} bottom={BASELINE} />
    </AbsoluteFill>
  );
};
