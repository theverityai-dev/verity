import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative as relativeNative } from "node:path";
import { PrismaClient } from "@prisma/client";
import { toPosix } from "./helpers/write-confinement";

// Always posix. On Windows the native `relative` returns backslashes, which made
// every `startsWith("src/...")` and `/src\/app\/.../` check below silently match
// nothing, so those boundary tests passed vacuously off CI.
const relative = (from: string, to: string): string => toPosix(relativeNative(from, to));

/**
 * Foundation conformance suite.
 *
 * Authority: implementation/13-conformance/implementation-invariant-checks.md,
 * forbidden-patterns.md, INV-001 through INV-003.
 *
 * These checks exist because the invariants they cover are the kind that decay
 * quietly: a model added without a tenant column, a legacy term reintroduced, a
 * table shipped without RLS. Each is cheap to verify and expensive to discover
 * late.
 */

const ROOT = process.cwd();
const SCHEMA = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8");

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.(ts|tsx)$/.test(full)) acc.push(full);
  }
  return acc;
}

const SOURCES = sourceFiles(join(ROOT, "src"));

/** Models that are deliberately not tenant-scoped, each with its authority. */
const GLOBAL_MODELS: Record<string, string> = {
  RequestQuota: "opaque pre-authentication quotas; function-only runtime access, audit F-008",
  Tenant: "the isolation boundary itself (ADR-005)",
  Party: "global identity — Bible V2 Primitive 2 §2, INV-003",
  User: "global identity, 1:1 with Party — GOV-TER-006",
  EntityDefinition: "platform metadata describing types — MET-ENT-004",
  CapabilityDefinition: "platform registry — PLA-CAP-001",
  StateDefinition: "capability lifecycle metadata — MET-STA-001",
  TransitionDefinition: "capability lifecycle metadata — MET-TRA-001",
  ConfigParameter: "Global scope rows belong to no tenant — PLA-CFG-001",
  FieldPermission: "which fields are sensitive is a property of the entity — PLA-AUT-005",
  PackRelease: "signed platform pack catalog — Task 110 / PLA-CAP-006",
  OidcLoginTransaction: "short-lived pre-session OIDC state — Task 36",
  SchedulerLease: "global cadence lock — Task 29 / ADR-015",
  SchedulerRun: "global scheduler evidence — Task 29 / ADR-015",
  DeploymentState: "global operator/deployment quarantine state — Task 42",
};

