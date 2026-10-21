"use client";

import { DataTable, type Column } from "@/components/ui/DataTable";
import { Button, Panel } from "@/components/ui/primitives";

/** Neutralises a cell a spreadsheet would run as a formula, then quotes it. */
function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) && Number.isNaN(Number(text)) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * One report: the table on screen and a CSV of exactly the same rows, built in the browser so the file and the
 * screen cannot differ. CSV opens in Excel; a native .xlsx file is a later build.
 */
export function ReportTable({
  title,
  note,
  filename,
  columns,
  rows,
  csvHeader,
  csvRows,
}: {
  title: string;
  note?: string;
  filename: string;
  columns: Column[];
  rows: Array<Record<string, unknown> & { id: string }>;
  csvHeader: string[];
  csvRows: Array<Array<string | number | null>>;
}) {
  const download = () => {
    const body = [csvHeader, ...csvRows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
    const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Panel
      title={title}
      flush
      action={
        <Button variant="secondary" size="sm" onClick={download} disabled={rows.length === 0}>
          Download for Excel
        </Button>
      }
    >
      <DataTable caption={title} rows={rows} columns={columns} emptyTitle="Nothing to report yet" emptyDescription="Rows appear as work is recorded." />
      {note && <p className="m-0 px-5 pb-4 pt-2 text-[13px] text-text-tertiary">{note}</p>}
    </Panel>
  );
}
