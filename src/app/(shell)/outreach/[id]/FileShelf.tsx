import { Badge } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { ViewFileLink } from "./ResearchForm";

type ResearchEntry = { id: string; title: string; type: string; fileId: string | null; createdAt: Date };

/**
 * File shelf — Task 109 Phase G §3 ("grid/preview view over existing
 * uploaded research files"). Upload plumbing (`files.ts` two-phase upload,
 * `ResearchForm`) already exists and is untouched — this is UI-only, a
 * second, browsable view over the same file-bearing research entries the
 * timeline below already lists.
 */
export function FileShelf({ entries }: { entries: ResearchEntry[] }) {
  const files = entries.filter((e) => e.fileId);
  if (files.length === 0) return null;

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {files.map((f) => (
        <div key={f.id} className="flex flex-col gap-2 rounded-[12px] bg-surface-sunken p-3">
          <div className="flex size-10 items-center justify-center rounded-md bg-accent-subtle text-accent">
            <Icon name="evidence" size={20} />
          </div>
          <p className="m-0 truncate text-[13px] text-text" title={f.title}>
            {f.title}
          </p>
          <div className="flex items-center justify-between gap-2">
            <Badge>{f.type}</Badge>
            <span className="text-[12px] text-text-tertiary">{f.createdAt.toISOString().slice(0, 10)}</span>
          </div>
          <ViewFileLink entryId={f.id} label="Open" />
        </div>
      ))}
    </div>
  );
}
