"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/Avatar";
import { CommandButton } from "@/components/ui/CommandAccess";
import { CommandFailure, FormModal, formOptional, formText, useCommand } from "@/components/ui/CommandForm";
import { Modal, ModalCancel } from "@/components/ui/Modal";
import { Badge, Button, Checkbox, Field, Input, Select, Surface } from "@/components/ui/primitives";
import { runCommand } from "@/server/actions/platform";
import { createTeamLogin, resetMemberPassword, suggestPassword } from "@/server/actions/people";
import type { ActionFailure } from "@/server/platform/action-error";
import type { TeamDirectory, TeamPerson } from "@/server/capabilities/piecework";
import { StageAssignment } from "./TeamForms";

const INSTALL = "verity.piecework.install_role_presets";
const ASSIGN_ROLE = "verity.platform.assign_role";
const DISABLE = "verity.platform.disable_membership";
const RESTORE = "verity.platform.restore_membership";
const ASSIGN_STAGES = "verity.piecework.assign_stages";

type Role = TeamDirectory["roles"][number];

const roleLine = (roles: Role[], id: string | null) => roles.find((r) => r.id === id)?.summary ?? null;

/* ============================== set up the roles ============================== */

/** Shown until every factory role exists in this workspace: what each role is for, and one button that creates them. */
export function InstallRoles({ missing, canInstall }: { missing: TeamDirectory["missingPresets"]; canInstall: boolean }) {
  const { run, pending, failure } = useCommand("/shopfloor/team");
  if (missing.length === 0) return null;
  return (
    <Surface className="mb-6 flex flex-col gap-4 p-6">
      <div>
        <h2 className="m-0 text-[17px] font-medium tracking-[-0.02em]">Set up the factory&apos;s roles</h2>
        <p className="m-0 mt-1 text-[13px] leading-[19px] text-text-secondary">
          A role decides what a person can see and do. These are made from permissions, so you can change any of them afterwards under Roles.
        </p>
      </div>
      <ul className="m-0 grid list-none gap-3 p-0" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))" }}>
        {missing.map((p) => (
          <li key={p.name} className="list-none rounded-[14px] bg-[var(--color-control)] p-4">
            <p className="m-0 text-[15px] font-medium text-text">{p.name}</p>
            <p className="m-0 mt-1 text-[13px] leading-[19px] text-text-secondary">{p.summary}</p>
          </li>
        ))}
      </ul>
      <CommandFailure failure={failure} title="The roles were not made" />
      <div>
        <CommandButton commands={INSTALL} variant="primary" disabled={pending || !canInstall} onClick={() => run(INSTALL, {})}>
          {pending ? "Making roles…" : `Make ${missing.length === 1 ? "this role" : `these ${missing.length} roles`}`}
        </CommandButton>
        {!canInstall && <span className="ml-3 text-[13px] text-text-secondary">Only the owner can do this.</span>}
      </div>
    </Surface>
  );
}

/* ================================ add a person ================================ */

