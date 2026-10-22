"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Button, Field, Input, StateBadge, Textarea } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { FormModal, formText, useCommand } from "@/components/ui/CommandForm";
import { runCommand } from "@/server/actions/platform";
import { STATUS_CATEGORY, STATUS_LABEL, expiryText } from "../format";

export type RevisionView = {
  id: string;
  label: string;
  status: string;
  changeReason: string | null;
  reviewNote: string | null;
  obsoleteReason: string | null;
  effectiveFrom: string | null;
  validUntil: string | null;
  expiry: string;
  selfApprovalReason: string | null;
  mine: boolean;
  author: string | null;
  submittedBy: string | null;
  approvedBy: string | null;
  releasedAt: string | null;
  file: { name: string; size: number } | null;
};

const REVALIDATE = "/documents";
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx";
const MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const size = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : null);

/** Choose a file and store it on a draft revision through the platform's two-phase upload. */
function AttachFile({ revisionId, hasFile, onDone }: { revisionId: string; hasFile: boolean; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ phase: "idle" } | { phase: "working" } | { phase: "error"; message: string }>({ phase: "idle" });

  async function upload(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const mimeType = MIME[ext];
    if (!mimeType) return setState({ phase: "error", message: "Use a PDF, an image, or a Word or Excel file." });
    setState({ phase: "working" });
    try {
      const bytes = await file.arrayBuffer();
      const reserved = await runCommand<{ fileId: string; uploadUrl?: string; uploadHeaders?: Record<string, string> }>("verity.document.reserve_file", {
        revisionId, fileName: file.name, mimeType, byteSize: file.size,
      });
      if (!reserved.ok) return setState({ phase: "error", message: reserved.message });
      if (!reserved.data.uploadUrl) return setState({ phase: "error", message: "File storage is not set up on this server." });
      const put = await fetch(reserved.data.uploadUrl, { method: "PUT", headers: reserved.data.uploadHeaders ?? { "content-type": mimeType }, body: bytes });
      if (!put.ok) return setState({ phase: "error", message: `The upload did not go through (${put.status}). Try again.` });
      const attached = await runCommand<{ status: "Stored" | "Quarantined" }>(
        "verity.document.attach_file",
        { revisionId, fileId: reserved.data.fileId, checksum: await sha256Hex(bytes), byteSize: file.size },
        REVALIDATE,
      );
      if (!attached.ok) return setState({ phase: "error", message: attached.message });
      if (attached.data.status !== "Stored") return setState({ phase: "error", message: "The file did not match what was sent. Choose it again." });
      setState({ phase: "idle" });
      onDone();
    } catch (e) {
      setState({ phase: "error", message: e instanceof Error ? e.message : "Could not upload that file." });
    }
  }

  return (
    <>
      <input ref={input} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
      <CommandButton commands="verity.document.reserve_file" size="sm" variant="secondary" disabled={state.phase === "working"} onClick={() => input.current?.click()}>
        <Icon name="plus" size={16} /> {state.phase === "working" ? "Uploading…" : hasFile ? "Replace file" : "Attach file"}
      </CommandButton>
      {state.phase === "error" && <p role="alert" className="m-0 w-full text-[13px] text-[var(--color-danger-ink)]">{state.message}</p>}
    </>
  );
}

