import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PERSON, RELATIONSHIP_CAPABILITY } from "@/server/capabilities/relationship";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { EmptyState, PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { RecordView } from "@/components/records/RecordView";
import { loadRecordPage } from "../_parts/load";
import { CustomFieldsButton, DuplicatesButton, ImportButton, NewPersonButton } from "../_parts/crm-ui";

export const dynamic = "force-dynamic";

/** People: the contacts at each company, every email and phone, who owns the relationship and when it was last touched. */
async function PeoplePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  installCapabilities();
  const { view } = await searchParams;
  const data = await loadRecordPage(ENTITY_PERSON, view);
  if (!data.ok) return <PermissionDenied what="reading people" />;
  const { described } = data;
  return (
    <>
      <PageHeader
        title="People"
        description="Contacts at your customers and partners: who they are, how to reach them, and when you last spoke."
        actions={
          <>
            <CustomFieldsButton described={described} />
            <DuplicatesButton object="person" described={described} />
            <ImportButton object="person" label="people" />
            <NewPersonButton described={described} />
          </>
        }
      />
      <RecordView
        described={described}
        views={data.views}
        initialViewId={data.viewId}
        initial={data.initial}
        bulkActions={[
          { kind: "field", label: "Assign owner", command: "verity.relationship.bulk_update_people", field: "owner" },
          { kind: "field", label: "Move to company", command: "verity.relationship.bulk_update_people", field: "company" },
          { kind: "simple", label: "Archive", command: "verity.relationship.archive_people", destructive: true, confirm: "They leave lists and search, and keep their history." },
        ]}
        emptyState={
          <div className="glass-card rounded-[12px]">
            <EmptyState
              title="No people yet"
              description="Add a contact, or import a spreadsheet. A work email links each person to the company with that domain."
              action={<div className="flex gap-2"><ImportButton object="person" label="people" /><NewPersonButton described={described} /></div>}
            />
          </div>
        }
      />
    </>
  );
}

export default withCapabilityPageAccess(RELATIONSHIP_CAPABILITY, PeoplePage);
