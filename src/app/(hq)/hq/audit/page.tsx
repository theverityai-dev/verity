import { PageHeader, Panel } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { platformAudit, requireOperator } from "@/server/platform/operator";

const columns: Column[] = [
  { key: "when", header: "When", sortable: true },
  { key: "client", header: "Client", sortable: true },
  { key: "entity", header: "Entity", sortable: true },
  { key: "change", header: "Change", sortable: false, subKey: "commandKey" },
  { key: "by", header: "By", sortable: true },
];

export const dynamic = "force-dynamic";

/**
 * Platform audit.
 *
 * Metadata only: which change happened, to which entity type, in which client,
 * by whom, and whether the actor was an operator. Not what the record contained
 * — a platform-wide view of every client's field values would be the leak this
 * whole mechanism exists to avoid, and it is not needed to answer the question
 * an operator actually has.
 *
 * ADR-013 answer 12 in the interface: privileged actions are labelled, because
 * an audit trail that cannot distinguish "the client did this" from "we did this
 * to the client" is not an audit trail anyone can act on.
 */
export default async function HqAuditPage() {
  const operator = await requireOperator();
  const rows = await platformAudit(operator, 100);

  const tableRows = rows.map((row, i) => ({
    id: `${row.entityId}-${row.occurredAt.toISOString()}-${i}`,
    when: row.occurredAt.toISOString().slice(0, 16).replace("T", " "),
    client: row.tenantName,
    entity: row.entityKey,
    change: row.fieldChanged,
    commandKey: row.commandKey ?? undefined,
    by: row.isOperator ? "Operator" : "Client user",
  }));

  return (
    <>
      <PageHeader
        title="Platform audit"
        description="Recent changes across every client. Operator actions are marked; payload values stay inside the client they belong to."
        actions={
          <a href="/api/hq/audit" download className="inline-flex min-h-11 items-center rounded-[10px] bg-control px-4 text-[15px] font-semibold text-accent-ink no-underline hover:bg-control-strong">
            Download CSV
          </a>
        }
      />

      <Panel title={`${rows.length} most recent`} flush>
        <DataTable
          columns={columns}
          rows={tableRows}
          caption="Platform-wide audit metadata"
          emptyTitle="Nothing recorded yet"
        />
      </Panel>
    </>
  );
}
