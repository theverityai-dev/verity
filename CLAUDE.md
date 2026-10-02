# Verity — Claude Code Project Memory

**Before anything else: read `taskplans/handoffs/README.md`.** It's the
always-current index of what's actively being worked on and in what order —
kept updated on every change to active work. `taskplans/00_STATUS_INDEX.md`
is the full historical register (every taskplan ever written); the handoffs
folder is the live work order.

## What this is

Verity is a **module-driven business operating platform** for service-driven organizations.
It is a **platform substrate**, not a product for any one industry. Internal admins assemble
reusable capabilities, packs, and system templates into configured tenant workspaces.

Core architectural principle (Authority: Bible V1 §3.A) — **standardize the foundation, not every behavior**:

```
STANDARDIZED PLATFORM FOUNDATION
    -> PURPOSE-BUILT REUSABLE CAPABILITIES
    -> INDUSTRY / DOMAIN PACKS
    -> CONFIGURATION
    -> CONTROLLED CLIENT EXTENSIONS
```

Do not drift to either extreme (everything configurable / everything hard-coded).

## Current objective: VERITY PLATFORM FOUNDATION READY

We are **not** building for a client yet. We are building the operating-system substrate
to the point where it can receive arbitrary future capabilities and client systems
**without redesign of the foundation**.

**Not in scope now**: CRM, Sales, Procurement, Inventory, Security Operations, Staffing,
Facilities, Field Service, Maintenance, Commerce, Finance, Work Order as a finished business
capability, any industry pack, any client-specific module, any polished product UI.

