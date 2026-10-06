import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { clientDirectory, requireOperator } from "@/server/platform/operator";
import { ClientTabs } from "./ClientTabs";
import { ClientLifecycle, EnterClientButton } from "../ClientLifecycle";
import { STATUS_LABEL } from "../status-label";

export const dynamic = "force-dynamic";

/**
 * One client's administration.
 *
 * The client is resolved from the operator's own directory projection rather
 * than by reading the tenant table: an id in the URL is a request, not an
 * authority, and looking it up through the projection means an operator can
 * only reach a client the projection would have shown them. An unknown or
 * unreachable id is a 404, which is also the right answer for "exists but is
 * not yours" — a distinguishable error would confirm the tenant exists.
 */
export default async function ClientAdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const operator = await requireOperator();
  const client = (await clientDirectory(operator)).find((c) => c.tenantId === tenantId);
  if (!client) notFound();

  return (
    <>
      <header className="mb-6">
        <Link
          href="/hq/clients"
          className="text-[13px] text-text-tertiary no-underline hover:text-text"
        >
          ← All clients
        </Link>
        <h1 className="mt-2 truncate">{client.name}</h1>
        <p className="mb-0 mt-2 text-[13px] text-text-secondary">
          {client.memberCount} {client.memberCount === 1 ? "person" : "people"} ·{" "}
          {client.organizationCount}{" "}
          {client.organizationCount === 1 ? "organization" : "organizations"} · created{" "}
          {client.createdAt.toISOString().slice(0, 10)}
          {client.timeZone ? ` · ${client.timeZone}` : " · UTC"}
        </p>
        <p className="mb-0 mt-2 text-[13px] text-text-secondary">
          Status: <span className={client.status === "suspended" ? "font-semibold text-danger" : "font-semibold text-text"}>{STATUS_LABEL[client.status] ?? client.status}</span>
          {client.statusReason ? ` · ${client.statusReason}` : ""}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <EnterClientButton tenantId={tenantId} name={client.name} />
          <ClientLifecycle tenantId={tenantId} status={client.status} />
        </div>
      </header>

      <ClientTabs tenantId={tenantId} />

      {children}
    </>
  );
}
