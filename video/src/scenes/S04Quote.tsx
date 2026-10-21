import React from "react";
import { AbsoluteFill } from "remotion";
import { V } from "../film/layout";
import { TextColumn } from "../film/engine";
import { useTime } from "../film/ease";
import { cue, sceneLength, word } from "../film/timeline";
import { addSfx } from "../film/sfx";
import { AppWindow } from "../ui/shell";
import { Badge, Button, Footnote, Panel, StateBadge, StatTile, tab } from "../ui/kit";
import { JOB_TABS, JobHeader, JobStepper, Tabs } from "../ui/job";
import { AGREED, QUOTES, dateText, inr } from "../content/fixture";
import { ProductShot, Reveal, WIN, press, swap } from "./common";

const v06 = cue("s04", "v06");
const T = {
  r1: word("s04", "v05", "specification"),
  r2: word("s04", "v06", "revisions"),
  replaced: word("s04", "v06", "revisions") + 0.9,
  approve: word("s04", "v06", "approves"),
  macro: word("s04", "v06", "fixed") - 0.4,
  pullBack: v06.end + 0.2,
  statement: v06.end + 0.7,
};

addSfx([
  { scene: "s04", at: T.r1, name: "paper", gain: 0.4 },
  { scene: "s04", at: T.r2, name: "paper", gain: 0.4 },
  { scene: "s04", at: T.approve, name: "press", gain: 0.5 },
  { scene: "s04", at: T.approve + 0.25, name: "confirm", gain: 0.45 },
]);

/** The order-value tile's centre on screen, for the macro push (window x 790 + 106 + 656 + 171). */
const TILE: [number, number] = [WIN.x + 933, WIN.y + 80 + 297 + 70];

const QuoteLines: React.FC<{ rev: 0 | 1 }> = ({ rev }) => (
  <div>
    {QUOTES[rev].lines.map((l) => (
      <div key={l.what} style={{ display: "grid", gridTemplateColumns: "1fr 40px 120px", gap: 12, padding: "9px 0", borderBottom: `1px solid ${V.line}`, fontSize: 15 }}>
        <span>{l.what}</span>
        <span style={{ color: V.text2, textAlign: "right", ...tab }}>{l.qty}</span>
        <span style={{ textAlign: "right", ...tab }}>{inr(l.qty * l.unit)}</span>
      </div>
    ))}
    <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0 4px", fontSize: 17, fontWeight: 600 }}>
      <span>Total</span>
      <span style={tab}>{inr(QUOTES[rev].total)}</span>
    </div>
  </div>
);

/**
 * s04 — 01 Enquiry to quote. Focal point: the quote revisions, then the agreed value.
 * Statement is the consequence ("stays approved"), not the UI's words.
 * Camera: window settles, slow push to the quote column, then a macro push onto the order value.
 */
export const S04Quote: React.FC = () => {
  const t = useTime();
  const len = sceneLength("s04");
  const quoted = swap(t, T.r1);
  const approved = swap(t, T.approve + 0.25);
  const replaced = swap(t, T.replaced);
  const state = approved > 0.5 ? { s: "pending" as const, l: "approved" } : quoted > 0.5 ? { s: "pending" as const, l: "quoted" } : { s: "draft" as const, l: "enquiry" };
  const step = approved > 0.5 ? 2 : quoted > 0.5 ? 1 : 0;
  return (
    <AbsoluteFill>
      <ProductShot
        keys={[
          [0, { s: 1 }],
          [3.0, { s: 1.1, x: -20, y: -40 }, 2.0],
          [T.macro, { s: 1.55, x: -260, y: -60 }, 1.8],
          [T.pullBack, { s: 1.0, x: 0, y: 0 }, 1.6],
        ]}
        origin={TILE}
      >
        <AppWindow active="jobs" collapsed width={WIN.w}>
          <JobHeader state={state.s} stateLabel={state.l} />
          <JobStepper at={step} />
          <Tabs tabs={JOB_TABS.slice(0, 5)} active="Quote" />
          <div style={{ display: "grid", gridTemplateColumns: "640px 1fr", gap: 16, alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {quoted <= 0 && (
                <Panel title="No quote yet">
                  <Footnote>Add the first revision when the specification is agreed.</Footnote>
                </Panel>
              )}
              <Reveal at={T.r2}>
                <Panel
                  title={
                    <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      Revision 2 <StateBadge state={approved > 0.5 ? "completed" : "pending"} label={approved > 0.5 ? "approved" : "sent"} />
                    </span>
                  }
                >
                  <QuoteLines rev={1} />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
                    <Footnote>Sent {dateText(QUOTES[1].sent)}</Footnote>
                    {approved < 1 && (
                      <Button variant="primary" size="sm" pressed={press(t, T.approve)} style={{ opacity: 1 - approved }}>
                        Customer approved the quote
                      </Button>
                    )}
                  </div>
                </Panel>
              </Reveal>
              <Reveal at={T.r1}>
                <Panel
                  title={
                    <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      Revision 1 {replaced > 0.5 ? <Badge>Replaced</Badge> : <StateBadge state="pending" label="sent" />}
                    </span>
                  }
                  style={{ opacity: 1 - 0.35 * replaced }}
                >
                  {replaced < 0.5 ? (
                    <QuoteLines rev={0} />
                  ) : (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15 }}>
                      <span style={{ color: V.text2 }}>Sent {dateText(QUOTES[0].sent)}</span>
                      <span style={tab}>{inr(QUOTES[0].total)}</span>
                    </div>
                  )}
                </Panel>
              </Reveal>
            </div>
            <Reveal at={T.approve + 0.3} y={16}>
              <StatTile
                icon="lock"
                hue="green"
                value={inr(AGREED)}
                label="Order value"
                hint={`From the approved quote, revision 2, ${dateText(QUOTES[1].approved)}`}
                highlight={swap(t, T.macro + 0.6) * (1 - swap(t, T.pullBack))}
              />
            </Reveal>
          </div>
        </AppWindow>
      </ProductShot>
      <TextColumn n="01" label="Enquiry to quote" lines={["The approved", "figure stays", "approved."]} labelAt={0.8} statementAt={T.statement} outAt={len - 0.35} />
    </AbsoluteFill>
  );
};
