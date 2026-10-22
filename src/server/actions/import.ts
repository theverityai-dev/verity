"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/platform/auth";
import { installCapabilities } from "@/server/capabilities/registry";
import { executeQuery } from "@/server/platform/query";
import { runCommandBatch, type BatchResult } from "@/server/platform/batch";
import {
  previewCustomerImport,
  previewSupplierImport,
  createCustomer,
  createSupplier,
} from "@/server/capabilities/trading";
import {
  previewProductImport,
  commitProductImport,
  type ProductImportRow,
} from "@/server/capabilities/plywood";
import { toActionFailure, type ActionResult } from "@/server/platform/action-error";

/**
 * Import server actions — Task 87.
 *
 * Same bridge discipline as `platform.ts`: the interface never touches
 * `executeCommand`/`executeQuery`/`runCommandBatch` directly, the actor is
 * always resolved server-side from the session, and every error crosses
 * the boundary as data rather than a thrown opaque digest.
 *
 * `kind` dispatches to the three concrete pairs registered in
 * `trading/import.ts` and `plywood/index.ts` — never a fourth, generic
 * "import anything" path (this capability's own non-goal).
 */

import type { ImportKind } from "@/lib/import-kinds";
// ImportKind lives in a plain module: a "use server" file may export only async functions.
export type { ImportKind };

export type ImportPreviewRow = { row: number; data: unknown };
export type ImportPreviewIssue = { row: number; raw: Record<string, string>; errors: string[] };
export type ImportPreviewSummary = { valid: ImportPreviewRow[]; invalid: ImportPreviewIssue[] };

/** Runs the "validate → preview" step: no writes, just what would happen. */
export async function runImportPreview(
  kind: ImportKind,
  rows: Record<string, string>[],
): Promise<ActionResult<ImportPreviewSummary>> {
  installCapabilities();
  try {
    const actor = await requireActor();
    const preview =
      kind === "customer"
        ? await executeQuery(actor, previewCustomerImport, { rows })
        : kind === "supplier"
          ? await executeQuery(actor, previewSupplierImport, { rows })
          : await executeQuery(actor, previewProductImport, { rows });
    return { ok: true, data: preview as ImportPreviewSummary };
  } catch (error) {
    return toActionFailure(error);
  }
}

export type ImportCommitRow = { row: number; ok: boolean; message: string };
export type ImportCommitSummary = {
  total: number;
  succeeded: number;
  failed: number;
  rows: ImportCommitRow[];
};

function summarize(batch: BatchResult<unknown>): ImportCommitSummary {
  return {
    total: batch.total,
    succeeded: batch.succeeded,
    failed: batch.failed,
    rows: batch.items.map((item) => ({
      row: item.index + 1,
      ok: item.outcome.status === "succeeded",
      message:
        item.outcome.status === "succeeded"
          ? "Created"
          : item.outcome.status === "needs_approval"
            ? item.outcome.reason
            : item.outcome.reason,
    })),
  };
}

/**
 * Runs the "commit → reconcile" step: `rows` must be EXACTLY the `data`
 * array `runImportPreview` returned as `valid` — the same no-drift
 * discipline `executeConfirmedPreview` (Task 81 rule 8) already applies to
 * a shown-then-run batch. Each row runs in its own transaction
 * (`runCommandBatch`); one bad row never fails the rest.
 */
export async function runImportCommit(
  kind: ImportKind,
  rows: unknown[],
): Promise<ActionResult<ImportCommitSummary>> {
  installCapabilities();
  try {
    const actor = await requireActor();

    if (kind === "customer") {
      const batch = await runCommandBatch(
        actor,
        createCustomer,
        rows as Parameters<typeof createCustomer.handler>[1][],
      );
      revalidatePath("/customers");
      return { ok: true, data: summarize(batch) };
    }

    if (kind === "supplier") {
      const batch = await runCommandBatch(
        actor,
        createSupplier,
        rows as Parameters<typeof createSupplier.handler>[1][],
      );
      revalidatePath("/suppliers");
      return { ok: true, data: summarize(batch) };
    }

    const result = await commitProductImport(actor, rows as ProductImportRow[]);
    revalidatePath("/catalogue");
    // Brand-resolution failures are already folded into `products`' own
    // per-row outcome (`commitProductImport`'s own contract) — reporting
    // `brands` separately here would double-count the same failure.
    return { ok: true, data: summarize(result.products) };
  } catch (error) {
    return toActionFailure(error);
  }
}
