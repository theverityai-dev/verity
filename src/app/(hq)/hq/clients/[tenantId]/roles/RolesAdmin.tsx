"use client";

/* eslint-disable no-restricted-syntax -- Task 121 grandfathered debt (bare <table>), migrate to DataTable/SmartTable opportunistically */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Panel,
  Select,
} from "@/components/ui/primitives";
import { runClientCommand } from "@/server/actions/hq";
import type { ActionFailure } from "@/server/platform/action-error";
import type { GrantableGroup, RoleRow } from "@/server/platform/administration";
import { actionExecuteLabel } from "@/server/platform/label";
import { entityLabelOf } from "@/components/ui/business/vocabulary";

/** Permission verbs and scopes in the words an operator would use. */
const VERB_LABEL: Record<string, string> = {
  Read: "View",
  Create: "Create",
  Edit: "Change",
  Delete: "Remove",
  ActionExecute: "Run",
  Approve: "Approve",
};
const SCOPE_LABEL: Record<string, string> = {
  Tenant: "whole client",
  Organization: "own organization",
  Location: "own location",
};

const VERBS = ["Read", "Create", "Edit", "Delete", "ActionExecute"] as const;
const SCOPES = ["Tenant", "Organization", "Location"] as const;

type DirectGrant = RoleRow["directGrants"][number];

/** Grant/revoke pair for one matrix cell — Manage is Create+Edit together. */
function matrixCell(directGrants: DirectGrant[], entity: string, verbs: readonly string[]) {
  const rows = verbs.map((verb) => directGrants.find((g) => g.entity === entity && g.verb === verb && g.scope === "Tenant"));
  return { checked: rows.every(Boolean), ids: rows.filter((r): r is DirectGrant => !!r).map((r) => r.id) };
}

/**
 * Roles and permissions for one client.
 *
 * The screen is built around the distinction that actually matters when
 * granting access: DIRECT grants are what this role was given, RESOLVED grants
 * are what the checker will see once composition is flattened. Showing only the
 * first is how someone grants a role that already had the permission through a
 * child, or removes one and finds access unchanged.
 *
 * `Global` is absent from the scope list on purpose. It is defined by
 * PLA-AUT-002 but deliberately filtered out of resolution, so offering it would
 * be offering a grant that looks effective and does nothing.
 */
