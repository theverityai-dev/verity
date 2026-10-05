import Link from "next/link";
import { ErrorState, Panel, Stat, StatRow } from "@/components/ui/primitives";
import { runClientQuery } from "@/server/actions/hq";
import type { ModuleRow, PersonRow, RoleRow } from "@/server/platform/administration";
import { OPERATOR_ROLE_NAME, clientDirectory, requireOperator } from "@/server/platform/operator";
import { ClientLifecycle } from "../ClientLifecycle";

export const dynamic = "force-dynamic";

type Org = { id: string; name: string; parentId: string | null; memberCount: number };

/**
 * One client at a glance.
 *
 * Four counts and the way into each surface. Everything here is read through
 * the ordinary query pipeline as the operator, so a number an operator is not
 * permitted to see would not appear rather than appearing as zero.
 */
export default async function ClientOverviewPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;

  const [people, roles, organizations, modules] = await Promise.all([
    runClientQuery<PersonRow[]>(tenantId, "verity.platform.list_people", {}),
    runClientQuery<RoleRow[]>(tenantId, "verity.platform.list_roles", {}),
    runClientQuery<Org[]>(tenantId, "verity.platform.list_organizations", {}),
    runClientQuery<ModuleRow[]>(tenantId, "verity.platform.list_modules", {}),
  ]);

  const failure = [people, roles, organizations, modules].find((r) => !r.ok);
  if (failure && !failure.ok) {
    return (
      <ErrorState
        title="Could not load this client"
        message={failure.message}
        retryable={failure.retryable}
      />
    );
  }
  if (!people.ok || !roles.ok || !organizations.ok || !modules.ok) return null;

  const base = `/hq/clients/${tenantId}`;
  const active = modules.data.filter((m) => m.status === "Active");
  const withoutRole = people.data.filter((p) => !p.roleId).length;

  // A2: onboarding as a checklist the operator can finish, computed from the
  // client's real state rather than ticked by hand.
  const operator = await requireOperator();
  const client = (await clientDirectory(operator)).find((c) => c.tenantId === tenantId);
  const clientPeople = people.data.filter((p) => p.roleName !== OPERATOR_ROLE_NAME);
  const clientRoles = roles.data.filter((r) => r.name !== OPERATOR_ROLE_NAME);
  const invited = clientPeople.filter((p) => p.state === "Invited").length;
  const steps = [
    {
      done: active.length > 0,
      title: "Enable the capabilities this client needs",
      href: `${base}/modules`,
      detail: active.length === 0 ? "None enabled yet, so the client's people see no navigation." : active.map((m) => m.name).join(", "),
    },
    {
      done: organizations.data.length > 1 || organizations.data.some((o) => o.memberCount > 0),
      title: "Shape the organization: outlets, branches, teams",
      href: `${base}/organizations`,
      detail: "Permissions scoped to an organization resolve against this.",
    },
    {
      done: clientRoles.length > 0,
      title: "Define roles and what each may do",
      href: `${base}/roles`,
      detail: clientRoles.length === 0 ? "No client roles yet." : clientRoles.map((r) => r.name).join(", "),
    },
    {
      done: clientPeople.some((p) => p.roleId),
      title: "Add the client's first admin and give them a role",
      href: `${base}/people`,
      detail: withoutRole > 0 ? `${withoutRole} ${withoutRole === 1 ? "person has" : "people have"} no role and can do nothing.` : "Everyone added has a role.",
    },
    {
      done: clientPeople.length > 0 && invited === 0,
      title: "Everyone has signed in at least once",
      href: `${base}/people`,
      detail: invited === 0 ? "Nobody is waiting." : `${invited} still waiting. The client's admin creates their sign-in from People.`,
    },
  ];
  const remaining = steps.filter((step) => !step.done).length;

  return (
    <>
      <StatRow className="mb-6">
        <Stat label="People" value={people.data.length} href={`${base}/people`} />
        <Stat label="Roles" value={roles.data.length} href={`${base}/roles`} />
        <Stat
          label="Organizations"
          value={organizations.data.length}
          href={`${base}/organizations`}
        />
        <Stat
          label="Modules enabled"
          value={`${active.length} of ${modules.data.length}`}
          href={`${base}/modules`}
        />
      </StatRow>

      <Panel title={remaining === 0 ? "Onboarding complete" : `Onboarding · ${steps.length - remaining} of ${steps.length} done`}>
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {steps.map((step) => (
            <li key={step.title} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[12px] font-semibold ${step.done ? "bg-success-subtle text-success" : "bg-control text-text-secondary"}`}
              >
                {step.done ? "✓" : ""}
              </span>
              <div className="min-w-0">
                <Link href={step.href} className="text-[15px] text-accent-ink no-underline hover:underline">
                  {step.title}
                </Link>
                <span className="sr-only">{step.done ? " (done)" : " (not done)"}</span>
                <p className="m-0 mt-0.5 text-[13px] text-text-secondary">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
        {client?.status === "onboarding" && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <p className="m-0 text-[13px] text-text-secondary">
              {remaining === 0
                ? "Everything is in place. Mark the client active when they start using it."
                : "Mark the client active once the steps above are done."}
            </p>
            <ClientLifecycle tenantId={tenantId} status={client.status} />
          </div>
        )}
      </Panel>
    </>
  );
}
