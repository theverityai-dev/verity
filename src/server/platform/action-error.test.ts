import { describe, expect, it } from "vitest";
import { toActionFailure } from "./action-error";
import { StorageUnavailableError } from "./files";

describe("toActionFailure for the file store", () => {
  it("names a storage outage instead of saying something went wrong, and says it is safe to retry", () => {
    for (const error of [new StorageUnavailableError(), new Error('E_STORAGE: could not check bucket "x" (connect ECONNREFUSED)')]) {
      const failure = toActionFailure(error);
      expect(failure).toMatchObject({ ok: false, retryable: true });
      expect(failure.ok === false && failure.message).toMatch(/storage is not reachable/);
      // The raw detail (hosts, bucket names) is logged, never sent to the browser.
      expect(failure.ok === false && failure.message).not.toMatch(/ECONNREFUSED|bucket/);
    }
  });

  it("still keeps the generic message for an error nobody anticipated", () => {
    const failure = toActionFailure(new Error("boom"));
    expect(failure.ok === false && failure.message).toMatch(/Something went wrong/);
  });
});
