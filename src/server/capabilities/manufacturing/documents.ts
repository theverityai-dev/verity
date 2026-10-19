import type { TenantScopedClient } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { ENTITY_EVIDENCE } from "@/server/capabilities/evidence";
import {
  ENTITY_MANUFACTURING_DISPATCH,
  ENTITY_MANUFACTURING_OPERATION,
  ENTITY_MANUFACTURING_ORDER,
  ENTITY_MANUFACTURING_PASSPORT,
} from "./shared";
import { latestFindings, readCheckpoints, readReadingPayload, withinMeasure } from "./stages";

/**
 * What the printed documents for one production order are built from: the job card and traveler, and the dispatch
 * pack. Each function answers with plain records and decides, per grant, what the reader may see:
 *
 *  - without Read on the order (or, for the pack, on dispatch) the answer is "denied";
 *  - stages and their checks are their own entity, so without that grant the document prints without them;
 *  - a recorded reading is Evidence, so without that grant the pack shows the verdict but not the reading.
 *
 * An order that belongs to another tenant is simply not there (RLS), so it answers null like any missing id.
 * Presentation (dates, layout, the QR code) and the job and customer link live in the pages, which compose this
 * with the project capability: manufacturing does not read project tables.
 */

type Reader = { roleId: string | null };

export type DocumentMaterial = { id: string; item: string; qty: number; unit: string };

export type TravelerRecord = {
  tenant: { name: string; timeZone: string; demo: boolean };
  order: { id: string; reference: string | null; state: string; product: string; quantity: number; location: string; bom: string | null };
  materials: DocumentMaterial[];
  /** Null when the reader may not see stages. Cancelled stages (history of a send-back) are left out. */
  stages: Array<{
    id: string;
    label: string;
    rework: boolean;
    state: string;
    startedAt: Date | null;
    completedAt: Date | null;
    checks: Array<{ key: string; label: string; needsEvidence: boolean; verdict: "pass" | "fail" | null }>;
  }> | null;
};

async function tenantFacts(tx: TenantScopedClient, tenantId: string) {
  const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true, timeZone: true, customFields: true } });
  return {
    name: tenant?.name ?? "",
    timeZone: tenant?.timeZone ?? "Asia/Kolkata",
    demo: (tenant?.customFields as { demo?: boolean } | null)?.demo === true,
  };
}

export async function loadTraveler(
  tx: TenantScopedClient,
  actor: Reader & { tenantId: string },
  orderId: string,
): Promise<TravelerRecord | "denied" | null> {
  if (!(await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_MANUFACTURING_ORDER))) return "denied";
  const order = await tx.manufacturingOrder.findUnique({
    where: { id: orderId },
    include: { outputItem: true, location: true, bom: true, lines: { include: { componentItem: true } } },
  });
  if (!order) return null;

  let stages: TravelerRecord["stages"] = null;
  if (await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_MANUFACTURING_OPERATION)) {
    const ops = await tx.manufacturingOperation.findMany({ where: { orderId: order.id, state: { not: "cancelled" } }, orderBy: { sequence: "asc" } });
    const results = await tx.manufacturingCheckpointResult.findMany({ where: { operationId: { in: ops.map((o) => o.id) } } });
    stages = ops.map((o) => {
      const latest = latestFindings(results.filter((r) => r.operationId === o.id));
      return {
        id: o.id,
        label: o.label,
        rework: o.reworkOfId !== null,
        state: o.state,
        startedAt: o.startedAt,
        completedAt: o.completedAt,
        checks: readCheckpoints(o.checkpoints).map((c) => ({
          key: c.key,
          label: c.label,
          needsEvidence: c.requireEvidence,
          verdict: (latest.get(c.key)?.result as "pass" | "fail" | undefined) ?? null,
        })),
      };
    });
  }

  return {
    tenant: await tenantFacts(tx, actor.tenantId),
    order: {
      id: order.id,
      reference: order.reference,
      state: order.state,
      product: order.outputItem.name,
      quantity: order.outputQty,
      location: order.location.name,
      bom: order.bom?.code ?? null,
    },
    materials: order.lines.map((l) => ({ id: l.id, item: l.componentItem.name, qty: l.qtyRequired, unit: l.componentItem.unitLabel })),
    stages,
  };
}

