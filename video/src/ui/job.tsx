import React from "react";
import { V, type StateKey } from "../film/layout";
import { JOB, dateText } from "../content/fixture";
import { Badge, Button, LargeTitle, StateBadge, Stepper } from "./kit";
import { Crumb } from "./shell";

/**
 * The job page as `src/app/(shell)/jobs/[id]/page.tsx` lays it out (see the 1440px reference):
 * breadcrumb, Large Title, reference and state pills, customer and promised date, actions, the
 * lifecycle stepper, then tabs.
 */
export const JobHeader: React.FC<{
  state: StateKey;
  stateLabel: string;
  actions?: React.ReactNode;
}> = ({ state, stateLabel, actions }) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: 24, marginBottom: 18 }}>
    <div>
      <Crumb parent="Jobs" here={JOB.ref} />
      <LargeTitle>{JOB.title}</LargeTitle>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        <Badge>{JOB.ref}</Badge>
        <StateBadge state={state} label={stateLabel} />
      </div>
      <div style={{ fontSize: 16, color: V.text2, marginTop: 8 }}>
        {JOB.customer} · promised by {dateText(JOB.promised)}
      </div>
    </div>
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", paddingTop: 30 }}>{actions}</div>
  </div>
);

export const JobStepper: React.FC<{ at: number }> = ({ at }) => <Stepper steps={JOB.steps} at={at} />;

export const Tabs: React.FC<{ tabs: Array<[string, number?]>; active: string }> = ({ tabs, active }) => (
  <div style={{ display: "flex", gap: 6, borderBottom: `1px solid ${V.line}`, margin: "18px 0 16px" }}>
    {tabs.map(([name, count]) => {
      const on = name === active;
      return (
        <div
          key={name}
          style={{
            padding: "10px 14px",
            fontSize: 15,
            fontWeight: on ? 600 : 400,
            color: on ? V.text : V.text2,
            borderBottom: on ? `2px solid ${V.accent}` : "2px solid transparent",
            marginBottom: -1,
            display: "flex",
            gap: 8,
          }}
        >
          {name}
          {count !== undefined && <span style={{ color: V.text3, fontVariantNumeric: "tabular-nums" }}>{count}</span>}
        </div>
      );
    })}
  </div>
);

export const JOB_TABS: Array<[string, number?]> = [
  ["Overview"],
  ["Quote", 2],
  ["Production", 1],
  ["Tasks", 5],
  ["Milestones", 4],
  ["Time", 9],
  ["Billing", 2],
  ["Costs"],
];

export { Button };
