/* eslint-disable no-restricted-syntax -- structural exception: a colour-by-size stock matrix with row headers, per-cell links and a totals row, which DataTable's one-value-per-column model cannot express. Overflow is handled by the wrapper below. */
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import {
  ENTITY_INVENTORY_TEMPLATE,
  INVENTORY_CAPABILITY,
  listAttributes,
  templateDetail,
  type TemplateDetail,
} from "@/server/capabilities/inventory";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { DefinitionList, PageHeader, Panel, PermissionDenied, Stat, StatRow, StateBadge } from "@/components/ui/primitives";
import { gstLabel } from "../gst";
import { StyleActions } from "./StyleActions";

export const dynamic = "force-dynamic";

type AxisValue = TemplateDetail["axisValues"][number]["values"][number];

/** A colour dot drawn from the tenant's own swatch value; absent for sizes and plain lists. */
function Swatch({ hex }: { hex: string | null }) {
  if (!hex) return null;
  return (
    <span
      aria-hidden="true"
      className="inline-block size-3.5 shrink-0 rounded-full ring-1 ring-inset ring-[var(--color-line-strong)]"
      style={{ backgroundColor: hex }}
    />
  );
}

/**
 * Stock by combination: the first list runs down the side, the second across the top, and a third list (if the
 * style has one) gets a grid of its own. A combination that was never generated is drawn as a gap, not a zero:
 * "no variant" and "no stock" are different facts.
 */
