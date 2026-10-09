import Link from "next/link";
import { withPageAccess } from "@/components/ui/PageAccess";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { installCapabilities } from "@/server/capabilities/registry";
import { executeQuery } from "@/server/platform/query";
import { ForbiddenError } from "@/server/platform/authorization";
import { listMenu, listMenuPriceRules, ORDER_CHANNELS, ORDER_CHANNEL_LABEL, serviceDayRange } from "@/server/capabilities/dinein";
import { PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { PricesAdmin } from "./PricesAdmin";

export const dynamic = "force-dynamic";

async function PricesPage() {
  installCapabilities();
  const actor = await requireActor();

  let menu: Awaited<ReturnType<typeof listMenu.handler>>;
  let rules: Awaited<ReturnType<typeof listMenuPriceRules.handler>>;
  let outlets: Array<{ id: string; name: string }>;
  let today: string;
  try {
    menu = await executeQuery(actor, listMenu, {});
    rules = await executeQuery(actor, listMenuPriceRules, {});
    outlets = await withTenant(actor.tenantId, (tx) =>
      tx.location.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    );
    today = await withTenant(actor.tenantId, async (tx) => (await serviceDayRange(tx, actor.organizationId)).day);
  } catch (error) {
    if (error instanceof ForbiddenError) return <PermissionDenied what="menu prices" />;
    throw error;
  }

  return (
    <>
      <PageHeader
        title="Prices by outlet and order type"
        description="The Menu holds each item's own price. Here an outlet or an order type, such as a delivery platform, can sell it for something else. The most specific price that fits an order is used, and the order pad says which."
        actions={
          <Link href="/menu" className="text-[13px] text-text-secondary underline-offset-4 hover:underline">
            Back to the menu
          </Link>
        }
      />
      <PricesAdmin
        items={menu.flatMap((c) => c.items).filter((i) => i.active).map((i) => ({ id: i.id, name: i.name, priceMinor: i.priceMinor }))}
        outlets={outlets}
        channels={ORDER_CHANNELS.map((c) => ({ value: c, label: ORDER_CHANNEL_LABEL[c] }))}
        rules={rules}
        today={today}
      />
    </>
  );
}

export default withPageAccess(PricesPage);
