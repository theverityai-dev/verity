import { describe, expect, it } from "vitest";
import {
  describeRule,
  formatMinute,
  inWindow,
  isAvailable,
  minuteOfDay,
  parseMinute,
  unavailableReason,
  type AvailabilityContext,
  type AvailabilityRule,
} from "./menu-availability";

const labels = { location: (id: string) => (id === "o1" ? "Main St" : "Mall"), channel: (key: string) => (key === "takeaway" ? "Takeaway" : key) };
const ctx = (over: Partial<AvailabilityContext> = {}): AvailabilityContext => ({ locationId: "o1", channel: "dine_in", minuteOfDay: 9 * 60, ...over });
const rule = (over: Partial<AvailabilityRule> = {}): AvailabilityRule => ({ locationId: null, channel: null, fromMinute: null, toMinute: null, ...over });

describe("inWindow", () => {
  it("is start-inclusive and end-exclusive", () => {
    expect(inWindow(420, 420, 660)).toBe(true);
    expect(inWindow(659, 420, 660)).toBe(true);
    expect(inWindow(660, 420, 660)).toBe(false);
  });
  it("wraps past midnight", () => {
    expect(inWindow(23 * 60, 22 * 60, 2 * 60)).toBe(true);
    expect(inWindow(60, 22 * 60, 2 * 60)).toBe(true);
    expect(inWindow(12 * 60, 22 * 60, 2 * 60)).toBe(false);
  });
});

describe("isAvailable", () => {
  it("is available everywhere with no rule", () => {
    expect(isAvailable([], ctx())).toBe(true);
  });
  it("needs one matching rule when rules exist", () => {
    const breakfast = rule({ fromMinute: 7 * 60, toMinute: 11 * 60 });
    expect(isAvailable([breakfast], ctx({ minuteOfDay: 9 * 60 }))).toBe(true);
    expect(isAvailable([breakfast], ctx({ minuteOfDay: 13 * 60 }))).toBe(false);
  });
  it("matches by outlet and by channel", () => {
    expect(isAvailable([rule({ locationId: "o1" })], ctx({ locationId: "o2" }))).toBe(false);
    expect(isAvailable([rule({ channel: "takeaway" })], ctx({ channel: "dine_in" }))).toBe(false);
    expect(isAvailable([rule({ channel: "takeaway" })], ctx({ channel: "takeaway" }))).toBe(true);
  });
  it("requires every part of one rule to match, any rule to match overall", () => {
    const rules = [rule({ locationId: "o1", fromMinute: 7 * 60, toMinute: 11 * 60 }), rule({ channel: "delivery_platform" })];
    expect(isAvailable(rules, ctx({ minuteOfDay: 20 * 60, channel: "delivery_platform" }))).toBe(true);
    expect(isAvailable(rules, ctx({ minuteOfDay: 20 * 60 }))).toBe(false);
  });
});

describe("minuteOfDay", () => {
  it("reckons in the zone given, not the server's", () => {
    const instant = new Date("2026-10-09T14:00:00Z"); // 19:30 in Delhi
    expect(minuteOfDay(instant, "Asia/Kolkata")).toBe(19 * 60 + 30);
    expect(minuteOfDay(instant, "UTC")).toBe(14 * 60);
  });
  it("reads midnight as 0, not 24:00", () => {
    expect(minuteOfDay(new Date("2026-10-09T00:00:00Z"), "UTC")).toBe(0);
  });
});

describe("text", () => {
  it("formats and parses HH:MM", () => {
    expect(formatMinute(450)).toBe("07:30");
    expect(parseMinute("07:30")).toBe(450);
    expect(parseMinute("7:05")).toBe(425);
    expect(parseMinute("24:00")).toBeNull();
    expect(parseMinute("noon")).toBeNull();
  });
  it("describes rules and gives the reason an item is hidden", () => {
    const rules = [rule({ channel: "takeaway", locationId: "o1", fromMinute: 420, toMinute: 660 })];
    expect(describeRule(rules[0]!, labels)).toBe("Takeaway · Main St · 07:00 to 11:00");
    expect(unavailableReason(rules, ctx(), labels)).toBe("Only available: Takeaway · Main St · 07:00 to 11:00");
    expect(unavailableReason(rules, ctx({ channel: "takeaway" }), labels)).toBeNull();
    expect(unavailableReason([], ctx(), labels)).toBeNull();
  });
});
