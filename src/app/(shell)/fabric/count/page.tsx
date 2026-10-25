import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_ROLL, ENTITY_PIECEWORK_ROLL_MOVE, PIECEWORK_CAPABILITY, listRolls } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { EmptyState, PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { CountRolls } from "./CountRolls";

export const dynamic = "force-dynamic";

/** Count the shelf: the rolls the ledger says are in stock, one box each for what is really found. Only differences are posted. */
async function CountPage() {
  installCapabilities();
  const actor = await requireActor();
  const { canRead, canCount } = await withTenant(actor.tenantId, async (tx) => ({
    canRead: await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_ROLL),
    canCount: await hasTenantPermission(tx, actor.roleId, "Create", ENTITY_PIECEWORK_ROLL_MOVE),
  }));
  if (!canRead || !canCount) return <PermissionDenied what="counting the shelf" />;
  const { rolls } = await executeQuery(actor, listRolls, {});
  const shelf = rolls.filter((r) => !r.cancelled && r.balanceCenti > 0).sort((a, b) => a.number.localeCompare(b.number));

  return (
    <>
      <PageHeader back={{ href: "/fabric", label: "Fabric" }} title="Count the shelf" description="Walk the shelf, scan or type each roll's number, and enter what is really there. Only the differences are posted, each as an adjustment with the reason Stock-take." />
      {shelf.length === 0 ? (
        <EmptyState title="No roll has fabric left" description="There is nothing to count. Receive rolls first." />
      ) : (
        <CountRolls rolls={shelf.map((r) => ({ id: r.id, number: r.number, fabricType: r.fabricType, unit: r.unit, balanceCenti: r.balanceCenti }))} />
      )}
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, CountPage);
