import { withPageAccess } from "@/components/ui/PageAccess";
import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { installCapabilities } from "@/server/capabilities/registry";
import { executeQuery } from "@/server/platform/query";
import { ForbiddenError } from "@/server/platform/authorization";
import { getOrderDetail, listMenu, type OrderDetail } from "@/server/capabilities/dinein";
import { PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { OrderPad } from "./OrderPad";

export const dynamic = "force-dynamic";

type MenuCategory = Awaited<ReturnType<typeof listMenu.handler>>[number];

/**
 * One table's order.
 *
 * The whole of table service happens here: what has been ordered, what the
 * kitchen has done with it, and what to add. A waiter should never have to hold
 * two screens in their head at once, so the menu and the order sit side by side
 * rather than behind a tab.
 */
async function OrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  installCapabilities();
  const { orderId } = await params;
  const actor = await requireActor();

  let order: OrderDetail | null;
  let menu: MenuCategory[];
  try {
    [order, menu] = await Promise.all([
      executeQuery(actor, getOrderDetail, { orderId }),
      executeQuery(actor, listMenu, {}),
    ]);
  } catch (error) {
    if (error instanceof ForbiddenError) return <PermissionDenied what="this order" />;
    throw error;
  }

  if (!order) notFound();

  return (
    <>
      <PageHeader
        title={order.label}
        description={
          order.tableId
            ? `${order.covers} ${order.covers === 1 ? "cover" : "covers"} · order is ${order.state.replace("_", " ")}`
            : `Order is ${order.state.replace("_", " ")}`
        }
      />
      <OrderPad order={order} menu={menu} />
    </>
  );
}

export default withPageAccess(OrderPage);
