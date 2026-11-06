import "server-only";
import type { ActorContext, CommandDefinition } from "./command";
import { enforcePolicy } from "./policy";
import { capabilityForEntity, requireCapabilityReady } from "./capability";
import { executeQuery, getQuery } from "./query";
import { withTenant, type TenantScopedClient } from "./tenancy";

/**
 * What the assistant may know about the records it is asked to touch (Task 132 A4 and A9).
 *
 * Two small registries, both read-only and both run as the person:
 *
 * - Name resolvers: how to find a record by the name someone typed. The assistant calls `resolve_name` instead of guessing an id.
 *   More than one match is never settled by the platform or the model: the person is asked (ERPClaw's rule for anything that
 *   decides whose money or books). A resolver is offered only if the person holds Read on its entity and its capability is ready.
 * - Current state: a command may name a query that reads the record it changes, so a confirmation shows "was X, now Y".
 */

export type NameCandidate = { id: string; name: string };

export type NameResolver = {
  /** What the person calls it: "company", "customer". Matched case-insensitively. */
  noun: string;
  /** Entity whose Read grant gates this resolver. */
  entity: string;
  /** Records whose name contains `text`, case-insensitively, at most `limit`. Archived or inactive records are left out. */
  find: (tx: TenantScopedClient, text: string, limit: number) => Promise<NameCandidate[]>;
};

const resolvers = new Map<string, NameResolver>();

export function registerNameResolver(resolver: NameResolver): void {
  const key = resolver.noun.toLowerCase();
  if (resolvers.has(key)) throw new Error(`Name resolver already registered: ${resolver.noun}`);
  resolvers.set(key, resolver);
}

export function clearNameResolvers(): void {
  resolvers.clear();
}

async function canResolve(tx: TenantScopedClient, actor: ActorContext, r: NameResolver): Promise<boolean> {
  try {
    const capability = await capabilityForEntity(tx, r.entity);
    if (capability) await requireCapabilityReady(tx, actor.tenantId, capability);
    await enforcePolicy(tx, actor, { verb: "Read", entity: r.entity, channel: "agent", resource: {} });
    return true;
  } catch {
    return false;
  }
}

async function usable(tx: TenantScopedClient, actor: ActorContext): Promise<NameResolver[]> {
  const out: NameResolver[] = [];
  for (const r of resolvers.values()) if (await canResolve(tx, actor, r)) out.push(r);
  return out.sort((a, b) => a.noun.localeCompare(b.noun));
}

/** Nouns this person can resolve now: Read on the entity, capability ready. */
export async function availableNouns(actor: ActorContext): Promise<string[]> {
  return withTenant(actor.tenantId, async (tx) => (await usable(tx, actor)).map((r) => r.noun));
}

export type Resolution =
  | { status: "unknown_noun"; available: string[] }
  | { status: "none"; noun: string }
  | { status: "one"; noun: string; match: NameCandidate }
  | { status: "several"; noun: string; candidates: NameCandidate[] };

const MAX_CANDIDATES = 8;

/**
 * Finds a record by name. Exactly one exact (case-insensitive) match wins even when longer names also contain the text; otherwise
 * one partial match alone is returned as the single answer, and anything else is a list for the person to choose from. Never picks
 * among several.
 */
export async function resolveName(actor: ActorContext, noun: string, name: string): Promise<Resolution> {
  const text = name.trim();
  return withTenant(actor.tenantId, async (tx): Promise<Resolution> => {
    const allowed = await usable(tx, actor);
    const resolver = allowed.find((r) => r.noun.toLowerCase() === noun.trim().toLowerCase());
    if (!resolver) return { status: "unknown_noun", available: allowed.map((r) => r.noun) };
    if (text.length < 2) return { status: "none", noun: resolver.noun };
    const found = await resolver.find(tx, text, MAX_CANDIDATES + 1);
    if (found.length === 0) return { status: "none", noun: resolver.noun };
    const exact = found.filter((c) => c.name.trim().toLowerCase() === text.toLowerCase());
    if (exact.length === 1) return { status: "one", noun: resolver.noun, match: exact[0] };
    if (exact.length === 0 && found.length === 1) return { status: "one", noun: resolver.noun, match: found[0] };
    return { status: "several", noun: resolver.noun, candidates: found.slice(0, MAX_CANDIDATES) };
  });
}

/* ------------------------------ current state ------------------------------ */

const SHOWN = 6;
const VALUE = 40;
const show = (v: unknown): string => (v === null || v === undefined || v === "" ? "empty" : String(v).slice(0, VALUE));

/**
 * One line per input for a confirmation: "field: was → now" for each field the command sets that differs from the record as the
 * person may read it now, and "field: now" where the record could not be read or has no such field. `undefined` means the command
 * declares no current state, so the caller keeps its plain lines.
 */
export async function currentStateLines(actor: ActorContext, command: CommandDefinition<unknown, unknown>, inputs: unknown[]): Promise<string[] | undefined> {
  const spec = command.currentState as
    | { query: string; input: (i: unknown) => unknown; changes: (i: unknown) => Record<string, unknown> }
    | undefined;
  if (!spec) return undefined;
  const query = getQuery(spec.query);
  const lines: string[] = [];
  for (const input of inputs.slice(0, 5)) {
    let row: Record<string, unknown> | null = null;
    if (query) {
      try {
        const result = await executeQuery(actor, query, spec.input(input), "agent");
        if (result && typeof result === "object" && !Array.isArray(result)) row = result as Record<string, unknown>;
      } catch {
        row = null; // not readable by this person: show the new values alone
      }
    }
    const parts = Object.entries(spec.changes(input))
      .filter(([, v]) => v !== undefined && (typeof v !== "object" || v === null))
      .slice(0, SHOWN)
      .flatMap(([field, now]) => {
        if (!row || !(field in row)) return [`${field}: ${show(now)}`];
        return show(row[field]) === show(now) ? [] : [`${field}: ${show(row[field])} → ${show(now)}`];
      });
    lines.push(parts.length > 0 ? parts.join(", ") : "no change to the fields shown");
  }
  return lines;
}
