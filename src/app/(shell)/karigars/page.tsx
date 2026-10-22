import Link from "next/link";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_PAYMENT, ENTITY_PIECEWORK_WORKER, PIECEWORK_CAPABILITY, listStages, listWorkers } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState, FilterChipRow, PageHeader, PermissionDenied, Surface } from "@/components/ui/primitives";
import { NewKarigarForm } from "./KarigarForms";
import { BASIS_LABEL, rupees } from "../lots/format";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "active", label: "Working" },
  { key: "retired", label: "Retired" },
  { key: "all", label: "All" },
] as const;

async function KarigarsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  installCapabilities();
  const actor = await requireActor();
  const { show } = await searchParams;

  const { allowed, canMoney } = await withTenant(actor.tenantId, async (tx) => ({
    allowed: await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_WORKER),
    canMoney: await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_PAYMENT),
  }));
  if (!allowed) return <PermissionDenied what="reading karigars" />;

  const [workers, stages] = await Promise.all([executeQuery(actor, listWorkers, { includeInactive: true }), executeQuery(actor, listStages, {})]);
  const active = FILTERS.find((f) => f.key === show) ?? FILTERS[0];
  const countOf = (key: string) => workers.filter((w) => (key === "all" ? true : key === "active" ? w.active : !w.active)).length;
  const shown = workers.filter((w) => (active.key === "all" ? true : active.key === "active" ? w.active : !w.active));
  const live = workers.filter((w) => w.active);
  const out = live.reduce((s, w) => s + w.piecesHeld, 0);
  const owed = live.reduce((s, w) => s + w.balanceMinor, 0);

  return (
    <>
      <PageHeader
        title="Karigars and outside units"
        description={`${live.length} working, ${out} pieces in their hands${canMoney ? `, ${rupees(owed)} owed` : ""}. Each has a rate per piece and the basis it is paid on.`}
        actions={<NewKarigarForm stages={stages.map((s) => ({ id: s.id, label: s.label }))} />}
      />

      <div className="mb-5">
        <FilterChipRow chips={FILTERS.map((f) => ({ label: f.label, count: countOf(f.key), active: f.key === active.key, href: f.key === "active" ? "/karigars" : `/karigars?show=${f.key}` }))} />
      </div>

      {shown.length === 0 ? (
        <EmptyState title="No karigars here" description="Add a karigar or an outside unit with a rate per piece for the work they do." />
      ) : (
        <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-2 2xl:grid-cols-3">
          {shown.map((w) => (
            <li key={w.id} className="list-none">
              <Link href={`/karigars/${w.id}`} className="block no-underline transition-transform duration-150 hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]">
                <Surface className={`h-full p-5 ${w.active ? "" : "opacity-70"}`}>
                  <div className="flex items-start gap-3.5">
                    <Avatar name={w.name} size={44} />
                    <div className="min-w-0 flex-1">
                      <h2 className="m-0 truncate text-[17px] font-semibold leading-[22px] tracking-[-0.02em] text-text">{w.name}</h2>
                      <p className="m-0 truncate text-[13px] leading-[18px] text-text-secondary">
                        {w.kind === "outside" ? "Outside unit" : "In the factory"}{w.mobile ? ` · ${w.mobile}` : ""}{w.active ? "" : " · Retired"}
                      </p>
                    </div>
                    {canMoney && (
                      <div className="shrink-0 text-right">
                        <p className="tabular m-0 text-[20px] font-medium leading-[24px] tracking-[-0.02em]" style={{ color: w.balanceMinor > 0 ? "var(--color-state-pending)" : undefined }}>{rupees(w.balanceMinor)}</p>
                        <p className="m-0 text-[12px] leading-[16px] text-text-tertiary">owed</p>
                      </div>
                    )}
                  </div>

                  <ul className="m-0 mt-4 flex list-none flex-wrap gap-1.5 p-0">
                    {w.workTypes.length === 0 ? (
                      <li className="list-none text-[13px] text-text-tertiary">No rate set yet</li>
                    ) : (
                      w.workTypes.map((t) => (
                        <li key={t.stageId} className="list-none rounded-full bg-[var(--color-control)] px-2.5 py-1 text-[13px] leading-[18px] text-text" title={BASIS_LABEL[t.wageBasis]}>
                          {t.label} <span className="tabular font-semibold">{rupees(t.rateMinor)}</span>
                          <span className="text-text-secondary"> on {t.wageBasis === "good" ? "good" : t.wageBasis === "issued" ? "issued" : "returned"}</span>
                        </li>
                      ))
                    )}
                  </ul>

                  <dl className="m-0 mt-4 grid grid-cols-3 gap-3 border-t border-[var(--color-line)] pt-3.5">
                    <div>
                      <dt className="text-[12px] leading-[16px] text-text-tertiary">Holding</dt>
                      <dd className="tabular m-0 text-[15px] font-semibold leading-[20px] text-text">{w.piecesHeld} pcs</dd>
                    </div>
                    {canMoney && (
                      <>
                        <div>
                          <dt className="text-[12px] leading-[16px] text-text-tertiary">Wages earned</dt>
                          <dd className="tabular m-0 text-[15px] font-semibold leading-[20px] text-text">{rupees(w.wagesMinor)}</dd>
                        </div>
                        <div>
                          <dt className="text-[12px] leading-[16px] text-text-tertiary">Advance out</dt>
                          <dd className="tabular m-0 text-[15px] font-semibold leading-[20px] text-text">{rupees(w.advanceOutstandingMinor)}</dd>
                        </div>
                      </>
                    )}
                  </dl>
                </Surface>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, KarigarsPage);
