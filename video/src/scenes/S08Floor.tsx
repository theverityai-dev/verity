import React from "react";
import { AbsoluteFill } from "remotion";
import { HUE, V, type Hue } from "../film/layout";
import { TextColumn } from "../film/engine";
import { useTime } from "../film/ease";
import { sceneLength, word } from "../film/timeline";
import { addSfx } from "../film/sfx";
import { AppWindow } from "../ui/shell";
import { Button, Chip, LargeTitle, Panel, StateBadge, StatTile, TableHead, TableRow, tab } from "../ui/kit";
import { Icon, type IconName } from "../ui/icons";
import { FLOOR, ROUTE } from "../content/fixture";
import { ProductShot, Reveal, WIN, pageChange, press, swap } from "./common";

const T = {
  ready: word("s08", "v12", "ready"),
  stage: word("s08", "v12", "stage"),
  start: word("s08", "v12", "start"),
  done: word("s08", "v12", "done"),
};

addSfx([
  { scene: "s08", at: T.ready - 0.2, name: "tick", gain: 0.35 },
  { scene: "s08", at: T.stage - 0.5, name: "whoosh", gain: 0.25 },
  { scene: "s08", at: T.start, name: "refuse", gain: 0.35 },
]);

const STAGE_LOOK: Record<string, { icon: IconName; hue: Hue }> = {
  fab: { icon: "wrench", hue: "slate" },
  mach: { icon: "gauge", hue: "indigo" },
  asm: { icon: "layers", hue: "brown" },
  hydro: { icon: "clipboard", hue: "teal" },
  run: { icon: "pulse", hue: "purple" },
  pack: { icon: "box", hue: "olive" },
};

/** One stage card of the order's Production journey (see the 1440px order screenshot). */
export const StageCard: React.FC<{ i: number; state: "done" | "running" | "waiting" | "rework" | "cancelled"; label?: string; note?: string; glow?: number }> = ({ i, state, label, note, glow = 0 }) => {
  const st = ROUTE[i];
  const look = STAGE_LOOK[st.key];
  const checks = st.checks.length;
  const running = state === "running";
  return (
    <div
      style={{
        background: running ? "#E6F0FD" : V.canvas,
        borderRadius: 12,
        padding: "14px 16px",
        boxShadow: running ? `inset 0 0 0 2px ${V.accentLine}` : glow ? `inset 0 0 0 2px rgba(201, 52, 0, ${0.5 * glow})` : undefined,
        opacity: state === "cancelled" ? 0.5 : 1,
        minHeight: 104,
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            flex: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            fontWeight: 700,
            background: state === "done" ? V.success : running ? V.accent : state === "rework" ? "#C93400" : V.controlStrong,
            color: state === "done" || running || state === "rework" ? "#FFF" : V.text2,
            ...tab,
          }}
        >
          {state === "done" ? <Icon name="check" size={15} color="#FFF" stroke={2.2} /> : state === "rework" ? <Icon name="undo" size={15} color="#FFF" stroke={2} /> : i + 1}
        </span>
        <span style={{ width: 40, height: 40, borderRadius: 10, background: HUE[look.hue].fill, color: HUE[look.hue].ink, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <Icon name={look.icon} size={20} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, lineHeight: "21px", textDecoration: state === "cancelled" ? "line-through" : undefined }}>{label ?? st.label}</div>
          <div style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6, background: V.controlStrong, borderRadius: 999, padding: "2px 10px", fontSize: 13, color: V.text2 }}>
            {note ?? (checks ? `${state === "done" ? checks : 0} of ${checks} checks passed` : "No checks")}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * s08 — 05 Production. Focal points: the shop floor queue filtered to one stage, then the order's
 * production journey, where stage 5 cannot start while stage 4 is open (`startOperation`,
 * manufacturing/stages.ts). Camera: push from the queue onto the journey.
 */
