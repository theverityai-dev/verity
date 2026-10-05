"use client";

import { CommandButton } from "@/components/ui/CommandAccess";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Panel,
  Row,
  RowList,
  Stat,
  StatRow,
  Textarea,
} from "@/components/ui/primitives";
import { rupees, rupeesShort } from "@/components/ui/business/format";
import { Related } from "@/components/ui/business/Related";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

type Report = Awaited<
  ReturnType<typeof import("@/server/capabilities/plywood").itcReconciliation.handler>
>;

/** What each bucket means to the person who has to clear it. */
const BUCKET: Record<string, { title: string; action: string }> = {
  amount_mismatch: {
    title: "Amount differs",
    action: "The tax recorded here is not what the supplier filed. Agree the figure with them.",
  },
  gstin_mismatch: {
    title: "GSTIN differs",
    action: "The same invoice number is filed under a different GSTIN. One of the two is wrong.",
  },
  missing_in_gst: {
    title: "Not filed by the supplier",
    action: "Credit is claimed in your books and unsupported. Chase the supplier before filing.",
  },
  missing_in_verity: {
    title: "Not recorded here",
    action: "The supplier filed it and no purchase invoice exists. Find the bill.",
  },
  matched: { title: "Matched", action: "Books and portal agree." },
};

/**
 * A minimal CSV reader for the portal export.
 *
 * Deliberately strict and deliberately small: it splits on commas and refuses
 * anything it does not understand, rather than guessing. A parser that silently
 * accepts a malformed row produces a reconciliation finding against a supplier
 * who did nothing wrong, which is worse than refusing the file.
 *
 * Amounts are read as RUPEES and converted, because that is how a portal export
 * is written. Parsing them as paise would understate every figure a hundredfold
 * and the mistake would look like a supplier under-filing.
 */
function parseCsv(text: string): {
  rows: Array<Record<string, string>>;
  error: string | null;
} {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) return { rows: [], error: "The file has no rows under its header." };

  const header = lines[0]!.split(",").map((cell) => cell.trim().toLowerCase());
  const required = ["gstin", "invoice", "date", "taxable", "total"];
  const missing = required.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    return {
      rows: [],
      error: `The header is missing: ${missing.join(", ")}. Expected gstin, invoice, date, taxable, cgst, sgst, igst, total.`,
    };
  }

  const rows: Array<Record<string, string>> = [];
  for (const [index, line] of lines.slice(1).entries()) {
    const cells = line.split(",").map((cell) => cell.trim());
    if (cells.length !== header.length) {
      return { rows: [], error: `Row ${index + 2} has ${cells.length} columns, expected ${header.length}.` };
    }
    rows.push(Object.fromEntries(header.map((column, i) => [column, cells[i] ?? ""])));
  }
  return { rows, error: null };
}

function rupeesToPaise(value: string): number {
  const parsed = Number.parseFloat(value.replace(/[, ]/g, ""));
  if (!Number.isFinite(parsed)) return Number.NaN;
  return Math.round(parsed * 100);
}

