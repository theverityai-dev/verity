import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_ENTRY, PIECEWORK_CAPABILITY, bundleDetail, listLots, listWorkers, lotDetail, recentEntries } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { PageHeader, Panel, PermissionDenied, Row, RowList } from "@/components/ui/primitives";
import { EntryScreen, type EntryBundle, type OpenIssue } from "./EntryScreen";

export const dynamic = "force-dynamic";

const timeOf = (iso: string, timeZone: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });

async function EntryPage({ searchParams }: { searchParams: Promise<{ lot?: string; bundle?: string }> }) {
  installCapabilities();
  const actor = await requireActor();
  const { lot: lotParam, bundle: bundleParam } = await searchParams;

  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Create", ENTITY_PIECEWORK_ENTRY));
  if (!allowed) {
    return (
      <>
        <PageHeader title="Daily entry" description="Pieces given out and taken back." />
        <PermissionDenied what="entering pieces. Only the munshi records entries" />
      </>
    );
  }

  const [lots, workers, recent] = await Promise.all([executeQuery(actor, listLots, {}), executeQuery(actor, listWorkers, {}), executeQuery(actor, recentEntries, {})]);
  const active = lots.filter((l) => l.status === "active");
  const lotDetails = (await Promise.all(active.map((l) => executeQuery(actor, lotDetail, { lotId: l.id })))).filter((d) => d !== null);
  const bundleIds = lotDetails.flatMap((d) => d.bundleRows.map((b) => b.id));
  const details = (await Promise.all(bundleIds.map((id) => executeQuery(actor, bundleDetail, { bundleId: id })))).filter((d) => d !== null);

  // A bundle from the lot being worked on comes first, so Record entry from a lot page lands on its own bundles.
  const ordered = [...details].sort((a, b) => Number(b.lotId === lotParam) - Number(a.lotId === lotParam));
  const bundles: EntryBundle[] = ordered.map((d) => ({
    id: d.id, number: d.number, lotNumber: d.lotNumber, netPieces: d.netPieces,
    stages: d.stages.map((s) => ({ stageId: s.stageId, label: s.label, toIssue: s.toIssue, reworkPool: s.reworkPool, pending: s.pending })),
  }));
  const openIssues: OpenIssue[] = ordered.flatMap((d) =>
    d.stages.flatMap((s) => s.issues.filter((i) => i.open > 0).map((i) => ({ issueId: i.issueId, bundleNumber: d.number, lotNumber: d.lotNumber, stageLabel: s.label, workerName: i.workerName, open: i.open, issued: i.issued, isRework: i.isRework }))),
  );

  const timeZone = (await withTenant(actor.tenantId, (tx) => tx.tenant.findFirst({ select: { timeZone: true } })))?.timeZone ?? "UTC";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());

  return (
    <>
      <PageHeader title="Daily entry" description="Give a bundle out, or take one back and say where each piece went. Every entry carries the date, the time and your name." />
      <div className="grid items-start gap-6 lg:grid-cols-[1.15fr_1fr]">
        <Panel title="New entry">
          <EntryScreen
            bundles={bundles}
            openIssues={openIssues}
            workers={workers.map((w) => ({ id: w.id, name: w.name, stageIds: w.workTypes.map((t) => t.stageId) }))}
            today={today}
            initialBundleId={bundleParam}
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
                      {r.bundleNumber} · {r.kind === "issue" ? "Issued" : "Returned"} {Math.abs(r.pieces)} · {r.stage}
                    </span>
                    <span className="text-[13px] text-text-secondary">
                      {timeOf(r.time, timeZone)} · {r.karigar}
                      {r.kind === "receive" ? ` · good ${Math.abs(r.good)}, rejected ${Math.abs(r.rejected)}, rework ${Math.abs(r.rework)}, short ${Math.abs(r.short)}` : ""}
                    </span>
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
