import Link from "next/link";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import { executeQuery } from "@/server/platform/query";
import { ENTITY_MANUFACTURING_OPERATION, MANUFACTURING_CAPABILITY } from "@/server/capabilities/manufacturing";
import { operationQueue } from "@/server/capabilities/manufacturing/stages";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { PageHeader, PermissionDenied, Stat, StatRow } from "@/components/ui/primitives";
import { FloorQueue, type FloorRow } from "./FloorQueue";

export const dynamic = "force-dynamic";

/**
 * The operator's view of the factory: the open stages of RUNNING orders, by stage.
 * A stage shows a Start button only when everything before it is done, so an
 * operator is never offered work that would be refused.
 */
async function FloorPage({ searchParams }: { searchParams: Promise<{ stage?: string }> }) {
  installCapabilities();
  const { stage } = await searchParams;
  const actor = await requireActor();

  const allowed = await withTenant(actor.tenantId, (tx) =>
    hasTenantPermission(tx, actor.roleId, "Read", ENTITY_MANUFACTURING_OPERATION),
  );
  if (!allowed) return <PermissionDenied what="reading the production floor" />;

  const all = await executeQuery(actor, operationQueue, {});

  // Stage chips come from the work that exists, in the order it first appears.
  const stages: Array<{ stageKey: string; label: string; count: number }> = [];
  for (const r of all) {
    const s = stages.find((x) => x.stageKey === r.stageKey);
    if (s) s.count++;
    else stages.push({ stageKey: r.stageKey, label: r.label, count: 1 });
  }

  const shown = stage ? all.filter((r) => r.stageKey === stage) : all;
  const rows: FloorRow[] = shown.map((r) => ({
    id: r.id,
    orderId: r.orderId,
    order: r.orderReference,
    item: r.outputItemName,
    qty: r.outputQty,
    stage: r.label + (r.reworkOfId ? " (rework)" : ""),
    state: r.state.replace(/_/g, " "),
    rawState: r.state,
    category: r.category,
    actionable: r.actionable,
    sendBackTo: r.sendBackTo,
  }));

  const chip = (active: boolean) =>
    "rounded-full border px-3 py-1 text-[13px] no-underline transition-colors " +
    (active ? "border-accent bg-accent-subtle text-text" : "border-line text-text-secondary hover:border-line-strong");

  return (
    <>
      <PageHeader
        title="Production floor"
        description="Open stages of running orders. Work can only start when everything before it is done."
      />

      <StatRow cols={4} className="mb-6">
        <Stat label="Open stages" value={all.length} />
        <Stat label="Ready to start" value={all.filter((r) => r.actionable).length} />
        <Stat label="On hold" value={all.filter((r) => r.state === "on_hold").length} />
        <Stat label="Rework" value={all.filter((r) => r.reworkOfId).length} />
      </StatRow>

      <nav aria-label="Filter by stage" className="mb-4 flex flex-wrap gap-2">
        <Link href="/manufacturing/floor" className={chip(!stage)}>All stages ({all.length})</Link>
        {stages.map((s) => (
          <Link key={s.stageKey} href={`/manufacturing/floor?stage=${s.stageKey}`} className={chip(stage === s.stageKey)}>
            {s.label} ({s.count})
          </Link>
        ))}
      </nav>

      <FloorQueue rows={rows} />
    </>
  );
}

export default withCapabilityPageAccess(MANUFACTURING_CAPABILITY, FloorPage);
