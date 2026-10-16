import { describe, expect, it } from "vitest";
import { rupeesInWords } from "./amount-words";

describe("rupeesInWords", () => {
  it("writes whole rupees in the Indian system", () => {
    expect(rupeesInWords(0)).toBe("Rupees zero only");
    expect(rupeesInWords(100)).toBe("Rupees one only");
    expect(rupeesInWords(678_500 * 100)).toBe("Rupees six lakh seventy-eight thousand five hundred only");
    expect(rupeesInWords(10_820_000 * 100)).toBe("Rupees one crore eight lakh twenty thousand only");
  });

  it("adds paise when there are any", () => {
    expect(rupeesInWords(12_345_650)).toBe("Rupees one lakh twenty-three thousand four hundred fifty-six and fifty paise only");
  });
});
