import { ENTITY_MEMBERSHIP, ENTITY_MEMBERSHIP_ACCESS, ENTITY_ROLE } from "@/server/platform/administration";
import { ENTITY_PIECEWORK_LOT_COST } from "./costs";
import { ENTITY_PIECEWORK_ROLL, ENTITY_PIECEWORK_ROLL_MOVE } from "./fabric";
import { ENTITY_PIECEWORK_APPROVAL, ENTITY_PIECEWORK_DAY_CLOSE, ENTITY_PIECEWORK_SETTING, ENTITY_PIECEWORK_STAGE_ASSIGNMENT } from "./floor";
import { ENTITY_PIECEWORK_LOT_RATE, ENTITY_PIECEWORK_REASON } from "./setup";

/**
 * The roles a garment factory starts with, as data. The capability's code knows no role name: a role is only the grants listed
 * here, and a workspace can edit them afterwards on `/roles`. The stage scope is the grant ActionExecute on the stage entity:
 * whoever holds it works at every stage; a supervisor does not, and is limited to the stages the owner assigns. A supervisor holds
 * no grant on workers, payments, fabric or costs, so no rate, wage, balance or roll reaches them.
 *
 * Repeated entity keys (those `index.ts` defines) are written out here because `index.ts` imports this file's neighbours.
 */
const STAGE = "verity.piecework.stage";
const LOT = "verity.piecework.lot";
const BUNDLE = "verity.piecework.bundle";
const WORKER = "verity.piecework.worker";
const ENTRY = "verity.piecework.entry";
const PAYMENT = "verity.piecework.payment";
/** The evidence capability's entity key, written out: this capability reaches it only through grants, never through an import. */
const ENTITY_EVIDENCE = "verity.evidence.evidence";

export type PresetVerb = "Read" | "Create" | "Edit" | "ActionExecute";
export type PresetGrant = readonly [entity: string, verbs: readonly PresetVerb[]];
export type RolePreset = { name: string; summary: string; grants: readonly PresetGrant[] };

const ALL: readonly PresetVerb[] = ["Read", "Create", "Edit", "ActionExecute"];
const full = (entities: readonly string[]): PresetGrant[] => entities.map((e) => [e, ALL]);

const CORE = [STAGE, LOT, BUNDLE, WORKER, ENTRY, PAYMENT];
const FLOOR = [ENTITY_PIECEWORK_APPROVAL, ENTITY_PIECEWORK_DAY_CLOSE, ENTITY_PIECEWORK_SETTING, ENTITY_PIECEWORK_STAGE_ASSIGNMENT, ENTITY_PIECEWORK_REASON];
const OFFICE = [ENTITY_PIECEWORK_LOT_RATE, ENTITY_PIECEWORK_ROLL, ENTITY_PIECEWORK_ROLL_MOVE, ENTITY_PIECEWORK_LOT_COST];

