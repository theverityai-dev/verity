import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { DOCUMENT_CAPABILITY, ENTITY_DOCUMENT, ENTITY_DOCUMENT_SELF_RELEASE, documentDetail } from "@/server/capabilities/document";
import { ENTITY_PROJECT_JOB, jobReference } from "@/server/capabilities/project";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { EntityHeader } from "@/components/ui/EntityHeader";
import { EmptyState, Panel, PermissionDenied } from "@/components/ui/primitives";
import { STATUS_CATEGORY, STATUS_LABEL, linkTarget } from "../format";
import { LinkJob } from "./LinkPanel";
import { RevisionPanel, type RevisionView } from "./RevisionPanel";

export const dynamic = "force-dynamic";

type Detail = {
  id: string;
  number: string;
  title: string;
  classification: string;
  type: { label: string; validMonths: number | null; requiresApproval: boolean };
  currentRevisionId: string | null;
  revisions: Array<Omit<RevisionView, "releasedAt"> & { releasedAt: string | Date | null }>;
  links: Array<{ id: string; entityKey: string; entityId: string; revisionLabel: string; newerReleaseExists: boolean; linkedAt: string | Date }>;
  access: { count: number; recent: Array<{ id: string; action: string; at: string | Date; actor: string | null; revisionLabel: string }> };
};

const dateTime = (d: string | Date) => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * One document: its revision journey, what relies on it, and who has opened it. The next action sits on the
 * revision it applies to, and a superseded or expired revision says so wherever it is shown.
 */
async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  installCapabilities();
  const { id } = await params;
  const actor = await requireActor();

  const access = await withTenant(actor.tenantId, async (tx) => {
    const read = await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_DOCUMENT);
    if (!read) return null;
    return {
      canSelfRelease: await hasTenantPermission(tx, actor.roleId, "ActionExecute", ENTITY_DOCUMENT_SELF_RELEASE),
      jobs: (await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PROJECT_JOB))
        ? (await tx.projectJob.findMany({ select: { id: true, number: true, title: true }, orderBy: { number: "desc" }, take: 200 })).map((j) => ({
            id: j.id,
            label: `${jobReference(j.number)} · ${j.title}`,
          }))
        : [],
    };
  });
  if (!access) return <PermissionDenied what="reading this document" />;

  const detail = (await executeQuery(actor, documentDetail, { documentId: id })) as unknown as Detail | null;
  if (!detail) notFound();

  // What each link points at, named the way the rest of the app names it.
  const names = await withTenant(actor.tenantId, async (tx) => {
    const byKey = (key: string) => detail.links.filter((l) => l.entityKey === key).map((l) => l.entityId);
    const [jobs, orders, boms] = await Promise.all([
      tx.projectJob.findMany({ where: { id: { in: byKey("verity.project.job") } }, select: { id: true, number: true, title: true } }),
      tx.manufacturingOrder.findMany({ where: { id: { in: byKey("verity.manufacturing.order") } }, select: { id: true, reference: true } }),
      tx.manufacturingBom.findMany({ where: { id: { in: byKey("verity.manufacturing.bom") } }, select: { id: true, code: true } }),
    ]);
    const map = new Map<string, string>();
    for (const j of jobs) map.set(j.id, `${jobReference(j.number)} · ${j.title}`);
    for (const o of orders) map.set(o.id, o.reference ?? `MO ${o.id.slice(0, 8)}`);
    for (const b of boms) map.set(b.id, b.code);
    return map;
  });

  const current = detail.revisions.find((r) => r.id === detail.currentRevisionId) ?? null;
  const latest = detail.revisions[0]!;
  const shown = current ?? latest;
  const iso = (d: string | Date | null) => (d === null ? null : typeof d === "string" ? d : d.toISOString());
  const revisions: RevisionView[] = detail.revisions.map((r) => ({ ...r, releasedAt: iso(r.releasedAt) }));

  return (
    <>
      <EntityHeader
        crumbs={[{ label: "Documents", href: "/documents" }, { label: detail.number }]}
        title={detail.title}
        code={detail.number}
        state={{ category: STATUS_CATEGORY[shown.status] ?? "Draft", label: STATUS_LABEL[shown.status] ?? shown.status }}
        meta={[detail.type.label, detail.classification === "customer" ? "Customer-facing" : "Internal", `${detail.revisions.length} ${detail.revisions.length === 1 ? "revision" : "revisions"}`]}
      />

      {current?.expiry === "expired" && (
        <p role="alert" className="mb-4 mt-0 rounded-[12px] bg-danger-subtle px-4 py-3 text-[14px] text-[var(--color-danger-ink)]">
          {current.label} is past its valid-until date. Start a new revision to renew it, or withdraw it.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <Panel title="Revisions">
          <RevisionPanel documentId={detail.id} revisions={revisions} currentRevisionId={detail.currentRevisionId} canSelfRelease={access.canSelfRelease} />
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel title="Relied on by">
            {detail.links.length === 0 ? (
              <EmptyState title="Nothing relies on it yet" description="Link a job to the revision in force, so the job keeps showing exactly what it was built from." />
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {detail.links.map((l) => {
                  const target = linkTarget(l.entityKey, l.entityId);
                  return (
                    <li key={l.id} className="rounded-[10px] bg-[var(--color-surface-sunken)] px-3 py-2.5">
                      <Link href={target.href} className="text-[15px] font-medium text-accent-ink no-underline hover:underline">
                        {names.get(l.entityId) ?? target.kind}
                      </Link>
                      <p className="m-0 text-[13px] text-text-secondary">
                        {target.kind} · uses <span className="font-semibold text-text">{l.revisionLabel}</span>
                      </p>
                      {l.newerReleaseExists && current && (
                        <p className="m-0 mt-1 text-[13px] font-medium text-[var(--color-state-pending-ink)]">A newer release, {current.label}, is in force. Moving to it is a deliberate step.</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {current && (
              <div className="mt-3">
                <LinkJob revisionId={current.id} revisionLabel={current.label} jobs={access.jobs} />
              </div>
            )}
          </Panel>

          <Panel title={`Opened ${detail.access.count} ${detail.access.count === 1 ? "time" : "times"}`}>
            {detail.access.recent.length === 0 ? (
              <p className="m-0 text-[14px] text-text-secondary">Nobody has opened or downloaded it yet. Every opening is logged here.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[14px]">
                {detail.access.recent.map((a) => (
                  <li key={a.id} className="flex flex-wrap justify-between gap-x-3 text-text-secondary">
                    <span><span className="font-medium text-text">{a.actor ?? "Someone"}</span> {a.action === "download" ? "downloaded" : "opened"} {a.revisionLabel}</span>
                    <span className="tabular text-[13px] text-text-tertiary">{dateTime(a.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

export default withCapabilityPageAccess(DOCUMENT_CAPABILITY, DocumentPage);
