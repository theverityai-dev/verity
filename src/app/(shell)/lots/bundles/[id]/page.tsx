import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_BUNDLE, PIECEWORK_CAPABILITY, bundleDetail } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { Icon } from "@/components/ui/icons";
import { PieceBar, countsOf } from "@/components/ui/PieceFlow";
import { ButtonLink, DefinitionList, PageHeader, PermissionDenied, Surface } from "@/components/ui/primitives";
import { shortDate } from "../../format";

export const dynamic = "force-dynamic";

type StageState = "done" | "active" | "waiting";

const STATE_WORD: Record<StageState, string> = { done: "Done", active: "In progress", waiting: "Not reached" };

async function BundlePage({ params }: { params: Promise<{ id: string }> }) {
  installCapabilities();
  const { id } = await params;
  const actor = await requireActor();

  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_BUNDLE));
  if (!allowed) return <PermissionDenied what="viewing this bundle" />;

  const b = await executeQuery(actor, bundleDetail, { bundleId: id });
  if (!b) notFound();

  const stateOf = (s: (typeof b.stages)[number]): StageState => (s.intake === 0 ? "waiting" : s.pending > 0 || s.reworkPool > 0 || s.toIssue > 0 ? "active" : "done");
  const facts = [
    { term: "Lot", value: <Link href={`/lots/${b.lotId}`} className="text-accent-ink no-underline hover:underline">{b.lotNumber} · {b.lotName ?? b.lotDesign}</Link> },
    { term: "Now", value: b.stageLabel ? `${b.stageLabel} · ${b.location}` : b.location },
    { term: "Cut", value: shortDate(b.cutOn) },
    ...(b.sizeNote ? [{ term: "Size mix", value: b.sizeNote }] : []),
    ...(b.daysHere !== null ? [{ term: "Here for", value: `${b.daysHere} day${b.daysHere === 1 ? "" : "s"}` }] : []),
  ];

  return (
    <>
      <PageHeader
        back={{ href: `/lots/${b.lotId}`, label: b.lotNumber }}
        title={`${b.number} · ${b.netPieces} pieces`}
        description={b.overdue ? "An issue of this bundle is past its return date." : undefined}
        actions={<ButtonLink href={`/lots/bundles/${b.id}/slip`} variant="primary">Print the slip</ButtonLink>}
      />

      <Surface className="mb-6 p-5">
        <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr] lg:gap-10">
          <div className="min-w-0">
            <h2 className="m-0 mb-4 text-[17px] font-semibold leading-[22px] tracking-[-0.02em]">Where the {b.netPieces} pieces are</h2>
            <PieceBar size="lg" label={`${b.number} pieces`} total={b.netPieces} counts={countsOf(b)} />
            <p className="m-0 mt-4 text-[13px] leading-[18px] text-text-tertiary">Good, rejected, rework and short are kept apart. Rework is not good until it is redone and accepted.</p>
          </div>
          <DefinitionList items={facts} />
        </div>
      </Surface>

      <h2 className="m-0 mb-3 px-1 text-[17px] font-semibold leading-[22px] tracking-[-0.02em]">Journey through the stages</h2>
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {b.stages.map((s, n) => {
          const state = stateOf(s);
          return (
            <li key={s.stageId} className="list-none">
              <Surface className="p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span
                    aria-hidden="true"
                    className="tabular grid size-8 shrink-0 place-items-center rounded-full text-[14px] font-bold"
                    style={state === "done" ? { backgroundColor: "var(--color-state-completed)", color: "#fff" } : state === "active" ? { backgroundColor: "var(--color-state-active)", color: "#fff" } : { backgroundColor: "var(--color-control-strong)", color: "var(--color-text-secondary)" }}
                  >
                    {state === "done" ? <Icon name="check" size={16} /> : n + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="m-0 text-[17px] font-semibold leading-[22px] tracking-[-0.01em] text-text">{s.label}</h3>
                    <p className="m-0 text-[13px] leading-[18px] text-text-secondary">
                      {STATE_WORD[state]}
                      {s.days !== null && state === "active" ? ` · ${s.days} day${s.days === 1 ? "" : "s"} here` : ""}
                    </p>
                  </div>
                  {state !== "waiting" && (
                    <p className="tabular m-0 text-[13px] text-text-secondary">
                      Reached <b className="font-semibold text-text">{s.intake}</b> · Good <b className="font-semibold text-text">{s.good}</b>
                      {s.pending > 0 && <> · Out <b className="font-semibold text-text">{s.pending}</b></>}
                    </p>
                  )}
                </div>

                {(s.issues.length > 0 || s.toIssue > 0 || s.reworkPool > 0) && (
                  <ul className="m-0 mt-4 flex list-none flex-col gap-2 p-0">
                    {s.issues.map((i) => {
                      const late = i.open > 0 && i.dueDate !== null && i.dueDate < b.today;
                      return (
                        <li key={i.issueId} className="list-none rounded-[10px] bg-[var(--color-surface-sunken)] px-3.5 py-3">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                            <span className="text-[15px] font-semibold text-text">
                              <Link href={`/karigars/${i.workerId}`} className="text-accent-ink no-underline hover:underline">{i.workerName}</Link>
                              {i.isRework && <span className="ml-2 rounded-full bg-[var(--color-control)] px-2 py-0.5 text-[12px] font-semibold text-text-secondary">Rework</span>}
                            </span>
                            <span className="text-[13px] text-text-secondary">
                              {i.issued} given {shortDate(i.entryDate)}
                              {i.dueDate ? <>, due <span style={late ? { color: "var(--color-state-blocked)", fontWeight: 600 } : undefined}>{shortDate(i.dueDate)}{late ? " (late)" : ""}</span></> : ""}
                            </span>
                          </div>
                          <div className="mt-2.5">
                            <PieceBar
                              size="sm"
                              legend={false}
                              label={`${i.workerName}, ${i.issued} pieces`}
                              total={i.issued}
                              counts={{ ready: i.good, out: i.open, rework: i.rework, rejected: i.rejected, short: i.short }}
                            />
                          </div>
                          <p className="tabular m-0 mt-2 text-[13px] leading-[18px] text-text-secondary">
                            Good {i.good} · Rejected {i.rejected} · Rework {i.rework} · Short {i.short}
                            {i.open > 0 && <b className="font-semibold text-text"> · {i.open} still out</b>}
                          </p>
                        </li>
                      );
                    })}
                    {s.reworkPool > 0 && (
                      <li className="list-none rounded-[10px] px-3.5 py-2.5 text-[14px] text-text" style={{ backgroundColor: "color-mix(in srgb, var(--color-state-pending) 14%, transparent)" }}>
                        <b className="font-semibold">{s.reworkPool}</b> rework piece{s.reworkPool === 1 ? "" : "s"} waiting here to be given out again.
                      </li>
                    )}
                    {s.toIssue > 0 && s.issues.length === 0 && (
                      <li className="list-none rounded-[10px] bg-[var(--color-surface-sunken)] px-3.5 py-2.5 text-[14px] text-text-secondary">
                        <b className="font-semibold text-text">{s.toIssue}</b> pieces are waiting to be given to a karigar.
                      </li>
                    )}
                  </ul>
                )}
              </Surface>
            </li>
          );
        })}
      </ol>
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, BundlePage);
