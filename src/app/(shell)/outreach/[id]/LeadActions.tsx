"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, ErrorState, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { OverflowMenu, OverflowMenuItem } from "@/components/ui/OverflowMenu";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

const TERMINAL_STATES = ["not_a_fit", "unresponsive", "lost", "deferred", "disqualified"];
const REJECTION_REASONS = [
  "NoFit",
  "NoBudget",
  "NoTiming",
  "NotInterested",
  "WrongPerson",
  "RevisitLater",
  "LostToCompetitor",
  "LostOnPrice",
  "LostOnScopeTrust",
] as const;

const CHANNELS = ["LinkedIn", "Email", "WhatsApp", "Call", "Referral", "Meeting", "Other"] as const;
const ACTIVITY_TYPES = [
  "FirstOutreach",
  "FollowUp",
  "Response",
  "MeetingBooked",
  "MeetingCompleted",
  "ProposalSent",
  "PitchDeck",
  "BusinessResearch",
  "Other",
] as const;

/**
 * Stage transitions + activity logging, both real platform commands. Buttons
 * are generated from the transitions the state runtime actually declared
 * from here (handbook Ch. 22), so the interface cannot offer a move the
 * command pipeline would refuse.
 */
export function LeadActions({
  leadId,
  transitions,
  canEdit,
  canLog,
  isTerminal,
  advanceThresholdMinor,
  advanceReceivedMinor,
  teamMembers,
  currentOwnerId,
  isEscalated,
  initiallyLogOpen = false,
}: {
  leadId: string;
  transitions: Array<{ key: string; category: string }>;
  canEdit: boolean;
  canLog: boolean;
  isTerminal: boolean;
  advanceThresholdMinor: number | null;
  advanceReceivedMinor: number;
  teamMembers: Array<{ id: string; name: string }>;
  currentOwnerId: string;
  isEscalated: boolean;
  /** Opens the record's activity form from a command-palette deep link. */
  initiallyLogOpen?: boolean;
}) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const [pendingTerminal, setPendingTerminal] = useState<string | null>(null);
  const [reason, setReason] = useState<(typeof REJECTION_REASONS)[number]>("NoFit");
  const [logOpen, setLogOpen] = useState(initiallyLogOpen);
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const [stagePick, setStagePick] = useState<string>("");

  const advance = (toState: string, rejectionReason?: string) => {
    setFailure(null);
    startTransition(async () => {
      const result = await runCommand(
        "verity.outreach.advance_stage",
        { leadId, toState, rejectionReason },
        `/outreach/${leadId}`,
      );
      if (result.ok) {
        setPendingTerminal(null);
        router.refresh();
      } else {
        setFailure(result);
      }
    });
  };

  const closedWonBlocked =
    advanceThresholdMinor == null || advanceReceivedMinor < advanceThresholdMinor;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {canLog && !isTerminal && (
          <Button size="sm" variant="secondary" onClick={() => setLogOpen((v) => !v)}>
            {logOpen ? "Close log form" : "Log activity"}
          </Button>
        )}
        {isEscalated && <Badge tone="accent">Escalated</Badge>}
        {/* Task: stage change was previously one click per option — a
            misclick fired the move immediately, and the state machine only
            runs forward (INV-002-adjacent: no undo transition exists). A
            dropdown + explicit Update requires two deliberate actions
            before anything moves, same as the terminal-reason flow below. */}
        {canEdit && !isTerminal && (() => {
          const forwardMoves = transitions.filter((t) => !TERMINAL_STATES.includes(t.key));
          if (forwardMoves.length === 0) return null;
          const blocked = stagePick === "closed_won" && closedWonBlocked;
          return (
            <div className="flex items-center gap-2">
              <Select
                aria-label="Move to stage"
                value={stagePick}
                onChange={(e) => setStagePick(e.target.value)}
                disabled={pending}
              >
                <option value="">Move to stage…</option>
                {forwardMoves.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.key.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending || !stagePick || blocked}
                title={blocked ? "Cumulative advance received has not cleared the threshold yet" : undefined}
                onClick={() => {
                  advance(stagePick);
                  setStagePick("");
                }}
              >
                Update
              </Button>
            </div>
          );
        })()}
        {canEdit && (
          <OverflowMenu>
            {!isTerminal && (
              <OverflowMenuItem onClick={() => setReassignOpen((v) => !v)}>Reassign owner</OverflowMenuItem>
            )}
            {!isTerminal && (
              <OverflowMenuItem onClick={() => setPaymentOpen((v) => !v)}>Record payment</OverflowMenuItem>
            )}
            {isTerminal && <OverflowMenuItem onClick={() => setReactivateOpen((v) => !v)}>Reactivate</OverflowMenuItem>}
            {!isTerminal && !isEscalated && (
              <OverflowMenuItem onClick={() => setEscalateOpen((v) => !v)}>Escalate</OverflowMenuItem>
            )}
            {!isTerminal &&
              transitions
                .filter((t) => TERMINAL_STATES.includes(t.key))
                .map((t) => (
                  <OverflowMenuItem key={t.key} danger onClick={() => setPendingTerminal(t.key)}>
                    {t.key.replace(/_/g, " ")}
                  </OverflowMenuItem>
                ))}
          </OverflowMenu>
        )}
      </div>

      {pendingTerminal && (
        <div className="flex items-end gap-2 rounded-[12px] bg-surface p-3">
          <Field label="Reason" htmlFor="rejectionReason">
            <Select
              id="rejectionReason"
              value={reason}
              onChange={(e) => setReason(e.target.value as (typeof REJECTION_REASONS)[number])}
            >
              {REJECTION_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r.replace(/([A-Z])/g, " $1").trim()}
                </option>
              ))}
            </Select>
          </Field>
          <Button size="sm" disabled={pending} onClick={() => advance(pendingTerminal, reason)}>
            Confirm
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setPendingTerminal(null)}>
            Cancel
          </Button>
        </div>
      )}

      {logOpen && <LogActivityForm leadId={leadId} onDone={() => setLogOpen(false)} />}
      {reassignOpen && (
        <ReassignOwnerForm
          leadId={leadId}
          teamMembers={teamMembers}
          currentOwnerId={currentOwnerId}
          onDone={() => setReassignOpen(false)}
        />
      )}
      {paymentOpen && <RecordPaymentForm leadId={leadId} onDone={() => setPaymentOpen(false)} />}
      {reactivateOpen && (
        <ReactivateForm leadId={leadId} teamMembers={teamMembers} onDone={() => setReactivateOpen(false)} />
      )}
      {escalateOpen && <EscalateForm leadId={leadId} onDone={() => setEscalateOpen(false)} />}

      {failure && (
        <div className="w-full sm:w-96">
          <ErrorState title="Could not update the lead" message={failure.message} issues={failure.issues} retryable={failure.retryable} />
        </div>
      )}
    </div>
  );
}

