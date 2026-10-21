import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { BASELINE, DK, FEATURES, FONT, H, TEXT, TYPE, W } from "./layout";
import { D, glide, p, smooth, useTime } from "./ease";

/* ---------------------------------- world --------------------------------- */

/**
 * The dark world: base, one warm key from the top left, vignette 0.3, grain 0.07 (skill section 5).
 * Painted once beneath every scene, so scenes paint content only and cross-fade cleanly.
 */
export const World: React.FC<{ keyX?: number; keyY?: number }> = ({ keyX = 22, keyY = 8 }) => (
  <AbsoluteFill style={{ background: DK.base }}>
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse 70% 80% at ${keyX}% ${keyY}%, ${DK.key}, rgba(0,0,0,0) 70%), linear-gradient(180deg, ${DK.baseAlt} 0%, ${DK.base} 70%)`,
      }}
    />
  </AbsoluteFill>
);

/** Vignette and film grain, painted over everything (including the light UI, at grain strength). */
export const Grade: React.FC = () => {
  const frame = useCurrentFrame();
  // The grain pattern changes on every second frame at 60 fps, like real grain at 30.
  const seed = Math.floor(frame / 2) % 17;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill
        style={{ background: "radial-gradient(ellipse 85% 80% at 50% 48%, rgba(0,0,0,0) 62%, rgba(0,0,0,0.24) 100%)" }}
      />
      <svg width={W} height={H} style={{ position: "absolute", inset: 0, opacity: 0.07, mixBlendMode: "overlay" }}>
        <filter id={`grain-${seed}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={seed} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width={W} height={H} filter={`url(#grain-${seed})`} />
      </svg>
    </AbsoluteFill>
  );
};

/* --------------------------------- camera --------------------------------- */

export type CameraMove = { s?: number; x?: number; y?: number; ry?: number; rx?: number };

/**
 * One transform on a scene group (skill section 4). `origin` is the point the camera pushes
 * towards, in frame pixels. Perspective is applied only when there is rotation.
 */