describe("conformance: forbidden legacy patterns", () => {
  // The policy documents necessarily contain these strings; the code must not.
  const forbidden = [
    "factoryId",
    "factory_id",
    "vehicleBrandId",
    "vehicleModelId",
    "seatType",
    "hasArmrest",
    "headrestCount",
    "ProductionBatch",
    "BomMode",
    "QCTemplate",
    "SpecRefTarget",
    "verity-glass",
  ];

  it("does not reintroduce any VEDA identifier in source", () => {
    const violations: string[] = [];
    for (const file of SOURCES) {
      // This file necessarily contains the terms it searches for, exactly as
      // no-legacy-policy.md does. Excluding it is the same exemption, made
      // explicit rather than by a fragile regex.
      if (file.endsWith("conformance.test.ts")) continue;
      const text = readFileSync(file, "utf8");
      for (const term of forbidden) {
        if (text.includes(term)) violations.push(`${relative(ROOT, file)}: ${term}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("does not define legacy role-based routes (forbidden pattern #9)", () => {
    // Route groups like (owner) are parenthesised and never appear in a URL;
    // a real /owner route directory would.
    const appDir = join(ROOT, "src/app");
    const offenders = sourceFiles(appDir)
      .map((f) => relative(ROOT, f))
      .filter((f) => /src\/app\/(owner|worker|inspector|supervisor|verity)\//.test(f));
    expect(offenders).toEqual([]);
  });
});

describe("conformance: tenancy isolation (INV-001)", () => {
  it("gives every persistent model a tenant column unless documented global", () => {
    const models = [...SCHEMA.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];
    expect(models.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const [, name, body] of models) {
      if (name in GLOBAL_MODELS) continue;
      if (!/\btenantId\b/.test(body)) missing.push(name);
    }
    expect(missing).toEqual([]);
  });

  it("keeps the documented global list explicit rather than implicit", () => {
    // Every allowlisted model must actually exist, so the list cannot rot into
    // a set of stale exemptions that silently excuse a new model.
    const declared = [...SCHEMA.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
    for (const name of Object.keys(GLOBAL_MODELS)) {
      expect(declared).toContain(name);
    }
  });

  it("gives every model a uuid primary key, never an auto-increment integer", () => {
    const models = [...SCHEMA.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];
    const offenders = models
      .filter(([, , body]) => /@id[^\n]*autoincrement\(\)/.test(body))
      .map(([, name]) => name);
    expect(offenders).toEqual([]);
  });
});

describe("conformance: architectural boundaries", () => {
  it("keeps Prisma out of components and non-API app code", () => {
    const offenders = SOURCES.filter((file) => {
      const rel = relative(ROOT, file);
      const isUiLayer = rel.startsWith("src/components/") || rel.startsWith("src/app/");
      const isApiRoute = rel.startsWith("src/app/api/");
      if (!isUiLayer || isApiRoute) return false;
      return /from "@prisma\/client"|from "@\/server\/platform\/db"/.test(readFileSync(file, "utf8"));
    }).map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it("keeps capabilities out of the platform core", () => {
    // A capability may import the platform; the platform must never import a
    // capability. The Location scope resolver is registered *into* the platform
    // rather than imported *by* it, and this is the check that keeps it that way.
    const offenders = SOURCES.filter((file) => {
      const rel = relative(ROOT, file);
      if (!rel.startsWith("src/server/platform/")) return false;
      return /from "@\/server\/capabilities\//.test(readFileSync(file, "utf8"));
    }).map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it("keeps React out of the server platform layer", () => {
    const offenders = SOURCES.filter((file) => {
      const rel = relative(ROOT, file);
      if (!rel.startsWith("src/server/")) return false;
      return /from "react"|\.tsx$/.test(rel) || /from "react"/.test(readFileSync(file, "utf8"));
    }).map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});


describe("conformance: capability contracts (Phase E)", () => {
  /**
   * Declared dependencies, mirrored from each capability's install migration.
   * A capability may import another only if it declares the dependency — that
   * is what makes the dependency graph enforceable rather than decorative.
   */
  const DECLARED_DEPENDENCIES: Record<string, string[]> = {
    location: [],
    asset: ["location"],
    evidence: ["location"],
    scheduling: ["asset"],
    approval: [],
    // Kent's Restaurant, the first real client. Depends on nothing: a menu, a
    // floor and a bill need no other capability, and declaring one it does not
    // use would make the graph a wish rather than a fact.
    dinein: [],
    // The plywood trader, the second real client, and the first capability to
    // depend on shared ones: a godown IS a Location (ADR-004), a delivery
    // vehicle IS an Asset, and an LR scan IS Evidence. Declared here and in the
    // install migrations, so the database refuses the activation when any of the
    // three is inactive rather than discovering it at a failing foreign key.
    // ADR-018 added a fourth dependency: the generic trading engine plywood's
    // own product-detail extension sits on top of.
    plywood: ["location", "asset", "evidence", "trading"],
    // ADR-018 — the generic order-to-cash/procure-to-pay engine extracted out
    // of plywood. Depends on nothing: parties, orders, invoicing, GST, stock
    // and payments need no other capability, the same reasoning `dinein`
    // above already gives for depending on nothing.
    trading: [],
    // Tasks 72/73/77/78, built 2026-09-04 under explicit product-owner
    // override ("build ahead of demand"), MVP scope. Each is a standalone
    // vertical slice depending on no other capability (checked: no
    // cross-capability import from any of the four) — this list was
    // simply never updated when they shipped.
    accounting: [],
    inventory: [],
    billing: [],
    hr: [],
    // Colonel Kebabz slices. These are declared here because the source
    // imports are the enforceable dependency surface, even when the
    // capability's install migration is the historical authority for the
    // activation graph.
    attendance: ["hr", "location"],
    complaint: ["crm", "dinein"],
    coupon: ["dinein"],
    crm: ["dinein"],
    finance: ["dinein", "location"],
    loyalty: ["crm", "dinein"],
    outreach: [],
    manufacturing: [],
    recipe: ["dinein", "inventory"],
  };

  // These are command-owned integration hooks, not capability activation
  // dependencies. The dine-in bill command calls them in its own transaction;
  // making dine-in depend on CRM/Loyalty/Recipe would create activation cycles
  // because those capabilities already depend on dine-in for their data model.
  const COMMAND_OWNED_INTEGRATIONS: Record<string, Set<string>> = {
    dinein: new Set(["recipe", "crm", "loyalty"]),
  };

  const capabilityDirs = readdirSync(join(ROOT, "src/server/capabilities")).filter((entry) =>
    statSync(join(ROOT, "src/server/capabilities", entry)).isDirectory(),
  );

  it("has a declared dependency list for every shipped capability", () => {
    expect(capabilityDirs.sort()).toEqual(Object.keys(DECLARED_DEPENDENCIES).sort());
  });

  it("never imports a capability it has not declared a dependency on", () => {
    const violations: string[] = [];

    for (const capability of capabilityDirs) {
      const allowed = new Set(DECLARED_DEPENDENCIES[capability] ?? []);
      for (const file of sourceFiles(join(ROOT, "src/server/capabilities", capability))) {
        const text = readFileSync(file, "utf8");
        for (const match of text.matchAll(/@\/server\/capabilities\/([a-z_]+)/g)) {
          const imported = match[1]!;
          if (imported === capability || allowed.has(imported) || COMMAND_OWNED_INTEGRATIONS[capability]?.has(imported)) continue;
          violations.push(`${capability} imports ${imported} without declaring it`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  // "Every capability mutation goes through a command" is enforced by
  // write-confinement.test.ts. It replaced a per-file text heuristic (a file that
  // writes must contain the word CommandDefinition) that both flagged a legitimate
  // shared helper and passed any file that merely mentioned the word.

  it("declares a verb and an entity on every command", () => {
    const violations: string[] = [];

    for (const capability of capabilityDirs) {
      for (const file of sourceFiles(join(ROOT, "src/server/capabilities", capability))) {
        const text = readFileSync(file, "utf8");
        // Each command literal must carry both, or the pipeline cannot
        // authorize it and would fall through to the capability gate alone.
        for (const block of text.split("CommandDefinition<").slice(1)) {
          const head = block.slice(0, 900);
          // Generic handler-context type references are not command literals.
          if (!/\bkey:\s*"/.test(head)) continue;
          if (!/\bverb:\s*"/.test(head) || !/\bentity:\s*[A-Z_]/.test(head)) {
            violations.push(`${relative(ROOT, file)}: a command is missing verb or entity`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("never sets a tenant scope by hand inside a capability", () => {
    // Tenant context comes from withTenant. A capability calling set_config on
    // verity.tenant_id would be choosing its own isolation boundary.
    const violations = capabilityDirs.flatMap((capability) =>
      sourceFiles(join(ROOT, "src/server/capabilities", capability))
        .filter((file) => /set_config\(\s*'verity\.tenant_id'|SET LOCAL verity/.test(readFileSync(file, "utf8")))
        .map((file) => relative(ROOT, file)),
    );
    expect(violations).toEqual([]);
  });
});

describe("conformance: DEC-001 boundary (ADR-014)", () => {
  it("keeps kitchen vocabulary out of the platform", () => {
    // ADR-014 permits a kitchen SCREEN inside a client capability and leaves
    // DEC-001's exclusion of a kitchen MODULE from core untouched. The
    // difference is whether anything kitchen-shaped can escape the capability,
    // so that is what is checked rather than trusted.
    const platform = sourceFiles(join(ROOT, "src/server/platform"));
    const offenders = platform.filter((file) =>
      /kitchen|bump[ _-]?timer|recipe|prep[ _-]?queue/i.test(
        readFileSync(file, "utf8"),
      ),
    );
    expect(offenders.map((file) => relative(ROOT, file))).toEqual([]);
  });

  it("keeps the kitchen screen inside the capability that owns it", () => {
    // A shared component would be the excluded module wearing a different name:
    // the moment a second capability can render this board, it has generalised.
    const shared = sourceFiles(join(ROOT, "src/components")).filter((file) =>
      /kitchen/i.test(readFileSync(file, "utf8")),
    );
    expect(shared.map((file) => relative(ROOT, file))).toEqual([]);
  });

  it("has no recipe or inventory logic anywhere in the dine-in capability", () => {
    // The two things DEC-001's rationale names stay excluded outright. The
    // screen shows what was ordered; it does not know what a dish is made of.
    const capability = sourceFiles(join(ROOT, "src/server/capabilities/dinein"));
    const offenders = capability.filter((file) =>
      /recipe|ingredient|stock[ _-]?level|deplet/i.test(readFileSync(file, "utf8")),
    );
    expect(offenders.map((file) => relative(ROOT, file))).toEqual([]);
  });
});

describe("conformance: over-genericity (Phase G)", () => {
  it("keeps JSON columns to the declared extension points", () => {
    // Json is legitimate for custom_fields (PLA-EXT-001), event and automation
    // payloads, and configuration values. Anywhere else it is usually a
    // relational model that was not thought through, so the budget is fixed and
    // a new one has to be argued for rather than added quietly.
    const jsonFields = [...SCHEMA.matchAll(/^\s*(\w+)\s+Json/gm)].map((m) => m[1]!);
    const permitted = new Set([
      "customFields", "payload", "value", "config", "condition", "input", "output", "result",
      // Platform control-plane and operational evidence documents.
      "diff", "manifest", "schema", "data", "details",
      // Manufacturing: a route stage's QC checklist template, copied onto each
      // operation; a public passport's minimal projection (ADR-030). Outreach/
      // external idempotency: the stored response replayed on a repeated key.
      "checkpoints", "snapshot", "response",
    ]);
    const unexpected = jsonFields.filter((name) => !permitted.has(name));
    expect(unexpected).toEqual([]);
  });

  it("has no entity-attribute-value table", () => {
    // The failure mode the brief names first. An EAV table would show up as a
    // model carrying an attribute name and a loose value column side by side.
    const models = [...SCHEMA.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];
    const suspects = models
      .filter(([, , body]) =>
        /\b(attributeName|attribute_name|fieldKey|propertyName)\b/.test(body) &&
        /\b(value|stringValue|numericValue)\b/.test(body),
      )
      .map(([, name]) => name);
    expect(suspects).toEqual([]);
  });

  it("keeps state machines declared as data, not as code branches", () => {
    // One transition runtime, driven by transition_definition rows. A capability
    // implementing its own switch over states would mean the platform's runtime
    // is not actually reusable.
    const capabilitySources = readdirSync(join(ROOT, "src/server/capabilities"))
      .filter((entry) => statSync(join(ROOT, "src/server/capabilities", entry)).isDirectory())
      .flatMap((entry) => sourceFiles(join(ROOT, "src/server/capabilities", entry)));

    const violations = capabilitySources
      .filter((file) => /switch\s*\(\s*\w*[Ss]tate\b/.test(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file));
    expect(violations).toEqual([]);
  });

  it("keeps the platform surface small enough to stay comprehensible", () => {
    // Not a hard architectural rule, but a tripwire: unchecked growth in the
    // platform layer is how capability logic ends up there. If this fails the
    // question to ask is whether the new module belongs in a capability.
    // Tests are excluded, and that is not softening the tripwire.
    //
    // The guard asks one question — "does this new module belong in a
    // capability?" — and a test file is not a module anyone could put in a
    // capability. Counting tests would mean writing tests for platform code
    // pushed the platform toward the cap, which is an incentive pointing
    // exactly the wrong way: the honest response to that pressure would be to
    // delete tests. Before Task 66 the directory happened to contain no
    // colocated tests, so the two counts agreed and the difference was
    // invisible.
    const platformModules = sourceFiles(join(ROOT, "src/server/platform")).filter(
      (file) => !/\.test\.tsx?$/.test(file),
    );
    // 25: config.ts (Task 26) — a deployment-configuration boundary, not
    // capability logic, so it belongs here rather than in a capability.
    // 26: authProvider.ts (Task 28) — the neutral Principal/AuthProvider
    // contract; auth.ts is its Supabase implementation, same reasoning.
    // 27: job.ts (Task 29) — the neutral background-job contract; not
    // capability logic, so it belongs here rather than in a capability.
    // 28: oidc.ts (Task 36) — pure OIDC token verification and claim
    // normalization. It is the identity boundary, which is platform by
    // definition: no capability may decide who the actor is. Kept separate
    // from auth.ts so the rules are provable without Next or a live provider.
    // 29: policy.ts (Task 37) — the authorization decision point. It adds no
    // rules; it composes authorization.ts into one answer so that a command, a
    // query, an API route and a Phase 9 agent cannot each grow their own habit.
    // 30: integration.ts (Task 39) — the ports-and-adapters contract for
    // exchanges with external systems. Platform because the *shape* of an
    // exchange (tenant, correlation, attempt policy, inbound trust) is a
    // platform rule; the transport lives in src/server/integrations/.
    // 31: observability.ts (Task 40) — logging, metrics, errors and the
    // ambient request context. Platform because correlation and redaction are
    // platform rules; the destination (stdout, a collector, an APM) is a
    // deployment decision and no vendor is bound here.
    // 32: rate-limit.ts (Task 66, audit finding F-01) — request throttling.
    // Platform because the path it protects is authentication, which no
    // capability owns, and because a limiter each caller reinvents is a
    // limiter some caller forgets.
    // 33: telemetry-scrub.ts (Task 66, audit finding F-04) — what may leave
    // the deployment in a crash report. Same reasoning as observability.ts:
    // redaction is a platform rule and the destination is a deployment
    // decision. It binds no vendor — the Sentry config passes its event in
    // against a structural type, so the platform never imports the SDK.
    // Reviewed additions: batch, agent-chat, tool-manifest, sync plus audit
    // csp, execution-failure, request-limits and shared-rate-limit controls.
    // Current reviewed additions through Outreach and the pack/control-plane
    // work remain platform contracts, not capability implementations.
    // 55: data-export.ts (ADR-037, Task 125 item 7.5) — a client exports its own
    // data. Platform because the Export verb, the verity.platform.data_export
    // entity and the rule "an export never exceeds the requester's own Read
    // authority" are platform rules; what is exportable is declared by each
    // capability through registerExportable, so no capability logic lives here.
    // 56: notification-outbox.ts (ADR-039, Task 125 item 7.7) — the event outbox
    // dispatcher and per-tenant alert subscriptions. Platform because the outbox
    // is domain_event, the dispatcher runs as a platform schedule (no capability
    // owns it) and what a notification may say is a platform rule: the kind of
    // record, never a figure the recipient could not already read.
    expect(platformModules.length).toBeLessThanOrEqual(56);
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

describeDb("conformance: database enforcement", () => {
  it("enables and forces RLS on every application table", async () => {
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      const rows = await admin.$queryRaw<
        { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
      >`SELECT relname, relrowsecurity, relforcerowsecurity
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND relname <> '_prisma_migrations'
        ORDER BY relname`;

      expect(rows.length).toBeGreaterThan(0);
      // Operational tables that carry no tenant data at all (no tenant_id):
      // OIDC login state, scheduler lease/run history and the restore-quarantine
      // flag. Isolation here is by grant (REVOKE ALL FROM PUBLIC; the runtime
      // role gets only what it needs), not RLS, so they are named explicitly
      // rather than exempted by pattern. A new tenant-scoped table never fits.
      const NO_TENANT_DATA = new Set([
        "deployment_state", "oidc_login_transaction", "scheduler_lease", "scheduler_run",
      ]);
      const unprotected = rows
        .filter((r) => !NO_TENANT_DATA.has(r.relname))
        .filter((r) => !r.relrowsecurity || !r.relforcerowsecurity)
        .map((r) => r.relname);
      // FORCE matters as much as ENABLE: without it the owning role bypasses
      // every policy and the isolation tests would still pass.
      expect(unprotected).toEqual([]);
    } finally {
      await admin.$disconnect();
    }
  });

  it("keeps the audit and event tables append-only by trigger (EXE-AUD-003)", async () => {
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      const rows = await admin.$queryRaw<{ tablename: string }[]>`
        SELECT c.relname AS tablename
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE NOT t.tgisinternal AND t.tgname LIKE '%append_only%'`;
      const guarded = rows.map((r) => r.tablename).sort();
      // Evidence joins the audit tables: a proof-of-attendance photograph that
      // can be edited afterwards is not evidence.
      //
      // `stock_ledger_entry` is a capability table and belongs on this list for
      // the same reason. plywood.md calls the stock ledger append-only, and a
      // ledger that is append-only only because no code writes an UPDATE stays
      // that way exactly until someone writes one. Listing it here means a later
      // migration that drops the trigger fails a test rather than quietly making
      // a business's stock history editable.
      //
      // The plywood finance tables join for the same reason. A ledger entry is
      // what a balance is computed from (P3), and an invoice is a legal document
      // whose number, tax and totals are fixed once raised — a correction is a
      // credit note, which is a new document rather than an edit to an old one.
      // accounting's journal_entry/journal_line, billing's billing_invoice/
      // billing_meter_reading, hr's hr_leave_decision, and inventory's
      // inventory_stock_movement (Tasks 72/73/77/78, built 2026-09-04) join
      // for the same reason as the plywood/trading ledger tables above —
      // each is a financial or historical fact, not a mutable record. This
      // list simply was never rechecked against them until now. Sorted to
      // match `guarded`'s own `.sort()`.
      expect(guarded).toEqual([
        "activity",
        "bill_refund",
        "billing_invoice",
        "billing_meter_reading",
        "cash_movement",
        "command_failure",
        "domain_event",
        "evidence",
        "hr_leave_decision",
        "inventory_goods_receipt",
        "inventory_goods_receipt_line",
        "inventory_stock_movement",
        "inventory_vendor_payment",
        "inventory_wastage_record",
        "journal_entry",
        "journal_line",
        "loyalty_point_entry",
        "manufacturing_checkpoint_result",
        "manufacturing_dispatch",
        "outreach_activity",
        "outreach_ai_insight",
        "outreach_attribution_record",
        "outreach_check_in",
        "outreach_check_in_review",
        "outreach_closed_client",
        "outreach_coaching_note",
        "outreach_direction",
        "outreach_opportunity",
        "outreach_proposal",
        "outreach_research_entry",
        "outreach_team_weekly_assessment",
        "outreach_weekly_report",
        "security_audit_event",
        "stock_ledger_entry",
        "trading_invoice",
        "trading_ledger_entry",
      ]);
    } finally {
      await admin.$disconnect();
    }
  });

  it("guards every graph against cycles that would not terminate", async () => {
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      const rows = await admin.$queryRaw<{ tgname: string }[]>`
        SELECT t.tgname FROM pg_trigger t
        WHERE NOT t.tgisinternal AND t.tgname LIKE '%no_cycle%'`;
      const names = rows.map((r) => r.tgname).sort();
      expect(names).toEqual(["role_composition_no_cycle", "workflow_edge_no_cycle"]);
    } finally {
      await admin.$disconnect();
    }
  });

  it("refuses to run the platform on a connection that bypasses RLS", async () => {
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      const [role] = await admin.$queryRaw<{ rolbypassrls: boolean }[]>`
        SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`;
      // The migration role legitimately bypasses; the runtime role must not.
      expect(role?.rolbypassrls).toBe(true);

      const app = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
      try {
        const [runtime] = await app.$queryRaw<{ rolbypassrls: boolean; rolsuper: boolean }[]>`
          SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`;
        expect(runtime?.rolbypassrls).toBe(false);
        expect(runtime?.rolsuper).toBe(false);
      } finally {
        await app.$disconnect();
      }
    } finally {
      await admin.$disconnect();
    }
  });
});
