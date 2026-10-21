import Link from "next/link";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_LOT, PIECEWORK_CAPABILITY, listLots, listStages } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { CommandAccess } from "@/components/ui/CommandAccess";
import { PieceBar, StagePips } from "@/components/ui/PieceFlow";
import { ButtonLink, EmptyState, FilterChipRow, PageHeader, PermissionDenied, StateBadge, Surface } from "@/components/ui/primitives";
import { DefineStageForm, NewLotForm } from "./LotForms";
import { STATUS_CATEGORY, STATUS_LABEL, shortDate } from "./format";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "open", label: "In work", match: (s: string) => s === "active" || s === "hold" },
  { key: "draft", label: "Draft", match: (s: string) => s === "draft" },
  { key: "done", label: "Completed", match: (s: string) => s === "completed" || s === "closed" },
  { key: "all", label: "All", match: (s: string) => s !== "cancelled" },
] as const;

async function LotsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  installCapabilities();
  const actor = await requireActor();
  const { show } = await searchParams;

  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_LOT));
  if (!allowed) return <PermissionDenied what="reading lots" />;

  const [lots, stages] = await Promise.all([executeQuery(actor, listLots, {}), executeQuery(actor, listStages, {})]);

  if (stages.length === 0) {
    return (
      <>
        <PageHeader title="Lots" description="A lot is cut into numbered bundles, and each bundle moves through the stages." />
        <EmptyState
          title="Set up the stages first"
          description="Add the stages a bundle goes through, in order, for example Pasting, Collar & Cuff, Stitching, Button / Kaj, Finishing."
          action={<DefineStageForm next={1} />}
        />
      </>
    );
  }

  const active = FILTERS.find((f) => f.key === show) ?? FILTERS[0];
  const shown = lots.filter((l) => active.match(l.status));
  const late = lots.filter((l) => l.overdue).length;
  const labels = stages.map((s) => s.label);

  return (
    <>
      <PageHeader
        title="Lots"
        description={`${labels.join(" › ")} › Ready. Every lot has a number; every bundle cut from it has its own slip and its own record.`}
        actions={
          <>
            <CommandAccess commands="verity.piecework.record_issue">
              <ButtonLink href="/lots/entry" variant="secondary">Daily entry</ButtonLink>
            </CommandAccess>
            <NewLotForm />
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <FilterChipRow
          chips={FILTERS.map((f) => ({
            label: f.label,
            count: lots.filter((l) => f.match(l.status)).length,
            active: f.key === active.key,
            href: f.key === "open" ? "/lots" : `/lots?show=${f.key}`,
          }))}
        />
        {late > 0 && (
          <span className="text-[14px] font-medium" style={{ color: "var(--color-state-blocked)" }}>
            {late} lot{late === 1 ? " is" : "s are"} past the due date
          </span>
        )}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title={active.key === "open" ? "No lot is in work" : "Nothing here"}
          description={active.key === "open" ? "Create a lot, start it, then cut its bundles." : "No lot matches this view."}
        />
      ) : (
        <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-2 2xl:grid-cols-3">
          {shown.map((l) => {
            const finished = l.status === "completed" || l.status === "closed";
            return (
              <li key={l.id} className="list-none">
                <Link href={`/lots/${l.id}`} className="block no-underline transition-transform duration-150 hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]">
                  <Surface className="h-full p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="m-0 text-[13px] font-semibold leading-[18px] tracking-[0.02em] text-text-secondary">{l.number}</p>
                        <h2 className="m-0 mt-0.5 truncate text-[19px] font-semibold leading-[24px] tracking-[-0.02em] text-text">{l.name ?? l.design}</h2>
                        <p className="m-0 truncate text-[14px] leading-[20px] text-text-secondary">{[l.name ? l.design : null, l.fabricType].filter(Boolean).join(" · ") || " "}</p>
                      </div>
                      <StateBadge category={STATUS_CATEGORY[l.status]!} label={STATUS_LABEL[l.status]} />
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-3">
                      <StagePips stages={labels} at={finished ? "Ready" : l.bundles === 0 ? null : l.stageLabel} />
                      <span className="truncate text-[13px] text-text-secondary">{l.bundles === 0 ? "Not started" : `${l.stageLabel ?? "—"}`}</span>
                    </div>

                    <div className="mt-4">
                      {l.bundledPieces > 0 ? (
                        <PieceBar
                          label={`${l.number} pieces`}
                          total={l.bundledPieces}
                          size="md"
                          legend={false}
                          counts={{ ready: l.readyPieces, out: l.pendingPieces, rework: l.reworkPieces, rejected: l.rejectedPieces, short: l.shortPieces }}
                        />
                      ) : (
                        <div aria-hidden="true" className="h-2.5 w-full rounded-full bg-[var(--color-control-strong)]" />
                      )}
                    </div>

                    <dl className="m-0 mt-4 grid grid-cols-3 gap-3">
                      <div>
                        <dt className="text-[12px] leading-[16px] text-text-tertiary">Good ready</dt>
                        <dd className="tabular m-0 text-[17px] font-semibold leading-[22px] text-text">{l.readyPieces}</dd>
                      </div>
                      <div>
                        <dt className="text-[12px] leading-[16px] text-text-tertiary">Cut of planned</dt>
                        <dd className="tabular m-0 text-[17px] font-semibold leading-[22px] text-text">{l.bundledPieces}<span className="text-[13px] font-normal text-text-secondary"> / {l.plannedPieces}</span></dd>
                      </div>
                      <div>
                        <dt className="text-[12px] leading-[16px] text-text-tertiary">Due</dt>
                        <dd className="m-0 text-[17px] font-semibold leading-[22px]" style={{ color: l.overdue ? "var(--color-state-blocked)" : undefined }}>{l.dueDate ? shortDate(l.dueDate) : "—"}</dd>
                      </div>
                    </dl>

                    <p className="m-0 mt-3.5 truncate border-t border-[var(--color-line)] pt-3 text-[13px] leading-[18px] text-text-secondary">
                      {l.bundles === 0 ? "No bundle cut yet" : `${l.bundles} bundle${l.bundles === 1 ? "" : "s"} · ${l.location}`}
                      {l.rejectedPieces + l.reworkPieces + l.shortPieces > 0 && ` · ${l.rejectedPieces} rej, ${l.reworkPieces} rework, ${l.shortPieces} short`}
                    </p>
                  </Surface>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, LotsPage);
