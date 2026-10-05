import { ErrorState } from "@/components/ui/primitives";
import { runClientQuery } from "@/server/actions/hq";
import type { PersonRow } from "@/server/platform/administration";
import { OPERATOR_ROLE_NAME } from "@/server/platform/operator";
import { PeopleAdmin } from "./PeopleAdmin";

export const dynamic = "force-dynamic";

type Org = { id: string; name: string; parentId: string | null; memberCount: number };
type Role = { id: string; name: string };

/**
 * People in one client.
 *
 * Reads go through `runClientQuery`, which resolves the operator's actor for
 * this tenant and runs the ordinary query pipeline — so what is listed here is
 * what the operator's role is permitted to read, filtered by RLS, with
 * restricted fields removed. The page never touches Prisma and never names a
 * tenant except the one in its own URL, which the layout has already verified.
 */
export default async function ClientPeoplePage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;

  const [people, organizations, roles] = await Promise.all([
    runClientQuery<PersonRow[]>(tenantId, "verity.platform.list_people", {}),
    runClientQuery<Org[]>(tenantId, "verity.platform.list_organizations", {}),
    runClientQuery<Role[]>(tenantId, "verity.platform.list_roles", {}),
  ]);

  if (!people.ok || !organizations.ok || !roles.ok) {
    const failure = [people, organizations, roles].find((r) => !r.ok);
    return (
      <ErrorState
        title="Could not load this client's people"
        message={failure && !failure.ok ? failure.message : "Unknown error"}
        retryable={failure && !failure.ok ? failure.retryable : false}
      />
    );
  }

  return (
    <PeopleAdmin
      tenantId={tenantId}
      people={people.data}
      organizations={organizations.data.map((o) => ({ id: o.id, name: o.name }))}
      roles={roles.data.map((r) => ({ id: r.id, name: r.name }))}
    />
  );
}
