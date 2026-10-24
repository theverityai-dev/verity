"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CommandButton } from "@/components/ui/CommandAccess";
import { FormModal, useCommand } from "@/components/ui/CommandForm";
import { Button, Checkbox, Field, Input } from "@/components/ui/primitives";

const SPLIT = "verity.piecework.split_bundle";
const MERGE = "verity.piecework.merge_bundles";

/**
 * Re-bundling at the cutting table, offered only while nothing of this bundle has been given out (after that its pieces already move
 * in parts). Split shows the running total against the bundle's pieces; join lists the other untouched bundles of the same lot. Both
 * end on the lot's sheet of slips, because every new bundle needs its new slip.
 */
export function ReBundle({ bundleId, number, lotId, netPieces, sizeNote, siblings }: {
  bundleId: string; number: string; lotId: string; netPieces: number; sizeNote: string | null;
  siblings: Array<{ id: string; number: string; netPieces: number }>;
}) {
  const router = useRouter();
  const split = useCommand(`/lots/${lotId}`);
  const merge = useCommand(`/lots/${lotId}`);
  const [splitting, setSplitting] = useState(false);
  const [joining, setJoining] = useState(false);
  const half = Math.floor(netPieces / 2);
  const [parts, setParts] = useState([{ pieces: String(netPieces - half), size: sizeNote ?? "" }, { pieces: String(half), size: sizeNote ?? "" }]);
  const [picked, setPicked] = useState<string[]>([]);

  const counts = parts.map((p) => Number(p.pieces));
  const total = counts.reduce((s, n) => s + (Number.isInteger(n) && n > 0 ? n : 0), 0);
  const splitOk = parts.length >= 2 && counts.every((n) => Number.isInteger(n) && n >= 1) && total === netPieces;
  const joined = netPieces + siblings.filter((s) => picked.includes(s.id)).reduce((t, s) => t + s.netPieces, 0);

  return (
    <>
      <CommandButton commands={SPLIT} variant="secondary" onClick={() => { split.clear(); setSplitting(true); }}>Split</CommandButton>
      {siblings.length > 0 && <CommandButton commands={MERGE} variant="secondary" onClick={() => { merge.clear(); setJoining(true); }}>Join with…</CommandButton>}

      <FormModal
        open={splitting} onClose={() => setSplitting(false)}
        title={`Split ${number}`} description={`Into bundles that add up to its ${netPieces} pieces. ${number} is cancelled and each part gets its own number and slip.`}
        submitLabel={`Split into ${parts.length}`} pendingLabel="Splitting…" submitDisabled={!splitOk}
        pending={split.pending} failure={split.failure} failureTitle="The bundle was not split"
        onSubmit={() => split.run(SPLIT, { bundleId, parts: parts.map((p) => ({ netPieces: Number(p.pieces), sizeNote: p.size.trim() || undefined })) }, () => router.push(`/lots/${lotId}/slips`))}
      >
        {parts.map((p, i) => (
          <div key={i} className="grid grid-cols-[1fr_1.4fr_auto] items-end gap-2">
            <Field label={`Part ${i + 1} pieces`} htmlFor={`sp-n-${i}`}><Input id={`sp-n-${i}`} type="number" inputMode="numeric" min={1} step={1} value={p.pieces} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, pieces: e.target.value } : x)))} /></Field>
            <Field label="Size note" htmlFor={`sp-s-${i}`}><Input id={`sp-s-${i}`} maxLength={200} value={p.size} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, size: e.target.value } : x)))} /></Field>
            <Button type="button" variant="ghost" size="sm" aria-label={`Remove part ${i + 1}`} disabled={parts.length <= 2} onClick={() => setParts(parts.filter((_, j) => j !== i))}>Remove</Button>
          </div>
        ))}
        <div><Button type="button" variant="secondary" size="sm" disabled={parts.length >= 20} onClick={() => setParts([...parts, { pieces: "", size: sizeNote ?? "" }])}>Another part</Button></div>
        <p role="status" className="m-0 rounded-[12px] bg-[var(--color-control)] px-4 py-3 text-[15px] font-medium text-text">
          {total} of {netPieces} pieces{total === netPieces ? "" : total < netPieces ? ` · ${netPieces - total} still to place` : ` · ${total - netPieces} too many`}
        </p>
      </FormModal>

      <FormModal
        open={joining} onClose={() => setJoining(false)}
        title={`Join ${number} with other bundles`} description="Only bundles of this lot that have not been given out are listed. They are cancelled and one new bundle takes their pieces."
        submitLabel={`Join into one bundle of ${joined}`} pendingLabel="Joining…" submitDisabled={picked.length === 0}
        pending={merge.pending} failure={merge.failure} failureTitle="The bundles were not joined"
        onSubmit={() => merge.run(MERGE, { bundleIds: [bundleId, ...picked] }, () => router.push(`/lots/${lotId}/slips`))}
      >
        <div className="flex flex-col gap-1">
          {siblings.map((s) => (
            <Checkbox key={s.id} label={`${s.number} · ${s.netPieces} pieces`} checked={picked.includes(s.id)}
              onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))} />
          ))}
        </div>
      </FormModal>
    </>
  );
}
