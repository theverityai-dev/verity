"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorState, Panel } from "@/components/ui/primitives";
import { generateLeadInsight } from "@/server/actions/outreach";
import type { ActionFailure } from "@/server/platform/action-error";

type Insight = {
  id: string;
  kind: string;
  content: string;
  model: string;
  sourceReads: string[];
  requestedBy: string;
  createdAt: string;
};

const KIND_LABEL: Record<string, string> = {
  Summary: "Summary",
  NextStep: "Next step",
  Qualification: "Qualification",
};

/** `verity.outreach.lead_timeline` -> "timeline"; product copy, never a key. */
function readLabel(key: string): string {
  const tail = key.split(".").at(-1) ?? key;
  return tail.replace(/^list_/, "").replace(/_/g, " ");
}

/**
 * AI suggestions on a lead (Task 106 Phase 8, master-context §85; §32-33).
 *
 * Every entry is labelled as a suggestion and carries its provenance — the
 * model, who asked, and which of the lead's records it actually read. It
 * never changes the lead: acting on a suggestion is the human running the
 * real action above (advance the stage, log the activity). Nothing here is
 * auto-applied, drafted for sending, or presented as a fact.
 */
export function AiInsightPanel({
  leadId,
  insights,
  canRequest,
  configured,
}: {
  leadId: string;
  insights: Insight[];
  canRequest: boolean;
  configured: boolean;
}) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pendingKind, setPendingKind] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function request(kind: "Summary" | "NextStep" | "Qualification") {
    setFailure(null);
    setPendingKind(kind);
    startTransition(async () => {
      const result = await generateLeadInsight({ leadId, kind });
      setPendingKind(null);
      if (result.ok) router.refresh();
      else setFailure(result);
    });
  }

  return (
    <Panel title="AI suggestions">
      {canRequest && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {(["Summary", "NextStep", "Qualification"] as const).map((kind) => (
            <Button
              key={kind}
              size="sm"
              variant="secondary"
              disabled={pending || !configured}
              aria-busy={pending && pendingKind === kind}
              onClick={() => request(kind)}
            >
              {pending && pendingKind === kind ? "Reading records…" : KIND_LABEL[kind]}
            </Button>
          ))}
          {!configured && (
            <span className="text-[12px] text-text-tertiary">Not configured for this deployment.</span>
          )}
        </div>
      )}

      {failure && (
        <div className="mb-4">
          <ErrorState title="No suggestion recorded" message={failure.message} issues={failure.issues} retryable={failure.retryable} />
        </div>
      )}

      {insights.length === 0 ? (
        <p className="m-0 text-[13px] text-text-tertiary">
          No suggestions yet. Each one is grounded in this lead's own records and saved with what it read — it never
          changes the lead.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {insights.map((i) => (
            <li key={i.id} className="flex flex-col gap-1.5 border-b border-line pb-4 last:border-none last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-[13px] uppercase tracking-[0.02em] text-text-secondary">
                  AI suggestion · {KIND_LABEL[i.kind] ?? i.kind}
                </span>
                <time dateTime={i.createdAt} className="text-[12px] text-text-tertiary">
                  {new Date(i.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                </time>
              </div>
              <p className="m-0 whitespace-pre-line text-[14px] leading-relaxed text-text">{i.content}</p>
              <p className="m-0 text-[12px] text-text-tertiary">
                Requested by {i.requestedBy} · {i.model} · read {i.sourceReads.length === 0 ? "nothing" : i.sourceReads.map(readLabel).join(", ")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
