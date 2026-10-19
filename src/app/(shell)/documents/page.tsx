import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { DOCUMENT_CAPABILITY, ENTITY_DOCUMENT, listDocumentTypes, listDocuments } from "@/server/capabilities/document";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { DataTable } from "@/components/ui/DataTable";
import { FilterChipRow, PageHeader, PermissionDenied, StatTile, StatTileRow } from "@/components/ui/primitives";
import { CreateDocumentButton, CreateTypeButton, type DocumentTypeOption } from "./DocumentForms";
import { STATUS_CATEGORY, STATUS_LABEL, expiryText } from "./format";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  number: string;
  title: string;
  typeKey: string;
  typeLabel: string;
  classification: string;
  current: { id: string; label: string; validUntil: string | null; expiry: string } | null;
  latest: { id: string; label: string; status: string };
  openDraft: boolean;
};
type TypeRow = DocumentTypeOption & { active: boolean };

/**
 * The document register. The job here is to find a document by its number and to see what has lapsed or is about
 * to, so the tiles count the real list and each row says which revision is current and how long it stays valid.
 * Search is the table's own filter (number or title); the chips narrow to one type.
 */
async function DocumentsPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  installCapabilities();
  const { type } = await searchParams;
  const actor = await requireActor();
  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Read", ENTITY_DOCUMENT));
  if (!allowed) return <PermissionDenied what="reading documents" />;

  const [all, typeRows] = await Promise.all([
    executeQuery(actor, listDocuments, {}) as Promise<unknown> as Promise<Row[]>,
    executeQuery(actor, listDocumentTypes, {}).catch(() => []) as Promise<unknown> as Promise<TypeRow[]>,
  ]);
  const types = typeRows.filter((t) => t.active);
  const rows = type ? all.filter((r) => r.typeKey === type) : all;

  const current = all.filter((r) => r.current).length;
  const inReview = all.filter((r) => r.openDraft).length;
  const expiring = all.filter((r) => r.current?.expiry === "soon").length;
  const expired = all.filter((r) => r.current?.expiry === "expired").length;

  const chips = [
    { label: "All", count: all.length, icon: "revision" as const, active: !type, href: "/documents" },
    ...types.map((t) => ({
      label: t.label,
      count: all.filter((r) => r.typeKey === t.key).length,
      icon: "revision" as const,
      active: type === t.key,
      href: `/documents?type=${encodeURIComponent(t.key)}`,
    })),
  ];

  return (
    <>
      <PageHeader
        title="Documents"
        description="Every drawing, procedure and traveller, with its number, its current revision and how long it stays valid."
        actions={
          <>
            <CreateTypeButton />
            <CreateDocumentButton types={types} />
          </>
        }
      />

      <StatTileRow className="mb-4">
        <StatTile kind="revision" label="Current" value={current} hint="with a released revision" />
        <StatTile state="pending" icon="check" label="In progress" value={inReview} hint="draft or in review" />
        <StatTile state="active" icon="check" label="Expiring soon" value={expiring} hint="within 30 days" />
        <StatTile state="blocked" icon="close" label="Expired" value={expired} hint="renew or withdraw" />
      </StatTileRow>

      {all.length > 0 && <FilterChipRow chips={chips} className="mb-4" />}

      <DataTable
        caption="Documents"
        emptyTitle={types.length === 0 ? "Define a document type first" : "No documents yet"}
        emptyDescription={
          types.length === 0
            ? "A type says how its numbers are built, for example client, division and a running number. Use “Numbering” above to add one."
            : "Create the first document. It takes its number from the type's rule and starts as a draft."
        }
        columns={[
          { key: "number", header: "Number", variant: "link", href: "/documents/{id}", kindKey: "kind", subKey: "title" },
          { key: "typeLabel", header: "Type" },
          { key: "revision", header: "Revision" },
          { key: "statusLabel", header: "Status", variant: "state", categoryKey: "category" },
          { key: "validity", header: "Validity" },
        ]}
        rows={rows.map((r) => {
          const shown = r.current ?? null;
          const status = shown ? "released" : r.latest.status;
          return {
            id: r.id,
            kind: "revision",
            number: r.number,
            title: r.title,
            typeLabel: r.typeLabel,
            revision: shown ? shown.label : r.latest.label,
            // A lapsed revision is still "released" in the record, but it must not read as in force.
            statusLabel: shown?.expiry === "expired" ? "Expired" : `${STATUS_LABEL[status] ?? status}${r.openDraft && shown ? " · revision open" : ""}`,
            category: shown?.expiry === "expired" ? "Blocked" : (STATUS_CATEGORY[status] ?? "Draft"),
            validity: shown ? expiryText(shown.expiry, shown.validUntil) : "—",
          };
        })}
      />
    </>
  );
}

export default withCapabilityPageAccess(DOCUMENT_CAPABILITY, DocumentsPage);
