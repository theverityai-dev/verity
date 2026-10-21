import React from "react";
import { AbsoluteFill } from "remotion";
import { HUE, STATE, V } from "../film/layout";
import { TextColumn } from "../film/engine";
import { glide, p, useTime } from "../film/ease";
import { sceneLength, word } from "../film/timeline";
import { addSfx } from "../film/sfx";
import { AppWindow, Crumb } from "../ui/shell";
import { Icon } from "../ui/icons";
import { Badge, Button, LargeTitle, Panel, StateBadge, StatTile, tab, ui } from "../ui/kit";
import { DEALS, HERO_DEAL, PIPELINE_STAGES, PIPELINE_TILES, dateText, inr } from "../content/fixture";
import { ProductShot, WIN, pageChange, press, swap } from "./common";

const T = {
  deal: word("s12p", "v26", "deal"),
  value: word("s12p", "v26", "value"),
  follow: word("s12p", "v26", "follow"),
  when: word("s12p", "v26", "when"),
  // The recogniser hears "won" as "one"; the beat is the same sound.
  won: word("s12p", "v26", "one"),
  opens: word("s12p", "v26", "opens"),
  job: word("s12p", "v26", "job"),
  carrying: word("s12p", "v26", "carrying"),
};
const SHEET_IN = T.opens;
const SUBMIT = T.job + 0.35;
const TO_JOB = T.carrying - 0.1;

addSfx([
  { scene: "s12p", at: T.value, name: "tick", gain: 0.3 },
  { scene: "s12p", at: T.follow, name: "tick", gain: 0.3 },
  { scene: "s12p", at: T.when - 0.35, name: "whoosh", gain: 0.22 },
  { scene: "s12p", at: T.won, name: "confirm", gain: 0.4 },
  { scene: "s12p", at: SHEET_IN, name: "press", gain: 0.4 },
  { scene: "s12p", at: SUBMIT, name: "press", gain: 0.4 },
  { scene: "s12p", at: TO_JOB, name: "paper", gain: 0.3 },
]);

const hero = DEALS.find((d) => d.ref === HERO_DEAL.ref)!;

