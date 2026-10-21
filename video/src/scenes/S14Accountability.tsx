import React from "react";
import { AbsoluteFill } from "remotion";
import { V } from "../film/layout";
import { TextColumn } from "../film/engine";
import { useTime } from "../film/ease";
import { sceneLength, word } from "../film/timeline";
import { addSfx } from "../film/sfx";
import { AppWindow } from "../ui/shell";
import { Icon } from "../ui/icons";
import { LargeTitle, Panel, TableRow } from "../ui/kit";
import { HISTORY, JOB } from "../content/fixture";
import { ProductShot, Reveal, WIN, swap } from "./common";

const T = {
  attributed: word("s14", "v22", "attributed"),
  releasing: word("s14", "v22", "releasing"),
  history: word("s14", "v22", "history"),
};

addSfx([
  { scene: "s14", at: T.releasing, name: "tick", gain: 0.3 },
  { scene: "s14", at: T.history - 0.4, name: "paper", gain: 0.3 },
]);

/** Roles grant Verb + Entity permissions; releasing a document is its own grant (ADR-048). */
const GRANTS: Array<{ role: string; allow: string[]; deny: string[] }> = [
  { role: "Engineering lead", allow: ["Release document revisions", "Create and revise documents"], deny: [] },
  { role: "Design engineer", allow: ["Create and revise documents"], deny: ["Release document revisions"] },
];

/**
 * s14 — Accountability. Left of the window: who may release (role grants); right: the job's
 * history, every entry with a name and a time (the audit trail behind `AuditTrail`).
 */
export const S14Accountability: React.FC = () => {
  const t = useTime();
  const len = sceneLength("s14");
  const rel = swap(t, T.releasing);
  return (
    <AbsoluteFill>
      <ProductShot keys={[[0, { s: 1 }], [T.history - 0.6, { s: 1.04, x: -40, y: -30 }, 1.6]]} origin={[WIN.x + 600, WIN.y + 400]}>
        <AppWindow active="roles" collapsed width={WIN.w}>
          <LargeTitle>
            {JOB.ref} · history and roles
          </LargeTitle>
          <div style={{ display: "grid", gridTemplateColumns: "430px 1fr", gap: 16, marginTop: 18, alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {GRANTS.map((g) => (
                <Panel key={g.role} title={g.role}>
                  {[...g.allow.map((a) => ({ a, ok: true })), ...g.deny.map((a) => ({ a, ok: false }))].map(({ a, ok }) => {
                    const hi = a.startsWith("Release") ? rel : 0;
                    return (
                      <div key={a} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 8px", margin: "0 -8px", borderRadius: 8, fontSize: 15, background: hi ? `rgba(10,132,255,${0.1 * hi})` : undefined }}>
                        <span style={{ width: 20, height: 20, borderRadius: 10, background: ok ? V.success : V.controlStrong, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Icon name={ok ? "check" : "x"} size={12} color={ok ? "#fff" : V.text2} stroke={2.4} />
                        </span>
                        <span style={{ color: ok ? V.text : V.text3 }}>{a}</span>
                      </div>
                    );
                  })}
                </Panel>
              ))}
              <div style={{ fontSize: 13, color: V.text3, padding: "0 4px" }}>An author releasing their own revision needs a separate grant and a recorded reason.</div>
            </div>
            <Reveal at={T.attributed - 0.6}>
              <Panel title="History" flush>
                {HISTORY.map((h, i) => (
                  <Reveal key={i} at={T.attributed - 0.3 + i * 0.25} dur={0.5}>
                    <TableRow cols="1fr 150px" style={{ alignItems: "flex-start" }}>
                      <span>
                        <span style={{ fontWeight: 500 }}>{h.what}</span>
                        <div style={{ fontSize: 14, color: V.text2 }}>{h.detail}</div>
                        <div style={{ fontSize: 13, color: V.text3 }}>{h.who}</div>
                      </span>
                      <span style={{ fontSize: 13, color: V.text3, textAlign: "right" }}>{h.at}</span>
                    </TableRow>
                  </Reveal>
                ))}
              </Panel>
            </Reveal>
          </div>
        </AppWindow>
      </ProductShot>
      <TextColumn label="Accountability" lines={["Every handoff", "has a name."]} labelAt={0.6} statementAt={T.attributed + 0.4} outAt={len - 0.35} />
    </AbsoluteFill>
  );
};
