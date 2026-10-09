import { notFound } from "next/navigation";
import { withPageAccess } from "@/components/ui/PageAccess";
import { requireActor } from "@/server/platform/auth";
import { installCapabilities } from "@/server/capabilities/registry";
import { executeQuery } from "@/server/platform/query";
import { ForbiddenError } from "@/server/platform/authorization";
import { getKitchenTicket } from "@/server/capabilities/dinein";
import { PermissionDenied } from "@/components/ui/primitives";
import { TicketPrint } from "./TicketPrint";

export const dynamic = "force-dynamic";

const KIND_TITLE = { new: "New order", addition: "Added to order", void: "CANCELLED" } as const;

/**
 * One kitchen ticket as it prints on an 80 mm roll (ADR-041 item 5). Solid and
 * monochrome: a thermal printer has no colour and a frosted panel does not print.
 * `?auto=1` is how a station screen in auto-print mode opens it: it prints itself
 * and records the print, then stays quiet.
 */
async function TicketPage({ params, searchParams }: { params: Promise<{ ticketId: string }>; searchParams: Promise<{ auto?: string }> }) {
  installCapabilities();
  const { ticketId } = await params;
  const { auto } = await searchParams;
  const actor = await requireActor();

  let ticket: Awaited<ReturnType<typeof getKitchenTicket.handler>>;
  try {
    ticket = await executeQuery(actor, getKitchenTicket, { ticketId });
  } catch (error) {
    if (error instanceof ForbiddenError) return <PermissionDenied what="this ticket" />;
    throw error;
  }
  if (!ticket) notFound();

  const reprint = ticket.prints > 0;
  return (
    <div className="mx-auto w-full max-w-[80mm] bg-white p-3 font-mono text-[13px] leading-snug text-black print:max-w-none print:p-0">
      {ticket.kind === "void" && (
        <p className="m-0 mb-2 border-2 border-black p-1 text-center text-[16px] font-bold">CANCELLED: STOP MAKING THESE</p>
      )}
      {reprint && <p className="m-0 mb-1 text-center font-bold">REPRINT</p>}
      <div className="flex items-baseline justify-between">
        <span className="text-[22px] font-bold">{ticket.number}</span>
        <span>{ticket.stationName ?? "Kitchen"}</span>
      </div>
      <p className="m-0 text-[15px] font-bold">{ticket.label}</p>
      <p className="m-0">
        {KIND_TITLE[ticket.kind]}
        {ticket.covers > 0 && ticket.channel === "dine_in" ? ` · ${ticket.covers} cover${ticket.covers === 1 ? "" : "s"}` : ""}
      </p>
      <p className="m-0 mb-2">
        {ticket.createdAt.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
        {ticket.takenBy ? ` · ${ticket.takenBy}` : ""}
      </p>
      <hr className="my-1 border-black" />
      <ul className="m-0 list-none p-0">
        {ticket.lines.map((line, index) => (
          <li key={index} className="py-1">
            <span className="text-[16px] font-bold">{line.qty} × {line.itemName}</span>
            {line.variantName && <span> ({line.variantName})</span>}
            {line.courseName && <span className="block text-[12px]">{line.courseName}</span>}
            {line.modifiers.length > 0 && <span className="block font-bold">+ {line.modifiers.join(", ")}</span>}
            {line.lineNote && <span className="block">** {line.lineNote}</span>}
          </li>
        ))}
      </ul>
      <hr className="my-1 border-black" />
      <TicketPrint ticketId={ticket.id} auto={auto === "1"} alreadyPrinted={reprint} />
    </div>
  );
}

export default withPageAccess(TicketPage);
