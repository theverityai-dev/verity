import "server-only";
import { registerLocationCapability } from "./location";
import { registerAssetCapability } from "./asset";
import { registerEvidenceCapability } from "./evidence";
import { registerSchedulingCapability } from "./scheduling";
import { registerApprovalCapability } from "./approval";
import { registerDineinCapability } from "./dinein";
import { registerTradingCapability } from "./trading";
import { registerPlywoodCapability } from "./plywood";
import { registerAccountingCapability } from "./accounting";
import { registerInventoryCapability } from "./inventory";
import { registerManufacturingCapability } from "./manufacturing";
import { registerDecisionNode } from "@/server/platform/decision";
import { registerHrCapability } from "./hr";
import { registerBillingCapability } from "./billing";
import { registerRecipeCapability } from "./recipe";
import { registerCrmCapability } from "./crm";
import { registerLoyaltyCapability } from "./loyalty";
import { registerCouponCapability } from "./coupon";
import { registerComplaintCapability } from "./complaint";
import { registerAttendanceCapability } from "./attendance";
import { registerFinanceCapability } from "./finance";
import { registerOutreachCapability } from "./outreach";
import { installStorage } from "@/server/storage";

/**
 * Installs every shipped capability into the running process.
 *
 * Registration is idempotent by guard rather than by making registerCommand
 * tolerant of duplicates: a genuine duplicate key is a real defect and should
 * still throw. Next.js may evaluate a module more than once per process, which
 * is not a defect, so the guard lives here.
 */
let installed = false;

export function installCapabilities(): void {
  if (installed) return;
  installed = true;
  // The storage binding rides the same bootstrap because every entry point
  // already calls this one, and a second install function would be a second
  // thing to remember. It is NOT a capability: it registers a deployment
  // backend through the platform's extension point, and it is silent when this
  // deployment has none configured.
  installStorage();
  // A workflow node type, not a capability: it is inert until a workflow names
  // it AND the tenant has activated the egress capability (ADR-027).
  registerDecisionNode();
  registerLocationCapability();
  registerAssetCapability();
  registerEvidenceCapability();
  registerSchedulingCapability();
  registerApprovalCapability();
  registerDineinCapability();
  registerTradingCapability();
  registerPlywoodCapability();
  // Task 84 Phase 4, built ahead of demand under explicit product-owner
  // override 2026-09-04 — see taskplans/96_pending_roadmap_phases.md.
  registerAccountingCapability();
  registerInventoryCapability();
  registerManufacturingCapability();
  registerHrCapability();
  registerBillingCapability();
  registerRecipeCapability();
  registerCrmCapability();
  registerLoyaltyCapability();
  registerCouponCapability();
  registerComplaintCapability();
  registerAttendanceCapability();
  registerFinanceCapability();
  registerOutreachCapability();
}
