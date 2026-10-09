import { captureError } from "./observability";
import "server-only";
import type { PermissionVerb } from "@prisma/client";
import { withTenant, type TenantScopedClient } from "./tenancy";
import { CapabilityError, requireCapabilityReady } from "./capability";
import { recordCapabilityDenial } from "./execution-failure";

/**
 * Capability experience contributions.
 *
 * Authority: PLA-CAP-001 (a capability registers its metadata with the
 * platform), Bible V1 §3 ("standardize the foundation, not every behavior"),
 * foundation-ready condition F (new specialised UI without rewriting the shell).
 *
 * This closes a real violation. Until now the shell held a hard-coded map from
 * capability id to route, so every new capability required an edit to
 * platform code — precisely the coupling the capability system exists to
 * prevent. A capability now declares its own surfaces and the shell reads them.
 *
 * Deliberately NOT a universal screen renderer. A contribution declares *where*
 * a capability appears and *what* it may do there; it does not describe how to
 * draw the page. Scheduling needs a time grid and Approval needs a queue, and
 * forcing both through one generic renderer would trade real usability for
 * uniformity nobody asked for. Metadata-driven screens remain available for the
 * cases that suit them (see `experience.ts`), and purpose-built screens remain
 * available for the cases that do not.
 */

/** Where in the shell a contribution appears. */
/**
 * The heading a navigation entry sits under.
 *
 * `Platform`, `Capabilities` and `Administration` are the platform's own
 * vocabulary and remain for platform surfaces. The business groups were added
 * in the plywood workflow programme (taskplans/45 §8): a client should read
 * their own words in the sidebar, and "Capabilities" is an implementation
 * concept leaking into the product.
 *
 * A closed union rather than a free string, deliberately — the sidebar has to
 * render these in a deliberate order, and an open set means the next
 * capability invents a sixth heading nobody designed a position for.
 */
export type NavigationGroup =
  | "Platform"
  | "Capabilities"
  | "Administration"
  // Business groups, in the order the sidebar renders them.
  | "Overview"
  | "Trade"
  | "Inventory"
  | "Money"
  | "Insights";

/**
 * Which shell a surface belongs to.
 *
 * Bible V4 §2 defines four role-centric shells. A capability declares which it
 * contributes to, so a Worker-only surface never appears in an admin console
 * even for an administrator who technically holds the permission.
 */
export type ShellKind = "platform" | "operations" | "worker" | "external";

export type NavigationContribution = {
  /** Route the shell links to. Owned by the capability, not the platform. */
  href: string;
  label: string;
  group?: NavigationGroup;
  shells?: ShellKind[];
  /**
   * Entity the actor must be able to read for this to appear. A menu item that
   * leads to E_FORBIDDEN is worse than no menu item.
   */
  requiresEntity?: string;
  requiresVerb?: PermissionVerb;
  /** Lower sorts first; ties fall back to label order. */
  order?: number;
  /**
   * Name of an icon from the platform's design-system set.
   *
   * Deliberately a plain string rather than the UI layer's `IconName` union:
   * `src/server/` must not import from `src/components/`, and inverting that to
   * satisfy a type would put the design system upstream of the platform. The
   * shell narrows it with `isIconName()` and falls back when a capability names
   * an icon that does not exist, so a typo costs a glyph rather than a render.
   *
   * A capability picks an icon; it never ships SVG. That keeps the platform
   * ignorant of what a capability looks like while keeping the icon set a
   * design-system concern rather than something each capability re-decides.
   */
  icon?: string;
  /**
   * Generic routes this entry presents in the capability's own vocabulary.
   *
   * WHY THE PLATFORM NEEDS THIS AT ALL. A shared capability contributes a
   * generic entry — `/locations`, `/assets` — and a domain pack presents the
   * same underlying concept under the word its client actually uses. A plywood
   * business has godowns; it does not have "Locations", and showing both is
   * the foundation leaking into the product (target user flow §0).
   *
   * The alternative was for the shared capability to know which packs might
   * replace it, which inverts the dependency: `location` would have to name
   * `plywood`, and every future pack after it. Declaring supersession from the
   * side that has the better word keeps the shared capability ignorant, which
   * is what lets it be reused by the next client.
   *
   * This hides a NAVIGATION ENTRY and nothing else. The route still exists,
   * still authorizes, and is still reachable by anyone who has its link. It is
   * a vocabulary decision, never a permission one — a capability must not be
   * able to grant or remove access by contributing navigation.
   */
  supersedes?: string[];
};

