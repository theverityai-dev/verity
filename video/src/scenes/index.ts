import type React from "react";
import { S01Work } from "./S01Work";
import { S02Questions } from "./S02Questions";
import { S03Record } from "./S03Record";
import { S04Quote } from "./S04Quote";
import { S05Project } from "./S05Project";
import { S06Engineering } from "./S06Engineering";
import { S07Procurement } from "./S07Procurement";
import { S08Floor } from "./S08Floor";
import { S09Quality } from "./S09Quality";
import { S10Dispatch } from "./S10Dispatch";
import { S11Cost } from "./S11Cost";
import { S12Summary } from "./S12Summary";
import { S12Pipeline } from "./S12Pipeline";
import { S13Assistant } from "./S13Assistant";
import { S14Accountability } from "./S14Accountability";
import { S15Return } from "./S15Return";
import { S16Brand } from "./S16Brand";

/** Scene id (content/scenes.json) to component. */
export const SCENES: Record<string, React.FC> = {
  s01: S01Work,
  s02: S02Questions,
  s03: S03Record,
  s04: S04Quote,
  s05: S05Project,
  s06: S06Engineering,
  s07: S07Procurement,
  s08: S08Floor,
  s09: S09Quality,
  s10: S10Dispatch,
  s11: S11Cost,
  s12: S12Summary,
  s12p: S12Pipeline,
  s13: S13Assistant,
  s14: S14Accountability,
  s15: S15Return,
  s16: S16Brand,
};
