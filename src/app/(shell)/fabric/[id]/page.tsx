import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_LOT, ENTITY_PIECEWORK_ROLL, PIECEWORK_CAPABILITY, listLots, rollDetail } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { ButtonLink, DefinitionList, PageHeader, Panel, PermissionDenied, Row, RowList, Surface } from "@/components/ui/primitives";
import { ProgressBar } from "@/components/ui/viz";
import { rupees, shortDate } from "../../lots/format";
import { qty } from "../format";
import { CancelRoll, MoveFabric } from "./RollActions";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { issue: "Sent to", return: "Back from", adjust: "Corrected" };

/** One roll: how much is left, where the rest went (every movement with a running balance), and its label. */
async function RollPage({ params }: { params: Promise<{ id: string }> }) {
  installCapabilities();
  const { id } = await params;
  const actor = await requireActor();
  const { canRead, canMove, canCancel, canLots } = await withTenant(actor.tenantId, async (tx) => ({
    canRead: await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_ROLL),
    canMove: await hasTenantPermission(tx, actor.roleId, "Create", "verity.piecework.roll_move"),
    canCancel: await hasTenantPermission(tx, actor.roleId, "ActionExecute", ENTITY_PIECEWORK_ROLL),
    canLots: await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_LOT),
  }));
  if (!canRead) return <PermissionDenied what="this roll" />;
  const d = await executeQuery(actor, rollDetail, { rollId: id });
  if (!d) notFound();
  const lots = canLots && canMove ? (await executeQuery(actor, listLots, {})).filter((l) => l.status === "draft" || l.status === "active" || l.status === "hold") : [];
  const r = d.roll;

  return (
    <>
      <PageHeader
        back={{ href: "/fabric", label: "Fabric" }}
        title={`${r.number} · ${r.fabricType}`}
        description={r.cancelled ? "Cancelled. The number is not reused." : undefined}
        actions={r.cancelled ? null : (
          <>
            {canMove && <MoveFabric rollId={r.id} unit={r.unit} balanceCenti={r.balanceCenti} lots={lots.map((l) => ({ id: l.id, label: `${l.number} · ${l.name ?? l.design}` }))} />}
            <ButtonLink href={`/fabric/labels?ids=${r.id}`} variant="secondary">Print label</ButtonLink>
            {canCancel && d.moves.length === 0 && <CancelRoll rollId={r.id} number={r.number} />}
          </>
        )}
      />

      <Surface className="mb-6 p-5">
        <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr] lg:gap-10">
          <div className="min-w-0">
            <p className="figure m-0 text-[44px] text-text">{qty(r.balanceCenti, r.unit)}</p>
            <p className="m-0 mb-4 text-[14px] text-text-secondary">left of {qty(r.receivedCenti, r.unit)} received</p>
            <ProgressBar label={`${r.number} fabric left`} value={r.balanceCenti} total={Math.max(r.receivedCenti, 1)} tone={r.balanceCenti <= 0 ? "draft" : "active"} showFigures={false} />
          </div>
          <DefinitionList items={[
            { term: "Received", value: shortDate(r.receivedOn) },
            ...(r.supplier ? [{ term: "Supplier", value: r.supplier }] : []),
            ...(r.invoiceNumber ? [{ term: "Invoice", value: r.invoiceNumber }] : []),
            ...(r.rateMinor !== null ? [{ term: "Rate", value: `${rupees(r.rateMinor)} per ${r.unit}` }] : []),
            { term: "Used in", value: r.lotCount === 0 ? "No lot yet" : `${r.lotCount} lot${r.lotCount === 1 ? "" : "s"}` },
          ]} />
        </div>
      </Surface>

      <Panel title="Every movement" flush>
        {d.moves.length === 0 ? (
          <p className="m-0 px-5 pb-5 text-[14px] text-text-secondary">Nothing has left this roll. Cut a lot with it, or use Move fabric.</p>
        ) : (
          <RowList>
            {d.moves.map((m) => (
              <Row key={m.id}>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[15px] font-medium text-text">
                    {KIND_LABEL[m.kind] ?? m.kind}{" "}
                    {m.lotId ? <Link href={`/lots/${m.lotId}`} className="text-text hover:underline">{m.lotNumber}{m.lotName ? ` · ${m.lotName}` : ""}</Link> : null}
                  </span>
                  <span className="text-[13px] text-text-secondary">{shortDate(m.movedOn)}{m.reason ? ` · ${m.reason}` : ""}</span>
                </div>
                <span className="text-right">
                  <span className={`block text-[15px] font-medium ${m.deltaCenti < 0 ? "text-text" : "text-[var(--color-state-completed-ink)]"}`}>{m.deltaCenti > 0 ? "+" : ""}{qty(m.deltaCenti, r.unit)}</span>
                  <span className="block text-[12px] text-text-tertiary">{qty(m.runningCenti, r.unit)} left</span>
                </span>
              </Row>
            ))}
          </RowList>
        )}
      </Panel>
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, RollPage);
