import React from "react";
import { AbsoluteFill } from "remotion";
import { BASELINE } from "../film/layout";
import { Camera, Statement } from "../film/engine";
import { glide, linear, p, useTime } from "../film/ease";
import { sceneLength, word } from "../film/timeline";
import { addSfx } from "../film/sfx";
import { Phone } from "../props/Phone";
import { PHONE_POS, questionNotes } from "./S02Questions";
import { QUESTIONS } from "../content/fixture";

const T = {
  come: word("s15", "v23", "come"),
  leadership: word("s15", "v24", "leadership"),
};
const ANSWERS_AT = T.come + 0.4;

addSfx(QUESTIONS.map((_, i) => ({ scene: "s15", at: ANSWERS_AT + i * 0.45, name: "tick" as const, gain: 0.22 })));

/**
 * s15 — Control without constant intervention. The same phone, the same six questions, now each
 * answered by the record that holds the answer. Statement: what the owner gets back.
 * Camera: slow pull-back, the reverse of s02's drift.
 */
export const S15Return: React.FC = () => {
  const t = useTime();
  const len = sceneLength("s15");
  // The questions are already there when we return: shift their arrival before the scene starts.
  const notes = questionNotes(true, ANSWERS_AT).map((n) => ({ ...n, at: n.at - 6 }));
  const arrive = p(t, 0, 1.2, glide);
  return (
    <AbsoluteFill>
      <Camera move={{ s: 1.04 - 0.06 * p(t, 0, len, linear), x: -30 }} origin={[PHONE_POS.x + 235, 560]}>
        <div style={{ position: "absolute", left: PHONE_POS.x, top: PHONE_POS.y, opacity: arrive, transform: "rotate(-2deg)" }}>
          <Phone t={t} clock="8:58" notes={notes} />
        </div>
      </Camera>
      <Statement lines={["Back to the work", "only you can do."]} inAt={T.leadership + 0.2} outAt={len - 0.3} bottom={BASELINE} />
    </AbsoluteFill>
  );
};
