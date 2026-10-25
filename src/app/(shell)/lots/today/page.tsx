import Link from "next/link";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_ENTRY, ENTITY_PIECEWORK_LOT, ENTITY_PIECEWORK_ROLL, PIECEWORK_CAPABILITY, dayRecap, listRolls, readyStock } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { Surface, PageHeader, PermissionDenied } from "@/components/ui/primitives";
import { shortDate } from "../format";
import { DayPicker } from "./DayPicker";

export const dynamic = "force-dynamic";

/**
 * Today: the factory's day in a few figures, to read at the end of it (or any earlier day). What was given out and taken back, what came back
 * short, what is late, what waits for a decision, what left as ready stock. Every figure that needs a look is a link to where it is handled.
 * No wage, rate or balance. It is the day-close summary underneath, so it can never disagree with a supervisor's closed day.
 */
async function TodayPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  installCapabilities();
  const actor = await requireActor();
  const { date } = await searchParams;
  const { canEntry, canLot, canRolls } = await withTenant(actor.tenantId, async (tx) => ({
    canEntry: await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_ENTRY),
    canLot: await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_LOT),
    canRolls: await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_ROLL),
  }));
  if (!canEntry) return <PermissionDenied what="the day's summary" />;
  const recap = await executeQuery(actor, dayRecap, { date: /^\d{4}-\d{2}-\d{2}$/.test(date ?? "") ? date : undefined });
  const [stock, rolls] = await Promise.all([canLot ? executeQuery(actor, readyStock, {}) : null, canRolls ? executeQuery(actor, listRolls, {}) : null]);
  const isToday = recap.date === recap.today;
  const look = [
    recap.late.length > 0 && { href: "/shopfloor/custody", label: `${recap.late.length} bundle${recap.late.length === 1 ? "" : "s"} late`, detail: "Past their return date and still out" },
    recap.openShortages > 0 && { href: "/shopfloor/cases", label: `${recap.openShortages} open case${recap.openShortages === 1 ? "" : "s"}`, detail: "Short pieces not yet settled" },
    recap.pendingApprovals > 0 && { href: "/shopfloor/approvals", label: `${recap.pendingApprovals} waiting for a decision`, detail: "Charges, write-offs and holds" },
    rolls && rolls.low.length > 0 && { href: "/fabric", label: `${rolls.low.length} fabric${rolls.low.length === 1 ? "" : "s"} running low`, detail: rolls.low.map((l) => l.fabricType).slice(0, 3).join(", ") },
  ].filter((x): x is { href: string; label: string; detail: string } => Boolean(x));
  const figures: Array<[string, number]> = [["Given out", recap.given], ["Taken back", recap.takenBack], ["Good", recap.good], ["Short", recap.short]];

  return (
    <>
      <PageHeader
        title={isToday ? "Today" : "The day"}
        description={`${new Date(`${recap.date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}${recap.stages.length > 0 ? ` · ${recap.stages.join(", ")}` : ""}`}
        actions={<DayPicker date={recap.date} today={recap.today} />}
      />

      <ul className="m-0 mb-6 grid list-none gap-3 p-0" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))" }}>
        {figures.map(([label, value]) => (
          <li key={label} className="list-none">
            <Surface className="flex h-full flex-col gap-1 p-5">
              <p className="micro m-0">{label}</p>
              <p className="figure tabular m-0 text-[40px] leading-[44px] text-text" style={label === "Short" && value > 0 ? { color: "var(--color-state-pending-ink)" } : undefined}>{value.toLocaleString("en-IN")}</p>
              <p className="m-0 text-[13px] text-text-secondary">{label === "Taken back" ? `${recap.rejected} rejected, ${recap.rework} for rework` : "pieces"}</p>
            </Surface>
          </li>
        ))}
      </ul>

      <h2 className="micro m-0 mb-3 px-1">{isToday ? "Needs a look now" : "Open on the day it is read"}</h2>
      {look.length === 0 ? (
        <Surface className="mb-6 p-5"><p className="m-0 text-[15px] text-text-secondary">Nothing needs a look: nothing late, no open case, nothing waiting for a decision.</p></Surface>
      ) : (
        <ul className="m-0 mb-6 grid list-none gap-3 p-0" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))" }}>
          {look.map((x) => (
            <li key={x.href} className="list-none">
              <Link href={x.href} className="block no-underline transition-transform duration-150 hover:-translate-y-px active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]">
                <Surface className="flex h-full flex-col gap-1 p-5">
                  <p className="m-0 text-[17px] font-medium leading-[22px] tracking-[-0.02em] text-text">{x.label}</p>
                  <p className="m-0 text-[13px] leading-[19px] text-text-secondary">{x.detail}</p>
                </Surface>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {recap.late.length > 0 && (
        <section className="mb-6" aria-label="Late bundles">
          <h2 className="micro m-0 mb-3 px-1">Late</h2>
          <Surface className="p-0">
            <ul className="m-0 flex list-none flex-col divide-y divide-[var(--color-line)] p-0">
              {recap.late.slice(0, 8).map((l) => (
                <li key={`${l.bundleNumber}-${l.workerName}-${l.stageLabel}`} className="flex list-none flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3">
                  <span className="text-[15px] text-text">{l.bundleNumber} · {l.workerName}</span>
                  <span className="text-[13px] text-text-secondary">{l.stageLabel} · {l.open} out{l.dueDate ? ` · was due ${shortDate(l.dueDate)}` : ""}</span>
                </li>
              ))}
            </ul>
          </Surface>
        </section>
      )}

      {stock && (
        <Link href="/lots/ready" className="block no-underline transition-transform duration-150 hover:-translate-y-px active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]">
          <Surface className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 p-5">
            <span className="text-[17px] font-medium tracking-[-0.02em] text-text">Ready stock</span>
            <span className="text-[15px] text-text-secondary"><span className="tabular font-semibold text-text">{stock.totalBalance.toLocaleString("en-IN")}</span> garments in stock{recap.readyOut > 0 ? `, ${recap.readyOut.toLocaleString("en-IN")} taken out ${isToday ? "today" : "that day"}` : ""}</span>
          </Surface>
        </Link>
      )}
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, TodayPage);
