import React from "react";
import { AbsoluteFill } from "remotion";
import { V } from "../film/layout";
import { TextColumn } from "../film/engine";
import { glide, mix, p, smooth, useTime } from "../film/ease";
import { cue, sceneLength, word } from "../film/timeline";
import { addSfx } from "../film/sfx";
import { AppWindow, Crumb } from "../ui/shell";
import { Badge, Footnote, LargeTitle, Panel, StateBadge, TableHead, TableRow, tab } from "../ui/kit";
import { Icon } from "../ui/icons";
import { Sheet } from "../props/Sheet";
import { BOM, DRAWING, JOB, ORDER, dateText } from "../content/fixture";
import { ProductShot, Reveal, WIN, pageChange, swap } from "./common";

const v09 = cue("s06", "v09");
const T = {
  released: word("s06", "v08", "releases") + 0.3,
  supersedes: word("s06", "v08", "supersedes"),
  flight: word("s06", "v08", "supersedes") + 1.0,
  linked: word("s06", "v08", "linked"),
  exact: word("s06", "v08", "exact"),
  toOrder: v09.start - 0.8,
  scales: word("s06", "v09", "scales"),
  copied: word("s06", "v09", "copied"),
};

addSfx([
  { scene: "s06", at: T.released, name: "stamp", gain: 0.45 },
  { scene: "s06", at: T.supersedes, name: "tick", gain: 0.3 },
  { scene: "s06", at: T.flight, name: "whoosh", gain: 0.3 },
  { scene: "s06", at: T.linked, name: "tick", gain: 0.35 },
  { scene: "s06", at: T.toOrder, name: "whoosh", gain: 0.25 },
  { scene: "s06", at: T.scales, name: "tick", gain: 0.3 },
]);

/** Screen position of the file row in the Revisions panel, where the sheet lands. */
const FILE_ROW = { x: WIN.x + 130, y: WIN.y + 80 + 128 + 202, w: 40 };

