import { describe, expect, it } from "vitest";
import { addDays, buildRosterGrid, planCopyWeek, weekDates, weekStartOf, type RosterShift } from "./roster-week";

const shift = (employeeId: string, date: string, startTime = "09:00", endTime = "17:00", label = "Day"): RosterShift => ({
  locationId: "loc-1",
  employeeId,
  date,
  label,
  startTime,
  endTime,
});

describe("roster week", () => {
  it("starts a week on Monday, including from a Sunday", () => {
    expect(weekStartOf("2026-10-07")).toBe("2026-10-05"); // Wednesday
    expect(weekStartOf("2026-10-05")).toBe("2026-10-05"); // Monday
    expect(weekStartOf("2026-10-11")).toBe("2026-10-05"); // Sunday belongs to the week that began the Monday before
  });

  it("lists seven consecutive days and crosses month and year ends", () => {
    expect(weekDates("2026-12-28")).toEqual([
      "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03",
    ]);
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("builds one row per employee with shifts in the right day, earliest first", () => {
    const grid = buildRosterGrid(
      ["a", "b"],
      [shift("a", "2026-10-05", "14:00", "22:00", "Late"), shift("a", "2026-10-05", "06:00", "14:00", "Early"), shift("b", "2026-10-07")],
      "2026-10-05",
    );
    expect(grid[0]!.days[0]!.map((s) => s.label)).toEqual(["Early", "Late"]);
    expect(grid[0]!.days[2]).toEqual([]);
    expect(grid[1]!.days[2]).toHaveLength(1);
  });

  it("copies last week forward by seven days", () => {
    const planned = planCopyWeek([shift("a", "2026-10-05"), shift("a", "2026-10-09")], "2026-10-05");
    expect(planned.map((s) => s.date)).toEqual(["2026-10-12", "2026-10-16"]);
    expect(planned[0]).toMatchObject({ employeeId: "a", locationId: "loc-1", startTime: "09:00", endTime: "17:00" });
  });

  it("ignores shifts outside the source week and never doubles a copy that already exists", () => {
    const all = [
      shift("a", "2026-09-28"), // the week before, not copied
      shift("a", "2026-10-05"),
      shift("a", "2026-10-12"), // already there
    ];
    expect(planCopyWeek(all, "2026-10-05")).toEqual([]);
    const withNew = [...all, shift("b", "2026-10-06")];
    expect(planCopyWeek(withNew, "2026-10-05").map((s) => `${s.employeeId}@${s.date}`)).toEqual(["b@2026-10-13"]);
  });
});
