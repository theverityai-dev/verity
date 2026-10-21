/**
 * A tiny isometric drawing kit: 3D boxes and cylinders, in millimetres, projected to SVG paths
 * with a fill that hides what is behind (painter's order) and strokes that show only what a
 * draughtsman would draw. Deterministic and computed once.
 *
 * Screen: sx = (x - y) cos30, sy = (x + y) sin30 - z. The viewer sits at +x, +y, +z, so the
 * visible faces are +x, +y and +z and a point is nearer the larger x + y + z is.
 */

export type V3 = [number, number, number];
export type V2 = [number, number];

const C = Math.cos(Math.PI / 6);
const S = Math.sin(Math.PI / 6);
const VIEW: V3 = [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)];

export const proj = ([x, y, z]: V3): V2 => [(x - y) * C, (x + y) * S - z];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const f = (n: number) => n.toFixed(1);
const poly = (pts: V2[], close = true) => `M${pts.map((p) => `${f(p[0])} ${f(p[1])}`).join(" L")}${close ? " Z" : ""}`;

function hull(points: V2[]): V2[] {
  const pts = [...points].sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  const cross = (o: V2, a: V2, b: V2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: V2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: V2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** A drawn solid: one fill (occludes what is behind) and its strokes. */
export type Solid = { id: string; group: string; depth: number; fill: string; lines: string[]; fine?: string[] };

export function box(id: string, group: string, [x0, y0, z0]: V3, [x1, y1, z1]: V3): Solid {
  const v: V3[] = [
    [x0, y0, z0], [x1, y0, z0], [x0, y1, z0], [x1, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x0, y1, z1], [x1, y1, z1],
  ];
  const h = hull(v.map(proj));
  const near: V3 = [x1, y1, z1];
  const lines = [poly(h), poly([proj([x0, y1, z1]), proj(near), proj([x1, y0, z1])], false), poly([proj(near), proj([x1, y1, z0])], false)];
  return { id, group, depth: (x0 + x1 + y0 + y1 + z0 + z1) / 2, fill: poly(h), lines };
}

type Axis = "x" | "y" | "z";
const AX: Record<Axis, V3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const PERP: Record<Axis, [V3, V3]> = {
  x: [[0, 1, 0], [0, 0, 1]],
  y: [[1, 0, 0], [0, 0, 1]],
  z: [[1, 0, 0], [0, 1, 0]],
};

function ring(axis: Axis, centre: V3, at: number, r: number, n = 48): V3[] {
  const [u, w] = PERP[axis];
  const a = AX[axis];
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push([
      centre[0] + a[0] * at + (u[0] * Math.cos(t) + w[0] * Math.sin(t)) * r,
      centre[1] + a[1] * at + (u[1] * Math.cos(t) + w[1] * Math.sin(t)) * r,
      centre[2] + a[2] * at + (u[2] * Math.cos(t) + w[2] * Math.sin(t)) * r,
    ]);
  }
  return out;
}

/** Only the half of a ring that faces the viewer, as an open polyline. */
function frontHalf(axis: Axis, centre: V3, at: number, r: number): string {
  const pts = ring(axis, centre, at, r, 96);
  const a = AX[axis];
  const c: V3 = [centre[0] + a[0] * at, centre[1] + a[1] * at, centre[2] + a[2] * at];
  const keep = pts.map((p) => dot([p[0] - c[0], p[1] - c[1], p[2] - c[2]], VIEW) > 0);
  // Rotate so the polyline starts at a hidden-to-visible boundary and runs unbroken.
  const start = keep.findIndex((k, i) => k && !keep[(i + keep.length - 1) % keep.length]);
  const seq: V2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const j = (start + i) % pts.length;
    if (!keep[j]) break;
    seq.push(proj(pts[j]));
  }
  return poly(seq, false);
}

/**
 * A cylinder along an axis from `from` to `to` (mm along that axis, relative to `centre`).
 * Draws the silhouette, the near end face, and optional rings (fins, flange edges, bolts).
 */
export function cyl(
  id: string,
  group: string,
  axis: Axis,
  centre: V3,
  from: number,
  to: number,
  r: number,
  opts: { rings?: number[]; bolts?: number; boltR?: number; fineRings?: number[] } = {},
): Solid {
  const a = ring(axis, centre, from, r);
  const b = ring(axis, centre, to, r);
  const h = hull([...a, ...b].map(proj));
  const nearAt = dot(AX[axis], VIEW) > 0 ? Math.max(from, to) : Math.min(from, to);
  const lines = [poly(h), poly(ring(axis, centre, nearAt, r, 72).map(proj))];
  for (const at of opts.rings ?? []) lines.push(frontHalf(axis, centre, at, r));
  const fine: string[] = [];
  for (const at of opts.fineRings ?? []) fine.push(frontHalf(axis, centre, at, r));
  if (opts.bolts) {
    const br = opts.boltR ?? r * 0.8;
    const holes = ring(axis, centre, nearAt, br, opts.bolts);
    const hole = Math.max(r * 0.06, 6);
    for (const hc of holes) {
      const local = ring(axis, hc, 0, hole, 16).map(proj);
      fine.push(poly(local));
    }
  }
  const mid = (from + to) / 2;
  const ax = AX[axis];
  const depth = centre[0] + centre[1] + centre[2] + (ax[0] + ax[1] + ax[2]) * mid;
  return { id, group, depth, fill: poly(h), lines, fine };
}

/** Bounding box of every fill, for framing. */
export function bounds(solids: Solid[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of solids) {
    for (const m of s.fill.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)) {
      const x = Number(m[1]), y = Number(m[2]);
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