export const ROLE_PRESETS: readonly RolePreset[] = [
  {
    name: "Owner",
    summary: "Everything, including adding people, choosing their roles, rates, limits and every payment.",
    grants: [
      ...full([...CORE, ...FLOOR, ...OFFICE, ENTITY_EVIDENCE]),
      [ENTITY_MEMBERSHIP, ["Read", "Create", "Edit"]], [ENTITY_MEMBERSHIP_ACCESS, ["Read", "ActionExecute"]], [ENTITY_ROLE, ["Read", "Create", "Edit"]],
    ],
  },
  {
    name: "Manager",
    summary: "Runs lots, fabric, karigars, payments and approvals within the limits the owner sets. Cannot add people or change limits.",
    grants: [
      ...full([...CORE, ...OFFICE]),
      [ENTITY_PIECEWORK_APPROVAL, ALL], [ENTITY_PIECEWORK_SETTING, ["Read"]], [ENTITY_PIECEWORK_STAGE_ASSIGNMENT, ["Read"]],
      [ENTITY_PIECEWORK_DAY_CLOSE, ["Read"]], [ENTITY_EVIDENCE, ["Read", "Create"]],
    ],
  },
  {
    name: "Supervisor",
    summary: "Gives out and takes back at the stages assigned to them, records short pieces and closes the day. Sees no rate, wage or balance.",
    grants: [
      [STAGE, ["Read"]], [LOT, ["Read"]], [BUNDLE, ["Read"]],
      [ENTRY, ["Read", "Create", "ActionExecute"]], [ENTITY_PIECEWORK_APPROVAL, ["Read", "Create"]],
      [ENTITY_PIECEWORK_DAY_CLOSE, ["Read", "Create"]], [ENTITY_EVIDENCE, ["Read", "Create"]],
    ],
  },
  {
    name: "Munshi",
    summary: "The office clerk: daily entry, lots, karigars, fabric and payments. Asks for approvals, does not give them.",
    grants: [
      ...full([...CORE, ...OFFICE]),
      [ENTITY_PIECEWORK_APPROVAL, ["Read", "Create"]], [ENTITY_PIECEWORK_DAY_CLOSE, ["Read", "Create"]], [ENTITY_EVIDENCE, ["Read", "Create"]],
    ],
  },
  {
    name: "Store",
    summary: "Receives fabric rolls, prints labels and moves rolls. Sees lots and bundles, no money and no karigar rates.",
    grants: [
      ...full([ENTITY_PIECEWORK_ROLL, ENTITY_PIECEWORK_ROLL_MOVE]),
      [STAGE, ["Read"]], [LOT, ["Read"]], [BUNDLE, ["Read"]], [ENTRY, ["Read"]], [ENTITY_EVIDENCE, ["Read", "Create"]],
    ],
  },
  {
    name: "Cutting master",
    summary: "Cuts a lot into bundles from the rolls and prints the slips. Sees no money and no karigar rates.",
    grants: [
      [STAGE, ["Read"]], [LOT, ["Read"]], [BUNDLE, ["Read", "Create"]],
      [ENTITY_PIECEWORK_ROLL, ["Read"]], [ENTITY_PIECEWORK_ROLL_MOVE, ["Read", "Create"]], [ENTITY_EVIDENCE, ["Read", "Create"]],
    ],
  },
];

/** The preset a role name matches, if any (names are the preset's identity; a workspace may rename a role and lose the match). */
export const presetNamed = (name: string) => ROLE_PRESETS.find((p) => p.name === name);

/** One row per verb, for inserting a preset's grants as permissions. */
export const presetPermissions = (preset: RolePreset) =>
  preset.grants.flatMap(([entity, verbs]) => verbs.map((verb) => ({ verb, entity, scope: "Tenant" as const })));

/**
 * Where each person opens when they sign in or press the logo: the page their work is on, never the platform's own Overview (asset
 * states, grants and an event log), which means nothing to a factory. Derived from what the role can DO, not from its name, so a role
 * the factory renames or builds itself still lands somewhere sensible. A null answer leaves the caller to decide.
 */
export function pieceworkLandingRouteFor(resolved: Array<{ verb: string; entity: string }>): string | null {
  const has = (verb: string, entity: string) => resolved.some((p) => p.verb === verb && p.entity === entity);
  // Whoever reads lots and money (owner, manager, munshi) opens on the factory dashboard.
  if (has("Read", LOT) && has("Read", PAYMENT)) return "/lots/dashboard";
  // Whoever gives out and takes back (a supervisor) opens on their floor.
  if (has("Read", ENTRY) && has("Create", ENTRY)) return "/shopfloor";
  // Whoever cuts lots (the cutting master, who has no money) opens on the lots; the store, on the fabric.
  if (has("Create", BUNDLE)) return "/lots";
  if (has("Read", ENTITY_PIECEWORK_ROLL)) return "/fabric";
  if (has("Read", LOT)) return "/lots";
  return null;
}
