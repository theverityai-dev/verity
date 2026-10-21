import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Task 121 — a bare <table> bypasses the shared component's built-in
    // empty state, overflow-x-auto wrapper, and row drill-in, which is
    // exactly the class of "obvious basic" gap veda shipped with (see
    // taskplans/121_permanent_obvious_basics_enforcement_and_priority_
    // order.md). New screens must compose DataTable/SmartTable/
    // DynamicTable instead. The `ignores` list below is the 28 files that
    // already hand-roll a <table> as of 2026-09-23 — grandfathered as
    // known debt to migrate opportunistically, not silently exempted
    // forever; do not add a new file to this list without the same
    // justification the rule itself requires.
    files: ["src/app/**/*.tsx", "src/components/**/*.tsx"],
    ignores: [
      "src/components/ui/DataTable.tsx",
      "src/components/ui/business/SmartTable.tsx",
      "src/components/ui/DynamicTable.tsx",
      "src/app/(shell)/overview/page.tsx",
      "src/app/(shell)/counter/[billId]/BillView.tsx",
      "src/app/(shell)/import/ImportWizard.tsx",
      "src/app/(shell)/outreach/intelligence/page.tsx",
      "src/app/(shell)/stock/StockBoard.tsx",
      "src/app/(shell)/sales/SalesDesk.tsx",
      "src/app/(shell)/menu/MenuAdmin.tsx",
      "src/app/(shell)/floor/FloorPlan.tsx",
      "src/app/(shell)/catalogue/CatalogueAdmin.tsx",
      "src/app/(hq)/hq/clients/[tenantId]/roles/RolesAdmin.tsx",
      "src/app/(shell)/outreach/domains/[domainId]/page.tsx",
      "src/app/(shell)/ledgers/LedgerView.tsx",
      "src/app/(hq)/hq/settings/page.tsx",
      "src/app/(hq)/hq/page.tsx",
      "src/app/(hq)/hq/clients/[tenantId]/settings/SettingsAdmin.tsx",
      "src/app/(hq)/hq/clients/page.tsx",
      "src/app/(hq)/hq/clients/[tenantId]/people/PeopleAdmin.tsx",
      "src/app/(hq)/hq/clients/[tenantId]/organizations/OrganizationsAdmin.tsx",
      "src/app/(hq)/hq/clients/[tenantId]/modules/ModulesAdmin.tsx",
      "src/app/(hq)/hq/audit/page.tsx",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXOpeningElement[name.name='table']",
          message:
            "Bare <table> is forbidden here — compose DataTable, SmartTable, or DynamicTable from src/components/ui/ instead, so empty state, overflow-x-auto, and row drill-in come for free. See taskplans/121_permanent_obvious_basics_enforcement_and_priority_order.md.",
        },
      ],
    },
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@next/next/no-img-element": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/set-state-in-effect": "off",
      "react/no-unescaped-entities": "off",
      "prefer-const": "off"
    }
  },
  {
    // A CommonJS runner that patches Node's module resolver before anything is
    // loaded cannot use ESM imports: `import` is hoisted and evaluated before
    // any statement that would install the patch, which is the whole job of the
    // file. require() is not a style choice here, it is the mechanism.
    files: ["prisma/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "out/**",
    "build/**",
    "dist/**",
    "coverage/**",
    "test-results/**",
    "graphify-out/**",
    "audit/**",
    ".claude/worktrees/**",
    ".worktrees/**",
    "tmp_backup_verity/**",
    "tmp-010-*.mjs",
    "tmp-010-*.mts",
    "next-env.d.ts",
    // Design handoff bundle from claude.ai/design — HTML/CSS/JS prototypes kept as
    // visual authority, never compiled or shipped. Linting them reports defects in
    // someone else's prototype as defects in the platform.
    "verity-app-ui-mockups/**",
    // The Remotion film project has its own package.json, tsconfig and lint run.
    "video/**",
  ]),
]);

export default eslintConfig;