export type DispatchPackRecord = {
  tenant: { name: string; timeZone: string; demo: boolean };
  order: { id: string; reference: string | null; product: string; quantity: number };
  sent: { recordedAt: Date; transporter: string | null; vehicleNo: string | null; trackingRef: string | null; note: string | null; photoOnRecord: boolean };
  deliveredAt: Date | null;
  materials: DocumentMaterial[];
  /** Null when the reader may not see stages. A reading is null when the reader may not see Evidence. */
  checks: Array<{ id: string; stage: string; label: string; verdict: "pass" | "fail"; recordedAt: Date; remarks: string | null; reading: string | null }> | null;
  /** The published passport, if any. Its link is shown once at publishing and only a hash is kept, so no QR can be rebuilt here. */
  passport: { issuedAt: Date; reference: string | null } | null;
};

/** A reading evidence row keeps its instrument and value in a small payload; show them only as text. */
export function readingText(payload: unknown): string | null {
  const structured = readReadingPayload(payload);
  if (structured) {
    return [`${structured.value.toLocaleString("en-IN")} ${structured.unit}`, structured.condition ? `, ${structured.condition}` : "", structured.instrument ? ` (${structured.instrument})` : ""].join("");
  }
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { instrument?: unknown; reading?: unknown };
  const parts = [typeof p.reading === "string" ? p.reading : null, typeof p.instrument === "string" ? `(${p.instrument})` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

export async function loadDispatchPack(
  tx: TenantScopedClient,
  actor: Reader & { tenantId: string },
  orderId: string,
): Promise<DispatchPackRecord | "denied" | "undispatched" | null> {
  if (
    !(await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_MANUFACTURING_ORDER)) ||
    !(await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_MANUFACTURING_DISPATCH))
  ) {
    return "denied";
  }
  const order = await tx.manufacturingOrder.findUnique({ where: { id: orderId }, include: { outputItem: true, lines: { include: { componentItem: true } } } });
  if (!order) return null;

  const events = await tx.manufacturingDispatch.findMany({ where: { orderId: order.id }, orderBy: { recordedAt: "asc" } });
  const sent = events.find((e) => e.status === "dispatched");
  if (!sent) return "undispatched";
  const delivered = events.find((e) => e.status === "delivered");

  let checks: DispatchPackRecord["checks"] = null;
  if (await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_MANUFACTURING_OPERATION)) {
    const canReadEvidence = await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_EVIDENCE);
    const ops = await tx.manufacturingOperation.findMany({ where: { orderId: order.id, state: { not: "cancelled" } }, orderBy: { sequence: "asc" } });
    const results = await tx.manufacturingCheckpointResult.findMany({ where: { operationId: { in: ops.map((o) => o.id) } } });
    const evidenceIds = results.map((r) => r.evidenceId).filter((v): v is string => v !== null);
    const evidence = canReadEvidence && evidenceIds.length > 0 ? await tx.evidence.findMany({ where: { id: { in: evidenceIds } } }) : [];
    checks = [];
    for (const op of ops) {
      const latest = latestFindings(results.filter((r) => r.operationId === op.id));
      for (const c of readCheckpoints(op.checkpoints)) {
        const f = latest.get(c.key);
        if (!f) continue;
        const ev = f.evidenceId ? evidence.find((e) => e.id === f.evidenceId) : undefined;
        checks.push({
          id: `${op.id}:${c.key}`,
          stage: op.label,
          label: c.label,
          verdict: f.result === "pass" ? "pass" : "fail",
          recordedAt: f.recordedAt,
          remarks: f.remarks,
          reading: ev ? readingText(ev.payload) : null,
        });
      }
    }
  }

  let passport: DispatchPackRecord["passport"] = null;
  if (await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_MANUFACTURING_PASSPORT)) {
    const active = await tx.manufacturingPassport.findFirst({ where: { orderId: order.id, revokedAt: null }, orderBy: { issuedAt: "desc" } });
    if (active) {
      const snapshot = active.snapshot as { reference?: unknown } | null;
      passport = { issuedAt: active.issuedAt, reference: typeof snapshot?.reference === "string" ? snapshot.reference : null };
    }
  }

  return {
    tenant: await tenantFacts(tx, actor.tenantId),
    order: { id: order.id, reference: order.reference, product: order.outputItem.name, quantity: order.outputQty },
    sent: {
      recordedAt: sent.recordedAt,
      transporter: sent.transporter,
      vehicleNo: sent.vehicleNo,
      trackingRef: sent.trackingRef,
      note: sent.note,
      photoOnRecord: sent.packagingEvidenceId !== null,
    },
    deliveredAt: delivered?.recordedAt ?? null,
    materials: order.lines.map((l) => ({ id: l.id, item: l.componentItem.name, qty: l.qtyRequired, unit: l.componentItem.unitLabel })),
    checks,
    passport,
  };
}

