import Link from "next/link";
import { withPageAccess } from "@/components/ui/PageAccess";
import { requireActor } from "@/server/platform/auth";
import { installCapabilities } from "@/server/capabilities/registry";
import { executeQuery } from "@/server/platform/query";
import { ForbiddenError } from "@/server/platform/authorization";
import { listKitchenSetup } from "@/server/capabilities/dinein";
import { PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { KitchenSetup } from "./KitchenSetup";

export const dynamic = "force-dynamic";

async function KitchenSetupPage() {
  installCapabilities();
  const actor = await requireActor();

  let setup: Awaited<ReturnType<typeof listKitchenSetup.handler>>;
  try {
    setup = await executeQuery(actor, listKitchenSetup, {});
  } catch (error) {
    if (error instanceof ForbiddenError) return <PermissionDenied what="the kitchen setup" />;
    throw error;
  }

  return (
    <>
      <PageHeader
        title="Stations and courses"
        description="Which part of the kitchen cooks what, and the order dishes come to the pass."
        actions={
          <Link href="/kitchen" className="text-[13px] text-text-secondary underline-offset-4 hover:underline">
            Back to the kitchen
          </Link>
        }
      />
      <KitchenSetup setup={setup} />
    </>
  );
}

export default withPageAccess(KitchenSetupPage);