export const Camera: React.FC<{
  move: CameraMove;
  origin?: [number, number];
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ move, origin = [W / 2, H / 2], children, style }) => {
  const { s = 1, x = 0, y = 0, ry = 0, rx = 0 } = move;
  const rot = ry || rx ? ` perspective(2400px) rotateY(${ry}deg) rotateX(${rx}deg)` : "";
  return (
    <AbsoluteFill
      style={{
        transform: `translate(${x}px, ${y}px)${rot} scale(${s})`,
        transformOrigin: `${origin[0]}px ${origin[1]}px`,
        ...style,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

/** Interpolate between camera keys: [time, move, curve?][] — each key eases from the previous. */
export function cameraAt(t: number, keys: Array<[number, CameraMove, number?]>): CameraMove {
  const out: Required<CameraMove> = { s: 1, x: 0, y: 0, ry: 0, rx: 0 };
  const first = keys[0][1];
  Object.assign(out, { s: 1, x: 0, y: 0, ry: 0, rx: 0 }, first);
  for (let i = 1; i < keys.length; i++) {
    const [at, move, dur = D.push] = keys[i];
    const k = p(t, at, dur, smooth);
    (Object.keys(move) as Array<keyof CameraMove>).forEach((key) => {
      const target = move[key] ?? out[key];
      out[key] = out[key] + (target - out[key]) * k;
    });
  }
  return out;
}

/** Depth reveal: a new surface arrives from behind (scale 0.92, blur 10, opacity 0). */
export function depthIn(t: number, at: number, dur = 1.1): React.CSSProperties {
  const k = p(t, at, dur, glide);
  return {
    opacity: k,
    transform: `scale(${0.92 + 0.08 * k})`,
    filter: k < 1 ? `blur(${(1 - k) * 10}px)` : undefined,
  };
}

/* ---------------------------------- type ---------------------------------- */

export const textBase: React.CSSProperties = {
  fontFamily: FONT,
  fontFeatureSettings: FEATURES,
  WebkitFontSmoothing: "antialiased",
};

/**
 * A hero statement. Lines are written, not wrapped (skill section 2). Each line rises out of its
 * own mask, staggered 70 ms; the block leaves as one. Anchored by its BOTTOM to a named baseline
 * unless `top` is given.
 */
export const Statement: React.FC<{
  lines: string[];
  inAt: number;
  outAt?: number;
  bottom?: number;
  top?: number;
  x?: number;
  size?: number;
  color?: string;
  weight?: number;
  align?: "left" | "center";
  width?: number;
}> = ({ lines, inAt, outAt = 1e9, bottom = BASELINE, top, x = TEXT.x, size = TYPE.statement, color = DK.ink, weight = 300, align = "left", width = TEXT.w + 80 }) => {
  const t = useTime();
  const out = p(t, outAt, D.textOut, smooth);
  if (t < inAt - 0.01 || out >= 1) return null;
  const lineH = size * TYPE.statementLine;
  const pos: React.CSSProperties = top !== undefined ? { top } : { top: bottom - lineH * lines.length };
  return (
    <div
      style={{
        position: "absolute",
        left: align === "center" ? x - width / 2 : x,
        width,
        ...pos,
        textAlign: align,
        opacity: 1 - out,
        transform: `translateY(${-10 * out}px)`,
      }}
    >
      {lines.map((line, i) => {
        const k = p(t, inAt + i * 0.07, D.textIn, glide);
        return (
          <div key={i} style={{ height: lineH, overflow: "hidden", paddingBottom: 0 }}>
            <div
              style={{
                ...textBase,
                fontSize: size,
                lineHeight: `${lineH}px`,
                fontWeight: weight,
                letterSpacing: TYPE.statementTracking,
                color,
                whiteSpace: "nowrap",
                transform: `translateY(${(1 - k) * 105}%)`,
                opacity: Math.min(1, k * 1.6),
              }}
            >
              {line}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** Chapter label: "01 — Enquiry to quote", 17px uppercase, +0.14em (skill section 2 micro level). */
export const Eyebrow: React.FC<{ n?: string | null; label: string; inAt: number; outAt?: number; top: number; x?: number; color?: string }> = ({
  n,
  label,
  inAt,
  outAt = 1e9,
  top,
  x = TEXT.x,
  color = DK.inkSoft,
}) => {
  const t = useTime();
  const k = p(t, inAt, D.textIn, glide) * (1 - p(t, outAt, D.textOut, smooth));
  if (k <= 0) return null;
  const rule = p(t, inAt + 0.15, 0.7, glide);
  return (
    <div
      style={{
        ...textBase,
        position: "absolute",
        left: x,
        top,
        display: "flex",
        alignItems: "center",
        gap: 14,
        fontSize: TYPE.label,
        fontWeight: 500,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color,
        opacity: k,
      }}
    >
      {n && <span style={{ fontVariantNumeric: "tabular-nums" }}>{n}</span>}
      {n && <span style={{ width: 36 * rule, height: 1, background: color, display: "block" }} />}
      <span>{label}</span>
    </div>
  );
};

/** Supporting line under a statement: 0.4x the hero, 400, 1.3 (skill section 2). */
export const Support: React.FC<{ text: string; inAt: number; outAt?: number; top: number; x?: number; color?: string; width?: number }> = ({
  text,
  inAt,
  outAt = 1e9,
  top,
  x = TEXT.x,
  color = DK.inkSoft,
  width = TEXT.w,
}) => {
  const t = useTime();
  const k = p(t, inAt, D.textIn, glide) * (1 - p(t, outAt, D.textOut, smooth));
  if (k <= 0) return null;
  return (
    <div
      style={{
        ...textBase,
        position: "absolute",
        left: x,
        top: top + (1 - k) * 12,
        width,
        fontSize: TYPE.support,
        lineHeight: 1.3,
        fontWeight: 400,
        letterSpacing: "-0.01em",
        color,
        opacity: k,
      }}
    >
      {text}
    </div>
  );
};

/**
 * The left text column used across Act II: eyebrow, statement, anchored to the shared baseline.
 * Statement bottom = BASELINE; eyebrow sits 28 above the statement's first line.
 */
export const TextColumn: React.FC<{
  n?: string | null;
  label: string;
  lines: string[];
  labelAt: number;
  statementAt: number;
  outAt: number;
}> = ({ n, label, lines, labelAt, statementAt, outAt }) => {
  const lineH = TYPE.statement * TYPE.statementLine;
  const top = BASELINE - lineH * lines.length;
  return (
    <>
      <Eyebrow n={n} label={label} inAt={labelAt} outAt={outAt} top={top - 28 - TYPE.label} />
      <Statement lines={lines} inAt={statementAt} outAt={outAt} />
    </>
  );
};