**Product-owner scope decision, 2026-09-30 (supersedes the list above for the items named
here only):** business-capability build is now authorized past PLATFORM FOUNDATION READY for
Task 118 (manufacturing), Task 119 (Jev advisory decision source, under ADR-027's seven
constraints) and Task 120 (Relay integration). This satisfies Task 119's gate 2 and Task 118
§6's scope question. It does **not** waive the stop conditions below: anything that adds a
security boundary (Task 120's external tool-invocation surface) still needs its own ADR before
code, and nothing here changes INV-001, ADR-017 or `enforcePolicy()`. The list above otherwise
stands: no new business capability outside those three is authorized by this note.

`Party` is the first vertical slice **only as a platform proving slice** — it exercises
Tenant -> Organization -> Party -> User -> Membership -> Role -> Permission -> Entity ->
Command -> State -> Event -> Audit. Keep it minimal and foundational. Do not grow it into
CRM, workforce, or customer management.

The milestone is **PLATFORM FOUNDATION READY** — never "Party Complete", "Work Order
Complete", or "First Client Complete".

### Foundation-ready definition

Foundation is ready only when a new capability can be registered, new entities / workflows /
permissions / events / specialized UI / client configuration introduced, and cross-capability
dependencies declared — each **without** modifying unrelated platform infrastructure, the
platform ontology, the workflow engine, the authorization architecture, the event
infrastructure, the application shell, or forking a reusable capability. Capabilities built
for one client must be reusable by the next.

### Build priority (in order)

1. Clean repository / bootstrap
2. Tenant isolation
3. Identity / membership
4. Authorization
5. Canonical entity runtime
6. Command / query infrastructure
7. State / transition infrastructure
8. Event / audit infrastructure
9. Rules / workflow infrastructure
10. Configuration / capability / extension infrastructure
11. Required data / sync infrastructure
12. Minimal experience shell / runtime
13. Foundation conformance tests

**Correction (2026-09-08, `taskplans/104_verity_native_configuration_
extension_architecture.md`):** items 9 and 10 are substantially already
built — `WorkflowDefinition`/`WorkflowNode`/`WorkflowEdge`/`EdgeCondition`
(`workflow.ts`), `TenantActivation`/`CapabilityDefinition`
(`capability.ts`), `CustomFieldSchema` + metadata-driven forms
(`experience.ts`), navigation contributions (`contribution.ts`) — just
never consolidated under these item numbers until that document checked.
This does not itself declare foundation-ready (item 13's conformance
tests are the gate for that claim); it only corrects "unbuilt," which
`adr-019` had repeated without checking.
14. Hypothetical future-capability validation

## Authority order

All development and technical implementations must conform strictly to the V2 Active Authority baseline. Canonical V2 documents are currently maintained as single-file master documents under `taskplans/`. Do not assume a directory-based corpus exists.

### 1. Active Canonical Documents
*   **V2-ADRs**: [taskplans/17A_verity_architecture_decisions.md](file:///d:/Code/verity/taskplans/17A_verity_architecture_decisions.md) (V2-ADR-* series, why we chose it)
*   **Verity Bible v2**: [taskplans/19_verity_bible_v2.md](file:///d:/Code/verity/taskplans/19_verity_bible_v2.md) (Product/architectural constitution)
*   **Verity Spec v2**: [taskplans/20_verity_spec_v2.md](file:///d:/Code/verity/taskplans/20_verity_spec_v2.md) (Technical specification)
*   **Combined Enterprise PRD**: [taskplans/18_combined_verity_prd.md](file:///d:/Code/verity/taskplans/18_combined_verity_prd.md) (Active product requirements)
*   **Spec Consistency Audit**: [taskplans/22_spec_consistency_audit.md](file:///d:/Code/verity/taskplans/22_spec_consistency_audit.md) (Active verification gates)
*   **Implementation Roadmap v2**: [taskplans/21_implementation_roadmap_v2.md](file:///d:/Code/verity/taskplans/21_implementation_roadmap_v2.md) (Sequenced milestone target roadmap)

### 2. Historical Reference Documents
*   `verity-bible/` and `verity-spec/` (Legacy v1, maintained for historical context only; DO NOT use for new architecture decisions)
*   Legacy `ADR-001` through `ADR-016` (Historical only; do not confuse with V2-ADR-* namespace)

### 3. Active Execution Documents
*   Task plans under `taskplans/` describing active engineering workstreams (e.g. `taskplans/23_portable_runtime_v2.md`, `taskplans/27_storage_abstraction.md`).

Conflict resolution: **Safety > Truth > Coherence > Usefulness > Simplicity > Flexibility > Polish**.

Every concrete technology choice must cite its authority using one of:
`Authority: V2-ADR-[N]` | `Authority: Bible V2 [section]` | `Authority: Spec V2 [REQ-ID]` | `Authority: EXISTING INFRASTRUCTURE` | `Authority: IMPLEMENTATION DECISION REQUIRED`.

## Experience System — approved visual direction (ADR-026, partially supersedes ADR-024/ADR-023/ADR-012)

**Layered material system (ADR-026, 2026-09-19).** Structural chrome and ordinary cards/panels
use the glass classes — `.glass-shell` / `.glass-card` / `.glass-control` / `.glass-overlay` —
with atmospheric color, translucent gradients, blur, edge light and controlled elevation. Dense
tables, forms, long-form text and destructive confirmation may use `.verity-solid` when opacity
improves reading or decision safety. **Do not glass individual rows, badges or status dots.**
Depth comes from a small number of deliberate material layers, never decorative gradients on
every child.

- **Default accent is Gold `#D4A017`** (ADR-024, reverting ADR-012's Verity Mint default) — one
  of the ten existing presets (Verity Mint, Warm Sand Gold, Champagne, Ocean Blue, Slate Blue,
  Indigo, Violet, Emerald, Rose, Graphite) plus custom hex, unchanged otherwise. **The current
  palette authority is `design/verity-aesthetics-v2-gold.png`** (gold-primary, copied into the
  repo 2026-09-18) — `design/verity asthetics.png` (mint-primary) is superseded, kept only for
  history.
- **Accent governs small/interactive surfaces only — never a large filled background** (new
  ADR-024 constraint ADR-012 lacked). Buttons, links, focus rings, active nav state, badges as a
  tint/outline: yes. A card or banner filled edge-to-edge with accent color: no — rebuild it as a
  bordered surface with a small accent touch (icon, label, edge) instead. The Outreach "Current
  Direction" banner's old full-fill treatment is the concrete defect this constraint targets.
- **Brand and accent are separate systems, unchanged.** The Verity mark is a fixed asset,
  monochrome, never recoloured by the interface — including in the favicon and app icon. Semantic
  colours stay independent of accent: accent is theme, semantic is meaning — success stays a leaf
  green regardless of accent hue.
- **The brand sheet is the palette authority for neutrals/type**, unaffected by the accent-default
  change. Neutrals are `#F7F8FA` · `#0F1115` · `#1C1F24` · `#2A2E33` · `#E6E8EB`; type is Inter
  (Thin / Light / Regular / Medium) — no font swap, size-specific tracking/leading discipline
  applies per ADR-024's typography clause; icons are thin outline.
- **Never hard-code an accent.** Everything derives from `--accent-seed` through `color-mix` in
  `globals.css`. Contrast is computed in `src/server/platform/accent.ts`, never assumed.
- **Motion is spring-based on interactive/transient surfaces** (new, ADR-024): critically damped
  (`damping 1.0`, `response ~0.35`) by default, slight bounce (`damping ~0.8`) only for genuinely
  gesture-driven interactions. `framer-motion` is the library (already a dependency). Respect
  `prefers-reduced-motion` (cross-fade, no spring/scale) the same way `prefers-reduced-
  transparency` already flattens glass to solid.
- **Never trade accessibility for appearance.** WCAG AA on both materials, both themes — carried
  forward unchanged through ADR-011 → ADR-023 → ADR-024.
- **Light and dark are two material interpretations of one system**, not two designs.

Anti-regression: do not glass a content surface or solid a chrome surface without checking
ADR-024's table first, do not hard-code any accent value into a component, do not recolour the
mark with the accent, do not collapse semantic success into the accent hue, do not fill a large
surface with flat accent color, do not reintroduce scarlet.

## Constitutional invariants (non-negotiable)

- **INV-001** Strict tenancy isolation — every read/write filtered by tenant; no cross-tenant foreign keys.
- **INV-002** Read-only closed states — a closed Work Order is permanently locked; rework spawns a child.
- **INV-003** Unified Party identity — one Party record per person/business; no split tables.
- **PRN-001** Least surprise / explainable automation.
- **PRN-002** Progressive disclosure of complexity.

Tenant context is derived from the authenticated authorization context, **never** from a
client-supplied request payload (Spec PLA-TEN-006, `[DECIDED]`).

## Database connection roles (INV-001 depends on this)

PostgreSQL does **not** enforce row-level security for a role that is `SUPERUSER`
or has `BYPASSRLS` — `FORCE ROW LEVEL SECURITY` does not change that. Such a
connection has no tenant isolation at all while every policy remains present and
every test still passes. Supabase's default `postgres` role has `rolbypassrls = true`
and must never carry application traffic.

- `DATABASE_URL` -> `verity_app` (`NOSUPERUSER NOBYPASSRLS`), the runtime connection.
  Point it at the pooler in **transaction mode (port 6543)** with `pgbouncer=true`.
  Session mode (5432) pins one server connection per client for that client's whole
  life out of a 15-connection project pool, and took production down with
  `EMAXCONNSESSION` once several serverless instances were live. `withTenant` is
  transaction-mode-safe by construction — the tenant GUC is `set_config(..., true)`
  and the only lock is `pg_advisory_xact_lock`, both transaction-scoped. Do not
  reintroduce session state that outlives a transaction.
- `DIRECT_URL` -> `postgres`, used only by `prisma migrate`.
- `assertRlsEnforceable()` in `src/server/platform/tenancy.ts` refuses a bypassing role
  at startup and in the isolation test. Do not weaken or bypass it.
- Migrations run as `postgres`; `ALTER DEFAULT PRIVILEGES` grants each new table to
  `verity_app` automatically, so no post-migration grant step is needed.
- Tenant scope is applied by `withTenant()`, which sets the `verity.tenant_id` GUC
  transaction-locally via `set_config`. With no scope set, queries return nothing and
  writes are rejected — isolation fails closed.

## Canonical terminology (Spec GOV-TER-001..017) — use these words only

| Use | Never |
|---|---|
| `Organization` (tenant boundary) | — |
| `Party` | `client_obj`, `contact_entity` |
| `User` (1:1 with Party) | — |
| `Work` (Work Order) | `job_card`, `task`, `ticket_item`, `event_run` |
| `ChecklistItem` | `Task` (reserved for project-level milestones) |
| `Location` (site) | `branch`, `depot`, `factory_outlet` |
| `Resource` | `employee_row`, `tool_entry` |
| `Request` (uncommitted intake) | — |
| `Activity` (change / comms log) | — |
| `Asset` (physical equipment) | — |
| `Contract` (agreement with SLA terms) | — |
| `Evidence` (immutable field data) | — |

## Forbidden patterns — legacy VEDA, grep-able, never write these

This repository is greenfield. Legacy VEDA lives only in git tag `veda-legacy-final` and is
non-authoritative. No `legacy_archive/` in the active tree. Never resurrect VEDA schemas,
workflows, routes, or terminology, and never add a compatibility layer for them.

1. `factoryId` / `factory_id` — use `tenantId` / `organizationId` (Spec PLA-TEN-001)
2. `Department` as a production stage (CAD/Cutting/Stitching/QC/Packing) — use dynamic state machines
3. SalesOrder automotive columns: `vehicleBrandId`, `vehicleModelId`, `vehicleYear`, `seatType`, `hasArmrest`, `headrestCount` — use custom fields (Spec PLA-EXT-001)
4. `ItemType` enum values: `RAW_MATERIAL`, `SEMI_FINISHED`, `FINISHED_PRODUCT`, `CONSUMABLE`, `PACKAGING`, `SPARE_PART`, `MACHINERY`, `TOOL`, `ASSET` — use extensible taxonomies
5. `SpecRefTarget` enum: `VEHICLE_BRAND`, `VEHICLE_MODEL`, `VEHICLE_GENERATION`, `DESIGN`, `COLOR`
6. `SystemRole` enum: `OWNER`, `CO_OWNER`, `MANAGER`, `SUPERVISOR`, `WORKER`, `STORE_MANAGER` — use dynamic Verb+Entity+Scope permissions
7. Entities `ProductionBatch`, `BomMode`, `QCTemplate`
8. `backdrop-filter`/blur on individual rows, badges or status dots; use the bounded material
  classes (`.glass-shell`/`.glass-card`/`.glass-control`/`.glass-overlay`) and follow ADR-026.
  Dense tables, forms, long-form text and destructive confirmation may remain `.verity-solid`.
  (`.verity-glass` as a bare class name remains forbidden.)
9. Routes `/owner`, `/worker`, `/inspector`, `/supervisor`, `/verity` (legacy role-based routing)
10. `@@map` to VEDA schema naming

Also forbidden: franchise/pack framing from the old product (`facility_management`,
`franchise_qsr`, `franchise_retail` as hardcoded pack keys), MES/manufacturing concepts, and
any requirement written because it is "common in ERP/SaaS" rather than traced to the spec.

## Accepted decisions currently in force

- **ADR-001** Party is a bare identity primitive. `Prospect` / `Invited` lifecycles belong to CRM / Workforce capabilities, not the platform.
- **ADR-003** `Completed` (execution terminal) is decoupled from `Closed` (administrative closure). INV-002 locks on `Closed`.
- **ADR-004** `Place`, `Address`, `Location`, `Geofence` are four distinct concepts. Geofences are policies, not Locations.
- **ADR-005** `Tenant` is the root data-isolation boundary; `Organization` is a nested business-unit hierarchy inside a Tenant. RLS is one *mechanism* for tenant isolation, not the product invariant.
- **ADR-006** Work sub-steps are `ChecklistItem`. `Task` is reserved for project-level milestones.
- **ADR-007** Party de-duplication is resolved by invitation + verification: provisioning creates an `Invited` Party with *unverified* contacts and never looks across tenants; identity is linked only when the person verifies a contact channel. Uniqueness is enforced over verified contacts only. `provisionIdentity()` correctly does not de-duplicate.
- **ADR-008** `Resource` is a single schedulable unit backed by exactly one `Party` or `Asset`. Crews, pools, rooms-as-sets and capacity groups are `ResourceGroup` compositions, not a parallel type. Availability and conflict detection run against Resources only. Supersedes ADR-002.
- **ADR-009** `StateCategory` is closed at `Draft | Pending | Active | Blocked | Completed | Cancelled` — behavioural, not domain. SLA clocks read `category` only, never `key` or `label`. Only `Completed` and `Cancelled` may be terminal.
- **ADR-010** The spec `Status` field records **provenance**, not ratification. Only `[UNKNOWN_REASON: INTENTIONALLY_DEFERRED]` (6 uses) withholds permission to implement; every other value is permissive. See `verity-spec/00_governance/status-taxonomy.md`.
- **ADR-011** Glass is a **controlled material system**, not a decoration. Translucency is
  permitted on persistent surfaces where it establishes depth and hierarchy, bound by six
  constraints (composited-contrast AA, capped blur layers, hierarchy-first, light/dark parity,
  reduced-transparency honoured, content over effect). Dense tables, long-form text, forms,
  semantic status and destructive confirmation stay solid. Supersedes the *interpretation* of
  Bible V4 §1.B recorded in `globals.css` and the shell audits — not §1.B's text. Its accent-default
  clause alone is superseded by ADR-012; the material system stands in full.
- **ADR-012** The brand sheet `design/verity asthetics.png` is the palette authority. Neutrals
  are reconciled to the sheet; semantic success is retuned away from the accent hue so status and
  theme cannot read as one signal; the mark is monochrome everywhere, including favicon and app
  icon. Supersedes ADR-011 in part — accent default only. **Its own default-accent clause
  (`#00D1B2`) is in turn superseded by ADR-024** (Gold `#D4A017`); every other ADR-012 mechanic
  (ten-preset system, monochrome mark, semantic independence) is unaffected.
- **ADR-023** (2026-09-17) Structured minimalism replaces glass as the default Experience
  System material — supersedes ADR-011's five-level glass hierarchy and four glass surface
  classes **in full**. Solid opaque cards, hairline borders, soft shadow-based elevation,
  warm-neutral light / navy dark themes, per then-current product-owner reference screens
  (Settings/Appearance + Home dashboard). **Partially superseded by ADR-024** — its solid-on-
  dense-content call stands; its "in full" claim over structural chrome does not.
- **ADR-024** (2026-09-18) Scoped glass returns for structural chrome (sidebar, top bar,
  command palette, modals, dropdowns/popovers) — reactivating the glass token system ADR-023
  stopped defaulting to but never deleted. Dense content stays solid, exactly as ADR-023
  specified. Default accent reverts Mint → Gold `#D4A017` (existing preset, not new), with a
  new constraint: accent is tint/interactive-only, never a large filled background. Adds a
  spring-based motion system (`framer-motion`, already a dependency) for interactive/transient
  surfaces. Full text: `verity-spec/17_decisions/adr/adr-024.md`. **Follow-up closed
  2026-09-18: the gold-primary board is now in-repo at `design/verity-aesthetics-v2-gold.png`**
  (copied from the product owner's machine, confirmed matching — Gold `#D4A017`, Inter Thin/
  Light/Regular/Medium/Semibold, monochrome mark variations, the same neutral values already
  listed above). It also gives exact typography specs the brand sheet previously left implicit:
  Heading 1 `32px/40` weight Light, Heading 2 `24px/32` weight Light, body Inter Regular — see
  the Experience System typography clause below. `design/verity asthetics.png` (mint-primary)
  is now superseded by this file on every question, not just accent default.

- **ADR-026** (2026-09-19) extends the glass material from structural chrome to ordinary
  cards and panels. `Surface` defaults to `.glass-card`; dense tables, forms, long-form text
  and destructive confirmation may explicitly use `.verity-solid` when opacity improves
  reading or decision safety. The atmospheric field and grain are active visual structure.
  Glass remains capped at shell/card/control/overlay and is never applied to individual rows,
  badges or status dots. Full text: `verity-spec/17_decisions/adr/adr-026.md`.

  **This list is a curated highlight reel, not the complete register, and is stale beyond what
  it explicitly names.** The canonical ADR register is `verity-spec/17_decisions/adr/`
  (`adr-001.md`…`adr-032.md` as of 2026-10-02; ADR-032 the public origin is configured as `VERITY_PUBLIC_URL`, never derived from the request or forwarded headers, ACCEPTED; ADR-027 Jev/external decision model, ADR-028 liquid-glass refraction over ADR-026's materials, ADR-029 external tool-invocation surface, PROPOSED; ADR-030 public verification passport, ACCEPTED; ADR-031 supported deployment modes — Mode A first, B/C not promised, PROPOSED) — ADR-013 (Global HQ Operator Security Model),
  ADR-014 (DEC-001 scope), ADR-015 (scheduled work trigger), ADR-016 (the scheduler may enumerate
  tenants), ADR-017 (below), ADR-018 (extract a generic Trading capability out of plywood),
  ADR-019 (below), ADR-020 (OIDC browser identity), ADR-021 (capability pins), and ADR-022
  (Industry Packs as signed artifacts) are all ACCEPTED there and are not summarized here.
  ADR-023/024/026 (above) are summarized because they directly override this section's own
  Experience System content. Check the register before assuming an ADR number is unused, the
  mistake that made ADR-017 necessary as a correction to begin with.
- **ADR-017** The AI/assistant channel (`PolicyChannel: "agent"` in `policy.ts`) executes every
  action as the calling human's own `ActorContext` — same tenant, same membership, same role, same
  grants, same `enforcePolicy()` gate every other caller passes through. `channel` is recorded on
  the decision and audit trail for provenance only and is consulted by no authorization rule. There
  is no service-account, elevated, or agent-specific authority path. This was already true in the
  runtime (`command.ts`, `policy.ts`, and `policy-engine.test.ts`'s four-channel parity assertion)
  before this ADR — the ADR ratifies it as constitutional rather than changing anything. Gates
  `taskplans/84_verity_ai_agent_system.md`; nothing in that file's six implementation areas may
  proceed without this holding. Full text: `verity-spec/17_decisions/adr/adr-017.md`. (Briefly
  misnumbered ADR-013 on first write — that number was already taken by the accepted Global HQ
  Operator Security Model decision; corrected same day, before any dependent work shipped beyond
  this file and the taskplans below.)
- **ADR-019** Payload CMS (or any comparable second application framework with its own
  database-access layer) is rejected as the authoritative control plane for any tenant-configurable
  Verity data — custom fields, workflow/approval definitions, feature/module configuration, or
  anything else whose correct value depends on `tenant_id`. Reason, in order of weight: it would
  introduce a second tenant-access enforcement surface with no RLS-equivalent (fails open by
  default, the opposite of INV-001's fail-closed design) and a second authorization decision point
  outside `enforcePolicy()`, which ADR-017 already forecloses. The audited *patterns* (declarative
  schema-as-data, metadata-driven forms, a local-API-style server helper, shadow-table versioning)
  remain worth adopting natively; Payload the dependency does not. A narrowly bounded future option
  — Payload confined only to content that is never tenant-scoped (marketing content, platform-global
  templates, SOPs, a read-only industry-template catalog) — is left open, not decided, pending its
  own trigger. This ADR does **not** settle item 10's native implementation shape — see
  `taskplans/104_verity_native_configuration_extension_architecture.md`, still DRAFT with 5 open
  questions. Full text: `verity-spec/17_decisions/adr/adr-019.md`; full comparative analysis:
  `taskplans/103_payload_cms_control_plane_adr.md`.

## Identity, authorization, and post-foundation platform substrate (already decided, do not re-litigate)

Moved to `src/server/platform/CLAUDE.md` (loads only when working under that directory):
Identity shape, Authorization shape, Platform substrate added after the foundation.

## Open — do not solve silently

- `implementation/02-foundation-build-order/vertical-slice-strategy.md` still lists `DEC-BIBLE-001` as open; it was resolved by ADR-001. The ADR wins.
- **`Global` scope is defined but never granted.** PLA-AUT-002 defines cross-tenant platform administration, but honouring it means bypassing the RLS that enforces INV-001. `verity.resolve_permissions` filters `Global` grants out, so such a row can exist without silently taking effect. Wiring it up needs a security decision and an ADR.
- ~~**No storage driver is bound.**~~ **CLOSED 2026-08-28.** Supabase Storage is bound in
  `src/server/storage/supabase.ts` and registered through the platform's extension point — nothing
  in `src/server/platform/` changed. The plywood client forced it: an LR scan is `Evidence`, and
  Evidence with no file is a row claiming a photograph exists. A deployment with the variables
  unset still runs; `files.ts` refuses at the point of use rather than at boot.
- **Credential encryption key location is an implementation decision.** MET-AUT-003 requires an encrypted credential registry but does not say where the key lives. It is currently supplied per call from the application environment and never stored in the database, so a dump yields ciphertext alone. A managed KMS would be stronger and needs a platform decision.
- **`own` permission scope is an open decision.** PLA-AUT-002 enumerates `Global | Tenant | Organization | Location`. `team` and `resource` need no platform change — they are axes and the scope-resolver registry handles them. `own` is actor-relative, appears in neither Bible nor spec, and needs an ADR before it is added.
- ~~**Nothing runs on a schedule.**~~ **CLOSED 2026-08-28.** ADR-015 bound the trigger
  (`POST|GET /api/scheduled`, constant-time secret, 503 rather than running unauthenticated) and
  ADR-016 permits it to enumerate tenants, because a tenant id is runtime data and a cron schedule
  is build-time configuration — a per-tenant schedule was unwritable, not merely verbose.
  `vercel.json` carries one cron per cadence. **`CRON_SECRET` must be set on the deployment or
  nothing runs**, by design.
- **The Bible is not editable without fresh explicit instruction.** AMD-001 (`factoryId` ->
  `tenantId`, Volume V §1.A.1 and Volume VI) and **AMD-002** (2026-09-18, Volume IV §1: added
  §1.C "Motion & Interruptibility" — absent from the Bible before ADR-024 needed to invent
  motion governance from nothing — plus one line under §1.A cross-referencing "Simplicity,
  not minimalism"; both `[PROPOSED]`, drafted and confirmed by the product owner before
  applying, per Task 115's own constraint) are the only two amendments made, both already
  applied. Do not modify `verity-bible/` again without a fresh explicit instruction.

## Stop conditions — escalate, do not improvise

Stop and surface the issue when: a foundation invariant is ambiguous; two authorities
conflict; an unresolved ADR affects the work; a security boundary is unclear; a new platform
primitive appears necessary; a capability would require undocumented modification of the
platform core; the work would force a client-specific fork.

Classify the gap as **missing specification**, **conflicting specification**, **missing ADR**,
or **implementation decision required** — then continue only with work that is unblocked.
Never fill a gap with generic engineering knowledge, and never promote an implementation
choice into a constitutional rule.

Distinguish: product requirement / domain rule / architectural decision / implementation
decision. Implementation mechanics (file organization inside the approved structure, internal
helpers) are autonomous. Anything affecting product behavior is not.

## Security rule

Security is part of the foundation, never bolted on later. For every mutating operation
determine: actor, authorization, scope, preconditions, state mutation, audit, events, failure
behavior. Tenant isolation and authorization semantics hold from the first commit.
Never expose real secret values in documentation or code.

## Command / state / event vocabulary — do not blur

`Command` = request to perform an action. `State` = current business condition.
`Event` = fact that something happened. `Query` = read current state.
`Projection` = derived read representation. Never bypass the prescribed write path.

## Repository structure (target)

```
src/
  app/            (hq)/ (owner)/ (worker)/ (portal)/ shells + api/   [Bible V4]
  server/         platform/ (tenancy, auth, identity)
                  capabilities/ (one directory per capability)
                  runtime/ (entity, command, query, state, event)
  lib/ components/ui/ hooks/ types/ test/
prisma/           schema.prisma, migrations/
```

No UI or hooks in `src/server/`. No Prisma imports in `src/app/` (except API routes) or
`src/components/` — all DB access goes through `src/server/`. Unit tests sit beside their
source; integration tests in `src/test/`.

System of record is Prisma/Postgres (Authority: Bible V1).

## Implementation loop

```
READ SPEC -> IDENTIFY REQUIREMENT IDS -> CHECK DEPENDENCIES -> IMPLEMENT -> WRITE TESTS
-> RUN TESTS -> SPEC-CONFORMANCE CHECK -> CHECK ARCHITECTURAL BOUNDARIES
-> CHECK FOR LEGACY CONTAMINATION -> TRACE TO SPEC -> COMMIT
```

Code compiling is not completion.

## Reporting vocabulary — keep these distinct

- **BUILT** — platform infrastructure actually implemented.
- **PROVEN** — foundation behavior validated by passing tests.
- **DEMONSTRATED** — a hypothetical capability modeled on the foundation (on paper).
- **NOT YET BUILT** — business capability intentionally unimplemented.

Never report hypothetical composition as implemented functionality.

Before declaring a milestone complete, answer: requirements implemented / not implemented;
tests; architecture conformance PASS or FAIL; legacy contamination NONE or FOUND; open
decisions; known deviations; ready for next milestone YES or NO.

## graphify

Knowledge graph at `graphify-out/` (structural only — document, heading, and cross-reference
edges; no semantic pass has been run).

- For questions about the corpus, run `graphify query "<question>"` when `graphify-out/graph.json` exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for a focused subgraph. These return far less than `GRAPH_REPORT.md` or raw grep.
- Read `graphify-out/GRAPH_REPORT.md` only for broad review, or when query/path/explain do not surface enough.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

Bible **Volume 2 (Metamodel Primitives)** is the load-bearing document — 85% of all
spec-to-bible citations resolve there. Volume 5 (Operations & Security) is second.

Next.js 16 has breaking changes from earlier versions — read `node_modules/next/dist/docs/`
before touching framework-sensitive code.



# CLAUDE.md — Frontend Website Rules

## Always Do First
- **Invoke the `impeccable` skill** (`~/.claude/skills/impeccable/SKILL.md`) before writing any frontend
  code, every session, no exceptions. It is the standing craft authority; the Experience System section
  above (ADR-011, ADR-012) still decides Verity's specifics — accent tokens, material hierarchy, the
  monochrome mark — and impeccable never overrides an accepted ADR.

## Reference Images
- If a reference image is provided: match layout, spacing, typography, and color exactly. Swap in placeholder content (images via `https://placehold.co/`, generic copy). Do not improve or add to the design.
- If no reference image: design from scratch with high craft (see guardrails below).
- Screenshot your output, compare against reference, fix mismatches, re-screenshot. Do at least 2 comparison rounds. Stop only when no visible differences remain or user says so.

## Local Server
- **Always serve on localhost** — never screenshot a `file:///` URL.
- Start the dev server: `node serve.mjs` (serves the project root at `http://localhost:3000`)
- `serve.mjs` lives in the project root. Start it in the background before taking any screenshots.
- If the server is already running, do not start a second instance.

## Screenshot Workflow
- Puppeteer is installed at `C:/Users/nateh/AppData/Local/Temp/puppeteer-test/`. Chrome cache is at `C:/Users/nateh/.cache/puppeteer/`.
- **Always screenshot from localhost:** `node screenshot.mjs http://localhost:3000`
- Screenshots are saved automatically to `./temporary screenshots/screenshot-N.png` (auto-incremented, never overwritten).
- Optional label suffix: `node screenshot.mjs http://localhost:3000 label` → saves as `screenshot-N-label.png`
- `screenshot.mjs` lives in the project root. Use it as-is.
- After screenshotting, read the PNG from `temporary screenshots/` with the Read tool — Claude can see and analyze the image directly.
- When comparing, be specific: "heading is 32px but reference shows ~24px", "card gap is 16px but should be 24px"
- Check: spacing/padding, font size/weight/line-height, colors (exact hex), alignment, border-radius, shadows, image sizing

## Output Defaults
- Single `index.html` file, all styles inline, unless user says otherwise
- Tailwind CSS via CDN: `<script src="https://cdn.tailwindcss.com"></script>`
- Placeholder images: `https://placehold.co/WIDTHxHEIGHT`
- Mobile-first responsive

## Brand Assets
- Always check the `brand_assets/` folder before designing. It may contain logos, color guides, style guides, or images.
- If assets exist there, use them. Do not use placeholders where real assets are available.
- If a logo is present, use it. If a color palette is defined, use those exact values — do not invent brand colors.

## Anti-Generic Guardrails
- **Colors:** Never use default Tailwind palette (indigo-500, blue-600, etc.). Pick a custom brand color and derive from it.
- **Shadows:** Never use flat `shadow-md`. Use layered, color-tinted shadows with low opacity.
- **Typography:** Never use the same font for headings and body. Pair a display/serif with a clean sans. Apply tight tracking (`-0.03em`) on large headings, generous line-height (`1.7`) on body.
- **Gradients:** Layer multiple radial gradients. Add grain/texture via SVG noise filter for depth.
- **Animations:** Only animate `transform` and `opacity`. Never `transition-all`. Use spring-style easing.
- **Interactive states:** Every clickable element needs hover, focus-visible, and active states. No exceptions.
- **Images:** Add a gradient overlay (`bg-gradient-to-t from-black/60`) and a color treatment layer with `mix-blend-multiply`.
- **Spacing:** Use intentional, consistent spacing tokens — not random Tailwind steps.
- **Depth:** Surfaces should have a layering system (base → elevated → floating), not all sit at the same z-plane.

## Hard Rules
- Do not add sections, features, or content not in the reference
- Do not "improve" a reference design — match it
- Do not stop after one screenshot pass
- Do not use `transition-all`
- Do not use default Tailwind blue/indigo as primary color