/**
 * A count or short status a capability offers to the workspace queue.
 *
 * Returns a number, not a rendered card: Bible V4 §3 says a workspace is for
 * executing, so the shell decides presentation and the capability supplies only
 * what is waiting. This is also what keeps §31's "no fake metrics" enforceable —
 * a capability can only report something it can actually count.
 */
export type WorkspaceContribution = {
  key: string;
  label: string;
  href: string;
  /** Must return a real count. Return 0, never a placeholder. */
  count: (context: {
    tx: TenantScopedClient;
    tenantId: string;
    roleId: string | null;
    userId: string;
  }) => Promise<number>;
  shells?: ShellKind[];
};

/**
 * How often a piece of recurring work should run.
 *
 * A cadence, not a cron expression. A capability knows that a clock must be
 * swept "often" or that a digest is "daily"; it does not know whether
 * production runs on Vercel Cron, a worker loop, or something not yet chosen,
 * and encoding `0 3 * * *` here would make the capability responsible for a
 * decision that belongs to the deployment. The provider adapter translates.
 *
 * The set is deliberately closed and short. An open cron string is a
 * configuration language, and every value in it is a promise the platform would
 * have to keep on every provider it ever binds.
 */
export type ScheduleCadence = "frequent" | "hourly" | "daily" | "weekly";

/**
 * Recurring work a capability needs the platform to run for it.
 *
 * Authority: PLA-CAP-001 (a capability registers its metadata with the
 * platform). No authority names a scheduler vendor —
 * `verity-spec/07_workflow_automation/scheduler.md` concerns resource
 * availability slot math and is `FUTURE_CAPABILITY`; the Temporal material
 * under `verity-bible/reference/` is research evidence, not implementation
 * authority. So this declares WHAT must recur and leaves WHEN and BY WHAT to
 * the deployment.
 *
 * Three concerns, deliberately separated:
 *
 *   DECLARATION  this type — a capability says "I have recurring work"
 *   PROVIDER     a deployment adapter that decides when to call `runDueWork`
 *   EXECUTION    `runDueWork` below, which invokes handlers under `withTenant`
 *
 * A capability depends only on the first. It can be written, tested and shipped
 * before any provider exists, and survives the provider being replaced.
 */
export type ScheduleContribution = {
  /** Stable identifier, unique within the capability. Used for logs and idempotency. */
  key: string;
  /** What this work is, in the product's own words. Appears in operator-facing logs. */
  label: string;
  cadence: ScheduleCadence;
  /**
   * The work itself.
   *
   * Receives a tenant-scoped client, so it inherits RLS, the tenant GUC and the
   * transaction budget exactly as a command does — there is no privileged
   * scheduling path around tenancy. It returns the events it produced, matching
   * the shape command handlers already use, so scheduled work feeds the same
   * event and audit streams as any other write.
   *
   * MUST be idempotent. A scheduler that guarantees exactly-once delivery does
   * not exist; every real provider retries, and the platform will not pretend
   * otherwise.
   */
  run: (context: {
    tx: TenantScopedClient;
    tenantId: string;
    now: Date;
  }) => Promise<{ events?: Array<{ name: string; entityId?: string }> }>;
};

