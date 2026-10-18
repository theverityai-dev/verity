import { requireActor } from "@/server/platform/auth";
import { activeAuthProviderName, getAuthUser } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { DefinitionList, PageHeader, Panel } from "@/components/ui/primitives";
import { PasswordForm } from "./PasswordForm";

export const dynamic = "force-dynamic";

/**
 * Account settings — every role, every tenant. Not capability-gated: your
 * own identity and your own password are not a permission a role can lack.
 * Theme lives in the header already (`ThemeToggle`), so this page doesn't
 * duplicate it — it covers the one real gap, credentials.
 */
export default async function AccountPage() {
  const actor = await requireActor();
  const authUser = await getAuthUser();

  const data = await withTenant(actor.tenantId, async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.userId }, include: { party: true } });
    const role = actor.roleId ? await tx.role.findUnique({ where: { id: actor.roleId } }) : null;
    return { displayName: user.party.displayName, roleName: role?.name ?? "No role assigned" };
  });

  return (
    <>
      <PageHeader title="Account" description="Your identity and credentials." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Profile">
          <DefinitionList
            items={[
              { term: "Name", value: data.displayName },
              { term: "Email", value: authUser?.email ?? "—" },
              { term: "Role", value: data.roleName },
            ]}
          />
        </Panel>

        <Panel title="Change password">
          {activeAuthProviderName() === "oidc" ? (
            <p className="m-0 text-[15px] text-text-secondary">Your password is managed by your organization's identity provider. Change it there.</p>
          ) : (
            <PasswordForm />
          )}
        </Panel>
      </div>
    </>
  );
}
