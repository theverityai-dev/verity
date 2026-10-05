"use client";

import { useMemo, useState, useTransition } from "react";
import Papa from "papaparse";
import {
  Button,
  Field,
  FormRow,
  Panel,
  Select,
  ErrorState,
} from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import {
  IMPORT_KINDS,
  runImportPreview,
  runImportCommit,
  type ImportKind,
  type ImportPreviewSummary,
  type ImportCommitSummary,
} from "@/server/actions/import";
import type { ActionFailure } from "@/server/platform/action-error";

const KIND_LABEL: Record<ImportKind, string> = {
  customer: "Customers",
  supplier: "Suppliers",
  product: "Boards (catalogue)",
};

const KIND_TEMPLATE: Record<ImportKind, string> = {
  customer: "displayName,gstin,phone,email,stateCode,creditLimitPaise",
  supplier: "displayName,gstin,phone,email,stateCode",
  product: "brandName,name,hsnCode,thicknessTenthMm,category,widthTenth,heightTenth,grade,unitLabel,reorderLevelUnits",
};

/**
 * APPLE-P0-02: `primitives.tsx` now has a shared `Textarea`, but this stays a
 * documented exception rather than switching to it — `cx()` here is a plain
 * join, not `tailwind-merge`, so `Textarea`'s baked-in `min-h-24`/`text-[14px]`
 * would sit in the DOM alongside this box's `min-h-40 font-mono text-[13px]`
 * CSV needs with no guaranteed winner. Kept hand-rolled, same border/focus/
 * shadow language as `Input`/`Select`.
 */
const textareaClass =
  "bg-control w-full min-h-40 resize-y rounded-[10px] px-4 py-3 text-[13px] font-mono text-text " +
  "placeholder:text-text-tertiary placeholder:font-sans transition-[border-color,box-shadow] duration-200 " +
  "hover:border-line-strong focus:outline-none focus:border-accent " +
  "focus:shadow-[var(--shadow-highlight),0_0_0_3px_var(--color-accent-subtle)]";

type Step = "input" | "preview" | "done";

/**
 * Task 87's UI: `Import → map → validate → preview → commit → reconcile`.
 *
 * "Map" is implicit — a CSV column matching a target field name (shown as
 * the template header row) is picked up automatically; there is no
 * drag-and-drop column mapper (this taskplan's own non-goal, "not a
 * generic ETL platform").
 *
 * `preview.valid` is sent back to `runImportCommit` UNCHANGED — the same
 * no-drift discipline Task 81 rule 8's confirm step already uses: what you
 * saw is exactly what runs, never re-derived.
 */
