import React from "react";
import { AbsoluteFill } from "remotion";
import { V } from "../film/layout";
import { Camera } from "../film/engine";
import { glide, mix, p, smooth, useTime } from "../film/ease";
import { sceneLength } from "../film/timeline";
import { AppWindow } from "../ui/shell";
import { Badge, DefRow, Panel, StateBadge, ui } from "../ui/kit";
import { JOB_TABS, JobHeader, JobStepper, Tabs } from "../ui/job";
import { CUSTOMER, JOB, QUESTIONS, dateText } from "../content/fixture";
import { PHONE_POS } from "./S02Questions";

/** Where the window lands, and where its title sits on screen at that scale. */
const WIN_AT = { x: 600, y: 150, s: 0.8 };
const TITLE_AT = { x: WIN_AT.x + 270 * WIN_AT.s, y: WIN_AT.y + 104 * WIN_AT.s };

/**
 * s03 — A record of its own. The transformation of the film: the six questions lift out of the
 * phone, converge into one card, and the card becomes the job record as the window assembles
 * around it. Focal point: the converging cards, then the job title. No statement (v04 carries it).
 */
export const S03Record: React.FC = () => {
  const t = useTime();
  const len = sceneLength("s03");
  const lift = p(t, 0.0, 0.9, glide);
  const merge = p(t, 0.6, 1.1, smooth);
  const toTitle = p(t, 1.5, 1.2, smooth);
  const win = p(t, 1.9, 1.3, glide);
  const cardsGone = p(t, 2.6, 0.5, smooth);
  const push = p(t, 3.2, len - 3.2, smooth);

  // Phone notification geometry from s02 (newest on top, 102 px apart).
  const startX = PHONE_POS.x + 27;
  const startY = PHONE_POS.y + 13 + 300;
  return (
    <AbsoluteFill>
      <Camera move={{ s: 1 + 0.16 * push, x: -60 * push, y: 40 * push }} origin={[TITLE_AT.x, TITLE_AT.y]}>
        <div
          style={{
            position: "absolute",
            left: WIN_AT.x,
            top: WIN_AT.y,
            transform: `scale(${WIN_AT.s * (0.96 + 0.04 * win)})`,
            transformOrigin: `${270}px ${104}px`,
            opacity: win,
            filter: win < 1 ? `blur(${(1 - win) * 6}px)` : undefined,
          }}
        >
          <AppWindow active="jobs">
            <JobHeader state="draft" stateLabel="enquiry" />
            <JobStepper at={0} />
            <Tabs tabs={JOB_TABS.slice(0, 1).concat([["Quote", 0], ["Production", 0], ["Tasks", 0], ["Milestones", 0]])} active="Overview" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Panel title="Job">
                <DefRow term="Customer" value={CUSTOMER.name} />
                <DefRow term="Contact" value={CUSTOMER.contact} />
                <DefRow term="Priority" value={JOB.priority} />
                <DefRow term="Delivery promised" value={dateText(JOB.promised)} last />
              </Panel>
              <Panel title="History">
                <div style={{ fontSize: 15, fontWeight: 500 }}>Created</div>
                <div style={{ fontSize: 14, color: V.text2, marginTop: 2 }}>enquiry · {dateText(JOB.opened)}</div>
              </Panel>
            </div>
          </AppWindow>
        </div>

        {/* The questions, lifting out of the phone and converging on the title. */}
        {QUESTIONS.map((q, i) => {
          const order = QUESTIONS.length - 1 - i; // newest (last) is on top
          const x0 = startX;
          const y0 = startY + order * 102;
          const xm = mix(x0, TITLE_AT.x - 10, merge);
          const ym = mix(y0 - 20 * lift, TITLE_AT.y - 30, merge);
          const fadeOthers = i === QUESTIONS.length - 1 ? 1 : 1 - merge * 0.9;
          const o = (1 - cardsGone) * fadeOthers;
          if (o <= 0.01) return null;
          const w = mix(416, 760, toTitle);
          return (
            <div
              key={q.from}
              style={{
                ...ui,
                position: "absolute",
                left: xm,
                top: ym,
                width: w,
                opacity: o,
                borderRadius: mix(24, 12, toTitle),
                padding: "14px 16px",
                background: `rgba(${Math.round(mix(245, 255, toTitle))}, ${Math.round(mix(245, 255, toTitle))}, ${Math.round(mix(247, 255, toTitle))}, ${mix(0.84, 1, toTitle)})`,
                boxShadow: `0 ${mix(8, 18, merge)}px ${mix(20, 50, merge)}px rgba(0,0,0,${0.25 * (1 - toTitle) + 0.2})`,
              }}
            >
              <div style={{ opacity: Math.max(0, 1 - toTitle * 2.5), position: toTitle > 0.3 ? "absolute" : "relative" }}>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{q.from}</div>
                <div style={{ fontSize: 17, marginTop: 3 }}>{q.text}</div>
              </div>
              {toTitle > 0 && (
                <div style={{ opacity: toTitle }}>
                  <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "0.005em" }}>{JOB.title}</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                    <Badge>{JOB.ref}</Badge>
                    <StateBadge state="draft" label="enquiry" />
                    <span style={{ fontSize: 15, color: V.text2 }}>{CUSTOMER.name}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </Camera>
    </AbsoluteFill>
  );
};
