import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { resolvePermissions } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import {
  countWorkspaceContribution,
  workspaceContributionsFor,
} from "@/server/platform/contribution";
import {
  EmptyState,
  PageHeader,
  Panel,
  Row,
  RowList,
  Stat,
  StatRow,
  Surface,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

/**
 * Workspace (§11).
 *
 * Bible V4 §3 draws the distinction this page is built on: a dashboard is for
 * reading, a workspace is for executing. So this is a queue of things awaiting
 * this actor, not a set of metric tiles. Every item links to where the work is
 * done.
 *
 * It shows only what the platform can genuinely answer today — approvals awaiting
 * the actor's role, unresolved sync exceptions, and blocked records. There are no
 * SLA warnings because no SLA engine exists yet, and inventing one here would be
 * a fake workflow.
 */
export default async function WorkspacePage() {
  installCapabilities();
  const actor = await requireActor();

  const data = await withTenant(actor.tenantId, async (tx) => {
    const permissions = actor.roleId ? await resolvePermissions(tx, actor.roleId) : [];

    const [activations, exceptions] = await Promise.all([
      tx.tenantActivation.findMany({ where: { status: "Active" } }),
      tx.syncException.findMany({ where: { resolvedAt: null }, take: 10 }),
    ]);

    return { permissions, activations, exceptions };
  });

  // Queue entries are supplied by the capabilities themselves. The workspace
  // does not know what an approval or a patrol is; it knows how to render "N
  // things are waiting on you" and where to send the user. A capability that
  // cannot count something real simply contributes nothing.
  const queues = workspaceContributionsFor({
    activeCapabilityIds: data.activations.map((a) => a.capabilityId),
    shell: "platform",
  });

  const counted = await Promise.all(
    queues.map(async (queue) => ({
      ...queue,
      value: await countWorkspaceContribution({
        tenantId: actor.tenantId,
        roleId: actor.roleId,
        userId: actor.userId,
        contribution: queue,
      }),
    })),
  );
  const waiting = counted.filter((q) => q.value > 0);

  const nothingWaiting = waiting.length === 0 && data.exceptions.length === 0;

  return (
    <>
      <PageHeader
        title="Workspace"
        description="What is waiting on you right now. A workspace is for executing; the overview is for reading."
      />

      {/* Real counts of what is actually queued for this actor. `Queues` counts
          the queues that have anything in them, not the queues that exist —
          an empty queue is not work. */}
      <StatRow cols={3} className="mb-6">
        <Stat kind="schedule" label="Items waiting" value={waiting.reduce((n, q) => n + q.value, 0)} />
        <Stat kind="production" label="Queues with work" value={waiting.length} />
        <Stat icon="flag" state="blocked" label="Sync exceptions" value={data.exceptions.length} />
      </StatRow>

      {nothingWaiting ? (
        <Surface>
          <EmptyState
            title="Nothing is waiting on you"
            description="Approvals, unresolved sync exceptions and blocked records appear here the moment they need a decision. An empty workspace is the goal, not a gap."
          />
        </Surface>
      ) : (
        <div className="flex flex-col gap-9">
          {waiting.length > 0 && (
            <div>
              {/*
                Queues are cards in one band rather than a stack of sections. A
                queue is a destination with a count — the same shape each time —
                so giving each its own heading and rule made the page look longer
                than it was without making it clearer.
              */}
              <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {waiting.map((queue) => (
                  <Stat
                    key={queue.key}
                    label={queue.label}
                    value={queue.value}
                    hint={`${queue.value === 1 ? "item" : "items"} waiting — open`}
                    href={queue.href}
                  />
                ))}
              </div>
            </div>
          )}

          {data.exceptions.length > 0 && (
            <Panel
              title="Sync exceptions"
              action={
                <span className="text-[12px] text-text-tertiary">
                  {data.exceptions.length} unresolved
                </span>
              }
              flush
            >
              <RowList>
                {data.exceptions.map((exception) => (
                  <Row key={exception.id} className="items-start">
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-[14px] text-text">{exception.kind}</span>
                      <span className="text-[13px] leading-relaxed text-text-secondary">
                        {exception.detail}
                      </span>
                    </span>
                  </Row>
                ))}
              </RowList>
            </Panel>
          )}
        </div>
      )}
    </>
  );
}