export function AddPerson({ directory }: { directory: TeamDirectory }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, start] = useTransition();
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const role = directory.roles.find((r) => r.id === roleId);

  const reset = () => { setPassword(""); setRoleId(""); setPicked(new Set()); setFailure(null); };
  const close = () => { setOpen(false); reset(); };

  return (
    <>
      <CommandButton commands="verity.platform.invite_person" variant="primary" onClick={() => setOpen(true)} disabled={!directory.can.addPerson}>Add a person</CommandButton>
      <FormModal
        open={open} onClose={close} width="lg" title="Add a person"
        description="They can sign in as soon as you press Add. Tell them the email and the password; Verity does not send either."
        submitLabel="Add person" pendingLabel="Adding…" pending={pending} failure={failure} failureTitle="That person was not added"
        submitDisabled={roleId === "" || password.length < 8 || directory.organizationId === null}
        onSubmit={(form) => {
          setFailure(null);
          start(async () => {
            const result = await createTeamLogin({
              displayName: formText(form, "name"), email: formText(form, "email"), password,
              organizationId: directory.organizationId!, roleId, phone: formOptional(form, "phone"),
            });
            if (!result.ok) { setFailure(result); return; }
            // Stages are the supervisor's scope; a role that works at every stage needs none.
            if (picked.size > 0 && !role?.allStages) {
              const staged = await runCommand(ASSIGN_STAGES, { userId: result.data.userId, stageIds: [...picked] }, "/shopfloor/team");
              if (!staged.ok) { setFailure(staged); router.refresh(); return; }
            }
            close();
            router.refresh();
          });
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="team-name" required><Input id="team-name" name="name" required maxLength={120} autoFocus /></Field>
          <Field label="Mobile number" htmlFor="team-phone"><Input id="team-phone" name="phone" type="tel" inputMode="tel" maxLength={20} /></Field>
          <Field label="Email" htmlFor="team-email" required hint="This is how they sign in"><Input id="team-email" name="email" type="email" required /></Field>
          <Field label="Password" htmlFor="team-password" required hint="At least 8 characters. Give it to them directly.">
            <div className="flex gap-2">
              <div className="min-w-0 flex-1"><Input id="team-password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" /></div>
              <Button type="button" disabled={pending} onClick={() => start(async () => setPassword(await suggestPassword()))}>Suggest</Button>
            </div>
          </Field>
        </div>

        <Field label="Role" htmlFor="team-role" required hint={role?.summary ?? "What they are allowed to do"}>
          <Select id="team-role" value={roleId} onChange={(e) => setRoleId(e.target.value)} required>
            <option value="">Choose a role</option>
            {directory.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        </Field>

        {roleId !== "" && (role?.allStages ? (
          <p className="m-0 text-[13px] text-text-secondary">This role works at every stage, so none needs choosing.</p>
        ) : (
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-1 text-[13px] font-medium text-text">Stages they look after</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {directory.stages.map((s) => (
                <Checkbox key={s.id} label={s.label} checked={picked.has(s.id)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n; })} />
              ))}
            </div>
            <p className="m-0 text-[13px] text-text-secondary">They can give out and take back only at the stages ticked. You can change this later.</p>
          </fieldset>
        ))}
      </FormModal>
    </>
  );
}

/* ================================ person sheet ================================ */

