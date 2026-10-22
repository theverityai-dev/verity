import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import { APPROVAL_CAPABILITY, ENTITY_APPROVAL } from "@/server/capabilities/approval";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import {
  PageHeader,
  Panel,
  PermissionDenied,
  Row,
  RowList,
  Stat,
  StatRow,
  StateBadge,
} from "@/components/ui/primitives";
import { ApprovalQueue } from "./ApprovalQueue";

export const dynamic = "force-dynamic";

/**
 * Approval queue (§22).
 *
 * A queue rather than a table, because the operator's question is "what needs me
 * next" rather than "show me all approvals". Chains where the current step
 * belongs to someone else are listed separately and without controls, so it is
 * visible that they exist and clear that they are not actionable yet.
 */
async function ApprovalsPage() {
  installCapabilities();
  const actor = await requireActor();

  const data = await withTenant(actor.tenantId, async (tx) => {
    if (!(await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_APPROVAL))) return null;

    const requests = await tx.approvalRequest.findMany({
      orderBy: { createdAt: "desc" },
      include: { steps: { orderBy: { sequence: "asc" }, include: { role: true } } },
    });
    const canDecide = await hasTenantPermission(tx, actor.roleId, "ActionExecute", ENTITY_APPROVAL);

    const shaped = requests.map((request) => {
      const current = request.steps.find((s) => s.decision === "Pending");
      return {
        id: request.id,
        subject: request.subjectEntityKey.split(".").pop() ?? request.subjectEntityKey,
        subjectId: request.subjectEntityId,
        state: request.state,
        outcome: request.outcome,
        createdAt: request.createdAt.toISOString(),
        currentStepSequence: current?.sequence ?? null,
        currentApprover: current?.role.name ?? null,
        // Mine only when the current step names a role I hold.
        mine: Boolean(current && current.approverRoleId === actor.roleId),
        steps: request.steps.map((s) => ({
          sequence: s.sequence,
          role: s.role.name,
          decision: s.decision,
          comment: s.comment,
        })),
      };
    });

    return { canDecide, shaped };
  });

  if (!data) return <PermissionDenied what="reading approvals" />;

  const awaitingMe = data.shaped.filter((r) => r.mine);
  const awaitingOthers = data.shaped.filter((r) => !r.mine && r.outcome === "Pending");
  const settled = data.shaped.filter((r) => r.outcome !== "Pending");

  return (
    <>
      {/*
        A decision queue, not a list of records. The hierarchy is deliberate and
        asymmetric: what you can act on comes first at full weight, what is
        merely in flight comes second in a quieter register, and what is already
        settled comes last. Giving all three equal presentation would bury the
        only section that needs the reader to do anything.
      */}
      <PageHeader
        title="Approvals"
        description="Chains are decided in sequence. A step can only be decided by the role it names."
      />

      {/* The queue's shape at a glance, before the queue itself. Each figure is
          a count of rows already loaded — nothing here is a second query and
          nothing can disagree with the sections beneath it. */}
      <StatRow cols={3} className="mb-6">
        <Stat kind="approval" label="Awaiting your role" value={awaitingMe.length} />
        <Stat icon="clock" state="pending" label="In flight elsewhere" value={awaitingOthers.length} />
        <Stat icon="check" state="completed" label="Settled" value={settled.length} />
      </StatRow>

      <div className="flex flex-col gap-6">
        <Panel
          title="Your queue"
          action={
            <span
              className={
                "text-[12px] " +
                (awaitingMe.length > 0 ? "font-medium text-accent-ink" : "text-text-tertiary")
              }
            >
              {awaitingMe.length} awaiting you
            </span>
          }
          flush
        >
          <ApprovalQueue requests={awaitingMe} canDecide={data.canDecide} />
        </Panel>

        {awaitingOthers.length > 0 && (
          <Panel
            title="Awaiting others"
            action={<span className="text-[12px] text-text-tertiary">{awaitingOthers.length} in flight</span>}
            flush
          >
            <RowList>
              {awaitingOthers.map((request) => (
                <Row key={request.id}>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[14px] text-text-secondary">{request.subject}</span>
                    <span className="text-[12px] text-text-tertiary">
                      Step {(request.currentStepSequence ?? 0) + 1} · with {request.currentApprover}
                    </span>
                  </span>
                </Row>
              ))}
            </RowList>
          </Panel>
        )}

        {settled.length > 0 && (
          <Panel
            title="Settled"
            action={<span className="text-[12px] text-text-tertiary">{settled.length} decided</span>}
            flush
          >
            <RowList>
              {settled.map((request) => (
                <Row key={request.id}>
                  <span className="truncate text-[14px] text-text-secondary">{request.subject}</span>
                  <StateBadge
                    category={request.outcome === "Approved" ? "Completed" : "Cancelled"}
                    label={request.outcome}
                  />
                </Row>
              ))}
            </RowList>
          </Panel>
        )}
      </div>
    </>
  );
}

export default withCapabilityPageAccess(APPROVAL_CAPABILITY, ApprovalsPage);
