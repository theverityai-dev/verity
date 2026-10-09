"use client";

import { useState, useTransition } from "react";
import { CommandButton } from "@/components/ui/CommandAccess";
import { CommandFailure, useCommand } from "@/components/ui/CommandForm";
import { Button, ErrorState, Panel } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { runQuery } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

type ExportRow = {
  id: string;
  status: string;
  requestedAt: string;
  datasetCount: number;
  rowCount: number;
  byteSize: number | null;
};

const columns: Column[] = [
  { key: "when", header: "Requested", sortable: true },
  { key: "status", header: "Status" },
  { key: "contents", header: "Contents" },
  { key: "size", header: "Size", numeric: true },
];

function size(bytes: number | null): string {
  if (bytes === null) return "—";
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DataExportPanel({ exports }: { exports: ExportRow[] }) {
  const request = useCommand("/settings/data-export");
  const [linkFailure, setLinkFailure] = useState<ActionFailure | null>(null);
  const [downloading, startDownload] = useTransition();

  function download(exportId: string) {
    setLinkFailure(null);
    startDownload(async () => {
      const result = await runQuery<{ url: string } | null>("verity.platform.get_data_export_link", { exportId });
      if (!result.ok) return setLinkFailure(result);
      if (result.data) window.location.assign(result.data.url);
    });
  }

  return (
    <>
      <CommandFailure failure={request.failure} title="Could not create the export" />
      {linkFailure && (
        <div className="mb-4">
          <ErrorState title="Could not get the download link" message={linkFailure.message} issues={linkFailure.issues} retryable={linkFailure.retryable} />
        </div>
      )}
      <div className="mb-4">
        <CommandButton
          commands="verity.platform.request_data_export"
          variant="primary"
          disabled={request.pending}
          onClick={() => request.run("verity.platform.request_data_export", {})}
        >
          {request.pending ? "Preparing your export…" : "Create a new export"}
        </CommandButton>
      </div>
      <Panel title="Your exports" flush>
        <DataTable
          columns={columns}
          rows={exports.map((e) => ({
            id: e.id,
            exportId: e.id,
            when: e.requestedAt.slice(0, 16).replace("T", " "),
            status: e.status === "completed" ? "Ready" : e.status === "failed" ? "Failed" : "Preparing",
            contents: e.status === "completed" ? `${e.datasetCount} sets · ${e.rowCount.toLocaleString("en-IN")} rows` : "—",
            size: size(e.byteSize),
            ready: e.status === "completed",
          }))}
          caption="Data exports requested for this business (times in UTC)"
          emptyTitle="No exports yet"
          emptyDescription="Create one to get a ZIP of your records."
          filterable={false}
          rowActions={(row) =>
            row.ready ? (
              <Button size="sm" variant="secondary" disabled={downloading} onClick={() => download(String(row.exportId))}>
                Download
              </Button>
            ) : null
          }
        />
      </Panel>
    </>
  );
}
