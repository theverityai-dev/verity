import { describe, expect, it, vi } from "vitest";
import {
  dispatchExternalTool,
  hashSecret,
  mintApiKey,
  parseApiKey,
  verifySecret,
  type DispatchDeps,
} from "@/server/platform/external-tools";
import type { ToolDescriptor } from "@/server/platform/tool-manifest";

/** ADR-029 constraints 3, 5 and 6, without a database. */

const tool = (over: Partial<ToolDescriptor>): ToolDescriptor => ({
  key: "verity.order.status",
  kind: "query",
  entity: "verity.order",
  inputSchema: {},
  ...over,
});

function deps(manifest: ToolDescriptor[]): DispatchDeps & { runCommand: ReturnType<typeof vi.fn>; runQuery: ReturnType<typeof vi.fn> } {
  return {
    manifest: async () => manifest,
    getCommand: (key) => ({ key }) as never,
    getQuery: (key) => ({ key }) as never,
    runCommand: vi.fn(async () => "command-ran"),
    runQuery: vi.fn(async () => "query-ran"),
  };
}

describe("api keys (ADR-029 constraint 3)", () => {
  it("mints a key that parses back to its id and verifies against only its stored hash", () => {
    const minted = mintApiKey();
    const parsed = parseApiKey(minted.key);

    expect(parsed?.id).toBe(minted.id);
    expect(verifySecret(parsed!.secret, minted.secretHash)).toBe(true);
    expect(verifySecret(parsed!.secret, mintApiKey().secretHash)).toBe(false);
  });

  it("stores nothing replayable: the hash is not the secret and the key is never in the stored fields", () => {
    const minted = mintApiKey();
    const { secret } = parseApiKey(minted.key)!;

    expect(minted.secretHash).not.toContain(secret);
    expect(minted.secretHash).toBe(hashSecret(secret));
    expect(minted.id).not.toContain(secret);
  });

  it("mints distinct keys with enough entropy", () => {
    const keys = new Set(Array.from({ length: 50 }, () => mintApiKey().key));
    expect(keys.size).toBe(50);
    expect(parseApiKey(mintApiKey().key)!.secret).toHaveLength(43); // 32 bytes, base64url
  });

  it("rejects anything malformed instead of partially matching", () => {
    const { key } = mintApiKey();
    for (const bad of ["", "vrk_", key.replace("vrk_", "xxx_"), `${key}x`, key.slice(0, -1), `Bearer ${key}`, " " + key, key.toUpperCase()]) {
      expect(parseApiKey(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("does not throw on a stored hash of the wrong length", () => {
    expect(verifySecret("anything", "abcd")).toBe(false);
    expect(verifySecret("anything", "")).toBe(false);
  });
});

describe("external dispatcher (ADR-029 constraints 5, 6)", () => {
  it("runs a tool the actor is offered", async () => {
    const d = deps([tool({ key: "verity.order.status", kind: "query" })]);
    expect(await dispatchExternalTool({ tool: "verity.order.status", input: { id: "1" } }, d)).toEqual({
      ok: true,
      result: "query-ran",
    });
    expect(d.runQuery).toHaveBeenCalledWith(expect.objectContaining({ key: "verity.order.status" }), { id: "1" });

    const c = deps([tool({ key: "verity.order.create", kind: "command" })]);
    expect(await dispatchExternalTool({ tool: "verity.order.create", input: {} }, c)).toEqual({
      ok: true,
      result: "command-ran",
    });
  });

  it("refuses a tool that is not in the actor's manifest, identically to one that does not exist", async () => {
    const d = deps([tool({ key: "verity.order.status" })]);
    // Registered in the registry (getCommand finds it) but not offered to this actor.
    const notGranted = await dispatchExternalTool({ tool: "verity.payment.refund", input: {} }, d);
    const nonexistent = await dispatchExternalTool({ tool: "verity.does.not.exist", input: {} }, {
      ...d,
      getCommand: () => undefined,
      getQuery: () => undefined,
    });

    expect(notGranted).toEqual(nonexistent);
    expect(notGranted).toMatchObject({ ok: false, code: "E_UNKNOWN_TOOL" });
    expect(d.runCommand).not.toHaveBeenCalled();
    expect(d.runQuery).not.toHaveBeenCalled();
  });

  it("never runs a destructive command externally, even when it is offered", async () => {
    const d = deps([tool({ key: "verity.order.delete", kind: "command", impact: "destructive" })]);
    const result = await dispatchExternalTool({ tool: "verity.order.delete", input: {} }, d);

    expect(result).toMatchObject({ ok: false, code: "E_DESTRUCTIVE_NOT_ALLOWED" });
    expect(d.runCommand).not.toHaveBeenCalled();
  });

  it("routine commands and all queries are unaffected by the destructive rule", async () => {
    const d = deps([
      tool({ key: "a", kind: "command", impact: "routine" }),
      tool({ key: "b", kind: "command" }),
      tool({ key: "c", kind: "query" }),
    ]);
    for (const key of ["a", "b", "c"]) {
      expect(await dispatchExternalTool({ tool: key, input: {} }, d)).toMatchObject({ ok: true });
    }
  });

  it("lets an error from the pipeline propagate rather than swallowing it as success", async () => {
    const d = deps([tool({ key: "verity.order.create", kind: "command" })]);
    d.runCommand.mockRejectedValueOnce(new Error("E_FORBIDDEN"));
    await expect(dispatchExternalTool({ tool: "verity.order.create", input: {} }, d)).rejects.toThrow("E_FORBIDDEN");
  });
});
