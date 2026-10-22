import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import { EVIDENCE_CAPABILITY, ENTITY_EVIDENCE } from "@/server/capabilities/evidence";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { DataTable } from "@/components/ui/DataTable";
import {
  PageHeader,
  Panel,
  PermissionDenied,
  Stat,
  StatRow,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown> & {
  id: string; kind: string; subject: string; subjectId: string;
  capturedAt: string; fence: string;
};

/**
 * Evidence across the tenant (§21).
 *
 * Read-only by design. Evidence is captured in the context of the record it
 * concerns — an inspection, an asset — never from a general-purpose upload
 * screen, because evidence detached from its subject proves nothing. Capture
 * lives on the record's own page; this is the register.
 *
 * There is no edit or delete control anywhere, because the database refuses both
 * at trigger level even for a privileged role. Offering a control the backend
 * rejects teaches users to distrust the interface.
 */
async function EvidencePage() {
  installCapabilities();
  const actor = await requireActor();

  const rows = await withTenant(actor.tenantId, async (tx) => {
    if (!(await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_EVIDENCE))) return null;

    const evidence = await tx.evidence.findMany({ orderBy: { capturedAt: "desc" }, take: 200 });
    return evidence.map<Row>((e) => ({
      id: e.id,
      kind: e.kind,
      subject: e.entityKey.split(".").pop() ?? e.entityKey,
      subjectId: e.entityId,
      capturedAt: e.capturedAt.toISOString().replace("T", " ").slice(0, 16),
      fence:
        e.withinFence === null
          ? "Not evaluated"
          : e.withinFence
            ? "Inside"
            : "Outside",
    }));
  });

  if (!rows) return <PermissionDenied what="reading evidence" />;

  return (
    <>
      {/*
        Evidence is a register, not a CRUD list — nothing on this page mutates
        anything, by design. The composition says so before the copy does: there
        is no primary action in the masthead, and the immutability note is a
        standing panel rather than a footnote, because "why can I not edit this"
        is the question this screen exists to answer.
      */}
      <PageHeader
        title="Evidence"
        description="Immutable field data. Once recorded, evidence cannot be edited or deleted at any privilege level."
      />

      <StatRow className="mb-6">
        <Stat kind="evidence" label="Captures" value={rows.length} />
        <Stat icon="check" state="completed" label="Inside fence" value={rows.filter((r) => r.fence === "Inside").length} />
        <Stat icon="flag" state="pending" label="Outside fence" value={rows.filter((r) => r.fence === "Outside").length} />
        <Stat
          label="Not evaluated"
          value={rows.filter((r) => r.fence === "Not evaluated").length}
          hint="No fence at capture"
        />
      </StatRow>

      <DataTable
        caption="Evidence"
        rows={rows}
        columns={[
          { key: "subject", header: "Subject", variant: "link", href: "/assets/{subjectId}", subKey: "kind" },
          { key: "fence", header: "Geofence at capture" },
          { key: "capturedAt", header: "Captured" },
        ]}
        emptyTitle="No evidence captured"
        emptyDescription="Evidence is captured against a record. Open an asset to capture some."
      />

      <div className="mt-6">
        <Panel title="Why the verdict is stored, not computed">
          <p className="m-0 max-w-[70ch] text-[13px] leading-relaxed text-text-secondary">
            The geofence result is recorded at capture time. A fence can be moved or resized later,
            and re-judging an old capture against today&rsquo;s boundary would silently rewrite
            history.
          </p>
        </Panel>
      </div>
    </>
  );
}

export default withCapabilityPageAccess(EVIDENCE_CAPABILITY, EvidencePage);
