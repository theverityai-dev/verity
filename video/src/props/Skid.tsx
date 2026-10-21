import React from "react";
import { DK, PAPER } from "../film/layout";
import { bounds, box, cyl, type Solid } from "./iso";

/**
 * The film's physical hero: a booster pump skid, 2 x 75 kW duty/standby on a fabricated channel
 * base, with suction and discharge headers, butterfly and non-return valves, gauges and a control
 * panel. An original illustration built from the dimensions below (millimetres), drawn the way a
 * general-arrangement drawing would show it. The same object appears as the cold open, inside the
 * released drawing (s06), at the failed flange (s09) and in the crate (s10).
 */

const SETS = [420, 1180]; // y centre of each pump set
const SHAFT = 640; // shaft centre height
const X_SUCTION = 2760; // suction header line

function pumpSet(i: number, y: number): Solid[] {
  const g = `set${i}`;
  return [
    box(`plinth-${i}`, g, [560, y - 300, 220], [2320, y + 300, 330]),
    // Motor: fan cowl, finned body, terminal box.
    cyl(`cowl-${i}`, g, "x", [0, y, SHAFT], 470, 600, 235, { fineRings: [520, 560] }),
    cyl(`motor-${i}`, g, "x", [0, y, SHAFT], 600, 1440, 270, {
      rings: [600],
      fineRings: Array.from({ length: 13 }, (_, k) => 650 + k * 60),
    }),
    box(`tbox-${i}`, g, [880, y - 130, SHAFT + 250], [1140, y + 130, SHAFT + 420]),
    cyl(`shaftend-${i}`, g, "x", [0, y, SHAFT], 1440, 1480, 120),
    box(`guard-${i}`, g, [1480, y - 170, SHAFT - 170], [1700, y + 170, SHAFT + 150]),
    cyl(`bearing-${i}`, g, "x", [0, y, SHAFT], 1700, 1950, 120, { rings: [1760, 1890] }),
    cyl(`volute-${i}`, g, "x", [0, y, SHAFT], 1950, 2160, 340, { rings: [2010, 2100], bolts: 12, boltR: 300 }),
    cyl(`suction-${i}`, g, "x", [0, y, SHAFT], 2160, 2300, 120),
    cyl(`sflange-${i}`, g, "x", [0, y, SHAFT], 2300, 2330, 190, { bolts: 8, boltR: 155 }),
    // Suction branch to the header, with the DN200 butterfly valve and its lever.
    cyl(`sbranch-${i}`, g, "x", [0, y, SHAFT], 2330, 2440, 112),
    cyl(`bfv-${i}`, g, "x", [0, y, SHAFT], 2440, 2510, 190, { bolts: 8, boltR: 155 }),
    box(`bfvlever-${i}`, g, [2455, y - 20, SHAFT + 190], [2495, y + 20, SHAFT + 330]),
    box(`bfvhandle-${i}`, g, [2455, y - 20, SHAFT + 310], [2700, y + 20, SHAFT + 340]),
    cyl(`sbranch2-${i}`, g, "x", [0, y, SHAFT], 2510, X_SUCTION - 115, 112),
    // Discharge: nozzle, flange, non-return valve, riser into the header.
    cyl(`dnozzle-${i}`, g, "z", [2050, y, 0], SHAFT + 300, 1110, 100),
    cyl(`dflange-${i}`, g, "z", [2050, y, 0], 1110, 1140, 170, { bolts: 8, boltR: 140 }),
    cyl(`nrv-${i}`, g, "z", [2050, y, 0], 1140, 1300, 150, { rings: [1220] }),
    cyl(`nrvflange-${i}`, g, "z", [2050, y, 0], 1300, 1330, 170, { bolts: 8, boltR: 140 }),
    cyl(`riser-${i}`, g, "z", [2050, y, 0], 1330, 1440, 105),
  ];
}

