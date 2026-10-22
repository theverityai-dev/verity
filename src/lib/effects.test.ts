import { describe, expect, it } from "vitest";
import { effectsAttribute, effectsChoice, isWeakDevice } from "./effects";

describe("isWeakDevice", () => {
  it("flags a phone or PC with little memory or few cores", () => {
    expect(isWeakDevice({ deviceMemory: 2 })).toBe(true);
    expect(isWeakDevice({ deviceMemory: 4 })).toBe(true);
    expect(isWeakDevice({ hardwareConcurrency: 4 })).toBe(true);
    expect(isWeakDevice({ hardwareConcurrency: 2, deviceMemory: 8 })).toBe(true);
  });

  it("leaves a capable device on full glass", () => {
    expect(isWeakDevice({ hardwareConcurrency: 8, deviceMemory: 8 })).toBe(false);
    expect(isWeakDevice({ hardwareConcurrency: 6 })).toBe(false);
  });

  it("treats a missing signal as unknown, not weak (Safari and Firefox report no deviceMemory)", () => {
    expect(isWeakDevice({})).toBe(false);
    expect(isWeakDevice({ hardwareConcurrency: 0 })).toBe(false);
  });
});

describe("the cookie", () => {
  it("stamps lite for a chosen or detected lite, and nothing otherwise", () => {
    expect(effectsAttribute("lite")).toBe("lite");
    expect(effectsAttribute("auto-lite")).toBe("lite");
    expect(effectsAttribute("full")).toBeUndefined();
    expect(effectsAttribute(undefined)).toBeUndefined();
    expect(effectsAttribute("anything else")).toBeUndefined();
  });

  it("shows a remembered detection as Automatic, because the person did not choose it", () => {
    expect(effectsChoice("auto-lite")).toBe("auto");
    expect(effectsChoice(undefined)).toBe("auto");
    expect(effectsChoice("lite")).toBe("lite");
    expect(effectsChoice("full")).toBe("full");
  });
});
