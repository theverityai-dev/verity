import { describe, expect, it } from "vitest";
import { LOGIN_DOMAIN, isUsername, loginAddress, loginLabel } from "./login-address";

describe("login address", () => {
  it("uses a typed email as it is, lower-cased", () => {
    expect(loginAddress("  Owner@Stylified.Demo ")).toBe("owner@stylified.demo");
  });

  it("turns a username into an address on the reserved domain", () => {
    expect(loginAddress("Ravi.Stylified")).toBe(`ravi.stylified@${LOGIN_DOMAIN}`);
    expect(loginAddress("sup_a-2")).toBe(`sup_a-2@${LOGIN_DOMAIN}`);
  });

  it("refuses what is neither", () => {
    for (const bad of ["", "ab", "has space", "x".repeat(33), "-leading", "two@@signs", "no-dot@host", "ravi@"]) expect(loginAddress(bad)).toBeNull();
    expect(isUsername("ravi.s")).toBe(true);
    expect(isUsername("ravi@x.com")).toBe(false);
  });

  it("shows a username back as the person types it, and a real email untouched", () => {
    expect(loginLabel(`ravi@${LOGIN_DOMAIN}`)).toBe("ravi");
    expect(loginLabel("owner@stylified.demo")).toBe("owner@stylified.demo");
    expect(loginLabel(null)).toBeNull();
  });
});
