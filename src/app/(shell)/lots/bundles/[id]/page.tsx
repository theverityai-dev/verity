import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_BUNDLE, PIECEWORK_CAPABILITY, bundleDetail } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { DataTable } from "@/components/ui/DataTable";
import { ButtonLink, PageHeader, Panel, PermissionDenied, Stat, StatRow } from "@/components/ui/primitives";
import { shortDate } from "../../format";

export const dynamic = "force-dynamic";

async function BundlePage({ params }: { params: Promise<{ id: string }> }) {
  installCapabilities();
  const { id } = await params;
  const actor = await requireActor();

  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_BUNDLE));
  if (!allowed) return <PermissionDenied what="viewing this bundle" />;

  const b = await executeQuery(actor, bundleDetail, { bundleId: id });
  if (!b) notFound();

  return (
    <>
      <PageHeader
        title={`${b.number} · ${b.lotNumber}`}
        description={[b.lotName ?? b.lotDesign, b.sizeNote ? `Size mix: ${b.sizeNote}` : null].filter(Boolean).join(" · ")}
        actions={
          <>
            <ButtonLink href={`/lots/${b.lotId}`} variant="ghost">Back to the lot</ButtonLink>
            <ButtonLink href={`/lots/bundles/${b.id}/slip`} variant="primary">Print the slip</ButtonLink>
          </>
        }
      />

      <StatRow cols={4} className="mb-6">
        <Stat label="Net pieces" value={b.netPieces} />
        <Stat label="Where it is" value={b.stageLabel ?? "—"} hint={b.location} />
        <Stat label="Good ready" value={b.readyPieces} />
        <Stat label="Rejected · rework · short" value={`${b.rejectedPieces} · ${b.reworkPieces} · ${b.shortPieces}`} hint="Kept apart, never counted as good" />
      </StatRow>

      <Panel title="By stage" flush>
        <DataTable
          caption="Pieces at each stage of this bundle"
          rows={b.stages.map((s) => ({
            id: s.stageId, stage: s.label, intake: s.intake, issued: s.issued, good: s.good, rejected: s.rejected, rework: s.rework, short: s.short,
            pending: s.pending, waiting: s.toIssue, pool: s.reworkPool, days: s.days,
          }))}
          columns={[
            { key: "stage", header: "Stage" },
            { key: "intake", header: "Reached", numeric: true },
            { key: "issued", header: "Issued", numeric: true },
            { key: "good", header: "Good", numeric: true },
            { key: "rejected", header: "Rejected", numeric: true },
            { key: "rework", header: "Rework", numeric: true },
            { key: "short", header: "Short", numeric: true },
            { key: "pending", header: "Out now", numeric: true },
            { key: "waiting", header: "To issue", numeric: true },
            { key: "days", header: "Days", numeric: true },
          ]}
          emptyTitle="No stages"
          emptyDescription="No stage has been set up."
        />
      </Panel>

      <div className="mt-6">
        <Panel title="Issues and what came back" flush>
          <DataTable
            caption="Each issue with what was accounted for and what is still open"
            rows={b.stages.flatMap((s) =>
              s.issues.map((i) => ({
                id: i.issueId, stage: s.label, workerId: i.workerId, karigar: i.workerName, kind: i.isRework ? "Rework" : "First pass", date: shortDate(i.entryDate), due: shortDate(i.dueDate),
                issued: i.issued, good: i.good, rejected: i.rejected, rework: i.rework, short: i.short, open: i.open,
              })),
            )}
            columns={[
              { key: "stage", header: "Stage" },
              { key: "karigar", header: "Karigar", variant: "link", href: "/karigars/{workerId}", subKey: "kind" },
              { key: "date", header: "Issued" },
              { key: "due", header: "Due" },
              { key: "issued", header: "Pieces", numeric: true },
              { key: "good", header: "Good", numeric: true },
              { key: "rejected", header: "Rejected", numeric: true },
              { key: "rework", header: "Rework", numeric: true },
              { key: "short", header: "Short", numeric: true },
              { key: "open", header: "Still open", numeric: true, sortable: true },
            ]}
            emptyTitle="Nothing issued yet"
            emptyDescription="Issues appear here as the bundle is given to a karigar."
          />
        </Panel>
      </div>
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, BundlePage);
