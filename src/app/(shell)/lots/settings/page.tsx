import Link from "next/link";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_SETTING, PIECEWORK_CAPABILITY, productionSettings } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { PageHeader, PermissionDenied, Surface } from "@/components/ui/primitives";
import { LimitsForm } from "../../shopfloor/team/TeamForms";
import { ChallanForm, ChargeForm, FabricForm, ReasonList, StagesForm } from "./SettingsForms";

export const dynamic = "force-dynamic";

/**
 * Production settings: everything the factory decides about how work flows, in one place and in the factory's own words.
 * Stages and their default rates, the charge for a lost piece, the reasons the floor picks from (English and Hindi), the heading
 * on a challan, and what a manager may approve alone. Who looks after which stage stays on Team.
 */
async function SettingsPage() {
  installCapabilities();
  const actor = await requireActor();
  const { canRead, canEdit } = await withTenant(actor.tenantId, async (tx) => ({
    canRead: await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_SETTING),
    canEdit: await hasTenantPermission(tx, actor.roleId, "Edit", ENTITY_PIECEWORK_SETTING),
  }));
  if (!canRead) return <PermissionDenied what="production settings" />;
  const s = await executeQuery(actor, productionSettings, {});

  return (
    <>
      <PageHeader
        title="Production settings"
        description={canEdit ? "How work flows through the factory. Changes apply to work recorded from now on; history never moves." : "Read only. The owner changes these."}
        actions={<Link href="/shopfloor/team" className="inline-flex min-h-11 items-center rounded-[10px] px-4 text-[15px] font-semibold text-accent-ink no-underline hover:bg-[var(--color-control)]">Who looks after which stage</Link>}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Surface className="p-6">
          <h2 className="m-0 mb-1 text-[17px] font-medium tracking-[-0.02em]">Stages and default rates</h2>
          <p className="m-0 mb-5 text-[13px] leading-[19px] text-text-secondary">The steps a lot goes through, in order. The default rate is what a stage pays per piece when a lot sets nothing of its own.</p>
          <StagesForm stages={s.stages} canEdit={canEdit} />
        </Surface>

        <div className="flex flex-col gap-6">
          <Surface className="p-6">
            <h2 className="m-0 mb-4 text-[17px] font-medium tracking-[-0.02em]">Lost pieces</h2>
            <ChargeForm lostPieceChargeMinor={s.lostPieceChargeMinor} canEdit={canEdit} />
          </Surface>
          <Surface className="p-6">
            <h2 className="m-0 mb-4 text-[17px] font-medium tracking-[-0.02em]">Fabric stock</h2>
            <FabricForm lowFabricCenti={s.lowFabricCenti} canEdit={canEdit} />
          </Surface>
          <Surface className="p-6">
            <h2 className="m-0 mb-1 text-[17px] font-medium tracking-[-0.02em]">What a manager may approve</h2>
            <p className="m-0 mb-4 text-[13px] leading-[19px] text-text-secondary">Above these, a request waits for the owner.</p>
            <LimitsForm limits={s.limits} canEdit={canEdit} />
          </Surface>
        </div>
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Surface className="flex flex-col gap-7 p-6">
          <div>
            <h2 className="m-0 mb-1 text-[17px] font-medium tracking-[-0.02em]">Reasons and cost categories</h2>
            <p className="m-0 text-[13px] leading-[19px] text-text-secondary">
              Each person sees these in their own language. {s.reasons.custom ? "This is your own list." : "These are the starting words; saving a list makes it yours."}
            </p>
          </div>
          <ReasonList kind="defect" title="Rejected or sent for rework" hint="Asked when pieces come back with a defect." initial={s.reasons.defect} canEdit={canEdit} />
          <ReasonList kind="short" title="Short (pieces not returned)" hint="Asked when pieces are missing at take-back." initial={s.reasons.short} canEdit={canEdit} />
          <ReasonList kind="cost" title="Cost categories" hint="Offered when a cost is added to a lot (thread, buttons, packing ...). Fabric and wages are counted on their own." initial={s.reasons.cost} canEdit={canEdit} />
        </Surface>

        <Surface className="p-6">
          <h2 className="m-0 mb-1 text-[17px] font-medium tracking-[-0.02em]">Challan heading</h2>
          <p className="m-0 mb-4 text-[13px] leading-[19px] text-text-secondary">Printed at the top of every challan handed to a karigar.</p>
          <ChallanForm title={s.challanTitle} address={s.challanAddress} canEdit={canEdit} />
        </Surface>
      </div>
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, SettingsPage);
