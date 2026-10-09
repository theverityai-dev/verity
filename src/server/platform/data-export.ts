import { z } from "zod";
import { registerCommand, ValidationError, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { ForbiddenError, hasPermission } from "@/server/platform/authorization";
import { diffFields, recordActivity } from "@/server/platform/audit";
import { createJob, jobRunner } from "@/server/platform/job";
import { checksumOf, storageDriver, storageKeyFor } from "@/server/platform/files";
import type { TenantScopedClient } from "@/server/platform/tenancy";
import { toCsv } from "@/lib/csv";
import { zipStore } from "@/lib/zip-store";

/**
 * A client exports its own data (ADR-037).
 *
 * Export is the client's act. A person holding `Export` on this entity requests
 * a full export of their own tenant; it runs as them, reads each dataset through
 * the client's own row-level security, and leaves out every dataset they may not
 * read, so an export never exceeds the requester's authority. The operator holds
 * no `Export` grant and no HQ screen reads these files (ADR-037 clause 3).
 *
 * What can be exported is a registry that capabilities fill in, not a generic
 * dump of every table: a table nobody declared exportable is not exported, and a
 * declared dataset carries the entity whose `Read` permission guards it.
 */

export const ENTITY_DATA_EXPORT = "verity.platform.data_export";

export type ExportableDataset = {
  /** File name stem and manifest key: `customers` writes `customers.csv`. */
  key: string;
  label: string;
  /** The entity whose Read permission the requester must hold to get this dataset. */
  entity: string;
  columns: readonly string[];
  /** Every row, read through the requester's transaction (tenant RLS applies). */
  read: (tx: TenantScopedClient) => Promise<unknown[][]>;
};

const datasets = new Map<string, ExportableDataset>();

/** Declares a dataset exportable. A duplicate key is a defect, so it throws. */
export function registerExportable(dataset: ExportableDataset): void {
  if (!/^[a-z][a-z0-9_]{0,60}$/.test(dataset.key)) throw new Error(`E_EXPORT_BAD_KEY: ${dataset.key}`);
  if (datasets.has(dataset.key)) throw new Error(`E_EXPORT_DUPLICATE: ${dataset.key}`);
  datasets.set(dataset.key, dataset);
}

export function exportableDatasets(): ExportableDataset[] {
  return [...datasets.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Test seam. */
export function clearExportables(): void {
  datasets.clear();
}

/** Larger than this needs a streaming runner, which does not exist yet; fail cleanly instead. */
export const EXPORT_MAX_BYTES = 100 * 1024 * 1024;

export type DataExportRow = {
  id: string;
  status: string;
  requestedAt: Date;
  completedAt: Date | null;
  datasetCount: number;
  rowCount: number;
  byteSize: number | null;
  errorCode: string | null;
};

export const requestDataExport: CommandDefinition<Record<string, never>, { id: string; status: string; datasets: number; rows: number; omitted: string[] }> = {
  key: "verity.platform.request_data_export",
  entity: ENTITY_DATA_EXPORT,
  verb: "Export",
  impact: "destructive",
  input: z.object({}),
  preconditions: async () => {
    if (!storageDriver()) {
      throw new ValidationError("E_VALIDATION: file storage is not set up on this installation, so an export cannot be saved. Ask your administrator.");
    }
  },
  handler: async (ctx) => {
    const driver = storageDriver()!;
    const row = await ctx.tx.dataExport.create({
      data: { tenantId: ctx.actor.tenantId, requestedByUserId: ctx.actor.userId },
    });
    const requestedAt = row.requestedAt;

    let outcome = { datasets: 0, rows: 0, omitted: [] as string[], bytes: 0, key: "", checksum: "" };
    const job = createJob("verity.platform.data_export", { exportId: row.id });
    const result = await jobRunner.run(job, async () => {
      const files: Array<{ name: string; data: Uint8Array }> = [];
      const manifest: unknown[][] = [];
      const encoder = new TextEncoder();
      let rows = 0;
      const omitted: string[] = [];

      for (const dataset of exportableDatasets()) {
        // The requester's own authority decides what is in the file.
        if (!(await hasPermission(ctx.tx, ctx.actor.roleId, "Read", dataset.entity))) {
          omitted.push(dataset.label);
          manifest.push([dataset.key, "", 0, "omitted", "You do not have permission to read this data."]);
          continue;
        }
        const data = await dataset.read(ctx.tx);
        files.push({ name: `${dataset.key}.csv`, data: encoder.encode(toCsv(dataset.columns, data)) });
        manifest.push([dataset.key, `${dataset.key}.csv`, data.length, "included", ""]);
        rows += data.length;
      }

      const info = toCsv(["field", "value"], [
        ["tenant_id", ctx.actor.tenantId],
        ["requested_by_user_id", ctx.actor.userId],
        ["requested_at", requestedAt],
        ["datasets_included", manifest.filter((m) => m[3] === "included").length],
        ["rows_total", rows],
      ]);
      const zip = zipStore([
        { name: "manifest.csv", data: encoder.encode(toCsv(["dataset", "file", "rows", "status", "note"], manifest)) },
        { name: "export-info.csv", data: encoder.encode(info) },
        ...files,
      ]);
      if (zip.byteLength > EXPORT_MAX_BYTES) throw new Error("E_EXPORT_TOO_LARGE");

      const key = storageKeyFor(ctx.actor.tenantId, `data-export-${requestedAt.toISOString().slice(0, 10)}.zip`);
      await driver.storeVerified(key, zip, "application/zip");
      outcome = { datasets: files.length, rows, omitted, bytes: zip.byteLength, key, checksum: checksumOf(zip) };
    });

    if (result.status === "failed") {
      // A code, never the message (ADR-036 keeps free text out of what is recorded).
      const code = /^E_[A-Z_]{1,60}/.exec(result.error)?.[0] ?? "E_EXPORT_FAILED";
      await ctx.tx.dataExport.update({ where: { id: row.id }, data: { status: "failed", errorCode: code, completedAt: new Date() } });
      await recordActivity(ctx, {
        entityKey: ENTITY_DATA_EXPORT,
        entityId: row.id,
        commandKey: "verity.platform.request_data_export",
        changes: diffFields({ status: "requested" }, { status: "failed" }),
      });
      return { result: { id: row.id, status: "failed", datasets: 0, rows: 0, omitted: [] }, events: [] };
    }

    await ctx.tx.dataExport.update({
      where: { id: row.id },
      data: {
        status: "completed",
        storageKey: outcome.key,
        byteSize: outcome.bytes,
        checksum: outcome.checksum,
        datasetCount: outcome.datasets,
        rowCount: outcome.rows,
        completedAt: new Date(),
      },
    });
    await recordActivity(ctx, {
      entityKey: ENTITY_DATA_EXPORT,
      entityId: row.id,
      commandKey: "verity.platform.request_data_export",
      changes: diffFields({ status: "requested" }, { status: "completed" }),
    });
    return {
      result: { id: row.id, status: "completed", datasets: outcome.datasets, rows: outcome.rows, omitted: outcome.omitted },
      events: [{ name: "verity.platform.data_export_completed", entityId: row.id }],
    };
  },
};

export const listDataExports: QueryDefinition<Record<string, never>, DataExportRow[]> = {
  key: "verity.platform.list_data_exports",
  entity: ENTITY_DATA_EXPORT,
  input: z.object({}),
  handler: async (ctx) => {
    const rows = await ctx.tx.dataExport.findMany({ orderBy: { requestedAt: "desc" }, take: 50 });
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      requestedAt: r.requestedAt,
      completedAt: r.completedAt,
      datasetCount: r.datasetCount,
      rowCount: r.rowCount,
      byteSize: r.byteSize,
      errorCode: r.errorCode,
    }));
  },
};

/**
 * A short-lived download link. Reading the list is not enough: the file holds
 * whatever its requester could read, so only someone who may export gets a link.
 */
export const getDataExportLink: QueryDefinition<{ exportId: string }, { url: string; expiresInSeconds: number } | null> = {
  key: "verity.platform.get_data_export_link",
  entity: ENTITY_DATA_EXPORT,
  input: z.object({ exportId: z.string().uuid() }),
  handler: async (ctx, input) => {
    if (!(await hasPermission(ctx.tx, ctx.actor.roleId, "Export", ENTITY_DATA_EXPORT))) {
      throw new ForbiddenError("E_FORBIDDEN: exporting data needs the Export permission");
    }
    const row = await ctx.tx.dataExport.findUnique({ where: { id: input.exportId } });
    if (!row || row.status !== "completed" || !row.storageKey) return null;
    const driver = storageDriver();
    if (!driver) throw new ValidationError("E_VALIDATION: file storage is not set up on this installation");
    const expiresInSeconds = 300;
    return { url: await driver.createReadUrl(row.storageKey, expiresInSeconds), expiresInSeconds };
  },
};

export function registerDataExport(): void {
  registerCommand(requestDataExport);
  registerQuery(listDataExports);
  registerQuery(getDataExportLink);
}