const DocumentPage: React.FC<{ t: number }> = ({ t }) => {
  const released = swap(t, T.released);
  const superseded = swap(t, T.supersedes);
  const fileIn = swap(t, T.flight + 1.0);
  return (
    <AppWindow active="documents" collapsed width={WIN.w}>
      <Crumb parent="Documents" here={DRAWING.number} />
      <LargeTitle>{DRAWING.title}</LargeTitle>
      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0 18px" }}>
        <Badge>{DRAWING.number}</Badge>
        <span style={{ fontSize: 15, color: V.text2 }}>{DRAWING.type} · Internal</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "600px 1fr", gap: 16, alignItems: "start" }}>
        <Panel title="Revisions" flush>
          <div style={{ padding: "4px 20px 16px", borderBottom: `1px solid ${V.line}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 17, fontWeight: 700, ...tab }}>R02</span>
              <StateBadge state={released > 0.5 ? "completed" : "pending"} label={released > 0.5 ? "released" : "in review"} />
              {released > 0.5 && <span style={{ fontSize: 14, color: V.text2, opacity: released }}>Current · in force from {dateText(DRAWING.revisions[1].released)}</span>}
            </div>
            <div style={{ fontSize: 15, marginTop: 8 }}>
              <span style={{ color: V.text2 }}>Why </span>
              {DRAWING.revisions[1].why}
            </div>
            <div style={{ fontSize: 14, color: V.text2, marginTop: 6 }}>
              Written by {DRAWING.revisions[1].writtenBy}
              {released > 0.5 && <span style={{ opacity: released }}> · Released by {DRAWING.revisions[1].releasedBy}</span>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, height: 40, opacity: 0.25 + 0.75 * fileIn }}>
              <span style={{ width: 40, height: 40, borderRadius: 8, background: V.canvas, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name="doc" size={20} color={V.text2} />
              </span>
              <span style={{ fontSize: 15, flex: 1 }}>{DRAWING.number}-R02.pdf</span>
              <span style={{ fontSize: 15, color: V.accent, fontWeight: 600 }}>Download</span>
            </div>
          </div>
          <div style={{ padding: "14px 20px 18px", display: "flex", alignItems: "center", gap: 10, opacity: 1 - 0.4 * superseded }}>
            <span style={{ fontSize: 17, fontWeight: 700, ...tab }}>R01</span>
            <StateBadge state={superseded > 0.5 ? "cancelled" : "completed"} label={superseded > 0.5 ? "superseded" : "released"} />
            <span style={{ fontSize: 14, color: V.text2 }}>First issue · {dateText(DRAWING.revisions[0].released)}</span>
          </div>
        </Panel>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Reveal at={T.linked - 0.1}>
            <Panel title="Relied on by" flush>
              {[
                { what: `${JOB.ref} · ${JOB.title}`, kind: "Job" },
                { what: ORDER.ref, kind: "Manufacturing order" },
              ].map((r, i) => (
                <TableRow key={r.what} cols="1fr 64px" selected={i === 1 ? swap(t, T.exact) : 0}>
                  <span>
                    <span style={{ color: V.accent }}>{r.what}</span>
                    <div style={{ fontSize: 13, color: V.text3 }}>{r.kind}</div>
                  </span>
                  <Badge>R02</Badge>
                </TableRow>
              ))}
            </Panel>
          </Reveal>
          <Reveal at={T.exact + 0.6}>
            <Panel title="Opened">
              <Footnote>{DRAWING.opens} opens and downloads. Every opening is logged here.</Footnote>
            </Panel>
          </Reveal>
        </div>
      </div>
    </AppWindow>
  );
};

const OrderPage: React.FC<{ t: number }> = ({ t }) => {
  const scale = p(t, T.scales, 1.3, smooth);
  const copied = swap(t, T.copied);
  return (
    <AppWindow active="orders" collapsed width={WIN.w}>
      <Crumb parent="Manufacturing orders" here={ORDER.ref} />
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <LargeTitle>{ORDER.ref}</LargeTitle>
        <StateBadge state="draft" label="draft" />
      </div>
      <div style={{ fontSize: 16, color: V.text2, margin: "6px 0 10px" }}>
        {ORDER.qty} × {BOM.produces} · {ORDER.location} · BOM {BOM.code}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <Badge>
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <Icon name="doc" size={14} /> {DRAWING.number} R02
          </span>
        </Badge>
      </div>
      <Panel title="Components" flush>
        <div style={{ padding: "0 20px 12px", fontSize: 14, color: copied > 0 ? V.text : V.text3, opacity: 0.4 + 0.6 * copied }}>
          Copied from BOM {BOM.code} when this order was made. A later change to the BOM does not change this order.
        </div>
        <TableHead cols="1fr 110px 140px 70px" heads={["Component", "Per unit", "This order (×2)", "Unit"]} />
        {ORDER.lines.map((l, i) => {
          const k = p(t, T.scales + i * 0.06, 1.0, glide);
          const q = mix(l.perUnit, l.qty, scale > 0 ? k : 0);
          return (
            <TableRow key={l.item} cols="1fr 110px 140px 70px" style={{ padding: "9px 20px" }}>
              <span>{l.item}</span>
              <span style={{ ...tab, color: V.text2 }}>{l.perUnit}</span>
              <span style={{ ...tab, fontWeight: 600 }}>{Math.round(q)}</span>
              <span style={{ color: V.text2 }}>{l.uom}</span>
            </TableRow>
          );
        })}
      </Panel>
    </AppWindow>
  );
};

/**
 * s06 — 03 Engineering to BOM. Focal points in turn: the drawing (paper, the analogue world),
 * the revision being released, the sheet landing as R02's file (the drawing lives in Verity as a
 * controlled file; there is no in-app viewer, ADR-048), the "Relied on by" link, then the order's
 * components scaling x2 from the BOM.
 */
export const S06Engineering: React.FC = () => {
  const t = useTime();
  const len = sceneLength("s06");
  const [docK, orderK] = pageChange(t, T.toOrder);
  const draw = p(t, 0.1, 4.2, smooth);
  const fly = p(t, T.flight, 1.3, smooth);
  const sheetW = mix(600, FILE_ROW.w, fly);
  const sheetX = mix(120, FILE_ROW.x, fly);
  const sheetY = mix(190, FILE_ROW.y, fly);
  return (
    <AbsoluteFill>
      <ProductShot
        keys={[
          [0, { s: 1 }],
          [T.linked, { s: 1.06, x: -40, y: -10 }, 2.0],
          [T.toOrder, { s: 1.0, x: 0, y: 0 }, 1.0],
          [T.scales - 0.3, { s: 1.08, x: -20, y: -70 }, 2.0],
        ]}
        origin={[WIN.x + 500, WIN.y + 400]}
      >
        <div style={{ position: "relative" }}>
          <div style={{ opacity: docK }}>
            <DocumentPage t={t} />
          </div>
          {orderK > 0 && (
            <div style={{ position: "absolute", inset: 0, opacity: orderK }}>
              <OrderPage t={t} />
            </div>
          )}
        </div>
      </ProductShot>
      {fly < 1 && (
        <div style={{ position: "absolute", left: sheetX, top: sheetY, opacity: 1 - p(t, T.flight + 0.9, 0.4), transform: `rotate(${mix(-1.5, 0, fly)}deg)`, transformOrigin: "0 0" }}>
          <Sheet width={sheetW} draw={draw} />
        </div>
      )}
      <TextColumn n="03" label="Engineering to BOM" lines={["Built to the", "revision released."]} labelAt={T.flight + 0.8} statementAt={T.exact + 0.4} outAt={len - 0.35} />
    </AbsoluteFill>
  );
};