export function RolesAdmin({
  tenantId,
  roles,
  grantable,
}: {
  tenantId: string;
  roles: RoleRow[];
  grantable: GrantableGroup[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(roles[0]?.id ?? null);
  const [advanced, setAdvanced] = useState<Record<string, boolean>>({});
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

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

  /** Toggles one matrix cell: grants every missing verb, or revokes every held one. */
  function toggleCell(roleId: string, entity: string, verbs: readonly string[], cell: ReturnType<typeof matrixCell>) {
    setFailure(null);
    startTransition(async () => {
      const actions = cell.checked
        ? cell.ids.map((permissionId) => ({ key: "verity.platform.revoke_permission", input: { permissionId } }))
        : verbs.map((verb) => ({
            key: "verity.platform.grant_permission",
            input: { roleId, verb, entity, scope: "Tenant" },
          }));

      for (const action of actions) {
        const result = await runClientCommand(tenantId, action.key, action.input);
        if (!result.ok) {
          setFailure(result);
          return;
        }
      }
      router.refresh();
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

      <div className="mb-4 flex items-center justify-end">
        <Button variant="primary" onClick={() => setCreating((open) => !open)}>
          {creating ? "Cancel" : "New role"}
        </Button>
      </div>

      {creating && (
        <div className="mb-6">
          <Panel title="New role">
            <form
              className="flex flex-wrap items-end gap-3"
              action={(formData) =>
                run(
                  "verity.platform.create_role",
                  { name: String(formData.get("name") ?? "") },
                  () => setCreating(false),
                )
              }
            >
              <div className="min-w-[260px]">
                <Field label="Role name" htmlFor="role-name" required>
                  <Input id="role-name" name="name" required autoFocus />
                </Field>
              </div>
              <Button type="submit" variant="primary" disabled={pending}>
                Create
              </Button>
            </form>
          </Panel>
        </div>
      )}

      {roles.length === 0 ? (
        <Panel flush>
          <EmptyState
            compact
            title="No roles yet"
            description="A membership with no role grants nothing, so nobody can do anything here until a role exists."
          />
        </Panel>
      ) : (
        <div className="flex flex-col gap-4">
          {roles.map((role) => {
            const open = expanded === role.id;
            const inheritedOnly = role.resolvedGrants.filter(
              (r) => !role.directGrants.some((d) => d.verb === r.verb && d.entity === r.entity),
            );

            return (
              <Panel
                key={role.id}
                title={role.name}
                action={
                  <div className="flex items-center gap-3">
                    <span className="text-[12px] text-text-tertiary">
                      {role.memberCount} {role.memberCount === 1 ? "member" : "members"} ·{" "}
                      {role.resolvedGrants.length} resolved
                    </span>
                    <Button size="sm" onClick={() => setExpanded(open ? null : role.id)}>
                      {open ? "Hide" : "Manage"}
                    </Button>
                  </div>
                }
              >
                {!open ? (
                  <p className="m-0 text-[13px] text-text-secondary">
                    {role.directGrants.length} direct{" "}
                    {role.directGrants.length === 1 ? "grant" : "grants"}
                    {role.composedFrom.length > 0 &&
                      `, inheriting from ${role.composedFrom.map((c) => c.name).join(", ")}`}
                    .
                  </p>
                ) : (
                  <div className="flex flex-col gap-5">
                    <section>
                      <h3 className="mb-2">Direct grants</h3>
                      {role.directGrants.length === 0 ? (
                        <p className="m-0 text-[13px] text-text-secondary">None.</p>
                      ) : (
                        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                          {role.directGrants.map((grant) => (
                            <li
                              key={grant.id}
                              className="flex items-center justify-between gap-3 rounded-md bg-surface-sunken px-3 py-2 text-[13px]"
                            >
                              <span className="text-text">
                                <span className="font-medium">{grant.verb}</span> {grant.entity}{" "}
                                <span className="text-text-tertiary">@ {grant.scope}</span>
                              </span>
                              <Button
                                size="sm"
                                variant="danger"
                                disabled={pending}
                                onClick={() =>
                                  run("verity.platform.revoke_permission", {
                                    permissionId: grant.id,
                                  })
                                }
                              >
                                Revoke
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

                    {inheritedOnly.length > 0 && (
                      <section>
                        <h3 className="mb-2">Inherited through composition</h3>
                        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px] text-text-secondary">
                          {inheritedOnly.map((grant) => (
                            <li key={`${grant.verb}:${grant.entity}`}>
                              {VERB_LABEL[grant.verb] ?? grant.verb} {entityLabelOf(grant.entity)}{" "}
                              <span className="text-text-tertiary">· {SCOPE_LABEL[grant.scope] ?? grant.scope}</span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}

                    <section>
                      <h3 className="mb-2">Permissions</h3>
                      {grantable.length === 0 ? (
                        <p className="m-0 text-[13px] text-text-secondary">
                          No capability is active for this client yet — activate one under Modules
                          first, or use Advanced below for a platform administration grant.
                        </p>
                      ) : (
                        <div className="flex flex-col gap-4">
                          {grantable.map((group) => (
                            <div key={group.group}>
                              <p className="m-0 mb-1.5 text-[12px] font-medium text-text-tertiary">
                                {group.group}
                              </p>
                              <div className="overflow-hidden rounded-lg border border-line">
                                <table className="w-full border-collapse text-[13px]">
                                  <thead>
                                    <tr className="bg-surface-sunken text-left text-[11px] uppercase tracking-wide text-text-tertiary">
                                      <th className="px-3 py-2 font-medium">Entity</th>
                                      <th className="w-[90px] px-3 py-2 font-medium">View</th>
                                      <th className="w-[90px] px-3 py-2 font-medium">Manage</th>
                                      <th className="w-[90px] px-3 py-2 font-medium">Delete</th>
                                      <th className="px-3 py-2 font-medium">Action</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {group.entities.map((entity) => {
                                      const view = matrixCell(role.directGrants, entity.key, ["Read"]);
                                      const manage = matrixCell(role.directGrants, entity.key, ["Create", "Edit"]);
                                      const del = matrixCell(role.directGrants, entity.key, ["Delete"]);
                                      const actionLabel = actionExecuteLabel(entity.key);
                                      const action = actionLabel
                                        ? matrixCell(role.directGrants, entity.key, ["ActionExecute"])
                                        : null;
                                      return (
                                        <tr key={entity.key} className="border-t border-line">
                                          <td className="px-3 py-2 text-text">{entity.label}</td>
                                          <td className="px-3 py-2">
                                            <Checkbox
                                              label={<span className="sr-only">View {entity.label}</span>}
                                              checked={view.checked}
                                              disabled={pending}
                                              onChange={() => toggleCell(role.id, entity.key, ["Read"], view)}
                                            />
                                          </td>
                                          <td className="px-3 py-2">
                                            <Checkbox
                                              label={<span className="sr-only">Manage {entity.label}</span>}
                                              checked={manage.checked}
                                              disabled={pending}
                                              onChange={() => toggleCell(role.id, entity.key, ["Create", "Edit"], manage)}
                                            />
                                          </td>
                                          <td className="px-3 py-2">
                                            <Checkbox
                                              label={<span className="sr-only">Delete {entity.label}</span>}
                                              checked={del.checked}
                                              disabled={pending}
                                              onChange={() => toggleCell(role.id, entity.key, ["Delete"], del)}
                                            />
                                          </td>
                                          <td className="px-3 py-2">
                                            {action && (
                                              <Checkbox
                                                label={<span className="text-[12.5px] text-text-secondary">{actionLabel}</span>}
                                                checked={action.checked}
                                                disabled={pending}
                                                onChange={() =>
                                                  toggleCell(role.id, entity.key, ["ActionExecute"], action)
                                                }
                                              />
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>

                    <section>
                      <button
                        type="button"
                        className="m-0 cursor-pointer border-0 bg-transparent p-0 text-[12px] font-medium text-text-tertiary underline decoration-dotted underline-offset-4 hover:text-text"
                        onClick={() => setAdvanced((s) => ({ ...s, [role.id]: !s[role.id] }))}
                      >
                        {advanced[role.id] ? "Hide advanced grant" : "Advanced: custom grant, Organization/Location scope"}
                      </button>

                      {advanced[role.id] && (
                        <form
                          className="mt-3 flex flex-wrap items-end gap-3"
                          action={(formData) =>
                            run("verity.platform.grant_permission", {
                              roleId: role.id,
                              verb: String(formData.get("verb") ?? "Read"),
                              entity: String(formData.get("entity") ?? ""),
                              scope: String(formData.get("scope") ?? "Tenant"),
                            })
                          }
                        >
                          <div className="w-[150px]">
                            <Field label="Verb" htmlFor={`verb-${role.id}`}>
                              <Select id={`verb-${role.id}`} name="verb" defaultValue="Read">
                                {VERBS.map((verb) => (
                                  <option key={verb} value={verb}>
                                    {verb}
                                  </option>
                                ))}
                              </Select>
                            </Field>
                          </div>
                          <div className="min-w-[260px] flex-1">
                            <Field
                              label="Entity"
                              htmlFor={`entity-${role.id}`}
                              hint="A capability's entity key, e.g. verity.asset.asset. Free text by design — a new capability must not need a platform change to be grantable."
                              required
                            >
                              <Input
                                id={`entity-${role.id}`}
                                name="entity"
                                placeholder="verity.asset.asset"
                                required
                              />
                            </Field>
                          </div>
                          <div className="w-[170px]">
                            <Field label="Scope" htmlFor={`scope-${role.id}`}>
                              <Select id={`scope-${role.id}`} name="scope" defaultValue="Tenant">
                                {SCOPES.map((scope) => (
                                  <option key={scope} value={scope}>
                                    {scope}
                                  </option>
                                ))}
                              </Select>
                            </Field>
                          </div>
                          <Button type="submit" variant="primary" disabled={pending}>
                            Grant
                          </Button>
                        </form>
                      )}
                    </section>

                    <section>
                      <h3 className="mb-2">Composition</h3>
                      <p className="mb-3 mt-0 text-[13px] text-text-secondary">
                        This role inherits every permission held by the roles it composes. Cycles
                        are refused by the database, because resolution runs on every check.
                      </p>
                      <form
                        className="flex flex-wrap items-end gap-3"
                        action={(formData) =>
                          run("verity.platform.compose_role", {
                            parentRoleId: role.id,
                            childRoleId: String(formData.get("childRoleId") ?? ""),
                            attach: formData.get("attach") === "attach",
                          })
                        }
                      >
                        <div className="min-w-[220px]">
                          <Field label="Role" htmlFor={`child-${role.id}`}>
                            <Select id={`child-${role.id}`} name="childRoleId" required>
                              {roles
                                .filter((candidate) => candidate.id !== role.id)
                                .map((candidate) => (
                                  <option key={candidate.id} value={candidate.id}>
                                    {candidate.name}
                                  </option>
                                ))}
                            </Select>
                          </Field>
                        </div>
                        <div className="w-[160px]">
                          <Field label="Action" htmlFor={`attach-${role.id}`}>
                            <Select id={`attach-${role.id}`} name="attach" defaultValue="attach">
                              <option value="attach">Inherit from</option>
                              <option value="detach">Stop inheriting</option>
                            </Select>
                          </Field>
                        </div>
                        <Button type="submit" disabled={pending || roles.length < 2}>
                          Apply
                        </Button>
                      </form>
                    </section>
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
