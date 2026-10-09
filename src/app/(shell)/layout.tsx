import { returnToHqAction } from "@/server/actions/hq";
import { CommandAccessProvider } from "@/components/ui/CommandAccess";
import { listCommands } from "@/server/platform/command";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import {
  getAuthUser,
  listMemberships,
  resolveActor,
} from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { resolvePermissions } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import { installAdministration } from "@/server/platform/administration";
import { unreadFor } from "@/server/platform/notification";
import { navigationFor } from "@/server/platform/contribution";
import { PLYWOOD_CAPABILITY } from "@/server/capabilities/plywood/keys";
import {
  ShellChrome,
  type NavArea,
  type NavItem,
} from "@/components/shell/ShellChrome";
import { isIconName } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * The Verity platform shell.
 *
 * Bible V4 §2 partitions experience into four role-centric shells. This
 * milestone builds one adaptive shell rather than four, deliberately: §27 of the
 * brief defers the specialised Worker Shell, and four shells with nothing to put
 * in three of them would be scaffolding pretending to be architecture. The
 * layout adapts by role and viewport instead.
 *
 * Navigation is derived from what the actor can actually reach — the capability
 * registry and their resolved permissions — never from a hard-coded module list.
 */
export default async function ShellLayout({
  children,
}: {
  children: ReactNode;
}) {
  installCapabilities();
  // Pre-existing gap, not introduced here: only HQ routes called this
  // (`hq.ts`), so `verity.platform.set_configuration` and the rest of the
  // administration command/query registry were unregistered on any request
  // that never touched `/hq` in this server process — including this client
  // shell's own `/configuration` Save button. Idempotent, same as above.
  installAdministration();

  const actor = await resolveActor();
  if (!actor) redirect("/sign-in");

  const memberships = await listMemberships();
  const active =
    memberships.find((m) => m.membershipId === actor.membershipId) ??
    memberships[0]!;

  const { capabilities, canAudit, canConfigure, grants, commandKeys, unreadCount } = await withTenant(
    actor.tenantId,
    async (tx) => {
      const activations = actor.roleId ? await tx.tenantActivation.findMany({
        where: { status: "Active" },
        include: { capability: true },
      }) : [];
      const permissions = actor.roleId
        ? await resolvePermissions(tx, actor.roleId)
        : [];
      // Task 114 P1.5 item 1 — the bell's unread count. Reuses the existing
      // notification substrate's own `unreadFor` rather than a second query.
      const unread = await unreadFor(tx, actor.userId);


      return {
        // Every active capability is offered to the contribution layer, which
        // applies the per-item permission filter. Filtering here as well would
        // hide a capability whose only visible surface is one the actor *can*
        // reach.
        capabilities: activations.map((a) => ({
          id: a.capabilityId,
          name: a.capability.name,
        })),
        commandKeys: listCommands().filter((command) => permissions.some((p) =>
          p.entity === command.entity && p.verb === command.verb &&
          (p.scope === "Tenant" || command.scopeHandling === "handler")
        )).map((command) => command.key),
        grants: permissions.map((p) => ({ entity: p.entity, verb: p.verb })),
        canAudit: permissions.some((p) => p.verb === "Read" && p.entity === "verity.platform.activity" && p.scope === "Tenant"),
        // Edit on the TENANT, not "holds any Edit at all". The old test let a
        // salesperson who may edit a customer see a Configuration link, and §0
        // is explicit that raw configuration keys are not a client surface. It
        // now matches what the page and the write command both require.
        canConfigure: permissions.some(
          (p) => p.verb === "Edit" && p.entity === "verity.platform.tenant" && p.scope === "Tenant",
        ),
        unreadCount: unread.length,
      };
    },
  );

  // Capability navigation is declared by the capabilities themselves. The shell
  // previously held a hard-coded id-to-route map, which meant every new
  // capability required an edit to platform code — exactly the coupling the
  // capability system exists to prevent.
  const activeCapabilityIds = capabilities.map((c) => c.id);
  const contributed = navigationFor({
    activeCapabilityIds,
    shell: "platform",
    canRead: (entity, verb) =>
      grants.some((g) => g.entity === entity && g.verb === verb),
  })
    // Plywood supersedes the generic Location/Asset nav for its own tenants —
    // godowns are Locations under the hood (a real dependency, see the
    // capability's own `dependencies` array) but reachable via Godowns' own
    // "Go to Locations" empty-state link, and Assets isn't a Plywood
    // dependency at all. Named exception, not a generic "supersedes"
    // registry: this is Plywood-specific UI judgment, not a platform rule.
    .filter(
      (c) =>
        !(
          activeCapabilityIds.includes(PLYWOOD_CAPABILITY) &&
          (c.href === "/locations" || c.href === "/assets")
        ),
    );

  // Icons come from the contribution, never from a route-to-icon map here —
  // that map is the same coupling the capability system exists to prevent, and
  // it would have to be edited for every capability installed.
  const toItem = (c: (typeof contributed)[number]): NavItem => ({
    href: c.href,
    label: c.label,
    icon: isIconName(c.icon) ? c.icon : undefined,
  });

  /**
   * The sidebar, in the order a business reads it.
   *
   * Authority: taskplans/archive/45_plywood_workflow_program.md §8. The client's own
   * words — Trade, Inventory, Money, Insights — before the platform's own
   * "Platform" and "Capabilities", which are implementation vocabulary. A
   * client seeing "Capabilities" is the foundation leaking into the product.
   *
   * `Platform` and `Capabilities` remain for tenants running other capabilities
   * and for the platform tenant itself; they simply sort last and vanish when
   * empty. Nothing here is plywood-specific: a capability picks a group and the
   * shell renders it in this order.
   */
  const BUSINESS_GROUPS = [
    "Overview",
    "Trade",
    "Inventory",
    "Money",
    "Insights",
  ] as const;

  const businessAreas: NavArea[] = BUSINESS_GROUPS.map((group) => ({
    group,
    items: contributed.filter((c) => c.group === group).map(toItem),
  }));

  /**
   * Every href a capability already contributes.
   *
   * Audit finding U3-1: the plywood capability contributes an Audit entry and
   * the shell added its own, so "Audit" appeared twice in Administration and
   * React reported duplicate keys on every render. The capability's entry is
   * the one that carries the right group and ordering, so a shell default
   * stands down when a capability has already claimed the route.
   */
  const contributedHrefs = new Set(contributed.map((item) => item.href));

  /**
   * Audit finding U3-2. A client saw a "Platform" group (Overview, Workspace)
   * and a "Capabilities" group beside their own navigation — and therefore two
   * entries called "Overview" pointing at different pages. §0 of the target
   * flow lists exactly this as what a normal client must never be shown: the
   * foundation's vocabulary leaking into the product.
   *
   * Kept for the platform tenant, whose operators genuinely work in those
   * terms.
   */
  const areas: NavArea[] = [
    ...businessAreas,
    ...(active.isPlatform
      ? [
          {
            group: "Platform" as const,
            items: [
              { href: "/", label: "Overview", icon: "overview" as const },
              {
                href: "/workspace",
                label: "Workspace",
                icon: "workspace" as const,
              },
            ],
          },
          {
            group: "Capabilities" as const,
            items: contributed
              .filter((c) => (c.group ?? "Capabilities") === "Capabilities")
              .map(toItem),
          },
        ]
      : []),
    {
      group: "Administration",
      items: [
        // Raw system-level capability toggling is platform-tenant-only (see
        // capabilities/page.tsx) — a client tenant must never see the link.
        ...(active.isPlatform
          ? [
              {
                href: "/capabilities",
                label: "Capability registry",
                icon: "capabilities" as const,
              },
            ]
          : []),
        ...contributed.filter((c) => c.group === "Administration").map(toItem),
        ...(canConfigure && !contributedHrefs.has("/configuration")
          ? [
              {
                href: "/configuration",
                label: "Configuration",
                icon: "configuration" as const,
              },
            ]
          : []),
        ...(canAudit && !contributedHrefs.has("/audit")
          ? [{ href: "/audit", label: "Audit", icon: "audit" as const }]
          : []),
        // Every authenticated actor, every role, every tenant — your own
        // identity and password are not a permission a role can lack.
        ...(!contributedHrefs.has("/account")
          ? [{ href: "/account", label: "Account", icon: "people" as const }]
          : []),
      ],
    },
  ].filter((area) => area.items.length > 0);

  // The platform stores no display name — Party is a bare identity primitive
  // (ADR-001) and a profile belongs to a capability, not here. The verified
  // sign-in address is the one name the platform legitimately knows.
  const authUser = await getAuthUser();
  const email = authUser?.email ?? "";
  const userLabel = email.split("@")[0] || "Signed in";
  const userInitials = (
    userLabel
      .match(/\b[a-z0-9]/gi)
      ?.slice(0, 2)
      .join("") || "V"
  ).toUpperCase();

  // ADR-034 item 4: an operator acting inside a client sees, on every page,
  // that this is a support session and that it is recorded.
  const supportSession = !active.isPlatform && memberships.some((m) => m.isPlatform);

  return (
    <ShellChrome
      areas={areas}
      userLabel={userLabel}
      userInitials={userInitials}
      unreadCount={unreadCount}
    >
      {supportSession && (
        <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-[12px] bg-accent-subtle px-4 py-3 text-[13px] text-text">
          <span>
            Support session in <strong>{active.tenantName}</strong>. Everything you do here is recorded in this client&apos;s audit trail.
          </span>
          <form action={returnToHqAction}>
            <button type="submit" className="min-h-11 cursor-pointer border-0 bg-transparent px-0 font-semibold text-accent-ink hover:underline">
              End session and return to HQ
            </button>
          </form>
        </div>
      )}
      <CommandAccessProvider commandKeys={commandKeys}>{children}</CommandAccessProvider>
    </ShellChrome>
  );
}
