import { PageHeader, Panel, Stat, StatRow } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import {
  clientDirectory,
  platformActivity,
  requireOperator,
  schedulerRunSummary,
} from "@/server/platform/operator";

export const dynamic = "force-dynamic";

/** A live client with no change for this long is shown as gone quiet (B4). */
const QUIET_DAYS = 14;

const columns: Column[] = [
  { key: "name", header: "Client", sortable: true, variant: "link", href: "/hq/clients" },
  { key: "activity30d", header: "Changes", numeric: true, sortable: true },
  { key: "securityEvents30d", header: "Security events", numeric: true, sortable: true },
  { key: "lastActivity", header: "Last change", sortable: true },
];

/**
 * The operator overview.
 *
 * Every number here is counted, not estimated, and comes from the two read-only
 * projections ADR-013 enumerates. There is no trend, no sparkline and no
 * health score, because the platform has nothing to compare against yet and a
 * comparison invented for a dashboard is the exact fake metric this codebase
 * has refused elsewhere.
 */
export default async function HqOverviewPage() {
  const operator = await requireOperator();
  const [clients, activity, jobs] = await Promise.all([
    clientDirectory(operator),
    platformActivity(operator),
    schedulerRunSummary(operator),
  ]);

  const totalMembers = clients.reduce((sum, c) => sum + c.memberCount, 0);
  const totalActivity = activity.reduce((sum, a) => sum + a.activity30d, 0);
  const totalSecurity = activity.reduce((sum, a) => sum + a.securityEvents30d, 0);

  // ADR-034: which clients need someone to look, and why. Counts only.
  // eslint-disable-next-line react-hooks/purity -- a server component reads the clock once per request
  const now = Date.now();
  const statusById = new Map(clients.map((c) => [c.tenantId, c.status]));
  const attention = activity
    .map((a) => {
      const reasons: string[] = [];
      const status = statusById.get(a.tenantId);
      if (status === "suspended") reasons.push("Suspended");
      if (status === "onboarding") reasons.push("Still onboarding");
      if (a.syncExceptions > 0) reasons.push(`${a.syncExceptions} sync problems`);
      if (a.slaBreached > 0) reasons.push(`${a.slaBreached} late against SLA`);
      if (a.peopleInvited > 0) reasons.push(`${a.peopleInvited} ${a.peopleInvited === 1 ? "person has" : "people have"} never signed in`);
      if (status === "active") {
        const quietDays = a.lastActivityAt ? Math.floor((now - a.lastActivityAt.getTime()) / 86_400_000) : null;
        if (quietDays === null) reasons.push("No activity yet");
        else if (quietDays >= QUIET_DAYS) reasons.push(`No changes in ${quietDays} days`);
      }
      return { id: a.tenantId, tenantId: a.tenantId, name: a.name, why: reasons.join(" · "), count: reasons.length };
    })
    .filter((row) => row.count > 0);

  return (
    <>
      <PageHeader
        title="Platform overview"
        description="Every client on this Verity installation, and what has happened inside them. Counts only — a client's own records stay inside that client."
      />

      <StatRow className="mb-6">
        <Stat label="Clients" value={clients.length} href="/hq/clients" />
        <Stat label="People with access" value={totalMembers} />
        <Stat label="Changes · 30 days" value={totalActivity} />
        <Stat label="Security events · 30 days" value={totalSecurity} href="/hq/audit" />
      </StatRow>

      <Panel title={attention.length === 0 ? "Nothing needs attention" : `Needs attention · ${attention.length}`} flush>
        <DataTable
          columns={[
            { key: "name", header: "Client", sortable: true, variant: "link", href: "/hq/clients/{tenantId}" },
            { key: "why", header: "Why" },
          ]}
          rows={attention}
          caption="Clients with something to look at"
          emptyTitle="Every client looks healthy"
          emptyDescription="No sync problems, late work, unused invitations, quiet or suspended clients."
          filterable={false}
        />
      </Panel>

      <div className="mt-6" />

      <Panel title="Scheduled jobs" flush>
        <DataTable
          columns={[
            { key: "cadence", header: "Job" },
            { key: "status", header: "Last result" },
            { key: "when", header: "Last run" },
            { key: "work", header: "Clients · items", numeric: true },
          ]}
          rows={jobs.map((job) => ({
            id: job.cadence,
            cadence: job.cadence.charAt(0).toUpperCase() + job.cadence.slice(1),
            status: job.status,
            when: job.startedAt.toISOString().slice(0, 16).replace("T", " "),
            work: `${job.tenantCount ?? 0} · ${job.workCount ?? 0}`,
          }))}
          caption="The latest run of each scheduled job on this installation (UTC)"
          emptyTitle="No scheduled job has run"
          emptyDescription="Late-order alerts, reminders and sweeps run on a schedule. If this stays empty, the scheduler is not reaching the app."
          filterable={false}
        />
      </Panel>

      <div className="mt-6" />

      <Panel title="Activity by client" flush>
        <DataTable
          columns={columns}
          rows={activity.map((row) => ({
            id: row.tenantId,
            name: row.name,
            activity30d: row.activity30d,
            securityEvents30d: row.securityEvents30d,
            lastActivity: row.lastActivityAt
              ? row.lastActivityAt.toISOString().slice(0, 16).replace("T", " ")
              : "—",
          }))}
          caption="Activity per client over the last 30 days"
          emptyTitle="No clients yet"
          emptyDescription="Create the first client from the Clients page. Nothing is provisioned automatically."
        />
      </Panel>
    </>
  );
}
