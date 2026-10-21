import React from "react";
import { AbsoluteFill } from "remotion";
import { Grade, World } from "../film/engine";
import { Skid } from "../props/Skid";
import { AppWindow } from "../ui/shell";
import { LargeTitle, StatTile, StateBadge } from "../ui/kit";

/** Development check frames: the skid on dark and on paper, and the app window at 1x. */
export const Lab: React.FC<{ which: "skid" | "paper" | "window" }> = ({ which }) => (
  <AbsoluteFill>
    <World />
    {which === "skid" && (
      <div style={{ position: "absolute", left: 160, top: 60 }}>
        <Skid width={1600} />
      </div>
    )}
    {which === "paper" && (
      <div style={{ position: "absolute", left: 160, top: 60, background: "#F4F1EA", padding: 30 }}>
        <Skid width={1500} mode="paper" />
      </div>
    )}
    {which === "window" && (
      <div style={{ position: "absolute", left: 60, top: 40, transform: "scale(0.95)", transformOrigin: "0 0" }}>
        <AppWindow active="summary">
          <LargeTitle>Summary</LargeTitle>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginTop: 24 }}>
            <StatTile icon="money" hue="teal" value="₹74.3 L" label="Confirmed orders" hint="Accepted quotes, 6 jobs in work" />
            <StatTile icon="quote" hue="indigo" value="₹31.2 L" label="Quotes awaiting reply" hint="3 sent, not yet accepted" />
            <StatTile icon="enquiry" hue="olive" value="2" label="New enquiries" hint="Not quoted yet" />
            <StatTile icon="flag" hue="red" value="1" label="Late deliveries" hint="Past the promised date" />
          </div>
          <div style={{ marginTop: 20 }}><StateBadge state="active" label="in progress" /></div>
        </AppWindow>
      </div>
    )}
    <Grade />
  </AbsoluteFill>
);
