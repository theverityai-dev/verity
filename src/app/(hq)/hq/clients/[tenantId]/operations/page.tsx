import { ErrorState, Panel, Stat, StatRow, EmptyState } from "@/components/ui/primitives";
import { runClientQuery } from "@/server/actions/hq";
import type { OperationsSnapshot } from "@/server/platform/administration";
import { probeScheduler, probeStorage } from "@/server/platform/readiness";
import { entityLabelOf, fieldLabelOf } from "@/components/ui/business/vocabulary";

export const dynamic = "force-dynamic";

/**
 * Whether a platform service is working right now. These are installation-wide
 * (one storage bucket, one scheduler for every client), so each is the same on
 * every client's tab; it is shown here because "why is nothing arriving for this
 * client" starts with "is the service up". The probes are the ones `/api/ready`
 * already runs, so this page and the health endpoint cannot disagree.
 */
async function serviceStatuses(): Promise<Array<[name: string, purpose: string, status: string, ok: boolean]>> {
  type Result = { text: string; ok: boolean };
  const storage: Result = await probeStorage().then(
    (result): Result => (result.status === "ok" ? { text: "Connected", ok: true } : { text: "Not set up", ok: false }),
    (): Result => ({ text: "Not reachable", ok: false }),
  );
  const jobs: Result = await probeScheduler().then(
    (): Result => ({ text: "Running", ok: true }),
    (): Result => ({ text: "Not running recently", ok: false }),
  );
  return [
    ["File storage", "Photos and documents attached to records", storage.text, storage.ok],
    ["Scheduled jobs", "Late-order alerts, reminders and daily sweeps", jobs.text, jobs.ok],
    // No email, push or webhook transport is connected: notifications are in-app only.
    ["Email, push and webhook alerts", "Sending alerts outside the app", "Not connected. Alerts appear in the app only.", true],
  ];
}

/**
 * What is happening and what is failing inside one client.
 *
 * Read-only, and every number is a count of real rows. There is no health score
 * and no traffic light, because nothing defines one — a green tick computed
 * from an arbitrary formula tells an operator less than the four numbers it
 * would replace.
 *
 * Provider bindings appear here as a statement of fact rather than a status
 * light: the contracts are complete and no vendor is bound, which is a decision
 * (PLATFORM-FREEZE), not an outage.
 */
export default async function ClientOperationsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const snapshot = await runClientQuery<OperationsSnapshot>(
    tenantId,
    "verity.platform.operations_snapshot",
    {},
  );

  if (!snapshot.ok) {
    return (
      <ErrorState
        title="Could not load operations for this client"
        message={snapshot.message}
        retryable={snapshot.retryable}
      />
    );
  }

  const data = snapshot.data;
  const services = await serviceStatuses();

  return (
    <>
      <StatRow className="mb-6">
        <Stat label="Undelivered events" value={data.pendingOutbox} />
        <Stat label="SLA clocks running" value={data.runningClocks} />
        <Stat label="SLA breached" value={data.breachedClocks} />
        <Stat label="Unresolved sync exceptions" value={data.syncExceptions} />
      </StatRow>

      <div className="mb-6">
        <Panel title="Platform services">
          <ul className="m-0 flex list-none flex-col gap-3 p-0 text-[15px]">
            {services.map(([name, purpose, status, ok]) => (
              <li key={name} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-text">
                  {name}
                  <span className="block text-[13px] text-text-secondary">{purpose}</span>
                </span>
                <span className={ok ? "text-success" : "text-danger"}>{status}</span>
              </li>
            ))}
          </ul>
          <p className="mb-0 mt-4 text-[13px] text-text-secondary">
            These services are shared by every client. If one is down, it is down for all of them.
          </p>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Recent changes" flush>
          {data.recentActivity.length === 0 ? (
            <EmptyState compact title="Nothing recorded yet" />
          ) : (
            <ul className="m-0 list-none p-0">
              {data.recentActivity.map((row, index) => (
                <li
                  key={`${row.occurredAt}-${index}`}
                  className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2.5 text-[13px] last:border-b-0"
                >
                  <span className="min-w-0 truncate text-text">
                    {entityLabelOf(row.entityKey)}
                    <span className="ml-2 text-text-tertiary">{fieldLabelOf(row.fieldChanged)}</span>
                  </span>
                  <span className="tabular shrink-0 text-text-tertiary">
                    {new Date(row.occurredAt).toISOString().slice(0, 16).replace("T", " ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Security events" flush>
          {data.securityEvents.length === 0 ? (
            <EmptyState compact title="Nothing recorded yet" />
          ) : (
            <ul className="m-0 list-none p-0">
              {data.securityEvents.map((row, index) => (
                <li
                  key={`${row.occurredAt}-${index}`}
                  className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2.5 text-[13px] last:border-b-0"
                >
                  <span className="text-text">{row.eventType}</span>
                  <span className="tabular shrink-0 text-text-tertiary">
                    {new Date(row.occurredAt).toISOString().slice(0, 16).replace("T", " ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
