"use client";

import { CommandButton } from "@/components/ui/CommandAccess";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  EmptyState,
  ErrorState,
  Input,
  Panel,
  Row,
  RowList,
  StateBadge,
  StatTile,
  StatTileRow,
} from "@/components/ui/primitives";
import { Avatar } from "@/components/ui/Avatar";
import { OverflowMenu, OverflowMenuItem } from "@/components/ui/OverflowMenu";
import { ProgressBar } from "@/components/ui/viz";
import {
  NewCustomerModal,
  type CustomerDraft,
} from "@/components/ui/business/NewCustomerModal";
import { rupees, rupeesShort } from "@/components/ui/business/format";
import { Modal, ModalCancel } from "@/components/ui/Modal";
import { runCommand } from "@/server/actions/platform";
import type { ActionFailure } from "@/server/platform/action-error";

type Customer = {
  id: string;
  displayName: string;
  gstin: string | null;
  phone: string | null;
  stateCode: string | null;
  creditLimitPaise: number;
  exposurePaise: number;
  availableCreditPaise: number;
  active: boolean;
};

export function CustomerList({ customers, canCreate = false, canEdit = false, canDelete = false }: { customers: Customer[]; canCreate?: boolean; canEdit?: boolean; canDelete?: boolean }) {
  const [filter, setFilter] = useState("");
  // Reported: creating a customer lived on Sales only, so the page anyone opens
  // to look a customer up could not make one.
  const [creating, setCreating] = useState(false);
  // Requested: edit and remove. Removing DEACTIVATES a customer who has traded
  // — their orders, invoices and ledger entries all point at them — and deletes
  // one who never has, because a leftover typo is clutter that never clears.
  const [editing, setEditing] = useState<Customer | null>(null);
  const [removing, setRemoving] = useState<Customer | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const matching = !needle
      ? customers
      : customers.filter(
          (customer) =>
            customer.displayName.toLowerCase().includes(needle) ||
            (customer.gstin ?? "").toLowerCase().includes(needle),
        );
    // Those past their limit need a decision, so they lead; the rest keep the server's order.
    const pastLimit = (c: Customer) => (c.exposurePaise > c.creditLimitPaise ? 0 : 1);
    return [...matching].sort((a, b) => pastLimit(a) - pastLimit(b));
  }, [customers, filter]);

  const totals = useMemo(
    () => ({
      exposure: customers.reduce((sum, c) => sum + c.exposurePaise, 0),
      // Customers over their limit are the working list for a sales manager;
      // everyone else needs no decision.
      overLimit: customers.filter((c) => c.exposurePaise > c.creditLimitPaise).length,
      // Only customers with a limit have headroom; "no limit" is not zero headroom.
      headroom: customers.reduce((sum, c) => sum + (c.creditLimitPaise > 0 ? c.availableCreditPaise : 0), 0),
      limited: customers.filter((c) => c.creditLimitPaise > 0).length,
    }),
    [customers],
  );

  function create(input: unknown) {
    setFailure(null);
    startTransition(async () => {
      const result = await runCommand(
        "verity.trading.create_customer",
        input,
        "/customers",
      );
      if (result.ok) {
        setCreating(false);
        router.refresh();
      } else {
        setFailure(result);
      }
    });
  }

  function send(key: string, input: unknown, done: () => void) {
    setFailure(null);
    startTransition(async () => {
      const result = await runCommand(key, input, "/customers");
      if (result.ok) {
        done();
        router.refresh();
      } else {
        setFailure(result);
      }
    });
  }

  const asDraft = (row: Customer): CustomerDraft => ({
    displayName: row.displayName,
    gstin: row.gstin,
    stateCode: row.stateCode,
    phone: row.phone,
    creditLimitPaise: row.creditLimitPaise,
  });

  const dialog = (
    <>
      <NewCustomerModal
        open={creating}
        pending={pending}
        onClose={() => setCreating(false)}
        onSubmit={create}
      />
      <NewCustomerModal
        open={editing !== null}
        pending={pending}
        initial={editing ? asDraft(editing) : null}
        onClose={() => setEditing(null)}
        onSubmit={(input) =>
          send(
            "verity.trading.edit_customer",
            { customerId: editing!.id, ...input },
            () => setEditing(null),
          )
        }
      />
      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.displayName ?? ""}?`}
        description="If they have ever been sold to, they are kept and simply stop being offered — their orders, invoices and ledger explain money and cannot be orphaned. A customer with no history is deleted outright."
        width="sm"
        footer={
          <>
            <ModalCancel onClose={() => setRemoving(null)} disabled={pending}>
              Keep
            </ModalCancel>
            <CommandButton commands={"verity.trading.remove_customer"}
              variant="danger"
              disabled={pending}
              onClick={() =>
                send(
                  "verity.trading.remove_customer",
                  { customerId: removing!.id },
                  () => setRemoving(null),
                )
              }
            >
              Remove
            </CommandButton>
          </>
        }
      >
        <p className="m-0 text-[13px] text-text-secondary">
          Nothing already recorded against them changes either way.
        </p>
      </Modal>
    </>
  );

  if (customers.length === 0) {
    return (
      <>
        {failure && (
          <div className="mb-4">
            <ErrorState
              title="That was refused"
              message={failure.message}
              issues={failure.issues}
              retryable={failure.retryable}
            />
          </div>
        )}
        <EmptyState
          title="No customers yet"
          description="Add the first one here, or let a sales order create them."
          action={canCreate ? (
            <CommandButton commands={"verity.trading.create_customer"} variant="primary" onClick={() => setCreating(true)}>
              New customer
            </CommandButton>
          ) : undefined}
        />
        {dialog}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {failure && (
        <ErrorState
          title="That was refused"
          message={failure.message}
          issues={failure.issues}
          retryable={failure.retryable}
        />
      )}
      <StatTileRow cols={4}>
        <StatTile kind="party" label="Customers" value={customers.length} />
        <StatTile kind="money" label="Exposure" value={rupeesShort(totals.exposure)} hint="Owed plus committed" />
        <StatTile
          kind="sales"
          label="Headroom"
          value={totals.limited === 0 ? "—" : rupeesShort(totals.headroom)}
          hint={totals.limited === 0 ? "No customer has a credit limit" : `Across ${totals.limited} with a limit`}
        />
        <StatTile
          state={totals.overLimit === 0 ? "completed" : "blocked"}
          icon={totals.overLimit === 0 ? "check" : "hold"}
          label="Over limit"
          value={totals.overLimit}
          hint={totals.overLimit === 0 ? "Nobody" : "Need a decision"}
        />
      </StatTileRow>

      <Panel
        flush
        title="All customers"
        action={
          <div className="flex min-w-0 flex-wrap items-center gap-2 max-sm:w-full">
            <div className="w-56 max-sm:min-w-0 max-sm:flex-1">
              <Input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Name or GSTIN"
                aria-label="Filter customers"
              />
            </div>
            {canCreate && <CommandButton commands={"verity.trading.create_customer"} variant="primary" onClick={() => setCreating(true)}>
              New customer
            </CommandButton>}
          </div>
        }
      >
        {shown.length === 0 ? (
          <div className="px-5 py-6">
            <EmptyState compact title="No customer matches that" />
          </div>
        ) : (
          <RowList>
            {shown.map((customer) => {
              const over = customer.exposurePaise > customer.creditLimitPaise;
              const near = !over && customer.creditLimitPaise > 0 && customer.exposurePaise >= customer.creditLimitPaise * 0.8;
              return (
                <Row key={customer.id}>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar name={customer.displayName} size={40} />
                    <div className="min-w-0">
                      <Link
                        href={`/customers/${customer.id}`}
                        className="text-[15px] font-medium text-text no-underline hover:underline"
                      >
                        {customer.displayName}
                      </Link>
                      <p className="m-0 mt-0.5 text-[13px] text-text-secondary">
                        {customer.gstin ?? "No GSTIN recorded"}
                        {customer.phone ? ` · ${customer.phone}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-6 text-right max-md:hidden">
                    <div className="w-52 shrink-0 text-left">
                      {customer.creditLimitPaise > 0 ? (
                        <ProgressBar
                          value={customer.exposurePaise}
                          total={Math.max(customer.creditLimitPaise, customer.exposurePaise)}
                          marker={customer.creditLimitPaise}
                          tone={over ? "blocked" : near ? "pending" : "completed"}
                          figures={`${rupeesShort(customer.exposurePaise)} of ${rupeesShort(customer.creditLimitPaise)}`}
                          label={`Credit used by ${customer.displayName}`}
                        />
                      ) : null}
                      {/* Stated in words rather than by a minus sign or by
                          colour alone: a leading "−" against headroom reads as
                          negative money, and colour is not information to a
                          reader who cannot see it. */}
                      {customer.creditLimitPaise > 0 && (
                        <p className="tabular m-0 mt-1 text-[13px] text-text-secondary">
                          {over
                            ? `${rupees(customer.exposurePaise - customer.creditLimitPaise)} past their limit`
                            : `${rupees(customer.availableCreditPaise)} still available`}
                        </p>
                      )}
                    </div>
                    <div className="w-28 shrink-0 text-left">
                      {customer.creditLimitPaise > 0 ? (
                        <StateBadge category={over ? "Blocked" : near ? "Pending" : "Completed"} label={over ? "Over limit" : near ? "Near limit" : "Within limit"} />
                      ) : (
                        <StateBadge category="Draft" label="No limit" />
                      )}
                    </div>
                  </div>
                  {(canEdit || canDelete) && (
                    <OverflowMenu label={`More actions for ${customer.displayName}`}>
                      {canEdit && <OverflowMenuItem onClick={() => setEditing(customer)}>Edit</OverflowMenuItem>}
                      {canDelete && <OverflowMenuItem danger onClick={() => setRemoving(customer)}>Remove</OverflowMenuItem>}
                    </OverflowMenu>
                  )}
                </Row>
              );
            })}
          </RowList>
        )}
      </Panel>
      {dialog}
    </div>
  );
}
