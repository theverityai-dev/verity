import { describe, expect, it } from "vitest";
import {
  analyzeWrites,
  loadRepoFiles,
  toPosix,
  type AnalysisOptions,
} from "./helpers/write-confinement";

/**
 * Command-path conformance (write confinement).
 *
 * Authority: taskplans/123_enterprise_readiness_evidence_program.md; replaces the
 * text heuristic that lived in conformance.test.ts ("a file that writes must
 * mention CommandDefinition"). See helpers/write-confinement.ts for the
 * invariant, what the analysis proves and what it does not.
 */

const OPTIONS: AnalysisOptions = {
  capabilityPrefix: "src/server/capabilities/",
  entryPrefixes: ["src/app/", "src/components/", "src/server/actions/"],
  noDirectWritePrefixes: ["src/components/"],
  directWriteAllowList: {
    "src/app/api/allowed/route.ts": "fixture: an infrastructure route allowed to write",
  },
};

/** Analyses a virtual project made of the given files. */
function analyze(files: Record<string, string>) {
  return analyzeWrites("/virtual", new Map(Object.entries(files)), OPTIONS);
}

const COMMAND_TYPE = `type CommandDefinition<I, O> = { key: string; execute: (ctx: any, input: I) => Promise<O> };`;

describe("write confinement: fixtures for the known cases", () => {
  it("accepts a write inside a command", () => {
    const a = analyze({
      "src/server/capabilities/x/index.ts": `
        ${COMMAND_TYPE}
        export const make: CommandDefinition<{ n: string }, { id: string }> = {
          key: "x.make",
          execute: async (ctx, input) => {
            const row = await ctx.tx.thing.create({ data: { name: input.n } });
            return { id: row.id };
          },
        };`,
    });
    expect(a.capabilityViolations).toEqual([]);
    expect(a.counts.command).toBe(1);
  });

  it("accepts a write in a callback nested inside a command", () => {
    const a = analyze({
      "src/server/capabilities/x/index.ts": `
        ${COMMAND_TYPE}
        export const many: CommandDefinition<{ ids: string[] }, void> = {
          key: "x.many",
          execute: async (ctx, input) => {
            await Promise.all(input.ids.map((id) => ctx.tx.thing.update({ where: { id }, data: {} })));
          },
        };`,
    });
    expect(a.capabilityViolations).toEqual([]);
  });

  it("accepts a helper that is called only by a command (the manufacturing/shared.ts shape)", () => {
    const a = analyze({
      "src/server/capabilities/x/shared.ts": `
        export async function insertThing(tx: any, name: string) {
          return tx.thing.create({ data: { name } });
        }`,
      "src/server/capabilities/x/index.ts": `
        import { insertThing } from "./shared";
        ${COMMAND_TYPE}
        export const make: CommandDefinition<{ n: string }, { id: string }> = {
          key: "x.make",
          execute: async (ctx, input) => ({ id: (await insertThing(ctx.tx, input.n)).id }),
        };`,
    });
    expect(a.capabilityViolations).toEqual([]);
    expect(a.counts.confinedHelper).toBe(1);
    expect(a.confinedHelpers).toContain("src/server/capabilities/x/shared.ts insertThing");
  });

  it("accepts a helper reached through another helper that a command calls", () => {
    const a = analyze({
      "src/server/capabilities/x/index.ts": `
        ${COMMAND_TYPE}
        async function inner(tx: any) { await tx.thing.deleteMany({}); }
        async function outer(tx: any) { await inner(tx); }
        export const wipe: CommandDefinition<{}, void> = {
          key: "x.wipe",
          execute: async (ctx) => { await outer(ctx.tx); },
        };`,
    });
    expect(a.capabilityViolations).toEqual([]);
  });

  it("follows a const alias of a helper", () => {
    const a = analyze({
      "src/server/capabilities/x/index.ts": `
        ${COMMAND_TYPE}
        async function allocate(tx: any) { await tx.thing.create({ data: {} }); }
        const nextNumber = allocate;
        export const issue: CommandDefinition<{}, void> = {
          key: "x.issue",
          execute: async (ctx) => { await nextNumber(ctx.tx); },
        };`,
    });
    expect(a.capabilityViolations).toEqual([]);
  });

  it("does not count an advisory lock or set_config as a write", () => {
    const a = analyze({
      "src/server/capabilities/x/index.ts": `
        export async function lock(tx: any) {
          await tx.$executeRaw\`SELECT pg_advisory_xact_lock(1)\`;
          await tx.$executeRaw\`SELECT set_config('x', 'y', true)\`;
        }`,
    });
    expect(a.totalWriteSites).toBe(0);
  });

  it("flags an exported helper that writes and that no command calls", () => {
    const a = analyze({
      "src/server/capabilities/x/index.ts": `
        export async function sneaky(tx: any) { await tx.thing.create({ data: {} }); }`,
    });
    expect(a.capabilityViolations).toHaveLength(1);
    expect(a.capabilityViolations[0]).toMatchObject({ helper: "sneaky", op: "create" });
  });

  it("flags a file that merely mentions CommandDefinition but writes outside any command", () => {
    // The old text rule would pass this file because the word appears in it.
    const a = analyze({
      "src/server/capabilities/x/index.ts": `
        ${COMMAND_TYPE}
        export const noop: CommandDefinition<{}, void> = { key: "x.noop", execute: async () => {} };
        export async function directWrite(tx: any) { await tx.thing.update({ where: {}, data: {} }); }`,
    });
    expect(a.capabilityViolations.map((v) => v.helper)).toEqual(["directWrite"]);
  });

  it("flags a helper that a command calls but a page also calls directly", () => {
    const a = analyze({
      "src/server/capabilities/x/shared.ts": `
        export async function insertThing(tx: any) { return tx.thing.create({ data: {} }); }`,
      "src/server/capabilities/x/index.ts": `
        import { insertThing } from "./shared";
        ${COMMAND_TYPE}
        export const make: CommandDefinition<{}, void> = {
          key: "x.make",
          execute: async (ctx) => { await insertThing(ctx.tx); },
        };`,
      "src/app/page.tsx": `
        import { insertThing } from "@/server/capabilities/x/shared";
        export default async function Page() { await insertThing({}); return null; }`,
    });
    expect(a.capabilityViolations).toHaveLength(1);
    expect(a.capabilityViolations[0]!.reason).toMatch(/entry layer src\/app\/page\.tsx/);
  });

  it("flags a helper reached through an intermediate that the entry layer calls", () => {
    const a = analyze({
      "src/server/capabilities/x/index.ts": `
        ${COMMAND_TYPE}
        async function leaf(tx: any) { await tx.thing.deleteMany({}); }
        export async function middle(tx: any) { await leaf(tx); }
        export const ok: CommandDefinition<{}, void> = { key: "x.ok", execute: async (ctx) => { await leaf(ctx.tx); } };`,
      "src/server/actions/do.ts": `
        import { middle } from "@/server/capabilities/x";
        export async function action() { await middle({}); }`,
    });
    expect(a.capabilityViolations.map((v) => v.helper)).toEqual(["leaf"]);
  });

  it("flags a direct write in a component even if the file is on the allow-list", () => {
    const a = analyzeWrites(
      "/virtual",
      new Map([["src/components/Bad.tsx", `export async function f(tx: any) { await tx.thing.create({ data: {} }); }`]]),
      { ...OPTIONS, directWriteAllowList: { "src/components/Bad.tsx": "must not help" } },
    );
    expect(a.entryLayerViolations).toHaveLength(1);
  });

  it("allows a direct write only in an allow-listed entry-layer file", () => {
    const write = `export async function GET(tx: any) { await tx.thing.create({ data: {} }); }`;
    const ok = analyze({ "src/app/api/allowed/route.ts": write });
    expect(ok.entryLayerViolations).toEqual([]);
    const bad = analyze({ "src/app/api/other/route.ts": write });
    expect(bad.entryLayerViolations).toHaveLength(1);
  });
});

