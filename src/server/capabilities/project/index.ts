import { registerCommand } from "@/server/platform/command";
import { registerContribution } from "@/server/platform/contribution";
import {
  addQuoteRevision,
  approveQuote,
  cancelJob,
  completeJob,
  createJob,
  defineLostReason,
  editJob,
  holdJob,
  linkOrder,
  markJobLost,
  resumeJob,
  setLostReasonActive,
  startJob,
} from "./jobs";
import {
  addCost,
  addMilestone,
  addTaskDependency,
  createTask,
  editMilestone,
  editTask,
  logTime,
  reachMilestone,
  setTaskState,
  voidCostEntry,
  voidTimeEntry,
} from "./work";
import { recordInvoice, recordReceipt, voidInvoice, voidReceipt } from "./billing";
import { ENTITY_CUSTOMER } from "@/server/capabilities/trading/keys";
import { ENTITY_PROJECT_JOB, PROJECT_CAPABILITY } from "./shared";

/**
 * CAPABILITY: Project (Jobs) — `verity.capability.project`.
 *
 * First client: D & S Electric Works (clients/dsew/prd.md). A Job is an engineered order
 * run end to end: enquiry, quote revisions, approval, tasks and milestones, time and cost,
 * linked production orders. It composes manufacturing and inventory and adds nothing to
 * the platform core.
 *
 * Source of truth for every number the screens show:
 *  - Quoted value: the approved quote revision, snapshotted onto the job at approval.
 *  - Material cost: consumed quantities of linked production orders at each item's current
 *    moving-average cost (an estimate; issue movements do not snapshot a unit cost).
 *  - Labour cost: non-void time entries, hours x the hourly rate recorded on each entry.
 *  - Other cost: non-void cost entries.
 *  - Margin: quoted value minus the three costs. Derived on every read, never stored.
 *
 * Customer: a job points at the trading customer master (`customerId`); the name on the job is
 * a snapshot taken when it was opened.
 *
 * Billing: invoices the business raised and money received are RECORDED against the job as entered
 * (billing.ts); nothing is computed. Generating a GST invoice from a job is NOT built, because trading's
 * invoice engine bills stocked catalogue products issued from a godown and a made-to-order job is not that.
 * NOT YET BUILT: HR employees for time entries.
 */

export {
  PROJECT_CAPABILITY,
  ENTITY_PROJECT_JOB,
  ENTITY_PROJECT_QUOTE,
  ENTITY_PROJECT_MILESTONE,
  ENTITY_PROJECT_TASK,
  ENTITY_PROJECT_TIME_ENTRY,
  ENTITY_PROJECT_COST_ENTRY,
  ENTITY_PROJECT_LOST_REASON,
  ENTITY_PROJECT_INVOICE,
  ENTITY_PROJECT_RECEIPT,
  jobReference,
} from "./shared";
export * from "./jobs";
export * from "./work";
export * from "./billing";
export { jobBilling, jobCosting, jobDetail, listJobs, summaryData, taskProgress } from "./reads";

/**
 * Where a person who can read jobs lands. The generic Overview is platform vocabulary, so a
 * tenant running Jobs opens on its own Summary instead (same mechanism as the other packs).
 */
export function projectLandingRouteFor(resolved: Array<{ verb: string; entity: string }>): string | null {
  return resolved.some((p) => p.verb === "Read" && p.entity === ENTITY_PROJECT_JOB) ? "/summary" : null;
}

export function registerProjectCapability(): void {
  registerContribution({
    capabilityId: PROJECT_CAPABILITY,
    navigation: [
      {
        href: "/summary",
        label: "Summary",
        group: "Overview",
        order: 1,
        icon: "overview",
        requiresEntity: ENTITY_PROJECT_JOB,
        shells: ["platform", "operations"],
      },
      {
        href: "/customers",
        label: "Customers",
        group: "Trade",
        order: 19,
        icon: "parties",
        requiresEntity: ENTITY_CUSTOMER,
        shells: ["platform", "operations"],
      },
      {
        href: "/jobs",
        label: "Jobs",
        group: "Trade",
        order: 20,
        icon: "workspace",
        requiresEntity: ENTITY_PROJECT_JOB,
        shells: ["platform", "operations"],
      },
    ],
  });
  for (const command of [
    createJob,
    editJob,
    addQuoteRevision,
    approveQuote,
    markJobLost,
    startJob,
    holdJob,
    resumeJob,
    completeJob,
    cancelJob,
    linkOrder,
    defineLostReason,
    setLostReasonActive,
    createTask,
    editTask,
    editMilestone,
    addTaskDependency,
    setTaskState,
    addMilestone,
    reachMilestone,
    logTime,
    voidTimeEntry,
    addCost,
    voidCostEntry,
    recordInvoice,
    voidInvoice,
    recordReceipt,
    voidReceipt,
  ]) {
    registerCommand(command as never);
  }
}
