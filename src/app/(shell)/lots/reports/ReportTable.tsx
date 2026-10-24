"use client";

import { useRef } from "react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { XLSX_MIME, toXlsx } from "@/lib/xlsx";

/** Neutralises a cell a spreadsheet would run as a formula, then quotes it. */
function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) && Number.isNaN(Number(text)) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * One report as a table, folded under its own title so the graphics above it lead and the full rows are one tap away. Its files are the
 * same rows the table shows: a native Excel file (.xlsx), a CSV, or Print / PDF (the browser's own Save as PDF). They are built in the
 * browser, so a file and the screen cannot differ.
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
  const fold = useRef<HTMLDetailsElement | null>(null);
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
    save(new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" }), filename);
  };
  const downloadXlsx = () => save(new Blob([toXlsx(csvHeader, csvRows, title) as BlobPart], { type: XLSX_MIME }), filename.replace(/\.csv$/i, "") + ".xlsx");
  // A folded table does not print, so Print opens it first.
  const print = () => {
    if (fold.current) fold.current.open = true;
    window.setTimeout(() => window.print(), 50);
  };

  return (
    <details ref={fold} className="glass-card group overflow-hidden print:open">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-accent-line)] [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block truncate text-[16px] font-medium text-text">{title}</span>
          <span className="block text-[13px] text-text-secondary">{rows.length === 0 ? "Nothing to report yet" : `${rows.length} row${rows.length === 1 ? "" : "s"}`}</span>
        </span>
        <Icon name="chevronDown" size={18} className="shrink-0 text-text-secondary transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-line)] px-5 py-3 print:hidden">
        <p className="m-0 min-w-0 flex-1 basis-60 text-[13px] leading-[19px] text-text-tertiary">{note ?? "The same rows are in the files."}</p>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="secondary" size="sm" onClick={downloadXlsx} disabled={rows.length === 0}>Excel</Button>
          <Button variant="ghost" size="sm" onClick={downloadCsv} disabled={rows.length === 0}>CSV</Button>
          <Button variant="ghost" size="sm" onClick={print} disabled={rows.length === 0}>Print / PDF</Button>
        </div>
      </div>
      <DataTable caption={title} rows={rows} columns={columns} emptyTitle="Nothing to report yet" emptyDescription="Rows appear as work is recorded." />
    </details>
  );
}
