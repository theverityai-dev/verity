import { beforeAll, describe, expect, it } from "vitest";
import { agentApprovalClass } from "@/server/platform/agent-approval";
import { installCapabilities } from "@/server/capabilities/registry";
import { installAdministration } from "@/server/platform/administration";
import { listCommands } from "@/server/platform/command";

/**
 * ADR-055 clause 1, without a database. The classifier is the one place that decides whether the agent may run a command on the
 * model's request alone, so it is tested against the whole registry, not only against examples.
 */

describe("agentApprovalClass", () => {
  const cls = (key: string, over: { verb?: "Create" | "Edit" | "Delete"; impact?: "routine" | "destructive" } = {}) =>
    agentApprovalClass({ key, verb: over.verb ?? "Edit", impact: over.impact });

  it("blocks a destructive command and any Delete verb, whatever the name", () => {
    expect(cls("verity.x.tidy", { impact: "destructive" })).toBe("blocked");
    expect(cls("verity.x.tidy", { verb: "Delete" })).toBe("blocked");
    expect(cls("verity.x.record_payment", { impact: "destructive" })).toBe("blocked");
  });

  it("asks for confirmation when the name carries a money, ledger, state or outward word", () => {
    for (const key of [
      "verity.dinein.record_payment", "verity.dinein.refund_bill", "verity.accounting.post_journal_entry",
      "verity.accounting.reverse_journal_entry", "verity.project.void_invoice", "verity.inventory.approve_purchase_order",
      "verity.manufacturing.dispatch_order", "verity.outreach.post_direction", "verity.relationship.merge_people",
      "verity.relationship.bulk_update_companies", "verity.relationship.import_records", "verity.piecework.report_wage_payment",
      "verity.piecework.close_day", "verity.project.cancel_job", "verity.inventory.transfer_stock",
    ]) expect(cls(key), key).toBe("confirm");
  });

  it("lets an ordinary record-keeping command run immediately", () => {
    for (const key of ["verity.relationship.add_note", "verity.relationship.create_company", "verity.relationship.log_interaction"]) {
      expect(cls(key, { verb: "Create" }), key).toBe("routine");
    }
  });

  it("matches whole parts of the last segment, so a word inside another word does not trip it", () => {
    expect(cls("verity.postal.update_address")).toBe("routine"); // 'postal' is not 'post'
    expect(cls("verity.payments.update_note")).toBe("routine"); // only the last segment is read, never the namespace
  });
});

describe("agentApprovalClass over the whole registry", () => {
  beforeAll(() => {
    installCapabilities();
    installAdministration();
  });

  it("blocks every destructive or Delete command", () => {
    const offenders = listCommands()
      .filter((c) => (c.impact === "destructive" || c.verb === "Delete") && agentApprovalClass(c) !== "blocked")
      .map((c) => c.key);
    expect(offenders).toEqual([]);
  });

  it("holds the money, ledger and outward commands this ADR names to confirm, so a rename cannot slip one through", () => {
    const registered = new Map(listCommands().map((c) => [c.key, c]));
    const mustConfirm = [
      "verity.accounting.post_journal_entry",
      "verity.accounting.reverse_journal_entry",
      "verity.dinein.refund_bill",
      "verity.dinein.settle_bill",
      "verity.inventory.record_vendor_payment",
      "verity.inventory.approve_purchase_order",
      "verity.piecework.record_payment",
      "verity.project.void_invoice",
      "verity.manufacturing.dispatch_order",
    ];
    const missing = mustConfirm.filter((k) => !registered.has(k));
    expect(missing, "renamed or removed: update this list and re-check the class").toEqual([]);
    for (const key of mustConfirm) {
      const c = registered.get(key)!;
      // A destructive one is blocked, which is stricter; anything else must be confirm.
      expect(["confirm", "blocked"], key).toContain(agentApprovalClass(c));
    }
  });
});
