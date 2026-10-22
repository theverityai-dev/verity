"use client";

import { useState } from "react";
import { SmartTable } from "@/components/ui/business/SmartTable";
import { ContextPanel } from "@/components/ui/business/ContextPanel";

type ActivityRow = {
  id: string; entity: string; field: string; change: string; at: string; command: string;
  entityKey: string; entityId: string; oldValue: string; newValue: string;
  commandFull: string; actor: string; occurredAtFull: string;
};

/**
 * First Smart Table call site (`Verity_Component_Specification.md` §3.A).
 * The table columns stay truncated for scanning; clicking a row opens the
 * full, untruncated record in a Context Panel — new capability, since this
 * table had no destination before.
 */
export function OperationalHistory({ rows }: { rows: ActivityRow[] }) {
  const [active, setActive] = useState<ActivityRow | null>(null);

  return (
    <>
      <SmartTable
        caption="Operational history"
        rows={rows}
        columns={[
          { key: "entity", header: "Record", subKey: "field" },
          { key: "change", header: "Change" },
          { key: "command", header: "Command" },
          { key: "at", header: "When" },
        ]}
        emptyTitle="No changes recorded yet"
        emptyDescription="History begins when a command modifies a record."
        onRowClick={(row) => setActive(row as ActivityRow)}
      />

      <ContextPanel
        open={active !== null}
        onClose={() => setActive(null)}
        title={active ? `${active.entity} — ${active.field}` : ""}
      >
        {active && (
          <dl className="m-0 flex flex-col gap-4 text-[13px]">
            <Detail label="Entity" value={active.entityKey} />
            <Detail label="Entity ID" value={active.entityId} mono />
            <Detail label="Field changed" value={active.field} />
            <Detail label="Old value" value={active.oldValue} mono />
            <Detail label="New value" value={active.newValue} mono />
            <Detail label="Command" value={active.commandFull} mono />
            <Detail label="Actor" value={active.actor} mono />
            <Detail label="Occurred at" value={active.occurredAtFull} mono />
          </dl>
        )}
      </ContextPanel>
    </>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[12px] text-text-tertiary">{label}</dt>
      <dd className={"m-0 break-words text-text " + (mono ? "font-mono text-[13px]" : "")}>
        {value}
      </dd>
    </div>
  );
}
