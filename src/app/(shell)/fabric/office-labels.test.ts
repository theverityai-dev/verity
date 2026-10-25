import { describe, expect, it } from "vitest";
import { OFFICE_LABELS, fill } from "./office-labels";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe("office labels in Hindi and English", () => {
  const keys = Object.keys(OFFICE_LABELS.en) as Array<keyof typeof OFFICE_LABELS.en>;

  it("carry the same keys in both languages", () => {
    expect(Object.keys(OFFICE_LABELS.hi).sort()).toEqual([...keys].sort());
  });

  it("keep every placeholder in the Hindi text that the English has, so a number or a name is never dropped", () => {
    for (const key of keys) expect(placeholders(OFFICE_LABELS.hi[key]), key).toEqual(placeholders(OFFICE_LABELS.en[key]));
  });

  it("have no empty Hindi label (apart from the one connecting word that Hindi does not need)", () => {
    const empty = keys.filter((k) => OFFICE_LABELS.hi[k].trim() === "");
    expect(empty).toEqual(["onBasis"]);
  });

  it("have Hindi text that is Hindi, apart from codes, units and brand words", () => {
    // Every Hindi label with letters in it carries at least one Devanagari character, or is only a code like "{n}".
    for (const key of keys) {
      const text = OFFICE_LABELS.hi[key].replace(/\{\w+\}/g, "").trim();
      if (text === "" || !/[A-Za-z]/.test(text)) continue;
      expect(/[ऀ-ॿ]/.test(text), `${key}: ${text}`).toBe(true);
    }
  });

  it("fills placeholders", () => {
    expect(fill(OFFICE_LABELS.hi.onRolls, { n: 3 })).toBe("3 रोल पर");
    expect(fill(OFFICE_LABELS.en.countBar, { c: 4, d: 1, l: 9 })).toBe("4 counted, 1 different, 9 left as they are.");
    expect(fill("{x}", {})).toBe("");
  });
});