export function ItcView({ report }: { report: Report }) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [importing, setImporting] = useState(false);
  const [csv, setCsv] = useState("");
  const [sourceRef, setSourceRef] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const grouped = useMemo(() => {
    const map = new Map<string, Report["rows"]>();
    for (const row of report.rows) map.set(row.bucket, [...(map.get(row.bucket) ?? []), row]);
    return map;
  }, [report.rows]);

  const matched = grouped.get("matched") ?? [];
  const exceptions = report.rows.filter((row) => row.bucket !== "matched");

  function submitImport() {
    setFailure(null);
    setParseError(null);
    const { rows, error } = parseCsv(csv);
    if (error) {
      setParseError(error);
      return;
    }

    const payload: Array<{
      supplierGstin: string;
      supplierName?: string;
      invoiceNumber: string;
      invoiceDate: string;
      taxablePaise: number;
      cgstPaise: number;
      sgstPaise: number;
      igstPaise: number;
      totalPaise: number;
    }> = [];
    for (const [index, row] of rows.entries()) {
      const taxable = rupeesToPaise(row.taxable ?? "");
      const total = rupeesToPaise(row.total ?? "");
      const cgst = row.cgst ? rupeesToPaise(row.cgst) : 0;
      const sgst = row.sgst ? rupeesToPaise(row.sgst) : 0;
      const igst = row.igst ? rupeesToPaise(row.igst) : 0;
      const date = new Date(`${row.date}T00:00:00Z`);
      if ([taxable, total, cgst, sgst, igst].some((n) => Number.isNaN(n))) {
        setParseError(`Row ${index + 2} has an amount that is not a number.`);
        return;
      }
      if (Number.isNaN(date.getTime())) {
        setParseError(`Row ${index + 2} has a date that could not be read. Use YYYY-MM-DD.`);
        return;
      }
      payload.push({
        supplierGstin: (row.gstin ?? "").toUpperCase(),
        ...(row.supplier ? { supplierName: row.supplier } : {}),
        invoiceNumber: row.invoice ?? "",
        invoiceDate: date.toISOString(),
        taxablePaise: taxable,
        cgstPaise: cgst,
        sgstPaise: sgst,
        igstPaise: igst,
        totalPaise: total,
      });
    }

    startTransition(async () => {
      const result = await runCommand(
        "verity.trading.import_gst_portal_records",
        {
          periodKey: report.periodKey,
          rows: payload,
          ...(sourceRef.trim() ? { sourceRef: sourceRef.trim() } : {}),
        },
        "/tax/itc",
      );
      if (result.ok) {
        setImporting(false);
        setCsv("");
        router.refresh();
      } else {
        setFailure(result);
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {failure && (
        <ErrorState
          title="That import was refused"
          message={failure.message}
          issues={failure.issues}
          retryable={failure.retryable}
        />
      )}

      <StatRow>
        <Stat label="Credit in books" value={rupeesShort(report.booksTaxPaise)} hint={`${report.registerRowCount} invoice(s)`} />
        <Stat label="Filed by suppliers" value={rupeesShort(report.portalTaxPaise)} hint={`${report.portalRowCount} portal row(s)`} />
        <Stat label="Agreed" value={rupeesShort(report.matchedTaxPaise)} hint={`${matched.length} matched`} />
        <Stat label="To resolve" value={exceptions.length} hint={exceptions.length === 0 ? "Nothing outstanding" : "Differences"} />
      </StatRow>

      {report.portalRowCount === 0 && !importing && (
        <Panel title="No portal data for this period">
          <p className="m-0 text-[13px] text-text-secondary">
            A reconciliation needs both sides. Import the period&rsquo;s GSTR-2B rows and every
            difference below is computed from what your suppliers actually filed.
          </p>
          <p className="m-0 mt-2 text-[12px] text-text-tertiary">
            Nothing imported here is posted. It never becomes a payable or a ledger entry — what you
            owe is what your suppliers billed you, and this is only used to find disagreements.
          </p>
          <div className="mt-4">
            <CommandButton commands={"verity.trading.import_gst_portal_records"} variant="primary" onClick={() => setImporting(true)}>
              Import portal data
            </CommandButton>
          </div>
        </Panel>
      )}

      {importing && (
        <Panel title={`Import GSTR-2B for ${report.periodKey}`}>
          <div className="flex flex-col gap-4">
            <p className="m-0 text-[13px] text-text-secondary">
              Paste the rows as CSV with a header:{" "}
              <code className="text-[12px]">gstin, supplier, invoice, date, taxable, cgst, sgst, igst, total</code>.
              Amounts in rupees, dates as YYYY-MM-DD.
            </p>
            <Field label="Rows" htmlFor="itc-csv" required>
              <Textarea
                id="itc-csv"
                value={csv}
                onChange={(event) => setCsv(event.target.value)}
                rows={10}
                className="font-mono"
                placeholder={"gstin,supplier,invoice,date,taxable,cgst,sgst,igst,total\n07AABCU9603R1ZX,Century Ply,CP-8291,2026-08-14,113280,10195,10195,0,133670"}
              />
            </Field>
            <Field label="Where this came from" htmlFor="itc-source" hint="Recorded so the figures can be traced later">
              <Input
                id="itc-source"
                value={sourceRef}
                onChange={(event) => setSourceRef(event.target.value)}
                placeholder="GSTR-2B download, 12 Sep"
              />
            </Field>
            {parseError && (
              <p role="alert" className="m-0 text-[13px] text-danger">
                {parseError}
              </p>
            )}
            {/* Replace, not append: the portal amends a period after the fact,
                and rows added beside a superseded version would match twice. */}
            <p className="m-0 text-[12px] text-text-tertiary">
              This replaces everything already imported for {report.periodKey}, so it is safe to
              re-import when the portal is amended.
            </p>
            <div className="flex gap-2">
              <CommandButton commands={"verity.trading.import_gst_portal_records"} variant="primary" disabled={pending || csv.trim().length === 0} onClick={submitImport}>
                {pending ? "Importing…" : "Import"}
              </CommandButton>
              <Button disabled={pending} onClick={() => setImporting(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </Panel>
      )}

      {report.unmatchable.length > 0 && (
        <Panel flush title="Cannot be matched">
          {/* Its own condition, not folded into "missing in GST" — that would
              accuse the supplier of not filing when the gap is on this side. */}
          <p className="m-0 px-5 pb-3 pt-0 text-[13px] text-text-secondary">
            These purchase invoices have no supplier invoice number or no supplier GSTIN recorded,
            so there is nothing to match them on. The gap is here, not with the supplier.
          </p>
          <RowList>
            {report.unmatchable.map((row) => (
              <Row key={row.invoiceId}>
                <div className="min-w-0">
                  <Link href={`/finance/${row.invoiceId}`} className="text-[14px] text-text no-underline hover:underline">
                    {row.invoiceNumber}
                  </Link>
                  <p className="m-0 mt-0.5 text-[12px] text-text-tertiary">{row.supplierName}</p>
                </div>
                <span className="tabular shrink-0 text-[14px] text-text">{rupees(row.taxPaise)}</span>
              </Row>
            ))}
          </RowList>
        </Panel>
      )}

      {exceptions.length === 0 && report.portalRowCount > 0 ? (
        <EmptyState
          title="Everything agrees"
          description="Every purchase invoice in this period matches what the supplier filed."
        />
      ) : (
        ["amount_mismatch", "gstin_mismatch", "missing_in_gst", "missing_in_verity"].map((bucket) => {
          const rows = grouped.get(bucket) ?? [];
          if (rows.length === 0) return null;
          const meta = BUCKET[bucket]!;
          return (
            <Panel key={bucket} flush title={`${meta.title} — ${rows.length}`}>
              <p className="m-0 px-5 pb-3 pt-0 text-[13px] text-text-secondary">{meta.action}</p>
              <RowList>
                {rows.map((row, index) => (
                  <Row key={`${bucket}-${row.invoiceNumber}-${index}`}>
                    <div className="min-w-0">
                      <p className="m-0 text-[14px] text-text">
                        {row.ourInvoiceId ? (
                          <Link href={`/finance/${row.ourInvoiceId}`} className="text-text no-underline hover:underline">
                            {row.invoiceNumber}
                          </Link>
                        ) : (
                          row.invoiceNumber
                        )}{" "}
                        <span className="text-text-tertiary">· {row.supplierName ?? row.supplierGstin}</span>
                      </p>
                      <p className="m-0 mt-0.5 text-[12px] text-text-tertiary">{row.detail}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-6 text-right">
                      <div className="w-24">
                        <p className="tabular m-0 text-[13px] text-text">
                          {row.booksTaxPaise === null ? "—" : rupees(row.booksTaxPaise)}
                        </p>
                        <p className="m-0 text-[12px] text-text-tertiary">Books</p>
                      </div>
                      <div className="w-24">
                        <p className="tabular m-0 text-[13px] text-text">
                          {row.portalTaxPaise === null ? "—" : rupees(row.portalTaxPaise)}
                        </p>
                        <p className="m-0 text-[12px] text-text-tertiary">Portal</p>
                      </div>
                    </div>
                  </Row>
                ))}
              </RowList>
            </Panel>
          );
        })
      )}

      {matched.length > 0 && (
        // Collapsed to a count. A reconciliation that makes someone scroll past
        // agreement to reach disagreement has recreated the spreadsheet.
        <Panel>
          <p className="m-0 flex items-center gap-2 text-[13px] text-text-secondary">
            <Badge tone="accent">{matched.length} matched</Badge>
            worth {rupees(report.matchedTaxPaise)} in credit, agreed on both sides.
          </p>
        </Panel>
      )}

      {report.portalRowCount > 0 && !importing && (
        <div>
          <CommandButton commands={"verity.trading.import_gst_portal_records"} onClick={() => setImporting(true)}>Re-import portal data</CommandButton>
        </div>
      )}

      <Related
        links={[
          { href: "/tax", label: "Tax & Compliance" },
          { href: "/tax/gstr-3b", label: "GSTR-3B", note: "Where this credit lands" },
          { href: "/tax/purchases", label: "Purchase review" },
          { href: "/tax/exceptions", label: "Exceptions" },
        ]}
      />
    </div>
  );
}
