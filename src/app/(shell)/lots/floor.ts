import type { Placement } from "@/server/capabilities/piecework";
import type { FloorLane } from "@/components/ui/PieceFlow";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * Lays the factory out as lanes, one per stage in order, then Ready. A bundle stands in every lane where it holds
 * pieces (most of it finished and a few still out is the usual case), so each lane's figure is the number of pieces
 * actually there and the lanes add up to the pieces on the floor.
 */
export function floorLanes(stages: ReadonlyArray<{ id: string; label: string }>, placements: readonly Placement[], showLot: boolean): FloorLane[] {
  const lane = (key: string, label: string, done: boolean): FloorLane => {
    const here = placements.filter((p) => p.laneKey === key);
    const out = here.reduce((s, p) => s + p.out, 0);
    const waiting = here.reduce((s, p) => s + p.waiting, 0);
    const rework = here.reduce((s, p) => s + p.rework, 0);
    const ready = here.reduce((s, p) => s + p.here, 0);
    const tally = done
      ? plural(ready, "good piece")
      : [out > 0 ? `${out} out` : null, waiting > 0 ? `${waiting} waiting` : null, rework > 0 ? `${rework} rework` : null].filter(Boolean).join(" · ") || "Empty";
    return {
      key,
      label,
      done,
      tally,
      cards: here.map((p) => ({
        id: `${p.bundleId}-${key}`,
        href: `/lots/bundles/${p.bundleId}`,
        title: p.number,
        total: p.here,
        subtitle: showLot ? `${p.lotNumber} · ${p.lotName}` : `of ${p.netPieces} in the bundle`,
        holder: done ? "Ready stock" : p.holders.length > 0 ? p.holders.join(", ") : p.waiting > 0 ? "Waiting to be issued" : "Rework waiting",
        counts: done ? { ready: p.here, out: 0, rework: 0, rejected: 0, short: 0 } : { ready: 0, out: p.out, rework: p.rework, rejected: 0, short: 0 },
        age: p.daysHere === null ? undefined : p.daysHere === 0 ? "Today" : `${p.daysHere} day${p.daysHere === 1 ? "" : "s"} here`,
        late: p.late,
      })),
    };
  };
  return [...stages.map((s) => lane(s.id, s.label, false)), lane("ready", "Ready", true)];
}
