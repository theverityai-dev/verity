import { EmptyState } from "@/components/ui/primitives";

/**
 * Field-level change history for one record (§17).
 *
 * This is the *operational* stream — what changed on this record. It is
 * deliberately not the security stream, which answers a different question
 * ("whose permissions moved") for a different audience, and mixing them would
 * put authentication events in front of an operator who cannot act on them.
 *
 * COMPOSITION
 * Renders bare — no surface of its own — so the caller decides the container.
 * It is always shown inside a `Panel`, and a card nested directly inside a card
 * produces a double border that reads as a rendering mistake.
 *
 * Each entry leads with the field, because that is what the reader is scanning
 * for. The old value recedes; the new value holds full ink (no strikethrough:
 * a change is not a deletion). The command key sits last in mono at the smallest size — it matters when
 * you are tracing a change back to its cause and is noise the rest of the time.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-14T19:03:00.000Z" -> "14 Oct 2026, 19:03". Kept in the stored (UTC) clock so it never differs between server and browser. */
function whenText(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}, ${m[4]}:${m[5]}`;
}

/** A stored key read as a person would say it: "in_progress" -> "in progress". */
function plain(value: string): string {
  return value.replace(/_/g, " ");
}

export function AuditTrail({
  entries,
}: {
  entries: Array<{
    id: string;
    field: string;
    from: string | null;
    to: string | null;
    at: string;
    command: string | null;
  }>;
}) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="No recorded changes"
        description="History begins when a command modifies this record."
      />
    );
  }

  return (
    <ol className="m-0 list-none divide-y divide-line p-0">
      {entries.map((entry) => (
        <li key={entry.id} className="px-5 py-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-medium capitalize text-text">{plain(entry.field)}</span>
            <time dateTime={entry.at} className="tabular shrink-0 text-[12px] text-text-tertiary">
              {whenText(entry.at)}
            </time>
          </div>
          {/* The spaces around the arrow are literal, not margins. This line is
              read, copied and asserted on as one string, and styling the gap
              instead of writing it collapses the text content to
              "in_service→maintenance". The arrow is not aria-hidden either:
              direction is the meaning here, not decoration. */}
          <p className="m-0 mt-1 text-[13px] leading-relaxed">
            <span className="text-text-tertiary">{entry.from ? plain(entry.from) : "empty"}</span>
            <span className="text-text-tertiary">{" → "}</span>
            <span className="font-medium text-text">{entry.to ? plain(entry.to) : "empty"}</span>
          </p>
          {entry.command && (
            <p className="m-0 mt-1 font-mono text-[11.5px] text-text-tertiary">{entry.command}</p>
          )}
        </li>
      ))}
    </ol>
  );
}
