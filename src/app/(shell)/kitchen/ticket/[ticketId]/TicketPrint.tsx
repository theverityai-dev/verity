"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";

/**
 * Prints the ticket and records that it was printed. Automatically when a station
 * screen opened it with `?auto=1` (once, even if the frame reloads), and on a tap
 * otherwise. The record is what makes a second print a reprint on the paper.
 */
export function TicketPrint({ ticketId, auto, alreadyPrinted }: { ticketId: string; auto: boolean; alreadyPrinted: boolean }) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const started = useRef(false);

  function print() {
    startTransition(async () => {
      const result = await runCommand<{ reprint: boolean }>("verity.dinein.record_ticket_print", { ticketId }, "/kitchen");
      if (!result.ok) {
        setNote(result.message);
        return;
      }
      setNote(result.data.reprint ? "Reprinted." : "Printed.");
      window.print();
    });
  }

  useEffect(() => {
    if (!auto || alreadyPrinted || started.current) return;
    started.current = true;
    print();
  }, []);

  if (auto) return null;
  return (
    <div className="mt-3 flex items-center gap-3 print:hidden">
      <Button variant="primary" onClick={print} disabled={pending}>
        {alreadyPrinted ? "Reprint" : "Print"}
      </Button>
      {note && <span className="text-[13px] text-text-secondary">{note}</span>}
    </div>
  );
}
