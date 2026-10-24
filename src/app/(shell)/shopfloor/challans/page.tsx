import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_ENTRY, PIECEWORK_CAPABILITY, challanSheet, challansOnDay } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { getLang } from "../lang";
import { LangToggle } from "../LangToggle";
import { FloorTabs } from "../FloorChrome";
import { ChallansDay } from "./ChallansDay";

export const dynamic = "force-dynamic";

/** Print the day's challans together. Today unless a day is chosen; at most 60 a day are laid out. */
async function ChallansPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  installCapabilities();
  const actor = await requireActor();
  const { lang, t } = await getLang();
  const { date } = await searchParams;
  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_ENTRY));
  if (!allowed) return <PermissionDenied what="printing challans" />;

  const day = await executeQuery(actor, challansOnDay, { date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined });
  const sheets = (await Promise.all(day.challans.slice(0, 60).map((c) => executeQuery(actor, challanSheet, { number: c.number })))).flatMap((s) => (s ? [s] : []));
  const tenant = await withTenant(actor.tenantId, (tx) => tx.tenant.findFirst({ select: { name: true } }));

  return (
    <>
      <PageHeader title={t.printChallans} description={t.challansIntro} actions={<LangToggle lang={lang} />} />
      <FloorTabs active="floor" t={t} />
      <ChallansDay lang={lang} day={day} sheets={sheets} business={tenant?.name ?? ""} />
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, ChallansPage);
