"use client";

import { DataTable, type Column } from "@/components/ui/DataTable";
import { EnterClientButton, STATUS_LABEL } from "./ClientLifecycle";

const columns: Column[] = [
  { key: "name", header: "Client", sortable: true, variant: "link", href: "/hq/clients/{tenantId}" },
  { key: "statusLabel", header: "Status", variant: "state", categoryKey: "statusCategory", sortable: true },
  { key: "memberCount", header: "People", numeric: true, sortable: true },
  { key: "organizationCount", header: "Organizations", numeric: true, sortable: true },
  { key: "created", header: "Created", sortable: true },
  { key: "administer", header: "", variant: "link", href: "/hq/clients/{tenantId}" },
];

type ClientRow = {
  tenantId: string;
  name: string;
  memberCount: number;
  organizationCount: number;
  createdAt: Date;
  status: string;
};

/**
 * The client list's table half, split out from `page.tsx` (a Server
 * Component) because `DataTable`'s `rowActions` is a plain closure — it
 * cannot cross the Server/Client boundary the way a `"use server"` action
 * can. `enterClientAction` itself stays a real server action, called from
 * the row's own `<form>`, same write-not-navigation shape the page's own
 * doc comment requires (QO-3: entering a client is a privileged act with
 * an audit record, not a link).
 */
export function ClientsTable({ clients }: { clients: ClientRow[] }) {
  return (
    <DataTable
      columns={columns}
      rows={clients.map((client) => ({
        id: client.tenantId,
        tenantId: client.tenantId,
        name: client.name,
        statusLabel: STATUS_LABEL[client.status] ?? client.status,
        // ADR-009 behavioural categories for the badge.
        statusCategory: client.status === "suspended" ? "Blocked" : client.status === "onboarding" ? "Pending" : "Active",
        memberCount: client.memberCount,
        organizationCount: client.organizationCount,
        created: client.createdAt.toISOString().slice(0, 10),
        administer: "Administer",
      }))}
      caption="Clients on this installation"
      emptyTitle="No clients yet"
      emptyDescription="Create one above. Nothing is provisioned automatically, and no demo client is created for you."
      rowActions={(row) => <EnterClientButton tenantId={String(row.tenantId)} name={String(row.name)} />}
    />
  );
}
