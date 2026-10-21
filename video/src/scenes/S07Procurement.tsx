import React from "react";
import { AbsoluteFill } from "remotion";
import { V } from "../film/layout";
import { TextColumn } from "../film/engine";
import { p, useTime } from "../film/ease";
import { cue, sceneLength, word } from "../film/timeline";
import { addSfx } from "../film/sfx";
import { AppWindow, Crumb } from "../ui/shell";
import { Alert, Button, DefRow, Footnote, LargeTitle, Panel, StateBadge, TableHead, TableRow, tab } from "../ui/kit";
import { BOM, ORDER, PO, SHORT_MESSAGE, dateText, inr } from "../content/fixture";
import { ProductShot, WIN, pageChange, press, swap } from "./common";

const v11 = cue("s07", "v11");
const T = {
  hold: word("s07", "v10", "holds"),
  short: word("s07", "v10", "short"),
  toPo: v11.start - 0.7,
  decision: word("s07", "v11", "decision") + 0.3,
  two: word("s07", "v11", "two"),
  rest: word("s07", "v11", "rest"),
  back: word("s07", "v11", "hold") - 0.5,
  held: word("s07", "v11", "through"),
};

addSfx([
  { scene: "s07", at: T.hold, name: "press", gain: 0.5 },
  { scene: "s07", at: T.short, name: "refuse", gain: 0.5 },
  { scene: "s07", at: T.toPo, name: "whoosh", gain: 0.25 },
  { scene: "s07", at: T.decision, name: "stamp", gain: 0.4 },
  { scene: "s07", at: T.two, name: "tick", gain: 0.35 },
  { scene: "s07", at: T.rest, name: "tick", gain: 0.35 },
  { scene: "s07", at: T.held, name: "confirm", gain: 0.45 },
]);

/** First letter up, the rest exactly as the command words it. */
const sentence = (s: string) => s[0].toUpperCase() + s.slice(1);

const OrderStock: React.FC<{ t: number }> = ({ t }) => {
  const refused = swap(t, T.short);
  const held = swap(t, T.held);
  return (
    <AppWindow active="orders" collapsed width={WIN.w}>
      <Crumb parent="Manufacturing orders" here={ORDER.ref} />
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <LargeTitle>{ORDER.ref}</LargeTitle>
        <StateBadge state="draft" label="draft" />
      </div>
      <div style={{ fontSize: 16, color: V.text2, margin: "6px 0 20px" }}>
        {ORDER.qty} × {BOM.produces} · {ORDER.location} · BOM {BOM.code}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "560px 1fr", gap: 16, alignItems: "start" }}>
        <Panel title="Stock" action={<Button variant="primary" size="sm" pressed={press(t, T.hold) + press(t, T.back + 0.2)}>Hold stock</Button>}>
          <Footnote style={{ marginBottom: 12 }}>Hold every component this order needs at {ORDER.location}, or none of them.</Footnote>
          {held > 0 ? (
            <div style={{ opacity: held }}>
              <Alert tone="success" title="Stock held" message={`All ${ORDER.lines.length} components are held for this order.`} />
            </div>
          ) : refused > 0 ? (
            <div style={{ opacity: refused * (1 - p(t, T.toPo, 0.3)) }}>
              <Alert title="Could not update the hold" message={sentence(SHORT_MESSAGE)} />
            </div>
          ) : null}
        </Panel>
        <Panel title="Components" flush>
          {ORDER.lines.slice(4, 8).map((l) => {
            const short = l.item === PO.item;
            return (
              <TableRow key={l.item} cols="1fr 60px" selected={short ? refused * (1 - held) : 0} style={{ padding: "10px 20px" }}>
                <span style={{ color: short && refused > 0.5 && held < 0.5 ? V.danger : V.text }}>{l.item}</span>
                <span style={{ ...tab, textAlign: "right" }}>{l.qty}</span>
              </TableRow>
            );
          })}
        </Panel>
      </div>
    </AppWindow>
  );
};

