import { describe, expect, it } from "vitest";
import { leaveCalendar, type LeaveSpan } from "./leave-calendar";

const leave = (employee: string, fromDate: string, toDate: string, status: LeaveSpan["status"] = "Approved"): LeaveSpan => ({
  employee,
  fromDate,
  toDate,
  status,
});

describe("leave calendar", () => {
  it("lists each day and includes both ends of a leave", () => {
    const days = leaveCalendar([leave("Asha", "2026-10-06", "2026-10-07")], "2026-10-05", 4);
    expect(days.map((d) => d.approved)).toEqual([[], ["Asha"], ["Asha"], []]);
  });

  it("warns when two people are off the same day, counting pending leave", () => {
    const days = leaveCalendar(
      [leave("Asha", "2026-10-06", "2026-10-06"), leave("Ravi", "2026-10-06", "2026-10-08", "Pending")],
      "2026-10-05",
      4,
    );
    expect(days.map((d) => d.overlap)).toEqual([false, true, false, false]);
    expect(days[1]).toMatchObject({ approved: ["Asha"], pending: ["Ravi"] });
  });

  it("ignores rejected and revoked leave", () => {
    const days = leaveCalendar([leave("Asha", "2026-10-05", "2026-10-05", "Rejected"), leave("Ravi", "2026-10-05", "2026-10-05", "Revoked")], "2026-10-05", 1);
    expect(days[0]).toMatchObject({ approved: [], pending: [], overlap: false });
  });

  it("counts a person once when approved and pending leave overlap", () => {
    const days = leaveCalendar([leave("Asha", "2026-10-05", "2026-10-06"), leave("Asha", "2026-10-06", "2026-10-07", "Pending")], "2026-10-06", 1);
    expect(days[0]).toMatchObject({ approved: ["Asha"], pending: [], overlap: false });
  });

  it("accepts timestamps as well as dates", () => {
    const days = leaveCalendar([leave("Asha", "2026-10-05T00:00:00.000Z", "2026-10-05T00:00:00.000Z")], "2026-10-05", 1);
    expect(days[0]!.approved).toEqual(["Asha"]);
  });
});
