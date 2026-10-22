import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_SETTING, PIECEWORK_CAPABILITY, teamSetup } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { PageHeader, PermissionDenied, Surface } from "@/components/ui/primitives";
import { shortDate } from "../../lots/format";
import { LimitsForm, StageAssignment } from "./TeamForms";

export const dynamic = "force-dynamic";

/** M2 · Team and limits: the owner sets what a manager may approve alone and which stages each supervisor looks after. */
async function TeamPage() {
  installCapabilities();
  const actor = await requireActor();
  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_SETTING));
  if (!allowed) return <PermissionDenied what="team and limits" />;
  const team = await executeQuery(actor, teamSetup, {});

  return (
    <>
      <PageHeader title="Team and limits" description={team.canEdit ? "Who looks after which stage, and what a manager may approve alone." : "Read only. The owner sets these."} />

      <div className="mb-6 grid items-start gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Surface className="p-6">
          <h2 className="m-0 mb-1 text-[17px] font-medium tracking-[-0.02em]">Manager limits</h2>
          <p className="m-0 mb-4 text-[13px] leading-[19px] text-text-secondary">Above these, a request waits for the owner. A lot close follows the write-off limit on its short pieces.</p>
          <LimitsForm limits={team.limits} canEdit={team.canEdit} />
        </Surface>

        <Surface className="p-6">
          <h2 className="m-0 mb-1 text-[17px] font-medium tracking-[-0.02em]">Stages by person</h2>
          <p className="m-0 mb-4 text-[13px] leading-[19px] text-text-secondary">People with a role that works at every stage need no assignment. Everyone else can issue and receive only at the stages ticked here.</p>
          <ul className="m-0 flex list-none flex-col divide-y divide-[var(--color-line)] p-0">
            {team.members.map((m) => (
              <li key={m.userId} className="py-3.5 first:pt-0 last:pb-0">
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <span className="text-[15px] font-semibold text-text">{m.name}</span>
                  <span className="text-[13px] text-text-secondary">{m.role}</span>
                </div>
                {m.allStages ? <p className="m-0 text-[13px] text-text-secondary">Works at every stage.</p> : <StageAssignment userId={m.userId} stages={team.stages} assigned={m.stageIds} canEdit={team.canEdit} />}
              </li>
            ))}
          </ul>
        </Surface>
      </div>

      <h2 className="micro m-0 mb-3 px-1">Closed days</h2>
      {team.closes.length === 0 ? (
        <Surface className="p-5"><p className="m-0 text-[15px] text-text-secondary">No supervisor has closed a day yet.</p></Surface>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))" }}>
          {team.closes.map((c) => (
            <li key={c.id} className="list-none">
              <Surface className="flex h-full flex-col gap-2 p-5">
                <p className="m-0 flex items-baseline justify-between gap-3"><span className="text-[15px] font-semibold text-text">{c.by}</span><span className="text-[13px] text-text-secondary">{shortDate(c.date)}</span></p>
                <p className="m-0 text-[13px] text-text-secondary">{c.summary.stages.join(", ")} · given {c.summary.given}, back {c.summary.takenBack}, good {c.summary.good}, rejected {c.summary.rejected}, rework {c.summary.rework}, short {c.summary.short}</p>
                {c.summary.late.length > 0 && <p className="m-0 text-[13px]" style={{ color: "var(--color-state-blocked)" }}>{c.summary.late.length} late at close</p>}
                {c.note && <p className="m-0 mt-1 whitespace-pre-wrap rounded-[12px] bg-[var(--color-control)] px-3.5 py-2.5 text-[14px] text-text" lang={c.lang}>{c.note}</p>}
              </Surface>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, TeamPage);
