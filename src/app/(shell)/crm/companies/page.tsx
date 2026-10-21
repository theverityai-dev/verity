import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_COMPANY, RELATIONSHIP_CAPABILITY } from "@/server/capabilities/relationship";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { EmptyState, PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { RecordView } from "@/components/records/RecordView";
import { loadRecordPage } from "../_parts/load";
import { CustomFieldsButton, DuplicatesButton, ImportButton, NewCompanyButton } from "../_parts/crm-ui";

export const dynamic = "force-dynamic";

/**
 * Companies: scanning many comparable rows, so a table — with the relationship in its columns (people, open deals,
 * open value, last activity), inline edits, saved views and bulk owner changes.
 */
async function CompaniesPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  installCapabilities();
  const { view } = await searchParams;
  const data = await loadRecordPage(ENTITY_COMPANY, view);
  if (!data.ok) return <PermissionDenied what="reading companies" />;
  const { described } = data;
  return (
    <>
      <PageHeader
        title="Companies"
        description="Customers, prospects and partners, with the people and deals at each."
        actions={
          <>
            <CustomFieldsButton described={described} />
            <DuplicatesButton object="company" described={described} />
            <ImportButton object="company" label="companies" />
            <NewCompanyButton described={described} />
          </>
        }
      />
      <RecordView
        described={described}
        views={data.views}
        initialViewId={data.viewId}
        initial={data.initial}
        bulkActions={[
          { kind: "field", label: "Assign owner", command: "verity.relationship.bulk_update_companies", field: "owner" },
          { kind: "field", label: "Set industry", command: "verity.relationship.bulk_update_companies", field: "industry" },
          { kind: "simple", label: "Archive", command: "verity.relationship.archive_companies", destructive: true, confirm: "They leave lists and search, and keep their history." },
        ]}
        emptyState={
          <div className="glass-card rounded-[12px]">
            <EmptyState
              title="No companies yet"
              description="Add the businesses you sell to, or import them from a spreadsheet. People and opportunities attach to them."
              action={<div className="flex gap-2"><ImportButton object="company" label="companies" /><NewCompanyButton described={described} /></div>}
            />
          </div>
        }
      />
    </>
  );
}

export default withCapabilityPageAccess(RELATIONSHIP_CAPABILITY, CompaniesPage);