/** One revision as a card: what it is, who did what, and the next thing that can be done to it. */
function RevisionCard({ documentId, revision, isCurrent, canSelfRelease, hasOpenRevision }: {
  documentId: string;
  revision: RevisionView;
  isCurrent: boolean;
  canSelfRelease: boolean;
  hasOpenRevision: boolean;
}) {
  const router = useRouter();
  const command = useCommand(REVALIDATE);
  const [dialog, setDialog] = useState<null | "approve" | "reject" | "obsolete" | "new">(null);
  const [notice, setNotice] = useState<string | null>(null);
  const close = () => { setDialog(null); command.clear(); };
  const r = revision;

  async function open(action: "open" | "download") {
    setNotice(null);
    const result = await runCommand<{ url: string | null; banner: string | null }>("verity.document.open", { revisionId: r.id, action }, REVALIDATE);
    if (!result.ok) return setNotice(result.message);
    if (!result.data.url) return setNotice("The file store is not connected on this server, so the file cannot be opened here. The opening was still logged.");
    window.open(result.data.url, "_blank", "noopener,noreferrer");
    router.refresh();
  }

  const mustGiveReason = r.mine;
  const blockedFromOwn = mustGiveReason && !canSelfRelease;

  return (
    <li className="rounded-[12px] bg-[var(--color-surface-sunken)] p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="figure text-[22px] leading-[26px] text-text">{r.label}</span>
        <StateBadge category={STATUS_CATEGORY[r.status] ?? "Draft"} label={STATUS_LABEL[r.status] ?? r.status} />
        {isCurrent && <span className="rounded-full bg-[var(--color-control)] px-2.5 py-0.5 text-[12px] font-semibold text-text-secondary">Current</span>}
        {r.status === "released" && (
          <span className={`text-[13px] font-medium ${r.expiry === "expired" ? "text-[var(--color-danger-ink)]" : "text-text-secondary"}`}>{expiryText(r.expiry, r.validUntil)}</span>
        )}
      </div>

      <dl className="m-0 mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[14px]">
        {r.changeReason && (<><dt className="text-text-tertiary">Why</dt><dd className="m-0">{r.changeReason}</dd></>)}
        {r.author && (<><dt className="text-text-tertiary">Written by</dt><dd className="m-0">{r.author}</dd></>)}
        {r.submittedBy && (<><dt className="text-text-tertiary">Submitted by</dt><dd className="m-0">{r.submittedBy}</dd></>)}
        {r.approvedBy && (
          <>
            <dt className="text-text-tertiary">Released by</dt>
            <dd className="m-0">{r.approvedBy}{r.releasedAt ? ` on ${when(r.releasedAt)}` : ""}</dd>
          </>
        )}
        {r.selfApprovalReason && (<><dt className="text-text-tertiary">Own work, because</dt><dd className="m-0">{r.selfApprovalReason}</dd></>)}
        {r.effectiveFrom && (<><dt className="text-text-tertiary">In force from</dt><dd className="m-0">{when(r.effectiveFrom)}</dd></>)}
        {r.reviewNote && (<><dt className="text-text-tertiary">Sent back</dt><dd className="m-0">{r.reviewNote}</dd></>)}
        {r.obsoleteReason && (<><dt className="text-text-tertiary">Withdrawn because</dt><dd className="m-0">{r.obsoleteReason}</dd></>)}
        <dt className="text-text-tertiary">File</dt>
        <dd className="m-0">{r.file ? `${r.file.name} · ${size(r.file.size)}` : r.status === "draft" ? "Not attached yet" : "—"}</dd>
      </dl>

      {r.status === "superseded" && (
        <p className="m-0 mt-2 rounded-[10px] bg-[var(--color-control)] px-3 py-2 text-[13px] text-text-secondary">
          Superseded: a newer revision is in force. Kept so you can see what a job relied on.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {r.status === "draft" && (
          <>
            <AttachFile revisionId={r.id} hasFile={r.file !== null} onDone={() => router.refresh()} />
            <CommandButton commands="verity.document.submit" size="sm" variant="primary" disabled={command.pending || !r.file} title={r.file ? undefined : "Attach the file first"}
              onClick={() => command.run("verity.document.submit", { revisionId: r.id })}>
              Submit for release
            </CommandButton>
          </>
        )}
        {r.status === "in_review" && (
          <>
            <CommandButton commands="verity.document.approve" size="sm" variant="primary" disabled={command.pending || blockedFromOwn} title={blockedFromOwn ? "You wrote or submitted this; another person releases it" : undefined}
              onClick={() => setDialog("approve")}>
              Release
            </CommandButton>
            <CommandButton commands="verity.document.reject" size="sm" variant="secondary" disabled={command.pending} onClick={() => setDialog("reject")}>Send back</CommandButton>
          </>
        )}
        {r.file && r.status !== "draft" && (
          <>
            <Button size="sm" variant="secondary" onClick={() => void open("open")}><Icon name="evidence" size={16} /> Open</Button>
            <Button size="sm" variant="ghost" onClick={() => void open("download")}>Download</Button>
          </>
        )}
        {r.status === "released" && !hasOpenRevision && (
          <CommandButton commands="verity.document.start_revision" size="sm" variant="secondary" onClick={() => setDialog("new")}>New revision</CommandButton>
        )}
        {r.status === "released" && (
          <CommandButton commands="verity.document.obsolete" size="sm" variant="ghost" onClick={() => setDialog("obsolete")}>Withdraw</CommandButton>
        )}
      </div>
      {notice && <p role="status" className="m-0 mt-2 text-[13px] text-text-secondary">{notice}</p>}
      {!dialog && command.failure && <p role="alert" className="m-0 mt-2 text-[13px] text-[var(--color-danger-ink)]">{command.failure.message}</p>}

      <FormModal title={`Release ${r.label}`} description="It becomes the current revision. The one in force now, if any, is superseded." open={dialog === "approve"} onClose={close}
        submitLabel="Release" pending={command.pending} failure={command.failure} failureTitle="Could not release"
        onSubmit={(form) => command.run("verity.document.approve", {
          revisionId: r.id,
          ...(formText(form, "effectiveFrom") ? { effectiveFrom: formText(form, "effectiveFrom") } : {}),
          ...(formText(form, "validUntil") ? { validUntil: formText(form, "validUntil") } : {}),
          ...(mustGiveReason ? { selfApprovalReason: formText(form, "reason") } : {}),
        }, close)}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="In force from" htmlFor={`eff-${r.id}`} hint="Empty means today."><Input id={`eff-${r.id}`} name="effectiveFrom" type="date" /></Field>
          <Field label="Valid until" htmlFor={`val-${r.id}`} hint="Empty uses the type's validity."><Input id={`val-${r.id}`} name="validUntil" type="date" /></Field>
        </div>
        {mustGiveReason && (
          <Field label="Why you are releasing your own work" htmlFor={`own-${r.id}`} required hint="Recorded with the release.">
            <Textarea id={`own-${r.id}`} name="reason" rows={3} required minLength={10} maxLength={500} />
          </Field>
        )}
      </FormModal>

      <FormModal title={`Send ${r.label} back`} description="It returns to draft with your note, for the author to fix." open={dialog === "reject"} onClose={close}
        submitLabel="Send back" pending={command.pending} failure={command.failure} failureTitle="Could not send it back"
        onSubmit={(form) => command.run("verity.document.reject", { revisionId: r.id, reviewNote: formText(form, "note") }, close)}>
        <Field label="What needs fixing" htmlFor={`note-${r.id}`} required><Textarea id={`note-${r.id}`} name="note" rows={3} required minLength={3} maxLength={500} autoFocus /></Field>
      </FormModal>

      <FormModal title={`Withdraw ${r.label}`} description="The document has no current revision until another is released. This stays on record." open={dialog === "obsolete"} onClose={close}
        submitLabel="Withdraw" destructive pending={command.pending} failure={command.failure} failureTitle="Could not withdraw"
        onSubmit={(form) => command.run("verity.document.obsolete", { revisionId: r.id, reason: formText(form, "reason") }, close)}>
        <Field label="Why" htmlFor={`why-${r.id}`} required><Textarea id={`why-${r.id}`} name="reason" rows={3} required minLength={3} maxLength={500} autoFocus /></Field>
      </FormModal>

      <FormModal title="New revision" description="A change is a new revision with a reason. The current one stays in force until the new one is released." open={dialog === "new"} onClose={close}
        submitLabel="Start revision" pending={command.pending} failure={command.failure} failureTitle="Could not start a revision"
        onSubmit={(form) => command.run("verity.document.start_revision", { documentId, changeReason: formText(form, "reason") }, close)}>
        <Field label="What is changing, and why" htmlFor={`rev-${r.id}`} required><Textarea id={`rev-${r.id}`} name="reason" rows={3} required minLength={3} maxLength={500} autoFocus /></Field>
      </FormModal>
    </li>
  );
}

/** The revision journey, newest first. */
export function RevisionPanel({ documentId, revisions, currentRevisionId, canSelfRelease }: {
  documentId: string;
  revisions: RevisionView[];
  currentRevisionId: string | null;
  canSelfRelease: boolean;
}) {
  const hasOpenRevision = revisions.some((r) => r.status === "draft" || r.status === "in_review");
  return (
    <ol className="m-0 flex list-none flex-col gap-3 p-0">
      {revisions.map((r) => (
        <RevisionCard key={r.id} documentId={documentId} revision={r} isCurrent={r.id === currentRevisionId} canSelfRelease={canSelfRelease} hasOpenRevision={hasOpenRevision} />
      ))}
    </ol>
  );
}
