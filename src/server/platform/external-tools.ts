import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ActorContext, CommandDefinition } from "./command";
import type { QueryDefinition } from "./query";
import type { ToolDescriptor } from "./tool-manifest";

/**
 * Primitives for the external tool-invocation surface (machine callers).
 *
 * Authority: ADR-029 (PROPOSED), ADR-017, PLA-TEN-006, Task 120.
 *
 * INERT by design: nothing here is reachable over HTTP, and no key store or
 * route exists yet (ADR-029 "Implementation so far"). These are the two pieces
 * that are pure and can be proven without a database: how a key is minted and
 * checked, and how a call is allowed to reach a command or query at all.
 */

/* ------------------------------ credentials ------------------------------ */

const KEY_PREFIX = "vrk";

export type MintedApiKey = {
  /** The full key. Shown to its owner once and never stored. */
  key: string;
  /** Non-secret lookup id, safe to store and log. */
  id: string;
  /** SHA-256 of the secret half. The only thing that is stored. */
  secretHash: string;
};

/** `vrk_<id>.<secret>`; the id locates the row, the secret proves possession. */
export function mintApiKey(): MintedApiKey {
  const id = randomBytes(8).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  return { key: `${KEY_PREFIX}_${id}.${secret}`, id, secretHash: hashSecret(secret) };
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Splits a presented key. Anything malformed is `null`, never a partial match. */
export function parseApiKey(presented: string): { id: string; secret: string } | null {
  const match = /^vrk_([0-9a-f]{16})\.([A-Za-z0-9_-]{43})$/.exec(presented);
  return match ? { id: match[1]!, secret: match[2]! } : null;
}

/** Constant-time: the comparison time must not reveal how many leading bytes matched. */
export function verifySecret(secret: string, storedHash: string): boolean {
  const a = Buffer.from(hashSecret(secret), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ------------------------------- dispatcher ------------------------------ */

export type ToolCall = { tool: string; input: unknown };

export type ToolResult =
  | { ok: true; result: unknown }
  | { ok: false; code: "E_UNKNOWN_TOOL" | "E_DESTRUCTIVE_NOT_ALLOWED"; message: string };

export type DispatchDeps = {
  /** `buildToolManifest()` for this actor: the only tools they may even name. */
  manifest: () => Promise<ToolDescriptor[]>;
  getCommand: (key: string) => CommandDefinition<unknown, unknown> | undefined;
  getQuery: (key: string) => QueryDefinition<unknown, unknown> | undefined;
  runCommand: (def: CommandDefinition<unknown, unknown>, input: unknown) => Promise<unknown>;
  runQuery: (def: QueryDefinition<unknown, unknown>, input: unknown) => Promise<unknown>;
};

/**
 * Lets an already-authenticated external actor reach a command or query, and
 * nothing else. It authorizes nothing itself: a tool that is offered is still
 * checked by `enforcePolicy()` inside the pipeline (ADR-017). What it removes is
 * everything the actor should not even be able to name.
 *
 * An unknown tool and a tool the actor holds no grant for get the identical
 * refusal, so the surface cannot be used to enumerate the registry.
 */
export async function dispatchExternalTool(call: ToolCall, deps: DispatchDeps): Promise<ToolResult> {
  const offered = (await deps.manifest()).find((t) => t.key === call.tool);
  if (!offered) return { ok: false, code: "E_UNKNOWN_TOOL", message: "Unknown tool." };

  if (offered.kind === "command") {
    // Closed by default; a later ADR may open specific destructive commands.
    if (offered.impact === "destructive") {
      return { ok: false, code: "E_DESTRUCTIVE_NOT_ALLOWED", message: "This tool is not available externally." };
    }
    const def = deps.getCommand(offered.key);
    if (!def) return { ok: false, code: "E_UNKNOWN_TOOL", message: "Unknown tool." };
    return { ok: true, result: await deps.runCommand(def, call.input) };
  }

  const def = deps.getQuery(offered.key);
  if (!def) return { ok: false, code: "E_UNKNOWN_TOOL", message: "Unknown tool." };
  return { ok: true, result: await deps.runQuery(def, call.input) };
}

/** Kept so the actor type is part of this module's contract for the future route. */
export type ExternalActor = ActorContext;
