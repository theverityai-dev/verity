import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import {
  ENTITY_PIECEWORK_ENTRY,
  PIECEWORK_CAPABILITY,
  listLots,
  listWorkers,
  lotDetail,
  recentEntries,
} from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { PageHeader, Panel, PermissionDenied, Row, RowList } from "@/components/ui/primitives";
import { EntryScreen, type EntryLot } from "./EntryScreen";

export const dynamic = "force-dynamic";

const timeOf = (iso: string, timeZone: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });

async function EntryPage({ searchParams }: { searchParams: Promise<{ lot?: string }> }) {
  installCapabilities();
  const actor = await requireActor();
  const { lot: lotParam } = await searchParams;

  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Create", ENTITY_PIECEWORK_ENTRY));
  if (!allowed) {
    return (
      <>
        <PageHeader title="Daily entry" description="Pieces given out and received back." />
        <PermissionDenied what="entering pieces. Only the munshi records entries" />
      </>
    );
  }

  const [lots, workers, recent] = await Promise.all([
    executeQuery(actor, listLots, {}),
    executeQuery(actor, listWorkers, {}),
    executeQuery(actor, recentEntries, {}),
  ]);
  const open = lots.filter((l) => l.phase === "not_started" || l.phase === "in_progress");
  const details = (await Promise.all(open.map((l) => executeQuery(actor, lotDetail, { lotId: l.id })))).filter((d) => d !== null);

  const entryLots: EntryLot[] = details.map((d) => ({
    id: d.id,
    number: d.number,
    design: d.design,
    bundleSize: d.bundleSize,
    stages: d.stages.map((s) => ({
      stageId: s.stageId,
      label: s.label,
      toIssue: s.toIssue,
      pending: s.pending,
      workers: Object.fromEntries(s.workers.map((w) => [w.workerId, w.pending])),
    })),
  }));
  const timeZone = (await withTenant(actor.tenantId, (tx) => tx.tenant.findFirst({ select: { timeZone: true } })))?.timeZone ?? "UTC";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());

  return (
    <>
      <PageHeader title="Daily entry" description="Record pieces given out and pieces received back. Every entry carries the date, the time and your name." />
      <div className="grid items-start gap-6 lg:grid-cols-[1.1fr_1fr]">
        <Panel title="New entry">
          <EntryScreen
            lots={entryLots}
            workers={workers.map((w) => ({ id: w.id, name: w.name, stageIds: w.workTypes.map((t) => t.stageId) }))}
            today={today}
            initialLotId={lotParam}
          />
        </Panel>
        <Panel title="Today's entries" flush>
          {recent.length === 0 ? (
            <p className="m-0 px-5 py-4 text-[14px] text-text-secondary">Nothing entered for today yet.</p>
          ) : (
            <RowList>
              {recent.map((r) => (
                <Row key={r.id}>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[14px] font-medium text-text">
                      {r.isReversal ? "Reversal: " : ""}
                      {r.lotNumber} · {r.kind === "issue" ? "Issued" : "Received"} {Math.abs(r.pieces)} · {r.stage}
                    </span>
                    <span className="text-[13px] text-text-secondary">{timeOf(r.time, timeZone)} · {r.karigar} · {Math.abs(r.bundles)} bundles</span>
                  </div>
                </Row>
              ))}
            </RowList>
          )}
        </Panel>
      </div>
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, EntryPage);
