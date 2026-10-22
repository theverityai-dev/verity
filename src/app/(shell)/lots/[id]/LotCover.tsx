"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/primitives";
import { PhotoCapture } from "@/components/ui/PhotoCapture";

const LOT_ENTITY = "verity.piecework.lot";

/**
 * The lot's cover picture. The newest photograph taken for the lot becomes its cover on every card and screen that shows it; the
 * earlier ones stay as evidence. A phone opens its camera directly, a desktop offers the gallery.
 */
export function LotCover({ lotId, hasCover }: { lotId: string; hasCover: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (!open) {
    return <div><Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>{hasCover ? "Change the cover picture" : "Add a cover picture"}</Button></div>;
  }
  return (
    <div className="flex flex-col gap-2">
      <PhotoCapture
        entityKey={LOT_ENTITY}
        entityId={lotId}
        revalidate={`/lots/${lotId}`}
        onCaptured={(id) => { if (id) { setOpen(false); router.refresh(); } }}
      />
      <div><Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button></div>
    </div>
  );
}
