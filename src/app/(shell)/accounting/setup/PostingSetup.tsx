"use client";

import { Button, Panel, Row, RowList, Select } from "@/components/ui/primitives";
import { CommandFailure, useCommand } from "@/components/ui/CommandForm";

export type RoleRow = { role: string; label: string; requiredType: string; accountId: string | null; accountText: string | null };
export type AccountChoice = { id: string; text: string; type: string };
export type KindRow = { kind: string; label: string; needs: string[]; waiting: number; posted: number };
export type PendingRow = { key: string; kindLabel: string; reason: string; since: string };

const ROUTE = "/accounting/setup";

/**
 * Which account plays which role when invoices and receipts post to the ledger (ADR-044). Nothing posts to a guessed account:
 * a document whose role is unmapped waits here with the reason. Choosing an account is a command; so is "Post now".
 */
export function PostingSetup({
  roles,
  accounts,
  kinds,
  pending,
}: {
  roles: RoleRow[];
  accounts: AccountChoice[];
  kinds: KindRow[];
  pending: PendingRow[];
}) {
  const map = useCommand(ROUTE);
  const postNow = useCommand(ROUTE);
  const waiting = kinds.reduce((n, k) => n + k.waiting, 0);

  return (
    <div className="flex flex-col gap-6">
      <Panel title="Accounts for posting" flush>
        <RowList>
          {roles.map((role) => {
            const choices = accounts.filter((a) => a.type === role.requiredType);
            return (
              <Row key={role.role}>
                <span className="min-w-0">
                  <span className="block text-[15px]">{role.label}</span>
                  <span className="block text-[13px] text-text-tertiary">Needs a {role.requiredType.toLowerCase()} account</span>
                </span>
                <span className="w-full max-w-[280px]">
                  <label className="sr-only" htmlFor={`map-${role.role}`}>
                    Account for {role.label}
                  </label>
                  <Select
                    id={`map-${role.role}`}
                    value={role.accountId ?? ""}
                    disabled={map.pending || choices.length === 0}
                    onChange={(event) => {
                      if (event.target.value) map.run("verity.accounting.set_account_mapping", { role: role.role, accountId: event.target.value });
                    }}
                  >
                    <option value="">{choices.length === 0 ? `Add a ${role.requiredType.toLowerCase()} account first` : "Not set"}</option>
                    {choices.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.text}
                      </option>
                    ))}
                  </Select>
                </span>
              </Row>
            );
          })}
        </RowList>
        <div className="px-5 pb-4">
          <CommandFailure failure={map.failure} title="That account was refused" />
        </div>
      </Panel>

      <Panel title="What posts" flush>
        <RowList>
          {kinds.map((k) => (
            <Row key={k.kind}>
              <span className="min-w-0 text-[15px]">{k.label}</span>
              <span className="tabular text-[14px] text-text-secondary">
                {k.posted} posted · {k.waiting} waiting
              </span>
            </Row>
          ))}
        </RowList>
        <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <Button
            variant="primary"
            disabled={postNow.pending || waiting === 0}
            onClick={() => postNow.run("verity.accounting.post_documents_now", {})}
          >
            {postNow.pending ? "Posting…" : `Post ${waiting} waiting now`}
          </Button>
          <span className="text-[13px] text-text-tertiary">
            This also runs by itself every few minutes. Credit notes, purchase bills and job invoices are not posted yet.
          </span>
        </div>
        <div className="px-5 pb-4">
          <CommandFailure failure={postNow.failure} title="Posting was refused" />
        </div>
      </Panel>

      {pending.length > 0 && (
        <Panel title="Waiting, and why" flush>
          <RowList>
            {pending.map((p) => (
              <Row key={p.key}>
                <span className="min-w-0">
                  <span className="block text-[15px]">{p.kindLabel}</span>
                  <span className="block text-[13px] text-warning">{p.reason}</span>
                </span>
                <span className="text-[13px] text-text-tertiary">since {p.since}</span>
              </Row>
            ))}
          </RowList>
        </Panel>
      )}
    </div>
  );
}
