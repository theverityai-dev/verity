import { describe, expect, it } from "vitest";
import { outletLabour, shiftHours, type LabourEmployee } from "./labour-cost";

const person = (salary: number | null, shifts: LabourEmployee["shifts"], active = true): LabourEmployee => ({
  monthlySalaryMinor: salary,
  active,
  shifts,
});
const at = (locationId: string, startTime = "09:00", endTime = "17:00") => ({ locationId, startTime, endTime });

describe("shift hours", () => {
  it("counts a normal shift and one that crosses midnight", () => {
    expect(shiftHours("09:00", "17:30")).toBe(8.5);
    expect(shiftHours("22:00", "06:00")).toBe(8);
  });
});

describe("outlet labour", () => {
  it("charges a full month's salary to the only outlet a person works at", () => {
    const r = outletLabour([person(3_000_000, [at("a")])], "a", 30);
    expect(r).toEqual({ labourMinor: 3_000_000, placed: 1, unplaced: 0 });
  });

  it("prorates to the window length", () => {
    expect(outletLabour([person(3_000_000, [at("a")])], "a", 15).labourMinor).toBe(1_500_000);
  });

  it("splits a person's pay across outlets by shift hours", () => {
    const e = person(3_000_000, [at("a", "09:00", "17:00"), at("a", "09:00", "17:00"), at("b", "09:00", "17:00")]);
    expect(outletLabour([e], "a", 30).labourMinor).toBe(2_000_000);
    expect(outletLabour([e], "b", 30).labourMinor).toBe(1_000_000);
  });

  it("does not guess for people with no shifts, and skips unsalaried and inactive staff", () => {
    const r = outletLabour(
      [person(3_000_000, []), person(null, [at("a")]), person(2_000_000, [at("a")], false), person(1_000_000, [at("b")])],
      "a",
      30,
    );
    expect(r).toEqual({ labourMinor: 0, placed: 0, unplaced: 1 });
  });
});