export const S08Floor: React.FC = () => {
  const t = useTime();
  const len = sceneLength("s08");
  const [floorK, journeyK] = pageChange(t, T.stage - 0.6);
  const filter = swap(t, T.ready - 0.2);
  const rows = filter > 0.5 ? FLOOR.rows.filter((r) => r.stage === "Pressure test") : FLOOR.rows;
  const refuse = swap(t, T.start + 0.25);
  return (
    <AbsoluteFill>
      <ProductShot
        keys={[
          [0, { s: 1 }],
          [T.ready - 0.6, { s: 1.06, x: -10, y: -60 }, 1.4],
          [T.stage - 0.6, { s: 1.1, x: -30, y: -80 }, 1.2],
        ]}
        origin={[WIN.x + 400, WIN.y + 420]}
      >
        <div style={{ position: "relative" }}>
          <div style={{ opacity: floorK }}>
            <AppWindow active="floor" collapsed width={WIN.w}>
              <LargeTitle>Shop floor</LargeTitle>
              <div style={{ fontSize: 15, color: V.text2, margin: "6px 0 18px" }}>Open stages of running orders. Work can only start when everything before it is done.</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
                <StatTile icon="layers" hue="blue" value={FLOOR.open} label="Open stages" />
                <StatTile icon="check" hue="green" value={FLOOR.ready} label="Ready to start" />
                <StatTile icon="pause" hue="amber" value={FLOOR.onHold} label="On hold" />
                <StatTile icon="undo" hue="red" value={FLOOR.rework} label="Rework" />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "18px 0 14px" }}>
                <Chip label="All stages" count={FLOOR.open} selected={filter < 0.5} />
                <Chip label="Pressure test" count={2} icon="clipboard" selected={filter >= 0.5} />
                <Chip label="Frame fabrication" count={3} icon="wrench" />
                <Chip label="Machining" count={2} icon="gauge" />
                <Chip label="Assembly and alignment" count={2} icon="layers" />
              </div>
              <Panel flush>
                <TableHead cols="1fr 1fr 50px 130px" heads={["Order", "Stage", "Qty", "State"]} />
                {rows.map((r, i) => (
                  <TableRow key={r.order} cols="1fr 1fr 50px 130px" selected={i === 0 ? filter : 0}>
                    <span>
                      <span style={{ color: V.accent }}>{r.order}</span>
                      <div style={{ fontSize: 13, color: V.text3 }}>{r.product}</div>
                    </span>
                    <span>
                      {r.stage}
                      <div style={{ fontSize: 13, color: V.text3 }}>{r.of}</div>
                    </span>
                    <span style={tab}>{r.qty}</span>
                    <StateBadge state={r.state} label={r.label} />
                  </TableRow>
                ))}
              </Panel>
            </AppWindow>
          </div>
          {journeyK > 0 && (
            <div style={{ position: "absolute", inset: 0, opacity: journeyK }}>
              <AppWindow active="orders" collapsed width={WIN.w}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
                  <LargeTitle>BPS-75 ×2 | Halden</LargeTitle>
                  <StateBadge state="active" label="in progress" />
                </div>
                <div style={{ fontSize: 16, color: V.text2, marginBottom: 18 }}>Stage 4 of 6 · Pressure test</div>
                <Panel title="Production journey">
                  <div style={{ fontSize: 15, color: V.text2, marginBottom: 14 }}>Green is done, blue is in progress, amber is on hold, grey has not started.</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
                    {ROUTE.map((_, i) => (
                      <StageCard key={i} i={i} state={i < 3 ? "done" : i === 3 ? "running" : "waiting"} glow={i === 4 ? refuse : 0} />
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 16 }}>
                    <Button variant="primary" size="sm" pressed={press(t, T.start)} style={{ opacity: 0.45 }}>
                      Start run test
                    </Button>
                    <Reveal at={T.start + 0.25}>
                      <span style={{ fontSize: 15, color: V.warning }}>Waiting for the earlier stage to finish.</span>
                    </Reveal>
                  </div>
                </Panel>
              </AppWindow>
            </div>
          )}
        </div>
      </ProductShot>
      <TextColumn n="05" label="Production" lines={["Each stage,", "in its order."]} labelAt={0.6} statementAt={T.ready + 0.4} outAt={len - 0.35} />
    </AbsoluteFill>
  );
};
