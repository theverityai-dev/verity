"use client";

import { useState, useTransition } from "react";
import { Badge, Button, Select, Textarea } from "@/components/ui/primitives";
import { runCommand, runQuery } from "@/server/actions/platform";

type Note = { id: string; content: string; visibility: string; createdAt: string };

/**
 * Coaching notes for one member (Task 106 Phase 6, spec §79). Expands
 * inline from the member row — append-only, so this is a running log,
 * not an editable field.
 */
export function CoachingNotePanel({ teamId, aboutPartyId, aboutName }: { teamId: string; aboutPartyId: string; aboutName: string }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (!loaded) {
      startTransition(async () => {
        const result = await runQuery<Note[]>("verity.outreach.list_coaching_notes", { teamId, aboutPartyId });
        if (result.ok) setNotes(result.data);
        setLoaded(true);
      });
    }
  }

  return (
    <div className="mt-2">
      <Button size="sm" variant="secondary" onClick={toggle}>
        Coaching notes
      </Button>
      {open && (
        <div className="mt-2 flex flex-col gap-3 rounded-[12px] bg-surface-sunken p-3">
          {pending && <p className="m-0 text-[12px] text-text-tertiary">Loading…</p>}
          {!pending && notes.length === 0 && <p className="m-0 text-[12px] text-text-tertiary">No notes yet about {aboutName}.</p>}
          {notes.map((n) => (
            <div key={n.id} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Badge>{n.visibility === "LeaderPrivate" ? "Private" : "Visible to them"}</Badge>
                <span className="text-[12px] text-text-tertiary">{new Date(n.createdAt).toISOString().slice(0, 10)}</span>
              </div>
              <p className="m-0 text-[13px] text-text-secondary">{n.content}</p>
            </div>
          ))}

          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              const content = String(form.get("content") ?? "");
              if (!content.trim()) return;
              startTransition(async () => {
                const result = await runCommand("verity.outreach.create_coaching_note", {
                  teamId,
                  aboutPartyId,
                  content,
                  visibility: String(form.get("visibility") ?? "JuniorVisible"),
                });
                if (result.ok) {
                  const refreshed = await runQuery<Note[]>("verity.outreach.list_coaching_notes", { teamId, aboutPartyId });
                  if (refreshed.ok) setNotes(refreshed.data);
                  e.currentTarget.reset();
                }
              });
            }}
          >
            <Textarea name="content" rows={2} placeholder={`Add a note about ${aboutName}…`} />
            <div className="flex items-center gap-2">
              <Select name="visibility" defaultValue="JuniorVisible" className="w-auto">
                <option value="JuniorVisible">Visible to them</option>
                <option value="LeaderPrivate">Private (leader only)</option>
              </Select>
              <Button size="sm" type="submit" disabled={pending}>
                Add note
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
