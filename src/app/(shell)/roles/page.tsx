import { withPageAccess } from "@/components/ui/PageAccess";
import { requireActor } from "@/server/platform/auth";
import { installCapabilities } from "@/server/capabilities/registry";
import { executeQuery } from "@/server/platform/query";
import { ForbiddenError } from "@/server/platform/authorization";
import { listRoles } from "@/server/platform/administration";
import { BUSINESS_ACTIVITIES, activitiesOf } from "@/server/capabilities/plywood";
import Link from "next/link";
import { PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { RolesDesk } from "./RolesDesk";

export const dynamic = "force-dynamic";

/**
 * §6 — what each role is allowed to do, in business activities.
 *
 * The specification is a prohibition as much as a request: do not show a client
 * READ, MANAGE, DELETE. So the mapping from activity to Verb + Entity + Scope
 * is resolved on the server and never crosses to the browser. The page receives
 * activities and their state; it has no idea what a permission verb is.
 */
async function RolesPage() {
  installCapabilities();
  const actor = await requireActor();

  let roles: Awaited<ReturnType<typeof listRoles.handler>>;
  try {
    roles = await executeQuery(actor, listRoles, {});
  } catch (error) {
    if (error instanceof ForbiddenError) return <PermissionDenied what="roles" />;
    throw error;
  }

  const rows = roles.map((role) => {
    const { held, partial } = activitiesOf(role.resolvedGrants);
    return {
      id: role.id,
      name: role.name,
      memberCount: role.memberCount,
      composedFrom: role.composedFrom,
      held,
      partial,
      // Grants that belong to no activity at all. Surfaced as a count rather
      // than hidden: a role carrying permissions this vocabulary cannot
      // describe is exactly what an administrator needs to be told about,
      // and silently omitting them would make this screen a lie.
      undescribedGrantCount: role.resolvedGrants.filter(
        (grant) =>
          !BUSINESS_ACTIVITIES.some((activity) =>
            activity.grants.some(
              (candidate) => candidate.verb === grant.verb && candidate.entity === grant.entity,
            ),
          ),
      ).length,
    };
  });

  const activities = BUSINESS_ACTIVITIES.map((activity) => ({
    key: activity.key,
    label: activity.label,
    group: activity.group,
    note: activity.note ?? null,
  }));

  return (
    <>
      <PageHeader
        title="Roles"
        description="What each role may do, written as business activities. Ticking one grants everything it needs — taking a sales order also needs to read the catalogue, the customer and the stock, and half a permission is an error message nobody can act on."
        actions={
          // Reached from People, and not in the sidebar — so the way back has
          // to be on the page (2026-09-15).
          <Link
            href="/people"
            className="rounded-[10px] bg-control px-3 py-1 text-[13px] font-semibold text-accent-ink no-underline transition-colors hover:bg-control-strong"
          >
            ← Back to People
          </Link>
        }
      />
      <RolesDesk roles={rows} activities={activities} />
    </>
  );
}

export default withPageAccess(RolesPage);
