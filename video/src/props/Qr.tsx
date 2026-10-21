import React from "react";
import { random } from "remotion";

/**
 * A QR-style symbol for the nameplate and the passport. It is drawn, not encoded: three finder
 * patterns and seeded modules. It points nowhere, deliberately; the film never shows a scannable
 * link that could be mistaken for a real passport.
 */
export const Qr: React.FC<{ size: number; color?: string; seed?: string }> = ({ size, color = "#111", seed = "passport" }) => {
  const n = 25;
  const cell = size / n;
  const finder = (x: number, y: number) => x < 7 && y < 7;
  const isFinder = (x: number, y: number) => finder(x, y) || finder(n - 1 - x, y) || finder(x, n - 1 - y);
  const cells: React.ReactNode[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (isFinder(x, y)) continue;
      if (random(`${seed}-${x}-${y}`) > 0.52) cells.push(<rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={cell + 0.3} height={cell + 0.3} fill={color} />);
    }
  }
  const eye = (x: number, y: number) => (
    <g key={`${x}-${y}`}>
      <rect x={x * cell} y={y * cell} width={7 * cell} height={7 * cell} fill={color} />
      <rect x={(x + 1) * cell} y={(y + 1) * cell} width={5 * cell} height={5 * cell} fill="#fff" />
      <rect x={(x + 2) * cell} y={(y + 2) * cell} width={3 * cell} height={3 * cell} fill={color} />
    </g>
  );
  return (
    <svg width={size} height={size} style={{ display: "block", background: "#fff" }}>
      {cells}
      {eye(0, 0)}
      {eye(n - 7, 0)}
      {eye(0, n - 7)}
    </svg>
  );
};
