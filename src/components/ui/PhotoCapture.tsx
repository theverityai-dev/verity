"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { runCommand } from "@/server/actions/platform";

type State =
  | { phase: "empty" }
  | { phase: "working"; preview: string }
  | { phase: "done"; preview: string }
  | { phase: "error"; message: string };

const MAX_EDGE = 1600;

/** Phone photographs are large; scale to a working size and re-encode as JPEG (also normalises HEIC). */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("Could not read that photo.");
  return blob;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Take or choose a photograph and store it as Evidence about one record. The phone camera opens directly; the
 * bytes go through the platform's two-phase upload (reserve, PUT, confirm), so the evidence row exists only once
 * the stored file has been verified. `onCaptured` receives the evidence id, or null after the photo is removed.
 */
export function PhotoCapture({
  entityKey,
  entityId,
  revalidate,
  required,
  onCaptured,
}: {
  entityKey: string;
  entityId: string;
  revalidate: string;
  required?: boolean;
  onCaptured: (evidenceId: string | null) => void;
}) {
  const [state, setState] = useState<State>({ phase: "empty" });
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const previewUrl = useRef<string | null>(null);

  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);

  async function upload(file: File) {
    try {
      const blob = await shrink(file);
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      const preview = URL.createObjectURL(blob);
      previewUrl.current = preview;
      setState({ phase: "working", preview });
      onCaptured(null);

      const reserved = await runCommand<{ fileId: string; uploadUrl?: string; uploadHeaders?: Record<string, string> }>("verity.evidence.reserve_file", {
        entityKey, entityId, fileName: `photo-${Date.now()}.jpg`, mimeType: "image/jpeg", byteSize: blob.size,
      });
      if (!reserved.ok) return setState({ phase: "error", message: reserved.message });
      if (!reserved.data.uploadUrl) return setState({ phase: "error", message: "File storage is not set up on this server." });

      const bytes = await blob.arrayBuffer();
      const put = await fetch(reserved.data.uploadUrl, { method: "PUT", headers: reserved.data.uploadHeaders ?? { "content-type": "image/jpeg" }, body: bytes });
      if (!put.ok) return setState({ phase: "error", message: `The upload did not go through (${put.status}). Try again.` });

      const stored = await runCommand<{ id: string | null; status: "Stored" | "Quarantined" }>(
        "verity.evidence.capture_file",
        { entityKey, entityId, fileId: reserved.data.fileId, checksum: await sha256Hex(bytes), byteSize: blob.size, capturedAt: new Date().toISOString() },
        revalidate,
      );
      if (!stored.ok) return setState({ phase: "error", message: stored.message });
      if (stored.data.status !== "Stored" || !stored.data.id) return setState({ phase: "error", message: "The photo did not match what was sent. Take it again." });
      setState({ phase: "done", preview });
      onCaptured(stored.data.id);
    } catch (e) {
      setState({ phase: "error", message: e instanceof Error ? e.message : "Could not use that photo." });
    }
  }

  const pick = (file: File | undefined) => { if (file) void upload(file); };
  const clear = () => { setState({ phase: "empty" }); onCaptured(null); };
  const busy = state.phase === "working";

  return (
    <div className="flex flex-col gap-2">
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={libraryRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />

      {(state.phase === "working" || state.phase === "done") && (
        <div className="flex items-center gap-3 rounded-[12px] bg-surface-sunken p-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview, not a hosted image */}
          <img src={state.preview} alt="The photo you took" className="size-16 shrink-0 rounded-[8px] object-cover" />
          <div className="min-w-0 flex-1" role="status">
            <p className="m-0 text-[14px] font-semibold text-text">{busy ? "Saving photo…" : "Photo saved"}</p>
            <p className="m-0 text-[13px] text-text-secondary">{busy ? "Keep this open until it finishes." : "It is stored as evidence for this record."}</p>
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={clear} disabled={busy}>Remove</Button>
        </div>
      )}

      {state.phase === "error" && (
        <p role="alert" className="m-0 rounded-[10px] bg-danger-subtle px-3 py-2 text-[13px] text-[var(--color-danger-ink)]">{state.message}</p>
      )}

      {(state.phase === "empty" || state.phase === "error") && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => cameraRef.current?.click()}>
            <Icon name="photo" size={16} /> {required ? "Take photo (required)" : "Take photo"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => libraryRef.current?.click()}>Choose from gallery</Button>
        </div>
      )}
    </div>
  );
}
