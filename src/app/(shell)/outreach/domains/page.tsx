import Link from "next/link";
import { DomainTaxonomyActions } from "../OutreachForms";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { OUTREACH_CAPABILITY, ENTITY_DIRECTION, listDomainTaxonomy } from "@/server/capabilities/outreach";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { EmptyState, PageHeader, Panel, PermissionDenied } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

/**
 * Domains — Task 109 Phase F entry point (master prompt §42-50): the domain
 * taxonomy as a click-through workspace, not a table filter. Core-only, same
 * structural signal (`Create` on Direction) as `/outreach/intelligence`.
 */
async function DomainsPage() {
  installCapabilities();
  const actor = await requireActor();

  const groups = await withTenant(actor.tenantId, async (tx) => {
    if (!(await hasPermission(tx, actor.roleId, "Create", ENTITY_DIRECTION))) return null;
    return executeQuery(actor, listDomainTaxonomy, {});
  });

  if (!groups) return <PermissionDenied what="reading the domain workspace" />;

  const totalDomains = groups.reduce((sum, g) => sum + g.domains.length, 0);

  return (
    <>
      <PageHeader
        title="Domains"
        description="Every market group and domain in the taxonomy. Open one for its funnel, velocity, aging, and team/channel breakdown."
        actions={
          <>
          <DomainTaxonomyActions groups={groups.map((g) => ({ id: g.id, name: g.name }))} />
          <Link
            href="/outreach/intelligence"
            className="rounded-md border border-line px-3 py-1 text-[13px] text-text no-underline transition-colors hover:bg-surface-sunken"
          >
            Company intelligence
          </Link>
          </>
        }
      />

      {totalDomains === 0 ? (
        <EmptyState
          title="No domains yet"
          description="The domain taxonomy is seeded once per tenant — none exist here yet."
          compact
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {groups
            .filter((g) => g.domains.length > 0)
            .map((group) => (
              <Panel key={group.id} title={group.name} flush>
                <ul className="divide-y divide-line px-2 py-1">
                  {group.domains.map((domain) => (
                    <li key={domain.id}>
                      <Link
                        href={`/outreach/domains/${domain.id}`}
                        className="flex items-center justify-between px-3 py-2.5 text-[13px] text-text no-underline transition-colors hover:bg-surface-sunken"
                      >
                        <span>{domain.name}</span>
                        <span aria-hidden className="text-text-tertiary">
                          →
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Panel>
            ))}
        </div>
      )}
    </>
  );
}

export default withCapabilityPageAccess(OUTREACH_CAPABILITY, DomainsPage);
