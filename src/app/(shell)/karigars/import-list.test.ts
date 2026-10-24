import { describe, expect, it } from "vitest";
import { parseKarigarList } from "./import-list";

describe("parseKarigarList", () => {
  it("reads tab-separated lines as Excel pastes them, skipping a header row", () => {
    const { rows, problems } = parseKarigarList("Name\tMobile\tWorks\tAddress\nRavi Kumar\t98765 43210\tIn\tModel Town\nSharma Works\t98140 11002\tOutside unit\tFocal Point\n");
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      { name: "Ravi Kumar", mobile: "98765 43210", kind: "in_house", address: "Model Town" },
      { name: "Sharma Works", mobile: "98140 11002", kind: "outside", address: "Focal Point" },
    ]);
  });

  it("reads comma lines, makes mobile and address optional, and treats a missing kind as in the factory", () => {
    const { rows } = parseKarigarList("Asha\nBimla, 9876543210");
    expect(rows).toEqual([{ name: "Asha", kind: "in_house" }, { name: "Bimla", mobile: "9876543210", kind: "in_house" }]);
  });

  it("reports a bad line by number and keeps the rest", () => {
    const { rows, problems } = parseKarigarList("Asha, 9876543210\n,98765 43210\nBimla, 9876543210\nasha, 9876543211\nChanda, 12ab");
    expect(rows.map((r) => r.name)).toEqual(["Asha", "Bimla"]);
    expect(problems).toEqual([
      "Line 2: no name",
      "Line 4: asha is listed twice",
      "Line 5: Chanda has a mobile number that is not valid",
    ]);
  });
});
