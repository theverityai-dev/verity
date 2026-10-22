import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_APPROVAL, PIECEWORK_CAPABILITY, approvalsInbox, type ApprovalRow } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { Badge, EmptyState, PageHeader, PermissionDenied, Surface } from "@/components/ui/primitives";
import { rupees } from "../../lots/format";
import { photosFor } from "../photos";
import { ApprovalActions } from "./ApprovalActions";

export const dynamic = "force-dynamic";

const KIND: Record<ApprovalRow["kind"], string> = {
  deduction: "Wage deduction",
  writeoff: "Shortage write-off",
  hold: "Put lot on hold",
  close: "Close lot",
};

const ago = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} d ago`;
};

/** M1 · Approvals: one inbox for deductions, write-offs and lot hold or close, each with the facts and the photograph. */
async function ApprovalsPage() {
  installCapabilities();
  const actor = await requireActor();
  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_APPROVAL));
  if (!allowed) return <PermissionDenied what="approvals" />;
  const inbox = await executeQuery(actor, approvalsInbox, {});
  const photos = await photosFor(actor, inbox.rows.flatMap((r) => (r.entryId ? [r.entryId] : [])));
  const pending = inbox.rows.filter((r) => r.status === "pending");
  const decided = inbox.rows.filter((r) => r.status !== "pending").slice(0, 12);
  const needsOwner = pending.filter((r) => r.aboveLimit).length;

  return (
    <>
      <PageHeader
        title="Approvals"
        description={
          inbox.canDecide
            ? `${pending.length} waiting for a decision${needsOwner ? `, ${needsOwner} above the manager limit (${rupees(inbox.limits.deductionLimitMinor)} or ${inbox.limits.writeoffLimitPieces} pieces)` : ""}.`
            : "Requests you have raised, and what was decided."
        }
      />

      {pending.length === 0 ? (
        <div className="mb-8"><EmptyState title="Nothing is waiting" description="A request raised from the floor appears here with its facts and photograph." /></div>
      ) : (
        <ul className="m-0 mb-8 grid list-none gap-4 p-0" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))" }}>
          {pending.map((r) => (
            <li key={r.id} className="list-none">
              <ApprovalCard row={r} photos={r.entryId ? photos.get(r.entryId) : undefined} canAct={inbox.canDecide && !r.mine} />
            </li>
          ))}
        </ul>
      )}

      {decided.length > 0 && (
        <>
          <h2 className="micro m-0 mb-3 px-1">Recently decided</h2>
          <Surface className="overflow-hidden">
            <ul className="m-0 list-none divide-y divide-[var(--color-line)] p-0">
              {decided.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3.5">
                  <span className="text-[15px] font-medium text-text">{KIND[r.kind]} · {summaryOf(r)}</span>
                  <span className="text-[13px] text-text-secondary">
                    <span style={{ color: r.status === "approved" ? "var(--color-state-completed)" : "var(--color-state-blocked)" }}>{r.status === "approved" ? "Approved" : "Declined"}</span> by {r.decidedBy} · {ago(r.decidedAt ?? r.requestedAt)}
                    {r.decisionNote ? ` · ${r.decisionNote}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </Surface>
        </>
      )}
    </>
  );
}

const summaryOf = (r: ApprovalRow) =>
  [r.lotNumber, r.bundleNumber, r.workerName, r.amountMinor ? rupees(r.amountMinor) : null, r.pieces ? `${r.pieces} pieces` : null].filter(Boolean).join(" · ");

function ApprovalCard({ row: r, photos, canAct }: { row: ApprovalRow; photos: string[] | undefined; canAct: boolean }) {
  return (
    <Surface className="flex h-full flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="micro m-0">{KIND[r.kind]}</p>
          <p className="figure m-0 mt-1 text-[34px] text-text">{r.amountMinor ? rupees(r.amountMinor) : r.pieces ? `${r.pieces}` : r.lotNumber ?? ""}{!r.amountMinor && r.pieces ? <span className="ml-1.5 text-[14px] font-normal text-text-secondary">pieces</span> : null}</p>
        </div>
        {r.aboveLimit && <Badge tone="accent">Needs the owner</Badge>}
      </div>

      {photos?.[0] && (
        // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed read URL from the file store
        <img src={photos[0]} alt="Photograph of the pieces" className="max-h-56 w-full rounded-[14px] object-cover" />
      )}

      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
        {r.lotNumber && <><dt className="text-text-secondary">Lot</dt><dd className="m-0 text-text">{r.lotNumber}</dd></>}
        {r.bundleNumber && <><dt className="text-text-secondary">Bundle</dt><dd className="m-0 text-text">{r.bundleNumber}</dd></>}
        {r.workerName && <><dt className="text-text-secondary">Karigar</dt><dd className="m-0 text-text">{r.workerName}</dd></>}
        <dt className="text-text-secondary">Asked by</dt><dd className="m-0 text-text">{r.requestedBy} · {ago(r.requestedAt)}</dd>
      </dl>
      <p className="m-0 rounded-[12px] bg-[var(--color-control)] px-3.5 py-2.5 text-[14px] text-text">{r.reason}</p>

      <div className="mt-auto">
        {canAct ? <ApprovalActions id={r.id} aboveLimit={r.aboveLimit} /> : <p className="m-0 text-[13px] text-text-secondary">{r.mine ? "Waiting for someone else to decide." : "You can see this request; you cannot decide it."}</p>}
      </div>
    </Surface>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, ApprovalsPage);