describe("write confinement: path handling", () => {
  it("normalises Windows separators before any comparison", () => {
    expect(toPosix("src\\server\\capabilities\\crm\\index.ts")).toBe("src/server/capabilities/crm/index.ts");
    expect(toPosix("src/server/capabilities/crm/index.ts")).toBe("src/server/capabilities/crm/index.ts");
  });

  it("produces posix keys for every repository file regardless of platform", () => {
    const files = loadRepoFiles(process.cwd());
    expect(files.size).toBeGreaterThan(100);
    expect([...files.keys()].filter((k) => k.includes("\\"))).toEqual([]);
  });
});

/** Entry-layer files that write directly, with why. Each is also a writer to an audited global table. */
const REPO_DIRECT_WRITE_ALLOW_LIST: Record<string, string> = {
  "src/app/api/auth/oidc/start/route.ts": "OIDC login replay ledger (ADR-020); written before any tenant is known",
  "src/app/api/auth/oidc/callback/route.ts": "consumes the OIDC replay ledger row (ADR-020)",
  "src/app/api/scheduled/route.ts": "scheduler lease and run history (ADR-015/016), authenticated by CRON_SECRET",
};

describe("write confinement: the repository", () => {
  const analysis = analyzeWrites(process.cwd(), loadRepoFiles(process.cwd()), {
    ...OPTIONS,
    directWriteAllowList: REPO_DIRECT_WRITE_ALLOW_LIST,
  });

  it("analyses real code, so a pass is not vacuous", () => {
    expect(analysis.totalWriteSites).toBeGreaterThan(300);
    expect(analysis.counts.command).toBeGreaterThan(150);
    expect(analysis.counts.confinedHelper).toBeGreaterThan(10);
  });

  it("confines every capability write to a command, a scheduled unit, or a helper only they reach", () => {
    expect(analysis.capabilityViolations).toEqual([]);
  });

  it("recognises the known shared helpers as confined, not as violations", () => {
    expect(analysis.confinedHelpers).toContain("src/server/capabilities/manufacturing/shared.ts insertOrder");
    expect(analysis.confinedHelpers).toContain("src/server/capabilities/crm/index.ts upsertCustomerForOrder");
  });

  it("allows no direct database write in the entry layer beyond the audited infrastructure routes", () => {
    expect(analysis.entryLayerViolations).toEqual([]);
  });
});