// Task 114 P0.2 — next action is required on every activity log. No
// terminal-state exception needed here: `LogActivityForm` is only ever
// rendered when `!isTerminal` (see the primary button row above), so this
// form is never reachable on an already-closed lead.
/** yyyy-mm-dd `days` from now, for the quick-default buttons below. */
function dateInNDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Task 114 P1.5 item 6 (follow-up suggestion): a next-action default per
 * activity type, not a "based on stage/touch history" model — the review
 * didn't specify what history or threshold that would use, and inventing
 * one unasked is exactly what this taskplan's own text says not to do. This
 * is the smaller, honestly-scoped version: what a reasonable follow-up gap
 * looks like for the activity just logged, editable via the same quick-set
 * buttons or by hand — never submitted without the operator seeing it first.
 */
const FOLLOWUP_SUGGESTION_DAYS: Record<(typeof ACTIVITY_TYPES)[number], number> = {
  FirstOutreach: 3,
  FollowUp: 3,
  Response: 1,
  MeetingBooked: 1,
  MeetingCompleted: 2,
  ProposalSent: 3,
  PitchDeck: 3,
  BusinessResearch: 7,
  Other: 3,
};

function LogActivityForm({ leadId, onDone }: { leadId: string; onDone: () => void }) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const [nextActionAt, setNextActionAt] = useState(dateInNDays(FOLLOWUP_SUGGESTION_DAYS.FirstOutreach));
  const [dateTouched, setDateTouched] = useState(false);
  const [activityType, setActivityType] = useState<(typeof ACTIVITY_TYPES)[number]>("FirstOutreach");
  const activityCopy: Record<(typeof ACTIVITY_TYPES)[number], { message: string; messageHint: string; response: string; responseHint: string }> = {
    FirstOutreach: { message: "Opening message", messageHint: "The first outreach you sent", response: "Reply", responseHint: "Leave blank until they respond" },
    FollowUp: { message: "Follow-up message", messageHint: "What you used to re-open the conversation", response: "Reply", responseHint: "Any response or objection" },
    Response: { message: "Their message", messageHint: "What the prospect said", response: "Your response", responseHint: "How you replied or will reply" },
    MeetingBooked: { message: "Meeting context", messageHint: "Why they agreed to meet", response: "Agenda", responseHint: "What needs to be covered" },
    MeetingCompleted: { message: "Meeting summary", messageHint: "Decisions, needs, and commitments", response: "Outcome", responseHint: "Next commercial or delivery step" },
    ProposalSent: { message: "Proposal summary", messageHint: "Scope, value, or commercial terms sent", response: "Commercial response", responseHint: "Their feedback or objection" },
    PitchDeck: { message: "Deck shared", messageHint: "Deck version and the story it carried", response: "Reaction", responseHint: "Questions or level of interest" },
    BusinessResearch: { message: "Research finding", messageHint: "A verified company, market, or contact insight", response: "Implication", responseHint: "How it changes the sales approach" },
    Other: { message: "Activity note", messageHint: "What happened", response: "Result", responseHint: "What changed" },
  };
  const copy = activityCopy[activityType];

  return (
    <form
      className="flex w-full flex-col gap-3 rounded-[12px] bg-surface p-4 sm:w-[420px]"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setFailure(null);
        startTransition(async () => {
          const result = await runCommand(
            "verity.outreach.log_activity",
            {
              leadId,
              channel: String(form.get("channel")),
              activityType: String(form.get("activityType")),
              message: String(form.get("message") ?? "") || undefined,
              response: String(form.get("response") ?? "") || undefined,
              nextActionNote: String(form.get("nextActionNote") ?? "") || undefined,
              nextActionAt: form.get("nextActionAt") ? new Date(String(form.get("nextActionAt"))).toISOString() : undefined,
            },
            `/outreach/${leadId}`,
          );
          if (result.ok) {
            onDone();
            router.refresh();
          } else {
            setFailure(result);
          }
        });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Channel" htmlFor="channel">
          <Select id="channel" name="channel" defaultValue="LinkedIn">
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Type" htmlFor="activityType">
          <Select
            id="activityType"
            name="activityType"
            defaultValue="FirstOutreach"
            onChange={(e) => {
              const type = e.target.value as (typeof ACTIVITY_TYPES)[number];
              setActivityType(type);
              if (dateTouched) return;
              setNextActionAt(dateInNDays(FOLLOWUP_SUGGESTION_DAYS[type] ?? 3));
            }}
          >
            {ACTIVITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/([A-Z])/g, " $1").trim()}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={copy.message} htmlFor="message" hint={copy.messageHint}>
        <Textarea id="message" name="message" rows={2} />
      </Field>
      <Field label={copy.response} htmlFor="response" hint={copy.responseHint}>
        <Textarea id="response" name="response" rows={2} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Next action" htmlFor="nextActionNote" required>
          <Input id="nextActionNote" name="nextActionNote" required />
        </Field>
        <Field label="Due" htmlFor="nextActionAt" required hint="Suggested from the activity type — change freely">
          <Input
            id="nextActionAt"
            name="nextActionAt"
            type="date"
            required
            value={nextActionAt}
            onChange={(e) => {
              setDateTouched(true);
              setNextActionAt(e.target.value);
            }}
          />
        </Field>
      </div>
      <div className="-mt-1 flex flex-wrap gap-1.5">
        {[
          { label: "Tomorrow", days: 1 },
          { label: "3 days", days: 3 },
          { label: "Next week", days: 7 },
        ].map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => {
              setDateTouched(true);
              setNextActionAt(dateInNDays(preset.days));
            }}
            className="rounded-pill px-2.5 py-1 text-[11.5px] font-medium text-text-secondary transition-colors hover:bg-surface-sunken hover:text-text"
          >
            {preset.label}
          </button>
        ))}
      </div>
      {failure && <ErrorState title="Could not log activity" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Log activity"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Handbook Ch. 02: eligible only 14+ days after the last logged activity — the command itself is the enforcement, this just surfaces its error. */
function ReassignOwnerForm({
  leadId,
  teamMembers,
  currentOwnerId,
  onDone,
}: {
  leadId: string;
  teamMembers: Array<{ id: string; name: string }>;
  currentOwnerId: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex w-full flex-wrap items-end gap-3 rounded-[12px] bg-surface p-4 sm:w-auto"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setFailure(null);
        startTransition(async () => {
          const result = await runCommand(
            "verity.outreach.reassign_owner",
            { leadId, newOwnerId: String(form.get("newOwnerId")) },
            `/outreach/${leadId}`,
          );
          if (result.ok) {
            onDone();
            router.refresh();
          } else {
            setFailure(result);
          }
        });
      }}
    >
      <Field label="New owner" htmlFor="newOwnerId">
        <Select id="newOwnerId" name="newOwnerId" defaultValue={currentOwnerId}>
          {teamMembers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </Field>
      {failure && (
        <div className="w-full">
          <ErrorState title="Could not reassign" message={failure.message} issues={failure.issues} retryable={failure.retryable} />
        </div>
      )}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Reassign"}
      </Button>
      <Button type="button" size="sm" variant="secondary" onClick={onDone}>
        Cancel
      </Button>
    </form>
  );
}