const Board: React.FC<{ t: number }> = ({ t }) => (
  <AppWindow active="pipeline" collapsed width={WIN.w}>
    <LargeTitle>Pipeline</LargeTitle>
    <div style={{ fontSize: 15, color: V.text2, margin: "4px 0 16px" }}>Every open deal by stage, what it is worth, and what to move next.</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, maxWidth: 940 }}>
      <StatTile icon="layers" hue="blue" value={inr(PIPELINE_TILES.open, { compact: true })} label="Open pipeline" highlight={swap(t, T.value - 0.2) * (1 - swap(t, T.follow - 0.2))} />
      <StatTile icon="gauge" hue="indigo" value={inr(Math.round(PIPELINE_TILES.weighted), { compact: true })} label="Weighted forecast" />
      <StatTile icon="check" hue="green" value={inr(PIPELINE_TILES.wonThisMonth, { compact: true })} label="Won this month" />
      <StatTile icon="clock" hue="red" value={PIPELINE_TILES.overdue} label="Overdue follow-ups" highlight={swap(t, T.follow - 0.2) * (1 - swap(t, T.when - 0.5))} />
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 180px)", gap: 10, marginTop: 16 }}>
      {PIPELINE_STAGES.map((s, si) => {
        const deals = DEALS.filter((d) => d.stage === s.key);
        const total = deals.reduce((n, d) => n + d.value, 0);
        return (
          <div key={s.key} style={{ background: "rgba(118,118,128,0.08)", borderRadius: 12, padding: 10, minHeight: 330 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "2px 4px 10px" }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{s.label}</span>
              <span style={{ fontSize: 12.5, color: V.text3, ...tab }}>{total ? inr(total, { compact: true }) : ""}</span>
            </div>
            {deals.map((d, i) => {
              const isHero = d.ref === HERO_DEAL.ref;
              const k = p(t, T.deal - 0.6 + (i + si) * 0.06, 0.5, glide);
              return (
                <div
                  key={d.ref}
                  style={{
                    background: V.surface,
                    borderRadius: 10,
                    padding: "10px 11px",
                    marginBottom: 8,
                    opacity: 0.3 + 0.7 * k,
                    boxShadow: isHero ? `inset 0 0 0 ${2 * swap(t, T.when - 0.9)}px ${V.accentLine}` : undefined,
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>{d.name}</div>
                  <div style={{ fontSize: 12.5, color: V.text2, marginTop: 2 }}>{d.company}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 13 }}>
                    <span style={{ ...tab, fontWeight: 500 }}>{inr(d.value, { compact: true })}</span>
                    <span style={{ color: V.text3 }}>{d.ref}</span>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  </AppWindow>
);

const Deal: React.FC<{ t: number }> = ({ t }) => {
  const won = swap(t, T.won);
  const at = won > 0.5 ? 4 : 3;
  const sheet = p(t, SHEET_IN, 0.45, glide) * (1 - p(t, SUBMIT + 0.15, 0.35, glide));
  return (
    <AppWindow
      active="pipeline"
      collapsed
      width={WIN.w}
      overlay={
        sheet > 0 ? (
          <div style={{ position: "absolute", inset: 0, background: `rgba(0,0,0,${0.25 * sheet})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ ...ui, width: 520, borderRadius: 16, background: V.surface, padding: 24, boxShadow: "0 20px 60px rgba(0,0,0,0.3)", opacity: sheet, transform: `translateY(${(1 - sheet) * 24}px)` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 20, fontWeight: 700 }}>Open a job</span>
                <span style={{ width: 30, height: 30, borderRadius: 15, background: V.control, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name="x" size={14} color={V.text2} stroke={2} />
                </span>
              </div>
              <div style={{ fontSize: 14.5, color: V.text2, marginTop: 6, lineHeight: 1.45 }}>The job starts as an enquiry with this deal's name, contact and value. Quotes, tasks and production carry on there.</div>
              {[
                ["Job title", hero.name],
                ["Customer", hero.company],
                ["Due", ""],
              ].map(([l, v]) => (
                <div key={l} style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 13, color: V.text2, marginBottom: 4 }}>{l}</div>
                  <div style={{ height: 40, borderRadius: 10, background: V.control, display: "flex", alignItems: "center", padding: "0 12px", fontSize: 15, color: v ? V.text : V.text3 }}>{v || "dd-mm-yyyy"}</div>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
                <Button variant="primary" size="sm" pressed={press(t, SUBMIT - 0.15)}>Open job</Button>
              </div>
            </div>
          </div>
        ) : undefined
      }
    >
      <Crumb parent="Pipeline" here={HERO_DEAL.ref} />
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <LargeTitle>{hero.name}</LargeTitle>
        <StateBadge state={won > 0.5 ? "completed" : "active"} label={won > 0.5 ? "Won" : "Negotiation"} />
      </div>
      <div style={{ fontSize: 16, color: V.text2, margin: "6px 0 16px" }}>
        {hero.company} · {HERO_DEAL.contact} · source {HERO_DEAL.source}
      </div>
      {/* Stage track: n of m, ordered stages. */}
      <div style={{ background: V.surface, borderRadius: 12, padding: "16px 22px", display: "grid", gridTemplateColumns: `repeat(${PIPELINE_STAGES.length}, 1fr)`, maxWidth: 940 }}>
        {PIPELINE_STAGES.map((s, i) => {
          const done = i < at || (i === 4 && won > 0.5);
          const current = i === at && !(i === 4 && won > 0.5);
          return (
            <div key={s.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, position: "relative" }}>
              {i < PIPELINE_STAGES.length - 1 && <div style={{ position: "absolute", top: 11, left: "50%", width: "100%", height: 2, background: i < at ? V.success : V.track }} />}
              <span style={{ position: "relative", width: 24, height: 24, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", background: done ? V.success : current ? V.accent : V.controlStrong, color: done || current ? "#fff" : V.text2, fontSize: 12, fontWeight: 700 }}>
                {done ? <Icon name="check" size={14} color="#fff" stroke={2.2} /> : i + 1}
              </span>
              <span style={{ fontSize: 13, fontWeight: current || (i === 4 && won > 0.5) ? 600 : 400, color: V.text2 }}>{s.label}</span>
            </div>
          );
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "400px 1fr", gap: 14, marginTop: 14, maxWidth: 940 }}>
        <Panel title="Details" action={won > 0.5 ? <Button variant="primary" size="sm" pressed={press(t, SHEET_IN - 0.15)}>Open a job</Button> : undefined}>
          {[
            ["Value", inr(hero.value)],
            ["Chance of closing", won > 0.5 ? "100%" : "75%"],
            ["Weighted value", inr(won > 0.5 ? hero.value : hero.value * 0.75)],
            ["Expected close", dateText(HERO_DEAL.closes)],
          ].map(([l, v], i) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: i < 3 ? `1px solid ${V.line}` : undefined, fontSize: 15 }}>
              <span style={{ color: V.text2, fontSize: 14 }}>{l}</span>
              <span style={tab}>{v}</span>
            </div>
          ))}
        </Panel>
        <Panel title="Timeline">
          {HERO_DEAL.timeline.map((e, i) => (
            <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: `1px solid ${V.line}` }}>
              <span style={{ width: 22, height: 22, borderRadius: 11, background: HUE.slate.fill, color: HUE.slate.ink, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                <Icon name={e.what === "Follow-up" ? "clock" : e.what === "Call logged" ? "chat" : "route"} size={13} />
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14.5, fontWeight: 500 }}>
                  {e.what} <span style={{ fontWeight: 400, color: V.text2 }}>· {e.detail}</span>
                </div>
                <div style={{ fontSize: 13, color: e.what === "Follow-up" ? STATE.pending.ink : V.text3 }}>
                  {e.who} · {e.at}
                </div>
              </div>
            </div>
          ))}
          {won > 0 && (
            <div style={{ display: "flex", gap: 10, padding: "8px 0", opacity: won }}>
              <span style={{ width: 22, height: 22, borderRadius: 11, background: STATE.completed.fill, color: STATE.completed.ink, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                <Icon name="check" size={13} stroke={2.2} />
              </span>
              <div style={{ fontSize: 14.5, fontWeight: 500 }}>
                Stage moved <span style={{ fontWeight: 400, color: V.text2 }}>· Negotiation → Won</span>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </AppWindow>
  );
};

/** J-0152, opened from the won deal. */
const NewJob: React.FC = () => (
  <AppWindow active="jobs" collapsed width={WIN.w}>
    <Crumb parent="Jobs" here={HERO_DEAL.job} />
    <LargeTitle>{hero.name}</LargeTitle>
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
      <Badge>{HERO_DEAL.job}</Badge>
      <StateBadge state="draft" label="enquiry" />
    </div>
    <div style={{ fontSize: 16, color: V.text2, marginTop: 8 }}>{hero.company}</div>
    <div style={{ maxWidth: 940, marginTop: 18 }}>
      <Panel title="Job">
        {[
          ["Customer", hero.company],
          ["Contact", `${HERO_DEAL.contact}, ${HERO_DEAL.contactEmail}`],
          ["Description", `Opened from ${HERO_DEAL.ref}, won at ${inr(hero.value)}.`],
        ].map(([l, v], i) => (
          <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "11px 0", borderBottom: i < 2 ? `1px solid ${V.line}` : undefined }}>
            <span style={{ fontSize: 14, color: V.text2 }}>{l}</span>
            <span style={{ fontSize: 15 }}>{v}</span>
          </div>
        ))}
      </Panel>
    </div>
  </AppWindow>
);

/**
 * s12p — 07 Pipeline. Where the work comes from (`relationship` capability, Task 128): the board by
 * stage with value and overdue follow-ups, one deal's stage track and logged timeline, the deal won,
 * and "Open a job" (`open_job_from_opportunity`, project/opportunity-link.ts) carrying the name,
 * contact and value into a new job that starts as an enquiry.
 */
export const S12Pipeline: React.FC = () => {
  const t = useTime();
  const len = sceneLength("s12p");
  const [boardK, dealK] = pageChange(t, T.when - 0.35);
  const [, jobK] = pageChange(t, TO_JOB);
  return (
    <AbsoluteFill>
      <ProductShot
        keys={[
          [0, { s: 1 }],
          [T.deal - 0.5, { s: 1.04, y: -20 }, 1.6],
          [T.when - 0.35, { s: 1.06, y: -30 }, 1.0],
        ]}
        origin={[WIN.x, WIN.y + 300]}
      >
        <div style={{ position: "relative" }}>
          <div style={{ opacity: boardK }}>
            <Board t={t} />
          </div>
          {dealK > 0 && jobK < 1 && (
            <div style={{ position: "absolute", inset: 0, opacity: dealK * (1 - jobK) }}>
              <Deal t={t} />
            </div>
          )}
          {jobK > 0 && (
            <div style={{ position: "absolute", inset: 0, opacity: jobK }}>
              <NewJob />
            </div>
          )}
        </div>
      </ProductShot>
      <TextColumn n="07" label="Pipeline" lines={["Tomorrow's work,", "already in view."]} labelAt={0.6} statementAt={T.deal} outAt={len - 0.35} />
    </AbsoluteFill>
  );
};
