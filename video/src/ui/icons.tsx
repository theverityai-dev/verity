import React from "react";

/**
 * Line glyphs drawn for the film in the product's style (1.6 stroke, round caps, 20-unit box),
 * matching the sidebar and stat-tile glyphs in the 1440px reference screenshots. They are not the
 * product's icon files; they are redrawn so the film owns its assets.
 */
const P: Record<string, React.ReactNode> = {
  home: <path d="M3.5 9.2 10 4l6.5 5.2V16a1 1 0 0 1-1 1h-3.3v-4.4H7.8V17H4.5a1 1 0 0 1-1-1z" />,
  people: (
    <>
      <circle cx="7.5" cy="7" r="2.6" />
      <path d="M2.8 16c.5-2.6 2.4-4 4.7-4s4.2 1.4 4.7 4" />
      <path d="M12.6 4.7a2.5 2.5 0 0 1 0 4.7M14.2 12.2c1.6.4 2.7 1.7 3 3.8" />
    </>
  ),
  list: <path d="M7.5 5.5h9M7.5 10h9M7.5 14.5h9M3.6 5.5h.8M3.6 10h.8M3.6 14.5h.8" />,
  orders: <path d="M3.5 16.5h13M5 16.5v-5h3v5M8 16.5V9l3 2V8.5l3 2v6" />,
  doc: (
    <>
      <path d="M5 3h7l3.5 3.5V17H5z" />
      <path d="M7.5 9.5h5M7.5 12.5h5M11.8 3v3.7h3.7" />
    </>
  ),
  pulse: <path d="M2.5 10.5h3.2l2-4.5 3.4 9 2-4.5h4.4" />,
  route: (
    <>
      <circle cx="5" cy="5" r="1.8" />
      <circle cx="15" cy="15" r="1.8" />
      <path d="M6.8 5h5.7a2.5 2.5 0 0 1 0 5h-5a2.5 2.5 0 0 0 0 5h5.7" />
    </>
  ),
  grid: <path d="M3.5 3.5h5.2v5.2H3.5zM11.3 3.5h5.2v5.2h-5.2zM3.5 11.3h5.2v5.2H3.5zM11.3 11.3h5.2v5.2h-5.2z" />,
  stack: <path d="M3 5.5h14v3.5H3zM3 11h14v3.5H3zM6 7.2h3M6 12.8h3" />,
  cube: <path d="M10 2.8 16.5 6.4v7.2L10 17.2l-6.5-3.6V6.4zM3.5 6.4 10 10l6.5-3.6M10 10v7.2" />,
  book: <path d="M4.5 3.5h9.8a1 1 0 0 1 1 1V17H5.6a1.1 1.1 0 0 1-1.1-1.1zM4.5 14.4c0-.6.5-1.1 1.1-1.1h9.7M7.5 7h5" />,
  person: (
    <>
      <circle cx="10" cy="6.5" r="3" />
      <path d="M4.2 17c.6-3 3-4.8 5.8-4.8s5.2 1.8 5.8 4.8" />
    </>
  ),
  search: (
    <>
      <circle cx="8.8" cy="8.8" r="5" />
      <path d="m12.6 12.6 4 4" />
    </>
  ),
  sun: (
    <>
      <circle cx="10" cy="10" r="3.2" />
      <path d="M10 2.5v1.6M10 15.9v1.6M2.5 10h1.6M15.9 10h1.6M4.7 4.7l1.1 1.1M14.2 14.2l1.1 1.1M4.7 15.3l1.1-1.1M14.2 5.8l1.1-1.1" />
    </>
  ),
  chat: <path d="M3.5 5a1.5 1.5 0 0 1 1.5-1.5h10A1.5 1.5 0 0 1 16.5 5v7a1.5 1.5 0 0 1-1.5 1.5H9l-3.7 3v-3H5A1.5 1.5 0 0 1 3.5 12zM7 7.5h6M7 10h4" />,
  bell: <path d="M5.5 13.5V9a4.5 4.5 0 0 1 9 0v4.5l1.3 1.5H4.2zM8.3 16.8a1.9 1.9 0 0 0 3.4 0" />,
  check: <path d="m5 10.4 3.2 3.1L15 6.6" />,
  flag: <path d="M5.5 17V3.5M5.5 4h8.8l-1.8 3.4 1.8 3.4H5.5" />,
  clock: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 6.5V10l2.4 1.6" />
    </>
  ),
  layers: <path d="M10 3.5 17 7l-7 3.5L3 7zM3 10.5l7 3.5 7-3.5M3 14l7 3.5 7-3.5" />,
  clipboard: (
    <>
      <path d="M7 4.5H5.5v12.5h9V4.5H13" />
      <path d="M7.2 3.2h5.6v2.6H7.2zM7.6 11l1.8 1.8 3.2-3.4" />
    </>
  ),
  box: <path d="M3.5 6.5 10 3.3l6.5 3.2v7L10 16.7l-6.5-3.2zM3.5 6.5 10 9.7l6.5-3.2M10 9.7v7M6.8 4.9l6.5 3.2" />,
  undo: <path d="M7.5 6 4.5 9l3 3M4.8 9h7.2a3.5 3.5 0 0 1 0 7H9" />,
  pause: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M8.5 7.5v5M11.5 7.5v5" />
    </>
  ),
  chevronRight: <path d="m8 5 5 5-5 5" />,
  chevronLeft: <path d="m12 5-5 5 5 5" />,
  lock: (
    <>
      <path d="M5.5 9h9v7.5h-9z" />
      <path d="M7.3 9V6.6a2.7 2.7 0 0 1 5.4 0V9" />
    </>
  ),
  camera: (
    <>
      <path d="M3 6.8h3l1.4-2h5.2l1.4 2h3v9H3z" />
      <circle cx="10" cy="11.2" r="2.8" />
    </>
  ),
  truck: (
    <>
      <path d="M2.5 5.5h9v8h-9zM11.5 8h3.2l2.8 3v2.5h-6" />
      <circle cx="6" cy="14.8" r="1.5" />
      <circle cx="14.5" cy="14.8" r="1.5" />
    </>
  ),
  money: (
    <>
      <path d="M2.8 5.8h14.4v8.4H2.8z" />
      <circle cx="10" cy="10" r="2" />
      <path d="M5.3 8v4M14.7 8v4" />
    </>
  ),
  quote: <path d="M5 3h7l3.5 3.5V17H5zM7.5 10h5M7.5 13h3M11.8 3v3.7h3.7" />,
  enquiry: <path d="M3.5 5a1.5 1.5 0 0 1 1.5-1.5h10A1.5 1.5 0 0 1 16.5 5v7a1.5 1.5 0 0 1-1.5 1.5H9l-3.7 3v-3H5A1.5 1.5 0 0 1 3.5 12zM8.5 7.2a1.6 1.6 0 1 1 2.2 1.5c-.5.2-.7.6-.7 1.1M10 11.6v.1" />,
  shield: <path d="M10 2.8 16 5v4.6c0 3.6-2.5 6.3-6 7.6-3.5-1.3-6-4-6-7.6V5zM7.3 9.8l1.9 1.9 3.6-3.8" />,
  gauge: (
    <>
      <path d="M3.5 13.5a6.5 6.5 0 1 1 13 0" />
      <path d="m10 13.5 3-4" />
    </>
  ),
  wrench: <path d="M12.5 3.2a3.8 3.8 0 0 0-3.6 5L3.6 13.5a1.6 1.6 0 0 0 2.3 2.3l5.3-5.3a3.8 3.8 0 0 0 5-3.6l-2.3 2.3-2.4-.6-.6-2.4z" />,
  plus: <path d="M10 4.5v11M4.5 10h11" />,
  x: <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />,
  key: (
    <>
      <circle cx="7" cy="12.5" r="3.2" />
      <path d="m9.3 10.2 6.2-6.2M13.3 6.2l1.8 1.8M11.6 7.9l1.4 1.4" />
    </>
  ),
};

export type IconName = keyof typeof P;

export const Icon: React.FC<{ name: IconName; size?: number; color?: string; stroke?: number; style?: React.CSSProperties }> = ({
  name,
  size = 20,
  color = "currentColor",
  stroke = 1.6,
  style,
}) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flex: "none", ...style }}>
    {P[name]}
  </svg>
);