function PersonSheet({ person, directory, onClose }: { person: TeamPerson; directory: TeamDirectory; onClose: () => void }) {
  const { run, pending, failure, clear } = useCommand("/shopfloor/team");
  const router = useRouter();
  const [why, setWhy] = useState("");
  const [password, setPassword] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pwFailure, setPwFailure] = useState<ActionFailure | null>(null);
  const [pwPending, startPw] = useTransition();
  const role = directory.roles.find((r) => r.id === person.roleId);
  const { can } = directory;

  return (
    <Modal open onClose={onClose} width="lg" title={person.name} description={[person.email, person.phone].filter(Boolean).join(" · ") || "No contact on file"} footer={<ModalCancel onClose={onClose}>Close</ModalCancel>}>
      <div className="flex flex-col gap-6">
        <CommandFailure failure={failure} title="That was refused" />

        <section className="flex flex-col gap-2">
          <h3 className="micro m-0">Role</h3>
          <Select aria-label={`Role for ${person.name}`} value={person.roleId ?? ""} disabled={pending || !can.changeRole || person.isYou}
            onChange={(e) => run(ASSIGN_ROLE, { membershipId: person.membershipId, roleId: e.target.value === "" ? null : e.target.value })}>
            <option value="">No role</option>
            {directory.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
          <p className="m-0 text-[13px] leading-[19px] text-text-secondary">
            {person.isYou ? "Ask another administrator to change your own role." : role?.summary ?? "A person with no role can sign in and do nothing."}
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="micro m-0">Stages</h3>
          {person.allStages ? (
            <p className="m-0 text-[13px] text-text-secondary">Works at every stage.</p>
          ) : (
            <StageAssignment userId={person.userId} stages={directory.stages} assigned={person.stageIds} canEdit={can.assignStages} />
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="micro m-0">Karigars they look after</h3>
          {person.karigars.length === 0 ? (
            <p className="m-0 text-[13px] text-text-secondary">None yet. Set the supervisor on a karigar&apos;s own page, or leave a karigar open to every supervisor.</p>
          ) : (
            <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
              {person.karigars.map((k) => (
                <li key={k.id} className="list-none">
                  <Link href={`/karigars/${k.id}`} className="inline-flex min-h-9 items-center rounded-full bg-[var(--color-control)] px-3 text-[13px] text-text no-underline hover:bg-[var(--color-control-strong)]">{k.name}</Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {can.changeRole && (
          <section className="flex flex-col gap-2">
            <h3 className="micro m-0">New password</h3>
            <div className="flex flex-wrap gap-2">
              <div className="min-w-0 flex-1 basis-48"><Input aria-label="New password" value={password} onChange={(e) => { setPassword(e.target.value); setNote(null); }} autoComplete="off" placeholder="At least 8 characters" /></div>
              <Button type="button" disabled={pwPending} onClick={() => startPw(async () => setPassword(await suggestPassword()))}>Suggest</Button>
              <Button type="button" variant="primary" disabled={pwPending || password.length < 8}
                onClick={() => startPw(async () => {
                  setPwFailure(null);
                  const r = await resetMemberPassword({ membershipId: person.membershipId, password });
                  if (r.ok) { setNote("Password changed. Tell them the new one; Verity does not send it."); setPassword(""); } else setPwFailure(r);
                })}>{pwPending ? "Saving…" : "Set password"}</Button>
            </div>
            <CommandFailure failure={pwFailure} title="The password was not changed" />
            {note && <p role="status" className="m-0 text-[13px] text-text-secondary">{note}</p>}
          </section>
        )}

        {can.switchAccess && !person.isYou && (
          <section className="flex flex-col gap-2">
            <h3 className="micro m-0">{person.disabled ? "Switched off" : "Sign-in"}</h3>
            <p className="m-0 text-[13px] leading-[19px] text-text-secondary">
              {person.disabled
                ? "This person cannot sign in. Their history stays. Switch them back on if they return."
                : "Switch someone off when they leave. They stop signing in at once and everything they did stays on record."}
            </p>
            <div className="flex flex-wrap gap-2">
              <div className="min-w-0 flex-1 basis-48"><Input aria-label="Reason" value={why} onChange={(e) => { setWhy(e.target.value); clear(); }} placeholder="Reason, a few words" maxLength={500} /></div>
              <Button type="button" variant={person.disabled ? "primary" : "danger"} disabled={pending || why.trim().length < 3}
                onClick={() => run(person.disabled ? RESTORE : DISABLE, { membershipId: person.membershipId, reason: why.trim() }, () => { setWhy(""); router.refresh(); onClose(); })}>
                {pending ? "Saving…" : person.disabled ? "Switch back on" : "Switch off"}
              </Button>
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}

/* ================================== the grid ================================== */

/** The people, grouped by role; one card each, and the whole card opens that person's sheet. */
export function TeamPeople({ directory }: { directory: TeamDirectory }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = directory.people.find((p) => p.membershipId === openId) ?? null;
  const stageLabel = useMemo(() => new Map(directory.stages.map((s) => [s.id, s.label])), [directory.stages]);

  const groups = useMemo(() => {
    const order = new Map<string, number>();
    for (const p of directory.people) if (!order.has(p.roleName ?? "")) order.set(p.roleName ?? "", order.size);
    const by = new Map<string, TeamPerson[]>();
    for (const p of directory.people) { const k = p.disabled ? "\u0000off" : p.roleName ?? ""; by.set(k, [...(by.get(k) ?? []), p]); }
    // People with no role first (they can do nothing and need attention), then roles in order of first appearance, switched-off last.
    return [...by.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a === "\u0000off" ? 1 : b === "\u0000off" ? -1 : (order.get(a) ?? 0) - (order.get(b) ?? 0)));
  }, [directory.people]);

  if (directory.people.length === 0) {
    return <Surface className="mb-6 p-6"><p className="m-0 text-[15px] text-text-secondary">Nobody here yet. Add the first person with the button above.</p></Surface>;
  }

  return (
    <div className="mb-8 flex flex-col gap-6">
      {groups.map(([key, people]) => (
        <section key={key} aria-label={key === "" ? "No role" : key === "\u0000off" ? "Switched off" : key}>
          <h2 className="micro m-0 mb-3 px-1">{key === "" ? "No role yet" : key === "\u0000off" ? "Switched off" : key} · {people.length}</h2>
          <ul className="m-0 grid list-none gap-3 p-0" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))" }}>
            {people.map((p) => (
              <li key={p.membershipId} className="list-none">
                <button type="button" onClick={() => setOpenId(p.membershipId)}
                  className="block h-full w-full cursor-pointer rounded-[24px] border-0 bg-transparent p-0 text-left transition-transform duration-150 hover:-translate-y-px active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]">
                  <Surface className={`flex h-full flex-col gap-3 p-5 ${p.disabled ? "opacity-60" : ""}`}>
                    <div className="flex items-start gap-3.5">
                      <Avatar name={p.name} size={44} />
                      <div className="min-w-0 flex-1">
                        <p className="m-0 truncate text-[17px] font-medium leading-[22px] tracking-[-0.02em] text-text">{p.name}{p.isYou ? " (you)" : ""}</p>
                        <p className="m-0 truncate text-[13px] leading-[18px] text-text-secondary">{p.email ?? "No email"}{p.phone ? ` · ${p.phone}` : ""}</p>
                      </div>
                      {p.roleName ? <Badge tone="accent">{p.roleName}</Badge> : <Badge>No role</Badge>}
                    </div>
                    <p className="m-0 text-[13px] leading-[19px] text-text-secondary">
                      {p.allStages ? "Works at every stage" : p.stageIds.length === 0 ? "No stage assigned yet" : p.stageIds.map((id) => stageLabel.get(id) ?? "A stage").join(", ")}
                    </p>
                    {(p.karigars.length > 0 || p.piecesHeld > 0) && (
                      <dl className="m-0 mt-auto grid grid-cols-2 gap-3 border-t border-[var(--color-line)] pt-3">
                        <div><dt className="text-[12px] leading-[16px] text-text-tertiary">Karigars</dt><dd className="tabular m-0 text-[15px] font-semibold leading-[20px] text-text">{p.karigars.length}</dd></div>
                        <div><dt className="text-[12px] leading-[16px] text-text-tertiary">Holding</dt><dd className="tabular m-0 text-[15px] font-semibold leading-[20px] text-text">{p.piecesHeld} pcs</dd></div>
                      </dl>
                    )}
                  </Surface>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {open && <PersonSheet key={open.membershipId} person={open} directory={directory} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/** The roles in this workspace and what each is for, so the owner can read before choosing. */
export function RoleGuide({ roles, people }: { roles: Role[]; people: TeamPerson[] }) {
  return (
    <ul className="m-0 flex list-none flex-col divide-y divide-[var(--color-line)] p-0">
      {roles.map((r) => (
        <li key={r.id} className="py-3 first:pt-0 last:pb-0">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[15px] font-semibold text-text">{r.name}</span>
            <span className="text-[13px] text-text-secondary">{people.filter((p) => p.roleId === r.id && !p.disabled).length} people</span>
          </div>
          <p className="m-0 mt-0.5 text-[13px] leading-[19px] text-text-secondary">{roleLine(roles, r.id) ?? "A role made by this workspace. See Roles for what it allows."}</p>
        </li>
      ))}
    </ul>
  );
}
