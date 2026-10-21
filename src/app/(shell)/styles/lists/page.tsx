import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_INVENTORY_ATTRIBUTE, INVENTORY_CAPABILITY, listAttributes } from "@/server/capabilities/inventory";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { ButtonLink, EmptyState, PageHeader, Panel, PermissionDenied } from "@/components/ui/primitives";
import { AddValueForm, NewListForm, ValueToggle } from "./ListControls";

export const dynamic = "force-dynamic";

const KIND_NOTE: Record<string, string> = {
  colour: "Colour list. Each colour can carry a swatch.",
  size: "Size run. Shown in the order you set, smallest first.",
  other: "Plain list.",
};

async function ListsPage() {
  installCapabilities();
  const actor = await requireActor();

  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Read", ENTITY_INVENTORY_ATTRIBUTE));
  if (!allowed) return <PermissionDenied what="reading colour and size lists" />;

  const lists = await executeQuery(actor, listAttributes, { includeInactive: true });

  return (
    <>
      <PageHeader
        title="Colours and sizes"
        description="The lists every style draws from. A code is used in SKUs and never reused; a value you stop using is retired, not deleted."
        actions={
          <>
            <ButtonLink href="/styles" variant="ghost">Styles</ButtonLink>
            <NewListForm />
          </>
        }
      />

      {lists.length === 0 ? (
        <EmptyState
          title="No lists yet"
          description="Start with a colour list and a size run. Styles pick their colours and sizes from these."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {lists.map((list) => (
            <Panel
              key={list.id}
              title={list.label}
              action={list.active ? <AddValueForm attributeId={list.id} label={list.label} kind={list.kind} /> : undefined}
            >
              <p className="m-0 mb-3 text-[13px] text-text-secondary">{KIND_NOTE[list.kind] ?? KIND_NOTE.other}</p>
              {list.values.length === 0 ? (
                <p className="m-0 text-[14px] text-text-secondary">No values yet.</p>
              ) : (
                <ul className="m-0 grid list-none grid-cols-1 gap-x-8 gap-y-1 p-0 sm:grid-cols-2 lg:grid-cols-3">
                  {list.values.map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] py-2">
                      <span className={`flex min-w-0 items-center gap-2.5 ${v.active ? "text-text" : "text-text-tertiary"}`}>
                        {v.swatchHex && (
                          <span
                            aria-hidden="true"
                            className="inline-block size-4 shrink-0 rounded-full ring-1 ring-inset ring-[var(--color-line-strong)]"
                            style={{ backgroundColor: v.swatchHex }}
                          />
                        )}
                        <span className="truncate font-medium">{v.label}</span>
                        <span className="shrink-0 text-[12px] tabular-nums text-text-tertiary">{v.code}</span>
                        {!v.active && <span className="shrink-0 text-[12px]">Retired</span>}
                      </span>
                      <ValueToggle valueId={v.id} label={v.label} active={v.active} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}

export default withCapabilityPageAccess(INVENTORY_CAPABILITY, ListsPage);
