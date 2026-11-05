import { beforeAll, describe, expect, it } from "vitest";
import { plainDescription, searchTools, type ToolDescriptor } from "@/server/platform/tool-manifest";
import { DEFAULT_TENANT_DAILY_TOKENS, referencedIds, tenantDailyTokenLimit } from "@/server/platform/agent-approval";
import { installCapabilities } from "@/server/capabilities/registry";
import { installAdministration } from "@/server/platform/administration";
import { listQueries } from "@/server/platform/query";

/**
 * Task 132 stage 1, without a database: the manifest search the agent is given instead of every schema (A1), the tenant token
 * ceiling's configuration (A3), and which ids a stored action names for the stale check (A4).
 */

const tool = (key: string, kind: "command" | "query", description?: string, entity = "verity.test.thing"): ToolDescriptor => ({
  key,
  kind,
  entity,
  description,
  inputSchema: {},
});

describe("searchTools", () => {
  const manifest = [
    tool("verity.trading.record_payment", "command", "Record a payment received against an invoice.", "verity.trading.payment"),
    tool("verity.trading.list_invoices", "query", "List invoices with what is still unpaid.", "verity.trading.invoice"),
    tool("verity.inventory.stock_on_hand", "query", "Stock of each item at each location.", "verity.inventory.item"),
    tool("verity.hr.list_employees", "query", "People on the payroll.", "verity.hr.employee"),
  ];

  it("ranks by the words of the need, key and entity above description", () => {
    expect(searchTools(manifest, "unpaid invoices").map((t) => t.key)[0]).toBe("verity.trading.list_invoices");
    expect(searchTools(manifest, "record a payment").map((t) => t.key)[0]).toBe("verity.trading.record_payment");
    expect(searchTools(manifest, "stock of items").map((t) => t.key)).toEqual(["verity.inventory.stock_on_hand"]);
  });

  it("returns nothing for filler words or no match, and never more than the limit", () => {
    expect(searchTools(manifest, "show me all the")).toEqual([]);
    expect(searchTools(manifest, "spaceship")).toEqual([]);
    expect(searchTools(manifest, "verity trading invoice payment list", 1)).toHaveLength(1);
  });

  it("can only return what it was given", () => {
    expect(searchTools([], "invoices")).toEqual([]);
    const found = searchTools(manifest.slice(0, 1), "unpaid invoices payment");
    expect(found.every((t) => t.key === "verity.trading.record_payment")).toBe(true);
  });
});

describe("searchTools over the real registry", () => {
  beforeAll(() => {
    installCapabilities();
    installAdministration();
  });

  it("finds the platform's recent-changes read by plain words (Task 132 A10)", () => {
    const manifest = listQueries().map((q) => tool(q.key, "query", q.description, q.entity));
    expect(searchTools(manifest, "what changed in the last few minutes").map((t) => t.key)).toContain("verity.platform.recent_changes");
  });
});

describe("tenantDailyTokenLimit", () => {
  it("reads the deployment setting and falls back to the default on anything unreadable", () => {
    expect(tenantDailyTokenLimit({})).toBe(DEFAULT_TENANT_DAILY_TOKENS);
    expect(tenantDailyTokenLimit({ AGENT_TENANT_DAILY_TOKENS: "50000" })).toBe(50000);
    expect(tenantDailyTokenLimit({ AGENT_TENANT_DAILY_TOKENS: "0" })).toBe(0);
    expect(tenantDailyTokenLimit({ AGENT_TENANT_DAILY_TOKENS: "-1" })).toBe(DEFAULT_TENANT_DAILY_TOKENS);
    expect(tenantDailyTokenLimit({ AGENT_TENANT_DAILY_TOKENS: "lots" })).toBe(DEFAULT_TENANT_DAILY_TOKENS);
  });
});

describe("referencedIds", () => {
  it("collects every uuid in a top-level *Id field, once, and ignores everything else", () => {
    const a = "3f2b8c1e-1d2a-4c3b-9e8f-0a1b2c3d4e5f";
    const b = "7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d";
    expect(referencedIds([{ invoiceId: a, partyId: b, note: "x" }, { invoiceId: a.toUpperCase() }, { id: a }, { invoiceId: "INV-7" }, null]).sort())
      .toEqual([a, b].sort());
  });
});

describe("plainDescription", () => {
  it("keeps a written description and makes a readable one from the key otherwise (Task 132 A9)", () => {
    expect(plainDescription("verity.trading.record_payment", "Record a payment.")).toBe("Record a payment.");
    expect(plainDescription("verity.trading.record_payment")).toBe("Record payment (trading)");
    expect(plainDescription("ping")).toBe("Ping");
  });
});
