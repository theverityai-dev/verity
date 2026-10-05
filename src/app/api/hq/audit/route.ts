import { NextResponse } from "next/server";
import { platformAudit, resolveOperator } from "@/server/platform/operator";

export const dynamic = "force-dynamic";

/**
 * The platform audit as a CSV file (HQ audit C2: exportable evidence).
 *
 * Exactly the rows `/hq/audit` shows, from the same read-only projection
 * (ADR-013 projection 3): metadata only, never record contents. Operator-only;
 * anyone else gets 404, because a distinguishable "forbidden" would confirm the
 * endpoint exists.
 */
export async function GET(): Promise<Response> {
  const operator = await resolveOperator();
  if (!operator) return new NextResponse("Not found", { status: 404 });

  const rows = await platformAudit(operator, 500);
  const cell = (value: string | null | undefined) => {
    const text = value ?? "";
    // Quote every field and neutralise spreadsheet formulas (CSV injection).
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const header = ["occurred_at_utc", "client", "entity", "field_changed", "command", "actor", "actor_user_id"];
  const lines = rows.map((r) =>
    [
      r.occurredAt.toISOString(),
      r.tenantName,
      r.entityKey,
      r.fieldChanged,
      r.commandKey,
      r.isOperator ? "Operator" : "Client user",
      r.actorUserId,
    ]
      .map(cell)
      .join(","),
  );
  const body = [header.join(","), ...lines].join("\r\n") + "\r\n";
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="verity-platform-audit-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
