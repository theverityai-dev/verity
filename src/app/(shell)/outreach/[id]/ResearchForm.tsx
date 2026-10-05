"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorState, Field, Input, Panel, Select, Textarea } from "@/components/ui/primitives";
import { runCommand, runQuery } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

const FILE_TYPES = ["Pdf", "Docx", "Spreadsheet", "Presentation", "Image", "Screenshot", "Other"] as const;

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Add a research entry (Task 106 Phase 4, spec §26-29). Three modes — Write
 * Note, Add URL, Upload File — one toggle-open form like `ContactForm`/
 * `NewLeadForm`. File uploads go through the platform's real two-phase
 * contract (reserve → PUT bytes → confirm), not a mocked single call.
 */
export function ResearchForm({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"Note" | "Url" | "File">("Note");
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        + Add research
      </Button>
    );
  }

  async function handleFileUpload(form: FormData) {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setFailure({ ok: false, code: "E_VALIDATION", message: "Choose a file first.", retryable: false });
      return;
    }
    setUploading(true);
    setFailure(null);
    try {
      const reserved = await runCommand<{ fileId: string; uploadUrl?: string }>(
        "verity.outreach.reserve_research_file",
        { leadId, fileName: file.name, mimeType: file.type || "application/octet-stream", byteSize: file.size },
      );
      if (!reserved.ok) {
        setFailure(reserved);
        return;
      }
      if (!reserved.data.uploadUrl) {
        setFailure({
          ok: false,
          code: "E_UNKNOWN",
          message: "File storage is not configured on this deployment.",
          retryable: false,
        });
        return;
      }

      const bytes = await file.arrayBuffer();
      const putResponse = await fetch(reserved.data.uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: bytes,
      });
      if (!putResponse.ok) {
        setFailure({ ok: false, code: "E_UNKNOWN", message: `Upload failed (${putResponse.status}).`, retryable: true });
        return;
      }

      const checksum = await sha256Hex(bytes);
      const confirmed = await runCommand<{ id: string; status: "Stored" | "Quarantined" }>(
        "verity.outreach.confirm_research_file",
        {
          leadId,
          fileId: reserved.data.fileId,
          checksum,
          byteSize: file.size,
          type: String(form.get("fileType") ?? "Other"),
          title: String(form.get("title") ?? file.name),
        },
        `/outreach/${leadId}`,
      );
      if (!confirmed.ok) {
        setFailure(confirmed);
        return;
      }
      if (confirmed.data.status === "Quarantined") {
        setFailure({
          ok: false,
          code: "E_VALIDATION",
          message: "Upload didn't match the declared file size and was quarantined. Try again.",
          retryable: true,
        });
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setUploading(false);
    }
  }

  return (
    <Panel title="Add research" className="mt-4">
      <div className="mb-4 flex gap-2">
        {(["Note", "Url", "File"] as const).map((m) => (
          <Button key={m} size="sm" variant={mode === m ? "primary" : "secondary"} type="button" onClick={() => setMode(m)}>
            {m === "Url" ? "Add URL" : m === "File" ? "Upload file" : "Write note"}
          </Button>
        ))}
      </div>

      {mode !== "File" ? (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setFailure(null);
            startTransition(async () => {
              const result = await runCommand(
                "verity.outreach.create_research_note",
                {
                  leadId,
                  type: mode,
                  title: String(form.get("title") ?? ""),
                  content: String(form.get("content") ?? "") || undefined,
                  sourceUrl: String(form.get("sourceUrl") ?? "") || undefined,
                },
                `/outreach/${leadId}`,
              );
              if (result.ok) {
                setOpen(false);
                router.refresh();
              } else {
                setFailure(result);
              }
            });
          }}
        >
          <Field label="Title" htmlFor="title" required>
            <Input id="title" name="title" required />
          </Field>
          {mode === "Url" && (
            <Field label="URL" htmlFor="sourceUrl" required>
              <Input id="sourceUrl" name="sourceUrl" type="url" required placeholder="https://…" />
            </Field>
          )}
          <Field label={mode === "Url" ? "Notes" : "Content"} htmlFor="content">
            <Textarea id="content" name="content" rows={3} />
          </Field>
          {failure && (
            <ErrorState title="Could not save research" message={failure.message} issues={failure.issues} retryable={failure.retryable} />
          )}
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            void handleFileUpload(form);
          }}
        >
          <Field label="File" htmlFor="researchFile" required>
            <input
              ref={fileInputRef}
              id="researchFile"
              type="file"
              className="bg-control w-full rounded-[10px] px-4 py-2.5 text-[14px] text-text"
            />
          </Field>
          <Field label="Title" htmlFor="title" required>
            <Input id="title" name="title" required />
          </Field>
          <Field label="Type" htmlFor="fileType">
            <Select id="fileType" name="fileType" defaultValue="Other">
              {FILE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          {failure && (
            <ErrorState title="Could not upload file" message={failure.message} issues={failure.issues} retryable={failure.retryable} />
          )}
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={uploading}>
              {uploading ? "Uploading…" : "Upload"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}

/** Opens a signed, short-lived read URL for a research entry's file — never a stored/cached URL. */
export function ViewFileLink({ entryId, label = "View file" }: { entryId: string; label?: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          setError(null);
          const result = await runQuery<{ url: string }>("verity.outreach.research_file_url", { entryId });
          if (result.ok) {
            window.open(result.data.url, "_blank", "noopener,noreferrer");
          } else {
            setError(result.message);
          }
        })
      }
      className="text-[12px] text-accent-ink underline underline-offset-4 hover:text-accent disabled:opacity-50"
    >
      {pending ? "Opening…" : error ? "Retry" : label}
    </button>
  );
}