const PurchaseOrder: React.FC<{ t: number }> = ({ t }) => {
  const approved = swap(t, T.decision);
  const r1 = swap(t, T.two);
  const r2 = swap(t, T.rest);
  const state = r2 > 0.5 ? { s: "completed" as const, l: "received" } : r1 > 0.5 ? { s: "active" as const, l: "partially received" } : approved > 0.5 ? { s: "active" as const, l: "approved" } : { s: "pending" as const, l: "pending approval" };
  const got = (r1 > 0.5 ? PO.receipts[0].qty : 0) + (r2 > 0.5 ? PO.receipts[1].qty : 0);
  return (
    <AppWindow active="pos" collapsed width={WIN.w}>
      <Crumb parent="Purchase orders" here={PO.ref} />
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <LargeTitle>{PO.ref}</LargeTitle>
        <StateBadge state={state.s} label={state.l} />
      </div>
      <div style={{ fontSize: 16, color: V.text2, margin: "6px 0 20px" }}>{PO.vendor} · for {ORDER.ref}</div>
      <div style={{ display: "grid", gridTemplateColumns: "560px 1fr", gap: 16, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Panel title="Lines" flush>
            <TableHead cols="1fr 50px 100px 110px" heads={["Item", "Qty", "Rate", "Amount"]} />
            <TableRow cols="1fr 50px 100px 110px">
              <span>{PO.item}</span>
              <span style={tab}>{PO.qty}</span>
              <span style={tab}>{inr(PO.unit)}</span>
              <span style={{ ...tab, fontWeight: 600 }}>{inr(PO.total)}</span>
            </TableRow>
            <div style={{ padding: "12px 20px 16px" }}>
              <Footnote>Over the approval limit of {inr(PO.threshold)}, so it waits for an approver.</Footnote>
            </div>
          </Panel>
          <Panel title="Approval">
            <DefRow term="Requested by" value="Meera Iyer" />
            <DefRow term="Decision" value={approved > 0.5 ? <span style={{ color: V.success, opacity: approved }}>Approved by {PO.approvedBy}</span> : <span style={{ color: V.text3 }}>Waiting</span>} last />
          </Panel>
        </div>
        <Panel title={`Received ${got} of ${PO.qty}`} flush>
          <div style={{ height: 8, margin: "0 20px 14px", borderRadius: 4, background: V.track, overflow: "hidden" }}>
            <div style={{ width: `${(100 * (r1 * PO.receipts[0].qty + r2 * PO.receipts[1].qty)) / PO.qty}%`, height: 8, background: V.success }} />
          </div>
          {PO.receipts.map((r, i) => {
            const k = i === 0 ? r1 : r2;
            if (k <= 0) return null;
            return (
              <TableRow key={r.on} cols="1fr 120px" style={{ opacity: k }}>
                <span>Goods received · {dateText(r.on)}</span>
                <span style={{ ...tab, textAlign: "right" }}>{r.qty} nos</span>
              </TableRow>
            );
          })}
        </Panel>
      </div>
    </AppWindow>
  );
};

/**
 * s07 — 04 Procurement to stores. Focal points: the refused hold (with the command's own words),
 * the purchase order waiting for approval, two receipts, then the hold succeeding. The reservation
 * is all-or-nothing (`reserveOrder`, manufacturing/batch.ts); the threshold is the inventory
 * capability's PO approval limit.
 */
export const S07Procurement: React.FC = () => {
  const t = useTime();
  const len = sceneLength("s07");
  const [orderK, poK] = pageChange(t, T.toPo, T.back);
  return (
    <AbsoluteFill>
      <ProductShot
        keys={[
          [0, { s: 1 }],
          [T.hold - 0.5, { s: 1.12, x: -40, y: -60 }, 1.6],
          [T.toPo, { s: 1.06, x: -20, y: -40 }, 1.0],
          [T.back, { s: 1.12, x: -40, y: -60 }, 1.0],
        ]}
        origin={[WIN.x + 300, WIN.y + 330]}
      >
        <div style={{ position: "relative" }}>
          <div style={{ opacity: orderK }}>
            <OrderStock t={t} />
          </div>
          {poK > 0 && (
            <div style={{ position: "absolute", inset: 0, opacity: poK }}>
              <PurchaseOrder t={t} />
            </div>
          )}
        </div>
      </ProductShot>
      <TextColumn n="04" label="Procurement to stores" lines={["Shortages,", "known early."]} labelAt={0.6} statementAt={T.short + 1.0} outAt={len - 0.35} />
    </AbsoluteFill>
  );
};