export type CapabilityContribution = {
  capabilityId: string;
  navigation?: NavigationContribution[];
  workspace?: WorkspaceContribution[];
  schedules?: ScheduleContribution[];
};

const contributions = new Map<string, CapabilityContribution>();

/** Registers a capability's experience contributions. Idempotent by capability. */
export function registerContribution(contribution: CapabilityContribution): void {
  contributions.set(contribution.capabilityId, contribution);
}

export function clearContributions(): void {
  contributions.clear();
  platformSchedules.clear();
}

/** The capability id reported for recurring work the platform itself owns. */
export const PLATFORM_SCHEDULE_OWNER = "verity.platform";

const platformSchedules = new Map<string, ScheduleContribution>();

/**
 * Recurring work that belongs to no capability, such as draining the event
 * outbox (ADR-039). Same contract as a capability's schedule (idempotent, run
 * under the tenant's own scope), but it is not gated on a capability being
 * active, because no capability owns it. A duplicate key is a defect and throws.
 */
export function registerPlatformSchedule(unit: ScheduleContribution): void {
  if (platformSchedules.has(unit.key)) throw new Error(`E_SCHEDULE_DUPLICATE: ${unit.key}`);
  platformSchedules.set(unit.key, unit);
}

export function contributionFor(capabilityId: string): CapabilityContribution | undefined {
  return contributions.get(capabilityId);
}

/**
 * Navigation for the active capabilities, filtered by what the actor can read.
 *
 * Three filters, each necessary and none sufficient alone: the capability must
 * be activated for the tenant (PLA-CAP-002), the contribution must belong to
 * this shell (Bible V4 §2), and the actor must hold the declared permission
 * (PLA-AUT-003). None of them is authorization — the command and query
 * pipelines remain the thing that decides — they only choose what to draw.
 */
export function navigationFor(args: {
  activeCapabilityIds: string[];
  shell: ShellKind;
  canRead: (entity: string, verb: PermissionVerb) => boolean;
}): Array<NavigationContribution & { capabilityId: string }> {
  const items: Array<NavigationContribution & { capabilityId: string }> = [];

  for (const capabilityId of args.activeCapabilityIds) {
    const contribution = contributions.get(capabilityId);
    if (!contribution?.navigation) continue;

    for (const item of contribution.navigation) {
      const shells = item.shells ?? ["platform", "operations"];
      if (!shells.includes(args.shell)) continue;
      if (item.requiresEntity && !args.canRead(item.requiresEntity, item.requiresVerb ?? "Read")) {
        continue;
      }
      items.push({ ...item, capabilityId });
    }
  }

  // Applied after collection, not during: an entry can be superseded by a
  // capability that was iterated later, and resolving as we go would make the
  // result depend on activation order.
  //
  // A capability cannot supersede its OWN entry. That would be a way to write
  // navigation that is invisible for reasons nobody can see in the list, and
  // the honest way to remove an entry is to stop contributing it.
  const superseded = new Map<string, string>();
  for (const item of items) {
    for (const href of item.supersedes ?? []) superseded.set(href, item.capabilityId);
  }

  return items
    .filter((item) => {
      const by = superseded.get(item.href);
      return by === undefined || by === item.capabilityId;
    })
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.label.localeCompare(b.label));
}

/** Workspace queue entries offered by the active capabilities. */
export function workspaceContributionsFor(args: {
  activeCapabilityIds: string[];
  shell: ShellKind;
}): Array<WorkspaceContribution & { capabilityId: string }> {
  const items: Array<WorkspaceContribution & { capabilityId: string }> = [];

  for (const capabilityId of args.activeCapabilityIds) {
    for (const item of contributions.get(capabilityId)?.workspace ?? []) {
      const shells = item.shells ?? ["platform", "operations"];
      if (!shells.includes(args.shell)) continue;
      items.push({ ...item, capabilityId });
    }
  }
  return items;
}

