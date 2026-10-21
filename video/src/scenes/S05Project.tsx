import React from "react";
import { AbsoluteFill } from "remotion";
import { V } from "../film/layout";
import { TextColumn } from "../film/engine";
import { useTime } from "../film/ease";
import { sceneLength, word } from "../film/timeline";
import { addSfx } from "../film/sfx";
import { AppWindow } from "../ui/shell";
import { Panel, StateBadge, TableHead, TableRow, tab } from "../ui/kit";
import { Icon } from "../ui/icons";
import { JOB_TABS, JobHeader, JobStepper, Tabs } from "../ui/job";
import { MILESTONES, TASKS, dateText } from "../content/fixture";
import { ProductShot, Reveal, WIN, swap } from "./common";

const T = {
  tasks: word("s05", "v07", "tasks"),
  depend: word("s05", "v07", "depend"),
  milestones: word("s05", "v07", "milestones"),
  promised: word("s05", "v07", "promised"),
  firstDone: word("s05", "v07", "promised") + 1.2,
};

addSfx([
  { scene: "s05", at: T.tasks, name: "tick", gain: 0.35 },
  { scene: "s05", at: T.milestones, name: "tick", gain: 0.35 },
  { scene: "s05", at: T.firstDone, name: "confirm", gain: 0.4 },
]);

const COLS = "1fr 120px 210px 110px";

/**
 * s05 — 02 Order to project. Focal point: the tasks table's "Waits for" column, then the
 * promised date. When the first task is done its dependants become "to do" (startable): the
 * prerequisite rule (`setTaskState`, project/work.ts) shown as cause and effect.
 * Camera: slow lateral towards the milestones.
 */
export const S05Project: React.FC = () => {
  const t = useTime();
  const len = sceneLength("s05");
  const done = swap(t, T.firstDone);
  const taskState = (i: number) => {
    if (i === 0) return done > 0.5 ? { s: "completed" as const, l: "done" } : { s: "active" as const, l: "in progress" };
    if (i <= 2) return done > 0.5 ? { s: "pending" as const, l: "to do" } : { s: "draft" as const, l: "waiting" };
    return { s: "draft" as const, l: "waiting" };
  };
  return (
    <AbsoluteFill>
      <ProductShot
        keys={[
          [0, { s: 1, y: 0 }],
          [T.tasks - 0.4, { s: 1.05, x: -20, y: -110 }, 1.8],
          [T.milestones, { s: 1.07, x: -60, y: -130 }, 2.4],
        ]}
        origin={[WIN.x + 600, WIN.y + 520]}
      >
        <AppWindow active="jobs" collapsed width={WIN.w}>
          <JobHeader state="pending" stateLabel="approved" />
          <JobStepper at={2} />
          <Tabs tabs={JOB_TABS.slice(0, 5)} active="Tasks" />
          <Reveal at={T.tasks - 0.3}>
            <Panel title="Tasks" flush>
              <TableHead cols={COLS} heads={["Task", "Team", "Waits for", "Status"]} />
              {TASKS.map((task, i) => {
                const st = taskState(i);
                const waitK = task.waitsFor ? swap(t, T.depend + i * 0.12) : 0;
                return (
                  <TableRow key={task.name} cols={COLS} selected={i === 0 ? swap(t, T.tasks) * (1 - done) : 0}>
                    <span style={{ fontWeight: 500 }}>{task.name}</span>
                    <span style={{ color: V.text2 }}>{task.team}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, color: V.text2, fontSize: 14, opacity: task.waitsFor ? 0.25 + 0.75 * waitK : 1 }}>
                      {task.waitsFor ? (
                        <>
                          <Icon name="lock" size={14} color={done > 0.5 && i <= 2 ? V.success : V.text3} />
                          <span style={{ textDecoration: done > 0.5 && i <= 2 ? "line-through" : undefined }}>{task.waitsFor}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </span>
                    <StateBadge state={st.s} label={st.l} />
                  </TableRow>
                );
              })}
            </Panel>
          </Reveal>
          <Reveal at={T.milestones - 0.2} style={{ marginTop: 16 }}>
            <Panel title="Milestones" flush>
              {MILESTONES.map((m, i) => {
                const hi = i === 3 ? swap(t, T.promised - 0.2) : 0;
                return (
                  <TableRow key={m.name} cols="1fr 160px 120px" selected={hi}>
                    <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Icon name="flag" size={16} color={V.accent} />
                      {m.name}
                    </span>
                    <span style={{ ...tab, color: V.text2 }}>Due {dateText(m.due)}</span>
                    {/* At approval (6 Oct) no milestone has been reached yet. */}
                    <StateBadge state="pending" label="upcoming" />
                  </TableRow>
                );
              })}
            </Panel>
          </Reveal>
        </AppWindow>
      </ProductShot>
      <TextColumn n="02" label="Order to project" lines={["Nobody starts", "on a guess."]} labelAt={0.6} statementAt={T.depend + 0.4} outAt={len - 0.35} />
    </AbsoluteFill>
  );
};
