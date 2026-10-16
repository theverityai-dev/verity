import { describe, expect, it } from "vitest";
import {
  ENTITY_MANUFACTURING_BATCH,
  ENTITY_MANUFACTURING_BOM,
  ENTITY_MANUFACTURING_OPERATION,
  ENTITY_MANUFACTURING_ORDER,
  ENTITY_MANUFACTURING_ROUTE,
  MANUFACTURING_CAPABILITY,
  manufacturingLandingRouteFor,
  registerManufacturingCapability,
} from "@/server/capabilities/manufacturing";
import { navigationFor } from "@/server/platform/contribution";

/**
 * The shop-floor roles seeded by prisma/seed-dsew-roles.ts, as grants. Navigation, the phone tab bar and the
 * landing page are all derived from grants, so this proves what a worker is shown without logging in as one.
 */
type Grant = { verb: string; entity: string };
const grants = (entries: Array<[string, string[]]>): Grant[] => entries.flatMap(([entity, verbs]) => verbs.map((verb) => ({ verb, entity })));

const FLOOR_WORKER = grants([[ENTITY_MANUFACTURING_OPERATION, ["Read", "ActionExecute"]]]);
const SUPERVISOR = grants([
  [ENTITY_MANUFACTURING_OPERATION, ["Read", "ActionExecute"]],
  [ENTITY_MANUFACTURING_ORDER, ["Read"]],
  [ENTITY_MANUFACTURING_ROUTE, ["Read"]],
  [ENTITY_MANUFACTURING_BOM, ["Read"]],
  [ENTITY_MANUFACTURING_BATCH, ["Read"]],
]);

let registered = false;
function menuFor(held: Grant[]): string[] {
  if (!registered) registerManufacturingCapability();
  registered = true;
  return navigationFor({
    activeCapabilityIds: [MANUFACTURING_CAPABILITY],
    shell: "platform",
    canRead: (entity, verb) => held.some((g) => g.entity === entity && g.verb === verb),
  }).map((item) => item.href);
}

describe("shop-floor roles", () => {
  it("a floor worker sees the Shop floor and nothing else, and lands on it", () => {
    expect(menuFor(FLOOR_WORKER)).toEqual(["/manufacturing/floor"]);
    expect(manufacturingLandingRouteFor(FLOOR_WORKER)).toBe("/manufacturing/floor");
  });

  it("a supervisor also sees orders, bills of materials, routes and batches, but not money", () => {
    const menu = menuFor(SUPERVISOR);
    expect(menu).toEqual(expect.arrayContaining(["/manufacturing/floor", "/manufacturing", "/manufacturing/boms", "/manufacturing/routes", "/manufacturing/batches"]));
    expect(menu.some((href) => /accounting|customers|jobs|summary|inventory\/purchase/.test(href))).toBe(false);
  });

  it("a role with no stage access has no floor landing", () => {
    expect(manufacturingLandingRouteFor([])).toBeNull();
  });
});
