"use client";

import { useState } from "react";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Select } from "@/components/ui/primitives";
import { useCommand } from "@/components/ui/CommandForm";

/** Record that a job relied on the revision in force now. The link names that exact revision and never moves. */
export function LinkJob({ revisionId, revisionLabel, jobs }: { revisionId: string; revisionLabel: string; jobs: Array<{ id: string; label: string }> }) {
  const { run, pending, failure } = useCommand("/documents");
  const [jobId, setJobId] = useState("");
  if (jobs.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="link-job" className="text-[13px] font-medium text-text-secondary">Record that a job relies on {revisionLabel}</label>
      <div className="flex flex-wrap gap-2">
        <Select id="link-job" value={jobId} onChange={(e) => setJobId(e.target.value)} className="min-w-0 flex-1">
          <option value="" disabled>Choose a job…</option>
          {jobs.map((j) => (<option key={j.id} value={j.id}>{j.label}</option>))}
        </Select>
        <CommandButton commands="verity.document.link" variant="secondary" disabled={pending || !jobId}
          onClick={() => run("verity.document.link", { revisionId, entityKey: "verity.project.job", entityId: jobId }, () => setJobId(""))}>
          Link
        </CommandButton>
      </div>
      {failure && <p role="alert" className="m-0 text-[13px] text-[var(--color-danger-ink)]">{failure.message}</p>}
    </div>
  );
}