export type TestReportCheck = {
  key: string;
  label: string;
  /** The latest finding is the verdict; null when the check has not been recorded yet. */
  verdict: "pass" | "fail" | null;
  /** How many times this check was recorded, so a re-inspection after a fail is visible. */
  attempts: number;
  recordedAt: Date | null;
  remarks: string | null;
  /** Null when the reader may not see Evidence, or the check is not a measured one. */
  measured: { value: number; unit: string; min: number | null; max: number | null; inRange: boolean; condition: string | null; instrument: string | null } | null;
  /** The check is measured: the unit and range are on the checklist even when the reading is hidden. */
  unit: string | null;
  /** Free-text reading from before readings were structured. */
  readingNote: string | null;
  photoOnRecord: boolean;
};

export type TestReportRecord = {
  tenant: { name: string; timeZone: string; demo: boolean };
  order: { id: string; reference: string | null; product: string; quantity: number; state: string };
  /** Cancelled stages (history of a send-back) are left out. */
  stages: Array<{ id: string; label: string; state: string; rework: boolean; checks: TestReportCheck[] }>;
};

/**
 * The test report for one order, built to be read summary first: the totals and every failure answer "did it pass"
 * without opening a stage, and each check carries its reading, accepted range and test condition for the reader who
 * does need detail. Needs Read on the order and on stages; a reading is shown only to a reader who may see Evidence.
 */
export async function loadTestReport(
  tx: TenantScopedClient,
  actor: Reader & { tenantId: string },
  orderId: string,
): Promise<TestReportRecord | "denied" | null> {
  if (
    !(await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_MANUFACTURING_ORDER)) ||
    !(await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_MANUFACTURING_OPERATION))
  ) {
    return "denied";
  }
  const order = await tx.manufacturingOrder.findUnique({ where: { id: orderId }, include: { outputItem: true } });
  if (!order) return null;

  const canReadEvidence = await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_EVIDENCE);
  const ops = await tx.manufacturingOperation.findMany({ where: { orderId: order.id, state: { not: "cancelled" } }, orderBy: { sequence: "asc" } });
  const results = await tx.manufacturingCheckpointResult.findMany({ where: { operationId: { in: ops.map((o) => o.id) } } });
  const evidenceIds = results.map((r) => r.evidenceId).filter((v): v is string => v !== null);
  const evidence = canReadEvidence && evidenceIds.length > 0 ? await tx.evidence.findMany({ where: { id: { in: evidenceIds } } }) : [];

  const stages = ops
    .map((op) => {
      const opResults = results.filter((r) => r.operationId === op.id);
      const latest = latestFindings(opResults);
      const checks: TestReportCheck[] = readCheckpoints(op.checkpoints).map((c) => {
        const f = latest.get(c.key);
        const ev = f?.evidenceId ? evidence.find((e) => e.id === f.evidenceId) : undefined;
        const reading = ev ? readReadingPayload(ev.payload) : null;
        return {
          key: c.key,
          label: c.label,
          verdict: f ? (f.result === "pass" ? "pass" : "fail") : null,
          attempts: opResults.filter((r) => r.checkpointKey === c.key).length,
          recordedAt: f?.recordedAt ?? null,
          remarks: f?.remarks ?? null,
          measured:
            reading && c.measure
              ? {
                  value: reading.value,
                  unit: reading.unit,
                  min: c.measure.min ?? null,
                  max: c.measure.max ?? null,
                  inRange: withinMeasure(c.measure, reading.value),
                  condition: reading.condition ?? null,
                  instrument: reading.instrument ?? null,
                }
              : null,
          unit: c.measure?.unit ?? null,
          readingNote: ev && !reading ? readingText(ev.payload) : null,
          photoOnRecord: f?.evidenceId !== null && f?.evidenceId !== undefined,
        };
      });
      return { id: op.id, label: op.label, state: op.state, rework: op.reworkOfId !== null, checks };
    })
    .filter((s) => s.checks.length > 0);

  return {
    tenant: await tenantFacts(tx, actor.tenantId),
    order: { id: order.id, reference: order.reference, product: order.outputItem.name, quantity: order.outputQty, state: order.state },
    stages,
  };
}