/** Execute one workspace counter under the same capability guard and tenant transaction. */
export async function countWorkspaceContribution(args: {
  tenantId: string;
  roleId: string | null;
  userId: string;
  contribution: WorkspaceContribution & { capabilityId: string };
}): Promise<number> {
  try {
    return await withTenant(args.tenantId, async (tx) => {
      await requireCapabilityReady(tx, args.tenantId, args.contribution.capabilityId);
      return args.contribution.count({
        tx,
        tenantId: args.tenantId,
        roleId: args.roleId,
        userId: args.userId,
      });
    });
  } catch (error) {
    await recordCapabilityDenial(error, args.tenantId, `workspace:${args.contribution.key}`);
    if (error instanceof CapabilityError) return 0;
    throw error;
  }
}

/** Recurring work declared by the active capabilities. Declaration only — this runs nothing. */
export function schedulesFor(args: {
  activeCapabilityIds: string[];
  cadence?: ScheduleCadence;
}): Array<ScheduleContribution & { capabilityId: string }> {
  const items: Array<ScheduleContribution & { capabilityId: string }> = [];

  for (const capabilityId of args.activeCapabilityIds) {
    for (const item of contributions.get(capabilityId)?.schedules ?? []) {
      if (args.cadence && item.cadence !== args.cadence) continue;
      items.push({ ...item, capabilityId });
    }
  }
  return items;
}

export type ScheduleOutcome = {
  capabilityId: string;
  key: string;
  status: "ok" | "failed";
  events: number;
  ms: number;
  error?: string;
};

/**
 * EXECUTION — runs the due work for ONE tenant.
 *
 * A provider adapter calls this; the platform does not decide when. Each unit
 * runs in its own `withTenant` transaction, which means three things the
 * platform already guarantees apply unchanged: RLS is enforced on the
 * connection (`ensureRlsEnforceable`), the tenant GUC is set transaction-
 * locally, and the transaction budget is the same one every command obeys.
 *
 * One failing unit does not abort the rest. Scheduled work is a batch of
 * unrelated jobs across capabilities that happen to share a clock; letting an
 * SLA sweep failure cancel a notification drain would make the platform less
 * reliable than running them separately. Each outcome is returned so the caller
 * can log, alert or retry per unit rather than per batch.
 *
 * Returned, not logged: what to do with an outcome is a deployment decision,
 * and a platform that writes to stdout has already chosen for the operator.
 */
export async function runDueWork(args: {
  tenantId: string;
  activeCapabilityIds: string[];
  cadence?: ScheduleCadence;
  now?: Date;
}): Promise<ScheduleOutcome[]> {
  const now = args.now ?? new Date();
  const platformDue = [...platformSchedules.values()]
    .filter((unit) => !args.cadence || unit.cadence === args.cadence)
    .map((unit) => ({ ...unit, capabilityId: PLATFORM_SCHEDULE_OWNER }));
  const due = [
    ...platformDue,
    ...schedulesFor({
      activeCapabilityIds: args.activeCapabilityIds,
      cadence: args.cadence,
    }),
  ];

  const outcomes: ScheduleOutcome[] = [];

  for (const unit of due) {
    const started = Date.now();
    try {
      const result = await withTenant(args.tenantId, async (tx) => {
        if (unit.capabilityId !== PLATFORM_SCHEDULE_OWNER) await requireCapabilityReady(tx, args.tenantId, unit.capabilityId);
        return unit.run({ tx, tenantId: args.tenantId, now });
      });
      outcomes.push({
        capabilityId: unit.capabilityId,
        key: unit.key,
        status: "ok",
        events: result.events?.length ?? 0,
        ms: Date.now() - started,
      });
    } catch (error) {
      await recordCapabilityDenial(error, args.tenantId, `schedule:${unit.key}`);
      captureError(error);
      outcomes.push({
        capabilityId: unit.capabilityId,
        key: unit.key,
        status: "failed",
        events: 0,
        ms: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return outcomes;
}