export function ImportWizard() {
  const [kind, setKind] = useState<ImportKind>("customer");
  const [csvText, setCsvText] = useState("");
  const [step, setStep] = useState<Step>("input");
  const [preview, setPreview] = useState<ImportPreviewSummary | null>(null);
  const [commit, setCommit] = useState<ImportCommitSummary | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  const parsedRows = useMemo(() => {
    if (!csvText.trim()) return [];
    const result = Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: true,
    });
    return result.data;
  }, [csvText]);

  function reset() {
    setStep("input");
    setPreview(null);
    setCommit(null);
    setFailure(null);
  }

  function onFile(file: File) {
    file.text().then(setCsvText);
  }

  function doPreview() {
    setFailure(null);
    if (parsedRows.length === 0) {
      setFailure({
        ok: false,
        code: "E_VALIDATION",
        message: "Paste or choose a CSV file with at least one data row first.",
        retryable: false,
      });
      return;
    }
    startTransition(async () => {
      const result = await runImportPreview(kind, parsedRows);
      if (result.ok) {
        setPreview(result.data);
        setStep("preview");
      } else {
        setFailure(result);
      }
    });
  }

  function doCommit() {
    if (!preview || preview.valid.length === 0) return;
    setFailure(null);
    startTransition(async () => {
      const result = await runImportCommit(
        kind,
        preview.valid.map((row) => row.data),
      );
      if (result.ok) {
        setCommit(result.data);
        setStep("done");
      } else {
        setFailure(result);
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {failure && (
        <ErrorState
          title="That was refused"
          message={failure.message}
          issues={failure.issues}
          retryable={failure.retryable}
        />
      )}

      {step === "input" && (
        <Panel title="1. Choose what you're bringing in">
          <div className="flex flex-col gap-4 px-5 py-5">
            <FormRow columns="minmax(0,1fr)">
              <Field label="Kind" htmlFor="import-kind">
                <Select
                  id="import-kind"
                  value={kind}
                  onChange={(event) => setKind(event.target.value as ImportKind)}
                >
                  {IMPORT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </Select>
              </Field>
            </FormRow>

            <Field
              label="CSV file"
              htmlFor="import-file"
              hint="Or paste rows below. Either way, the first row must be column names."
            >
              <input
                id="import-file"
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onFile(file);
                }}
                className="block w-full text-[13px] text-text-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-surface-sunken file:px-3 file:py-2 file:text-[13px] file:text-text hover:file:bg-surface-sunken"
              />
            </Field>

            <Field
              label="Or paste CSV"
              htmlFor="import-paste"
              hint={`Expected columns for ${KIND_LABEL[kind].toLowerCase()}: ${KIND_TEMPLATE[kind]}`}
            >
              <textarea
                id="import-paste"
                className={textareaClass}
                placeholder={KIND_TEMPLATE[kind]}
                value={csvText}
                onChange={(event) => setCsvText(event.target.value)}
                spellCheck={false}
              />
            </Field>

            <div className="flex items-center justify-between">
              <p className="m-0 text-[12px] text-text-tertiary">
                {parsedRows.length > 0
                  ? `${parsedRows.length} row${parsedRows.length === 1 ? "" : "s"} ready to check`
                  : "No rows yet"}
              </p>
              <Button
                variant="primary"
                disabled={pending || parsedRows.length === 0}
                onClick={doPreview}
              >
                {pending ? "Checking…" : "Check rows"}
              </Button>
            </div>
          </div>
        </Panel>
      )}

      {step === "preview" && preview && (
        <>
          <Panel
            title="2. Review before anything is written"
            action={
              <span className="tabular text-[12px] text-text-tertiary">
                {preview.valid.length} ready · {preview.invalid.length} need fixing
              </span>
            }
          >
            {preview.invalid.length > 0 && (
              <DataTable
                columns={[
                  { key: "row", header: "Row", numeric: true, sortable: true },
                  { key: "problem", header: "Problem", sortable: false },
                ]}
                rows={preview.invalid.map((issue) => ({
                  id: issue.row,
                  row: issue.row,
                  problem: issue.errors.join("; "),
                }))}
                caption="Rows that will not be imported as-is"
              />
            )}
            <div className="flex items-center justify-between px-5 py-4">
              <p className="m-0 text-[12px] text-text-tertiary">
                {preview.invalid.length > 0
                  ? "Rows that need fixing are skipped — nothing about them is written. Fix your file and check again if you want them included."
                  : "Every row checked out."}
              </p>
              <div className="flex gap-2">
                <Button onClick={reset} disabled={pending}>
                  Start over
                </Button>
                <Button
                  variant="primary"
                  disabled={pending || preview.valid.length === 0}
                  onClick={doCommit}
                >
                  {pending
                    ? "Importing…"
                    : `Import ${preview.valid.length} ${KIND_LABEL[kind].toLowerCase()}`}
                </Button>
              </div>
            </div>
          </Panel>
        </>
      )}

      {step === "done" && commit && (
        <Panel
          title="3. Done"
          action={
            <span className="tabular text-[12px] text-text-tertiary">
              {commit.succeeded} of {commit.total} succeeded
            </span>
          }
        >
          <DataTable
            columns={[
              { key: "row", header: "Row", numeric: true, sortable: true },
              { key: "result", header: "Result", sortable: false },
            ]}
            rows={commit.rows.map((row) => ({
              id: row.row,
              row: row.row,
              result: row.message,
            }))}
            caption="What happened to each row"
          />
          <div className="flex justify-end px-5 py-4">
            <Button variant="primary" onClick={reset}>
              Import more
            </Button>
          </div>
        </Panel>
      )}
    </div>
  );
}
