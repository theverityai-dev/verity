import React from "react";
import { AbsoluteFill } from "remotion";
import { FEATURES, FONT, SAFE } from "./layout";
import { useTime } from "./ease";
import { captionLines } from "./caption-lines";

/**
 * Burned-in captions for the review cut (the master ships clean, with SRT and VTT sidecars).
 * Bottom-centre, inside the safe area, two lines at most, white on a soft dark plate.
 */
export const Captions: React.FC = () => {
  const t = useTime();
  const line = captionLines.find((c) => t >= c.start && t <= c.end);
  if (!line) return null;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: SAFE.y - 30 }}>
      <div
        style={{
          fontFamily: FONT,
          fontFeatureSettings: FEATURES,
          fontSize: 34,
          lineHeight: 1.3,
          fontWeight: 500,
          color: "#FFFFFF",
          background: "rgba(8, 11, 17, 0.72)",
          borderRadius: 10,
          padding: "8px 18px",
          maxWidth: 1300,
          textAlign: "center",
        }}
      >
        {line.text}
      </div>
    </AbsoluteFill>
  );
};
