import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_ENTRY, PIECEWORK_CAPABILITY, floorOverview, floorReasons } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { shortDate } from "../../lots/format";
import { getLang } from "../lang";
import { LangToggle } from "../LangToggle";
import { FloorTabs } from "../FloorChrome";
import { TakeBack } from "./TakeBack";

export const dynamic = "force-dynamic";

/** S2 · Receive and inspect: pick the issue coming back and say where every piece went. */
async function TakeBackPage({ searchParams }: { searchParams: Promise<{ issue?: string }> }) {
  installCapabilities();
  const actor = await requireActor();
  const { lang, t } = await getLang();
  const { issue } = await searchParams;
  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Create", ENTITY_PIECEWORK_ENTRY));
  if (!allowed) return <PermissionDenied what="taking pieces back" />;
  const [f, reasons] = await Promise.all([executeQuery(actor, floorOverview, {}), executeQuery(actor, floorReasons, {})]);

  return (
    <>
      <PageHeader title={t.takeBack} description={shortDate(f.today)} actions={<LangToggle lang={lang} />} />
      <FloorTabs active="take-back" t={t} />
      <TakeBack lang={lang} issues={f.issues} initialIssueId={issue} today={f.today} reasons={reasons} />
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, TakeBackPage);
