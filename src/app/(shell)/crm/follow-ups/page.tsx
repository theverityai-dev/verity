import { requireActor } from "@/server/platform/auth";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { RELATIONSHIP_CAPABILITY, listFollowUps } from "@/server/capabilities/relationship";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { FilterChipRow, PageHeader } from "@/components/ui/primitives";
import { FollowUpQueue, type FollowUpRow } from "../_parts/crm-ui";

export const dynamic = "force-dynamic";

/**
 * Follow-ups: a queue someone works through, in the order things need doing. Mine by default, because the first
 * question is "what do I have to do today"; everyone's one tap away for a manager. Tick the circle to finish one.
 */
async function FollowUpsPage({ searchParams }: { searchParams: Promise<{ scope?: string; status?: string }> }) {
  installCapabilities();
  const params = await searchParams;
  const scope = params.scope === "all" ? "all" : "mine";
  const status = params.status === "done" ? "done" : "open";
  const actor = await requireActor();
  const [rows, mineOpen, allOpen] = await Promise.all([
    executeQuery(actor, listFollowUps, { scope, status }) as Promise<FollowUpRow[]>,
    executeQuery(actor, listFollowUps, { scope: "mine", status: "open" }) as Promise<FollowUpRow[]>,
    executeQuery(actor, listFollowUps, { scope: "all", status: "open" }) as Promise<FollowUpRow[]>,
  ]);
  const href = (s: string, st: string) => `/crm/follow-ups?scope=${s}&status=${st}`;
  const overdueMine = mineOpen.filter((r) => r.overdue).length;

  return (
    <>
      <PageHeader
        title="Follow-ups"
        description={
          status === "open"
            ? overdueMine
              ? `${overdueMine} of yours ${overdueMine === 1 ? "is" : "are"} overdue. Plan new ones from any company, person or deal.`
              : "What has to be done next, in the order it is due. Plan new ones from any company, person or deal."
            : "What has been done recently."
        }
      />
      <FilterChipRow
        className="mb-4"
        chips={[
          { label: "Mine", count: mineOpen.length, icon: "user", active: scope === "mine" && status === "open", href: href("mine", "open") },
          { label: "Everyone", count: allOpen.length, icon: "people", active: scope === "all" && status === "open", href: href("all", "open") },
          { label: "Done", icon: "check", active: status === "done", href: href(scope, "done") },
        ]}
      />
      <FollowUpQueue rows={rows} done={status === "done"} />
    </>
  );
}

export default withCapabilityPageAccess(RELATIONSHIP_CAPABILITY, FollowUpsPage);
