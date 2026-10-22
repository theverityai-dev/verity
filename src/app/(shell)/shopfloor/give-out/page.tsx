import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_ENTRY, PIECEWORK_CAPABILITY, floorOverview, floorWorkers } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { shortDate } from "../../lots/format";
import { getLang } from "../lang";
import { LangToggle } from "../LangToggle";
import { FloorTabs } from "../FloorChrome";
import { GiveOut } from "./GiveOut";

export const dynamic = "force-dynamic";

/** S3 · Give out: bundles waiting at my stages, a karigar, a due date. Rework waiting in the pool is reissued from here too. */
async function GiveOutPage({ searchParams }: { searchParams: Promise<{ bundle?: string; stage?: string; rework?: string }> }) {
  installCapabilities();
  const actor = await requireActor();
  const { lang, t } = await getLang();
  const q = await searchParams;
  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Create", ENTITY_PIECEWORK_ENTRY));
  if (!allowed) return <PermissionDenied what="giving pieces out" />;
  const [f, workers] = await Promise.all([executeQuery(actor, floorOverview, {}), executeQuery(actor, floorWorkers, {})]);

  return (
    <>
      <PageHeader title={t.giveOut} description={shortDate(f.today)} actions={<LangToggle lang={lang} />} />
      <FloorTabs active="give-out" t={t} />
      <GiveOut lang={lang} waiting={f.waiting} workers={workers} today={f.today} initial={q.bundle && q.stage ? { bundleId: q.bundle, stageId: q.stage, rework: q.rework === "1" } : undefined} />
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, GiveOutPage);
