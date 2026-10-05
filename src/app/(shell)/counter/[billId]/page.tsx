import { withPageAccess } from "@/components/ui/PageAccess";
import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { installCapabilities } from "@/server/capabilities/registry";
import { executeQuery } from "@/server/platform/query";
import { ForbiddenError } from "@/server/platform/authorization";
import { getBillDetail, type BillDetail } from "@/server/capabilities/dinein";
import { PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { BillView } from "./BillView";

export const dynamic = "force-dynamic";

/**
 * One bill: what is owed, what has been paid, and the printable copy.
 *
 * Record-and-print by design (GOV-SCO-006). No terminal, no gateway, no cash
 * drawer — the restaurant takes the money the way it always has and records
 * what happened.
 */
async function BillPage({ params }: { params: Promise<{ billId: string }> }) {
  installCapabilities();
  const { billId } = await params;
  const actor = await requireActor();

  let bill: BillDetail | null;
  try {
    bill = await executeQuery(actor, getBillDetail, { billId });
  } catch (error) {
    if (error instanceof ForbiddenError) return <PermissionDenied what="this bill" />;
    throw error;
  }

  if (!bill) notFound();

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={`Bill · ${bill.label}`}
          description={bill.state === "settled" ? "Settled" : "Open — awaiting payment"}
        />
      </div>
      <BillView bill={bill} />
    </>
  );
}

export default withPageAccess(BillPage);