/** Handbook Ch. 02: milestone payments always ADD to the cumulative total, never replace it — see `recordAdvancePayment`. */
function RecordPaymentForm({ leadId, onDone }: { leadId: string; onDone: () => void }) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex w-full flex-wrap items-end gap-3 rounded-[12px] bg-surface p-4 sm:w-auto"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setFailure(null);
        startTransition(async () => {
          const amountRupees = Number(form.get("amount"));
          const thresholdRupees = form.get("threshold") ? Number(form.get("threshold")) : undefined;
          const result = await runCommand(
            "verity.outreach.record_advance_payment",
            {
              leadId,
              amountMinor: Math.round(amountRupees * 100),
              advanceThresholdMinor: thresholdRupees != null ? Math.round(thresholdRupees * 100) : undefined,
            },
            `/outreach/${leadId}`,
          );
          if (result.ok) {
            onDone();
            router.refresh();
          } else {
            setFailure(result);
          }
        });
      }}
    >
      <Field label="Amount received" htmlFor="amount" hint="In rupees">
        <div className="w-36">
          <Input id="amount" name="amount" type="number" min="0.01" step="0.01" required />
        </div>
      </Field>
      <Field label="Set threshold" htmlFor="threshold" hint="Optional — leave blank to keep the current one">
        <div className="w-36">
          <Input id="threshold" name="threshold" type="number" min="0.01" step="0.01" />
        </div>
      </Field>
      {failure && (
        <div className="w-full">
          <ErrorState title="Could not record payment" message={failure.message} issues={failure.issues} retryable={failure.retryable} />
        </div>
      )}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Record"}
      </Button>
      <Button type="button" size="sm" variant="secondary" onClick={onDone}>
        Cancel
      </Button>
    </form>
  );
}

