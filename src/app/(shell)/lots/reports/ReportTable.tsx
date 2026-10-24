"use client";

import { DataTable, type Column } from "@/components/ui/DataTable";
import { Button, Panel } from "@/components/ui/primitives";
import { XLSX_MIME, toXlsx } from "@/lib/xlsx";

/** Neutralises a cell a spreadsheet would run as a formula, then quotes it. */
function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) && Number.isNaN(Number(text)) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * One report: the table on screen, and the same rows as a native Excel file (.xlsx), as a CSV, or printed (Print opens the browser's
 * own "Save as PDF"). The files are built in the browser from the rows the screen was built from, so a file and the screen cannot
 * differ.
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
  const save = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };
  const downloadCsv = () => {
    const body = [csvHeader, ...csvRows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
    // The byte-order mark makes Excel read the file as UTF-8, so Hindi and the rupee sign survive.
    save(new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8" }), filename);
  };
  const downloadXlsx = () => save(new Blob([toXlsx(csvHeader, csvRows, title) as BlobPart], { type: XLSX_MIME }), filename.replace(/\.csv$/i, "") + ".xlsx");

  return (
    <Panel
      title={title}
      flush
      action={
        <div className="flex flex-wrap gap-1.5 print:hidden">
          <Button variant="secondary" size="sm" onClick={downloadXlsx} disabled={rows.length === 0}>Excel</Button>
          <Button variant="ghost" size="sm" onClick={downloadCsv} disabled={rows.length === 0}>CSV</Button>
          <Button variant="ghost" size="sm" onClick={() => window.print()} disabled={rows.length === 0}>Print / PDF</Button>
        </div>
      }
    >
      <DataTable caption={title} rows={rows} columns={columns} emptyTitle="Nothing to report yet" emptyDescription="Rows appear as work is recorded." />
      {note && <p className="m-0 px-5 pb-4 pt-2 text-[13px] text-text-tertiary">{note}</p>}
    </Panel>
  );
}
