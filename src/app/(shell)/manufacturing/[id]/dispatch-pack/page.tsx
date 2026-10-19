import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { installCapabilities } from "@/server/capabilities/registry";
import { MANUFACTURING_CAPABILITY } from "@/server/capabilities/manufacturing";
import { loadDispatchPack } from "@/server/capabilities/manufacturing/documents";
import { jobForOrder } from "@/server/capabilities/project";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { EmptyState, PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { dispatchPackDoc } from "../document-data";
import { DispatchPackDoc } from "./DispatchPackDoc";

export const dynamic = "force-dynamic";

/**
 * The dispatch pack for one dispatched order: delivery note, packing list and the inspection checks that
 * supported the release. It is built only from the dispatch ledger and the order's own records. The
 * verification passport's link is shown once when published and only its hash is stored, so this page states
 * that a passport exists but cannot print its QR: the nameplate carries it.
 */
async function DispatchPackPage({ params }: { params: Promise<{ id: string }> }) {
  installCapabilities();
  const { id } = await params;
  const actor = await requireActor();

  const loaded = await withTenant(actor.tenantId, async (tx) => {
    const record = await loadDispatchPack(tx, actor, id);
    if (typeof record === "string" || record === null) return record;
    return { record, job: await jobForOrder(tx, actor, id) };
  });

  if (loaded === "denied") return <PermissionDenied what="viewing this dispatch" />;
  if (loaded === "undispatched") {
    return (
      <>
        <PageHeader title="Dispatch pack" />
        <EmptyState title="Not dispatched yet" description="The pack is built from the dispatch record. Record the dispatch on the order first, then print it here." />
      </>
    );
  }
  if (!loaded) notFound();

  const doc = dispatchPackDoc(loaded.record, loaded.job);

  return (
    <>
      <div className="print:hidden">
        <PageHeader title="Dispatch pack" description="Delivery note, packing list and the inspection checks that supported the release." />
      </div>
      <DispatchPackDoc doc={doc} />
    </>
  );
}

export default withCapabilityPageAccess(MANUFACTURING_CAPABILITY, DispatchPackPage);
