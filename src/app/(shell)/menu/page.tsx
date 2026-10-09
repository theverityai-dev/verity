import { withPageAccess } from "@/components/ui/PageAccess";
import { requireActor } from "@/server/platform/auth";
import { installCapabilities } from "@/server/capabilities/registry";
import { executeQuery } from "@/server/platform/query";
import { ForbiddenError } from "@/server/platform/authorization";
import { withTenant } from "@/server/platform/tenancy";
import { listKitchenSetup, listMenu, ORDER_CHANNELS, ORDER_CHANNEL_LABEL } from "@/server/capabilities/dinein";
import { PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { MenuAdmin } from "./MenuAdmin";

export const dynamic = "force-dynamic";

/**
 * The menu.
 *
 * Retired items are shown here and nowhere else: the ordering surfaces hide
 * them, but a manager needs to see what exists in order to bring something
 * back. There is no delete, anywhere, by design — a bill from last month
 * references what was sold.
 */
async function MenuPage() {
  installCapabilities();
  const actor = await requireActor();

  let menu: Awaited<ReturnType<typeof listMenu.handler>>;
  let outlets: Array<{ id: string; name: string }>;
  let courses: Array<{ id: string; name: string }> = [];
  try {
    menu = await executeQuery(actor, listMenu, { includeInactive: true });
    outlets = await withTenant(actor.tenantId, (tx) =>
      tx.location.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    );
    // Courses come with the kitchen setup; a role that cannot read it simply gets no course picker.
    courses = (await executeQuery(actor, listKitchenSetup, {}).catch(() => null))?.courses.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name })) ?? [];
  } catch (error) {
    if (error instanceof ForbiddenError)
      return <PermissionDenied what="the menu" />;
    throw error;
  }

  return (
    <>
      <PageHeader
        title="Menu"
        description="What can be ordered, and what it costs. Prices change forward — bills already raised keep the price they were raised at."
      />
      <MenuAdmin
        menu={menu}
        outlets={outlets}
        courses={courses}
        channels={ORDER_CHANNELS.map((c) => ({ value: c, label: ORDER_CHANNEL_LABEL[c] }))}
      />
    </>
  );
}

export default withPageAccess(MenuPage);