function VariantMatrix({ detail, rowAxis, colAxis, sectionValue }: {
  detail: TemplateDetail;
  rowAxis: number;
  colAxis: number | null;
  sectionValue: { axis: number; value: AxisValue } | null;
}) {
  const rows = detail.axisValues[rowAxis]!.values;
  const cols = colAxis === null ? [null] : detail.axisValues[colAxis]!.values;
  const attr = (i: number) => detail.axes[i]!.attributeId;

  const find = (row: AxisValue, col: AxisValue | null) =>
    detail.variantRows.find(
      (v) =>
        v.values[attr(rowAxis)] === row.id &&
        (col === null || v.values[attr(colAxis!)] === col.id) &&
        (sectionValue === null || v.values[attr(sectionValue.axis)] === sectionValue.value.id),
    );

  const colTotal = (col: AxisValue | null) => rows.reduce((sum, r) => sum + (find(r, col)?.onHand ?? 0), 0);
  const rowTotal = (row: AxisValue) => cols.reduce((sum, c) => sum + (find(row, c)?.onHand ?? 0), 0);
  const grand = rows.reduce((sum, r) => sum + rowTotal(r), 0);

  const rowLabel = detail.axes[rowAxis]!.label;
  const colLabel = colAxis === null ? "On hand" : detail.axes[colAxis]!.label;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[14px]">
        <caption className="sr-only">
          Stock on hand by {rowLabel.toLowerCase()}
          {colAxis !== null ? ` and ${colLabel.toLowerCase()}` : ""}
          {sectionValue ? `, ${sectionValue.value.label}` : ""}
        </caption>
        <thead>
          <tr className="text-left text-[12px] text-text-tertiary">
            <th scope="col" className="px-3 py-2 font-medium">{rowLabel}</th>
            {cols.map((c) => (
              <th key={c?.id ?? "on-hand"} scope="col" className="px-3 py-2 text-right font-medium">
                {c ? c.label : "On hand"}
              </th>
            ))}
            {colAxis !== null && <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-[var(--color-line)]">
              <th scope="row" className={`px-3 py-2.5 text-left font-medium ${row.active ? "text-text" : "text-text-tertiary"}`}>
                <span className="inline-flex items-center gap-2">
                  <Swatch hex={row.swatchHex} />
                  {row.label}
                  {!row.active && <span className="text-[12px] font-normal">Retired</span>}
                </span>
              </th>
              {cols.map((col) => {
                const variant = find(row, col);
                return (
                  <td key={col?.id ?? "on-hand"} className="px-3 py-2.5 text-right tabular-nums">
                    {variant ? (
                      <Link
                        href={`/inventory/${variant.id}`}
                        className={`inline-block min-w-8 rounded-md px-1.5 py-0.5 no-underline hover:bg-[var(--color-control)] ${
                          !variant.active ? "text-text-tertiary" : variant.onHand === 0 ? "text-text-secondary" : "font-medium text-text"
                        }`}
                        title={`${variant.sku}${variant.active ? "" : " (retired)"}`}
                      >
                        {variant.onHand}
                      </Link>
                    ) : (
                      <span className="text-text-tertiary" title="No variant generated for this combination">—</span>
                    )}
                  </td>
                );
              })}
              {colAxis !== null && <td className="px-3 py-2.5 text-right font-medium tabular-nums">{rowTotal(row)}</td>}
            </tr>
          ))}
        </tbody>
        {colAxis !== null && (
          <tfoot>
            <tr className="border-t border-[var(--color-line-strong)]">
              <th scope="row" className="px-3 py-2.5 text-left font-medium">Total</th>
              {cols.map((c) => (
                <td key={c!.id} className="px-3 py-2.5 text-right font-medium tabular-nums">{colTotal(c)}</td>
              ))}
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{grand}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

async function StyleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  installCapabilities();
  const { id } = await params;
  const actor = await requireActor();

  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Read", ENTITY_INVENTORY_TEMPLATE));
  if (!allowed) return <PermissionDenied what="viewing this style" />;

  const [detail, lists] = await Promise.all([
    executeQuery(actor, templateDetail, { templateId: id }),
    executeQuery(actor, listAttributes, {}),
  ]);
  if (!detail) notFound();

  const onHand = detail.variantRows.reduce((sum, v) => sum + v.onHand, 0);

  // Live values the style does not offer yet, per list it varies by: what "Offer in more" can add.
  const offerable = detail.axes.flatMap((axis, i) => {
    const offered = new Set(detail.axisValues[i]!.values.map((v) => v.id));
    const list = lists.find((l) => l.id === axis.attributeId);
    const values = (list?.values ?? []).filter((v) => v.active && !offered.has(v.id));
    return values.length > 0 ? [{ attributeId: axis.attributeId, label: axis.label, values: values.map((v) => ({ id: v.id, label: v.label, code: v.code })) }] : [];
  });

  const sections =
    detail.axes.length >= 3 ? detail.axisValues[2]!.values.map((value) => ({ axis: 2, value })) : [null];

  return (
    <>
      <PageHeader
        title={`${detail.code} · ${detail.name}`}
        description={[detail.season, detail.groupName, `HSN ${detail.hsnCode ?? "not set"}`, `GST ${gstLabel(detail.taxRateBp)}`, detail.unitLabel]
          .filter(Boolean)
          .join(" · ")}
        actions={<StyleActions templateId={detail.id} active={detail.active} missing={detail.missing} offerable={offerable} />}
      />

      <StatRow cols={4} className="mb-6">
        <div className="flex flex-col px-5 py-4">
          <span className="flex h-[26px] items-center text-[15px]">
            <StateBadge category={detail.active ? "Active" : "Cancelled"} label={detail.active ? "active" : "archived"} />
          </span>
          <span className="mt-2 text-[12px] leading-[1.3] text-text-tertiary">State</span>
        </div>
        <Stat label="Variants" value={detail.variants} hint={`${detail.combinations} possible now`} />
        <Stat label="To generate" value={detail.missing} hint={detail.missing === 0 ? "Every combination exists" : "Offered, no variant yet"} />
        <Stat label="On hand" value={onHand} hint={detail.unitLabel} />
      </StatRow>

      <div className="grid items-start gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-6">
          {detail.variants === 0 ? (
            <Panel title="Stock by combination">
              <p className="m-0 text-[14px] text-text-secondary">
                Nothing generated yet. This style is offered in {detail.combinations} combination{detail.combinations === 1 ? "" : "s"};
                generate them to start receiving and producing stock against each one.
              </p>
            </Panel>
          ) : (
            sections.map((section) => (
              <Panel
                key={section?.value.id ?? "all"}
                title={section ? `Stock by combination · ${section.value.label}` : "Stock by combination"}
                flush
              >
                <VariantMatrix
                  detail={detail}
                  rowAxis={0}
                  colAxis={detail.axes.length >= 2 ? 1 : null}
                  sectionValue={section}
                />
              </Panel>
            ))
          )}
        </div>

        <Panel title="Offered in">
          <DefinitionList
            items={detail.axes.map((axis, i) => ({
              term: axis.label,
              value: (
                <span className="flex flex-wrap gap-x-3 gap-y-1">
                  {detail.axisValues[i]!.values.map((v) => (
                    <span key={v.id} className={`inline-flex items-center gap-1.5 ${v.active ? "" : "text-text-tertiary"}`}>
                      <Swatch hex={v.swatchHex} />
                      {v.label}
                    </span>
                  ))}
                </span>
              ),
            }))}
          />
        </Panel>
      </div>
    </>
  );
}

export default withCapabilityPageAccess(INVENTORY_CAPABILITY, StyleDetailPage);
