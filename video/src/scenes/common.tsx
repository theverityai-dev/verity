import React from "react";
import { Camera, cameraAt, type CameraMove } from "../film/engine";
import { glide, p, useTime } from "../film/ease";

/**
 * Where the application window sits in Act II: its top-left in frame pixels and its base scale.
 * Left edge at x 800 leaves the text column (120-740) clear; the window bleeds off the right and
 * bottom edges by design (skill section 1, "Cropping").
 */
export const WIN = { x: 790, y: 132, s: 1.0, w: 1180 } as const;

/**
 * The product shot: one window, one camera. The window settles from a 4 degree Y tilt as it
 * arrives (skill section 6) and the camera then moves along `keys`.
 */
export const ProductShot: React.FC<{
  keys: Array<[number, CameraMove, number?]>;
  origin?: [number, number];
  arriveAt?: number;
  x?: number;
  y?: number;
  s?: number;
  tilt?: number;
  children: React.ReactNode;
}> = ({ keys, origin, arriveAt = 0, x = WIN.x, y = WIN.y, s = WIN.s, tilt = 4, children }) => {
  const t = useTime();
  const arrive = p(t, arriveAt, 1.4, glide);
  const cam = cameraAt(t, keys);
  return (
    <Camera move={{ ...cam, ry: (cam.ry ?? 0) + tilt * (1 - arrive) }} origin={origin}>
      <div
        style={{
          position: "absolute",
          left: x,
          top: y,
          transform: `scale(${s * (0.97 + 0.03 * arrive)})`,
          transformOrigin: "0 0",
          opacity: Math.min(1, arrive * 1.4),
        }}
      >
        {children}
      </div>
    </Camera>
  );
};

/** Fades a block in at `at` and optionally out at `out` (UI state changes, 0.6 s). */
export const Reveal: React.FC<{ at: number; out?: number; dur?: number; y?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({
  at,
  out = 1e9,
  dur = 0.6,
  y = 10,
  children,
  style,
}) => {
  const t = useTime();
  const k = p(t, at, dur, glide) * (1 - p(t, out, 0.5));
  if (k <= 0) return null;
  return <div style={{ opacity: k, transform: `translateY(${(1 - k) * y}px)`, ...style }}>{children}</div>;
};

/** Progress of a UI state change that happens at `at`. */
export function swap(t: number, at: number, dur = 0.5): number {
  return p(t, at, dur, glide);
}

/** A press: 0 -> 1 -> 0 over 0.3 s around `at`, for button dimming. */
export function press(t: number, at: number): number {
  const k = (t - at) / 0.3;
  return k < 0 || k > 1 ? 0 : Math.sin(k * Math.PI);
}

/**
 * A page change inside the one window: the old page leaves (0.3 s), then the new one arrives
 * (0.35 s), never both at half strength. Returns [old opacity, new opacity].
 */
export function pageChange(t: number, at: number, back = 1e9): [number, number] {
  const out = p(t, at, 0.3, glide) * (1 - p(t, back + 0.25, 0.35, glide));
  const inn = p(t, at + 0.25, 0.35, glide) * (1 - p(t, back, 0.3, glide));
  return [1 - out, inn];
}