function build(): Solid[] {
  const solids: Solid[] = [
    // Base frame: two long channels, three cross members, drawn as boxes.
    box("rail-a", "frame", [0, 0, 0], [3200, 150, 220]),
    box("rail-b", "frame", [0, 1450, 0], [3200, 1600, 220]),
    box("cross-1", "frame", [0, 150, 0], [150, 1450, 220]),
    box("cross-2", "frame", [1520, 150, 0], [1670, 1450, 220]),
    box("cross-3", "frame", [3050, 150, 0], [3200, 1450, 220]),
    // Control panel, star-delta, on its own stand at the motor end.
    box("panel", "panel", [60, 760, 220], [420, 1440, 1920]),
    box("panel-door", "panel", [420, 800, 300], [430, 1400, 1860]),
    ...SETS.flatMap((y, i) => pumpSet(i, y)),
    // Suction header along y, flanged both ends.
    cyl("sheader", "suction", "y", [X_SUCTION, 0, SHAFT], -220, 1820, 115, { rings: [-190, 1790] }),
    cyl("sh-end-a", "suction", "y", [X_SUCTION, 0, SHAFT], -250, -220, 190),
    cyl("sh-end-b", "suction", "y", [X_SUCTION, 0, SHAFT], 1820, 1850, 190, { bolts: 8, boltR: 155 }),
    // Discharge header along y, flanged both ends; joint 3 is the far-end flange pair (s09).
    cyl("dheader", "discharge", "y", [2050, 0, 1555], -220, 1820, 115),
    cyl("dh-end-a", "discharge", "y", [2050, 0, 1555], -250, -220, 190),
    cyl("joint3", "discharge", "y", [2050, 0, 1555], 1820, 1880, 190, { bolts: 8, boltR: 155 }),
    cyl("dh-spool", "discharge", "y", [2050, 0, 1555], 1880, 2080, 115),
    // Gauges on both headers.
    cyl("g1-stem", "gauge", "z", [2050, 800, 0], 1670, 1770, 14),
    cyl("g1-dial", "gauge", "x", [0, 800, 1830], 2030, 2070, 62, { rings: [2070] }),
    cyl("g2-stem", "gauge", "z", [X_SUCTION, 800, 0], SHAFT + 115, SHAFT + 230, 14),
    cyl("g2-dial", "gauge", "x", [0, 800, SHAFT + 290], X_SUCTION - 20, X_SUCTION + 20, 62, { rings: [X_SUCTION + 20] }),
  ];
  return solids.sort((a, b) => a.depth - b.depth);
}

export const SKID = build();
export const SKID_BOX = bounds(SKID);

export type SkidMode = "dark" | "paper" | "blueprint";

/**
 * Draws the skid. `draw` (0..1) reveals it line by line, far to near; `dim` fades groups that are
 * not the subject; `mark` names solids to pick out (the failed flange) with `markColor`.
 */
export const Skid: React.FC<{
  width: number;
  mode?: SkidMode;
  draw?: number;
  stroke?: number;
  mark?: string[];
  markColor?: string;
  markK?: number;
  style?: React.CSSProperties;
  pad?: number;
}> = ({ width, mode = "dark", draw = 1, stroke = 1.4, mark = [], markColor = "#FF453A", markK = 0, style, pad = 40 }) => {
  const b = SKID_BOX;
  const vb = `${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}`;
  const height = (width * (b.h + pad * 2)) / (b.w + pad * 2);
  const ink = mode === "dark" ? DK.line : PAPER.ink;
  const soft = mode === "dark" ? DK.lineSoft : "rgba(29, 31, 36, 0.38)";
  const fill = mode === "dark" ? "#0b0f16" : PAPER.sheet;
  // The viewBox is in mm-scale units; keep strokes a constant on-screen width.
  const unit = (b.w + pad * 2) / width;
  const n = SKID.length;
  return (
    <svg width={width} height={height} viewBox={vb} style={{ display: "block", overflow: "visible", ...style }}>
      {SKID.map((s, i) => {
        // Each solid draws over a window of 0.35 of the timeline, staggered far to near.
        const start = (i / n) * 0.65;
        const k = Math.max(0, Math.min(1, (draw - start) / 0.35));
        if (k <= 0) return null;
        const marked = mark.includes(s.id);
        const color = marked && markK > 0 ? markColor : ink;
        const w = (marked && markK > 0 ? stroke * (1 + markK) : stroke) * unit;
        return (
          <g key={s.id}>
            <path d={s.fill} fill={fill} opacity={Math.min(1, k * 1.5)} />
            {s.lines.map((d, j) => (
              <path key={j} d={d} fill="none" stroke={color} strokeWidth={w} strokeLinejoin="round" strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - k} />
            ))}
            {s.fine?.map((d, j) => (
              <path key={`f${j}`} d={d} fill="none" stroke={marked && markK > 0 ? markColor : soft} strokeWidth={w * 0.6} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - k} />
            ))}
          </g>
        );
      })}
    </svg>
  );
};

/** Where a solid sits inside the drawn SVG, as a fraction of its width/height (for camera framing). */
export function solidCentre(id: string): [number, number] {
  const s = SKID.find((x) => x.id === id);
  if (!s) return [0.5, 0.5];
  const bb = bounds([s]);
  const pad = 40;
  return [(bb.x + bb.w / 2 - (SKID_BOX.x - pad)) / (SKID_BOX.w + pad * 2), (bb.y + bb.h / 2 - (SKID_BOX.y - pad)) / (SKID_BOX.h + pad * 2)];
}