/** INV-002: never reopens the terminal lead — spawns a new row (`reactivateLead`), carrying origination credit only within the handbook's 90-day window. */
function ReactivateForm({
  leadId,
  teamMembers,
  onDone,
}: {
  leadId: string;
  teamMembers: Array<{ id: string; name: string }>;
  onDone: () => void;
}) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex w-full flex-col gap-3 rounded-[12px] bg-surface p-4 sm:w-[420px]"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setFailure(null);
        startTransition(async () => {
          const result = await runCommand<{ id: string }>(
            "verity.outreach.reactivate_lead",
            {
              leadId,
              newOwnerId: String(form.get("newOwnerId")),
              whyRelevant: String(form.get("whyRelevant") ?? ""),
            },
            "/outreach",
          );
          if (result.ok) {
            router.push(`/outreach/${result.data.id}`);
          } else {
            setFailure(result);
          }
        });
      }}
    >
      <Field label="New owner" htmlFor="reactivateOwnerId">
        <Select id="reactivateOwnerId" name="newOwnerId" defaultValue={teamMembers[0]?.id}>
          {teamMembers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Why relevant now" htmlFor="reactivateWhy" required hint="The new trigger — spec §46: reactivation needs a genuinely new reason">
        <Textarea id="reactivateWhy" name="whyRelevant" required rows={2} />
      </Field>
      {failure && <ErrorState title="Could not reactivate" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Create new lead from this"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Founder Escalation Queue (master-context spec §57) — the flag side. */
const ESCALATION_TYPES = [
  { value: "Commercial", label: "Commercial" },
  { value: "Technical", label: "Technical" },
  { value: "ClientIssue", label: "Client / prospect issue" },
  { value: "Attribution", label: "Attribution" },
  { value: "TeamIssue", label: "Team issue" },
  { value: "Other", label: "Other" },
] as const;
const ESCALATION_URGENCIES = ["Normal", "High", "Critical"] as const;

/**
 * Escalation goes to the Team Leader first, Company Core only if
 * unresolved (2026-09-13 hierarchical-architecture doc §38-39) — not a
 * straight line to Founders, which is what the copy said before.
 */
function EscalateForm({ leadId, onDone }: { leadId: string; onDone: () => void }) {
  const router = useRouter();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex w-full flex-col gap-3 rounded-[12px] bg-surface p-4 sm:w-[420px]"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setFailure(null);
        startTransition(async () => {
          const result = await runCommand(
            "verity.outreach.flag_escalation",
            {
              leadId,
              note: String(form.get("note") ?? ""),
              type: String(form.get("type") ?? ""),
              urgency: String(form.get("urgency") ?? ""),
            },
            `/outreach/${leadId}`,
          );
          if (result.ok) {
            onDone();
            router.refresh();
          } else {
            setFailure(result);
          }
        });
      }}
    >
      <Field label="Type" htmlFor="escalationType" required>
        <Select id="escalationType" name="type" required defaultValue="Other">
          {ESCALATION_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Urgency" htmlFor="escalationUrgency" required>
        <Select id="escalationUrgency" name="urgency" required defaultValue="Normal">
          {ESCALATION_URGENCIES.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="What does your Team Leader need to know?"
        htmlFor="escalationNote"
        required
        hint="Large deal, unusual technical requirement, Agency+Verity cross-sell, ..."
      >
        <Textarea id="escalationNote" name="note" required rows={2} />
      </Field>
      {failure && <ErrorState title="Could not escalate" message={failure.message} issues={failure.issues} retryable={failure.retryable} />}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Sending…" : "Escalate"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
