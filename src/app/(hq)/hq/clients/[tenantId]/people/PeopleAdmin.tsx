"use client";

/* eslint-disable no-restricted-syntax -- Task 121 grandfathered debt (bare <table>), migrate to DataTable/SmartTable opportunistically */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Panel,
  Select,
} from "@/components/ui/primitives";
import { runClientCommand } from "@/server/actions/hq";
import type { ActionFailure } from "@/server/platform/action-error";
import type { PersonRow } from "@/server/platform/administration";

/**
 * People administration for one client — D20's "without asking a developer".
 *
 * Every mutation is a command through the platform runtime. Nothing here writes
 * to the database, decides authorization, or knows how a Party differs from a
 * User; it collects an input and reports what the platform said about it.
 *
 * Failures are rendered rather than swallowed, with the platform's own
 * `retryable` flag, because "did my change apply?" is the question an operator
 * has after every refusal and the one a spinner disappearing silently fails to
 * answer.
 */
export function PeopleAdmin({
  tenantId,
  people,
  operatorAccounts = 0,
  organizations,
  roles,
}: {
  tenantId: string;
  people: PersonRow[];
  /** Verity operator accounts with access to this client; not listed as staff. */
  operatorAccounts?: number;
  organizations: Array<{ id: string; name: string }>;
  roles: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [inviting, setInviting] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return people;
    return people.filter(
      (person) =>
        person.displayName.toLowerCase().includes(term) ||
        (person.email ?? "").toLowerCase().includes(term) ||
        (person.roleName ?? "").toLowerCase().includes(term) ||
        person.organizationName.toLowerCase().includes(term),
    );
  }, [people, search]);

  function run(key: string, input: unknown, after?: () => void) {
    setFailure(null);
    startTransition(async () => {
      const result = await runClientCommand(tenantId, key, input);
      if (result.ok) {
        after?.();
        router.refresh();
      } else {
        setFailure(result);
      }
    });
  }

  return (
    <>
      {failure && (
        <div className="mb-4">
          <ErrorState
            title="That change was refused"
            message={failure.message}
            issues={failure.issues}
            retryable={failure.retryable}
          />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label htmlFor="people-search" className="sr-only">
          Search people
        </label>
        <Input
          id="people-search"
          type="search"
          placeholder="Search by name, email or role"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="max-w-xs"
        />
        <div className="ms-auto">
          <Button variant="primary" onClick={() => setInviting((open) => !open)}>
            {inviting ? "Cancel" : "Invite person"}
          </Button>
        </div>
      </div>

      {inviting && (
        <div className="mb-6">
          <Panel title="Invite a person">
            <form
              className="grid gap-4 sm:max-w-lg"
              action={(formData) => {
                run(
                  "verity.platform.invite_person",
                  {
                    displayName: String(formData.get("displayName") ?? ""),
                    email: String(formData.get("email") ?? "") || undefined,
                    organizationId: String(formData.get("organizationId") ?? ""),
                    roleId: String(formData.get("roleId") ?? "") || null,
                  },
                  () => setInviting(false),
                );
              }}
            >
              <Field label="Name" htmlFor="invite-name" required>
                <Input id="invite-name" name="displayName" required autoFocus />
              </Field>

              <Field
                label="Email"
                htmlFor="invite-email"
                hint="Recorded on the Party. Identity is linked when the person verifies it, never by matching addresses across clients (ADR-007)."
              >
                <Input id="invite-email" name="email" type="email" />
              </Field>

              <Field label="Organization" htmlFor="invite-org" required>
                <Select id="invite-org" name="organizationId" required>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Role"
                htmlFor="invite-role"
                hint="A membership with no role grants nothing, which is a safe place to start."
              >
                <Select id="invite-role" name="roleId" defaultValue="">
                  <option value="">No role yet</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <div>
                <Button type="submit" variant="primary" disabled={pending}>
                  {pending ? "Inviting…" : "Invite"}
                </Button>
              </div>
            </form>
          </Panel>
        </div>
      )}

      {operatorAccounts > 0 && (
        <p className="mb-4 mt-0 text-[13px] text-text-secondary">
          {operatorAccounts} Verity operator {operatorAccounts === 1 ? "account has" : "accounts have"}{" "}
          support access to this client. They are not listed here, so they cannot be suspended by accident.
        </p>
      )}

      <Panel title={`${visible.length} of ${people.length}`} flush>
        {visible.length === 0 ? (
          <EmptyState
            compact
            title={people.length === 0 ? "Nobody has access yet" : "No match"}
            description={
              people.length === 0
                ? "Invite the first person above. Nothing is provisioned automatically."
                : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse">
              <caption className="sr-only">People with access to this client</caption>
              <thead>
                <tr>
                  {["Person", "Organization", "Role", "State", "Actions"].map((heading) => (
                    <th
                      key={heading}
                      className="border-b border-line px-3 py-3 text-left text-[12px] font-normal text-text-tertiary"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((person) => (
                  <tr key={person.membershipId}>
                    <td className="border-b border-line px-3 py-3 text-[14px]">
                      <span className="block text-text">{person.displayName}</span>
                      {person.email && (
                        <span className="block text-[12px] text-text-tertiary">{person.email}</span>
                      )}
                    </td>
                    <td className="border-b border-line px-3 py-3 text-[14px] text-text-secondary">
                      {person.organizationName}
                    </td>
                    <td className="border-b border-line px-3 py-3">
                      <label className="sr-only" htmlFor={`role-${person.membershipId}`}>
                        Role for {person.displayName}
                      </label>
                      <Select
                        id={`role-${person.membershipId}`}
                        value={person.roleId ?? ""}
                        disabled={pending}
                        onChange={(event) =>
                          run("verity.platform.assign_role", {
                            membershipId: person.membershipId,
                            roleId: event.target.value || null,
                          })
                        }
                      >
                        <option value="">No role</option>
                        {roles.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.name}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="border-b border-line px-3 py-3 text-[13px]">
                      <span
                        className={
                          person.state === "Suspended" ? "text-warning" : "text-text-secondary"
                        }
                      >
                        {person.state}
                      </span>
                    </td>
                    <td className="border-b border-line px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            run("verity.platform.set_person_state", {
                              membershipId: person.membershipId,
                              state: person.state === "Suspended" ? "Active" : "Suspended",
                            })
                          }
                        >
                          {person.state === "Suspended" ? "Restore" : "Suspend"}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={pending}
                          onClick={() =>
                            run("verity.platform.revoke_membership", {
                              membershipId: person.membershipId,
                            })
                          }
                        >
                          Revoke
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
