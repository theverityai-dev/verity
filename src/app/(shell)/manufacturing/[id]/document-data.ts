import type { DispatchPackRecord, TestReportRecord } from "@/server/capabilities/manufacturing/documents";
import type { OrderJob } from "@/server/capabilities/project";
import { dateText } from "../../jobs/format";
import type { DispatchPackData } from "./dispatch-pack/DispatchPackDoc";
import type { TestReportDoc } from "./test-report/TestReportView";

/**
 * Turns loader records into the plain, serialisable documents the printable views draw. One conversion, used by the
 * dedicated pages and by the project file, so a sheet reads the same wherever it appears.
 */

export function printedOn(timeZone: string): string {
  return new Date().toLocaleString("en-IN", { timeZone, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function testReportDoc(record: TestReportRecord, job: OrderJob | null): TestReportDoc {
  return {
    business: record.tenant.name,
    demo: record.tenant.demo,
    reference: record.order.reference ?? `MO ${record.order.id.slice(0, 8)}`,
    product: record.order.product,
    quantity: record.order.quantity,
    job: job ? { reference: job.reference, title: job.title, customer: job.customer?.name ?? null } : null,
    stages: record.stages.map((s) => ({
      id: s.id,
      label: s.label,
      rework: s.rework,
      checks: s.checks.map((c) => ({
        key: c.key,
        label: c.label,
        verdict: c.verdict,
        attempts: c.attempts,
        on: c.recordedAt ? dateText(c.recordedAt) : null,
        remarks: c.remarks,
        unit: c.unit,
        measured: c.measured,
        readingNote: c.readingNote,
        photoOnRecord: c.photoOnRecord,
      })),
    })),
    printedOn: printedOn(record.tenant.timeZone),
    backHref: `/manufacturing/${record.order.id}`,
  };
}

export function dispatchPackDoc(record: DispatchPackRecord, job: OrderJob | null): DispatchPackData {
  return {
    business: record.tenant.name,
    demo: record.tenant.demo,
    reference: record.order.reference ?? `MO ${record.order.id.slice(0, 8)}`,
    product: record.order.product,
    quantity: record.order.quantity,
    job: job ? { reference: job.reference, title: job.title } : null,
    customer: job ? job.customer : null,
    dispatch: {
      dispatchedOn: dateText(record.sent.recordedAt),
      transporter: record.sent.transporter ?? "—",
      vehicleNo: record.sent.vehicleNo,
      trackingRef: record.sent.trackingRef,
      note: record.sent.note,
      photoOnRecord: record.sent.photoOnRecord,
    },
    delivered: record.deliveredAt ? dateText(record.deliveredAt) : null,
    materials: record.materials,
    checks:
      record.checks?.map((c) => ({
        id: c.id,
        stage: c.stage,
        label: c.label,
        verdict: c.verdict === "pass" ? "Passed" : "Failed",
        on: dateText(c.recordedAt),
        remarks: c.remarks,
        reading: c.reading,
      })) ?? null,
    passport: record.passport ? { issuedOn: dateText(record.passport.issuedAt), reference: record.passport.reference } : null,
    printedOn: printedOn(record.tenant.timeZone),
    backHref: `/manufacturing/${record.order.id}`,
  };
}
