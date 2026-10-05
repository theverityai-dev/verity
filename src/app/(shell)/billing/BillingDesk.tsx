"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/ui/DataTable";
import { Tabs } from "@/components/ui/Tabs";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { FormModal, formPaise, formText, useCommand } from "@/components/ui/CommandForm";
import { runCommand } from "@/server/actions/platform";

export type MeterRow = {
  id: string;
  name: string;
  customer: string;
  rate: string;
  ratePaise: number;
  lastReading: string;
  lastReadingUnits: number | null;
  lastReadAt: string;
  active: boolean;
};
export type PeriodRow = { id: string; period: string; invoices: number; total: string; status: string };
export type InvoiceRow = {
  id: string;
  customer: string;
  meter: string;
  period: string;
  usage: string;
  amount: string;
  generated: string;
};
type PartyOption = { id: string; displayName: string };

const ROUTE = "/billing";
const startOfDay = (date: string) => `${date}T00:00:00.000Z`;
const endOfDay = (date: string) => `${date}T23:59:59.999Z`;

/* ---------------------------------- meters --------------------------------- */

function MetersTab({ meters, parties }: { meters: MeterRow[]; parties: PartyOption[] }) {
  const [adding, setAdding] = useState(false);
  const [reading, setReading] = useState<MeterRow | null>(null);
  const [rating, setRating] = useState<MeterRow | null>(null);
  const add = useCommand(ROUTE);
  const record = useCommand(ROUTE);
  const rate = useCommand(ROUTE);

  return (
    <>
      <DataTable
        caption="Meters"
        emptyTitle="No meters yet"
        emptyDescription="A meter belongs to one customer and is billed per unit used."
        emptyAction={<Button variant="primary" onClick={() => setAdding(true)}>Add meter</Button>}
        columns={[
          { key: "name", header: "Meter", sortable: true, subKey: "customer" },
          { key: "rate", header: "Rate", numeric: true },
          { key: "lastReading", header: "Last reading", numeric: true, subKey: "lastReadAt" },
        ]}
        rows={meters}
        toolbar={<Button variant="primary" onClick={() => setAdding(true)} disabled={parties.length === 0}>Add meter</Button>}
        rowActions={(row) => {
          const meter = row as unknown as MeterRow;
          if (!meter.active) return null;
          return (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setReading(meter)}>Record reading</Button>
              <Button size="sm" variant="ghost" onClick={() => setRating(meter)}>Change rate</Button>
            </div>
          );
        }}
      />

      <FormModal
        title="Add meter"
        description="Usage on this meter is billed to the customer at the rate per unit."
        open={adding}
        onClose={() => {
          setAdding(false);
          add.clear();
        }}
        submitLabel="Add meter"
        pending={add.pending}
        failure={add.failure}
        failureTitle="Could not add the meter"
        onSubmit={(form) =>
          add.run(
            "verity.billing.create_meter",
            { partyId: formText(form, "partyId"), name: formText(form, "name"), ratePerUnitMinor: formPaise(form, "rate") ?? 0 },
            () => setAdding(false),
          )
        }
      >
        <Field label="Customer" htmlFor="bm-party" required>
          <Select id="bm-party" name="partyId" required defaultValue="">
            <option value="" disabled>Choose a customer</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>{p.displayName}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Meter name" htmlFor="bm-name" required>
            <Input id="bm-name" name="name" required maxLength={120} placeholder="Unit 4 electricity" />
          </Field>
          <Field label="Rate per unit (₹)" htmlFor="bm-rate" required>
            <Input id="bm-rate" name="rate" type="number" min={0} step="0.01" inputMode="decimal" required />
          </Field>
        </div>
      </FormModal>

      <FormModal
        title="Record reading"
        description={reading ? `${reading.name} · ${reading.customer}. Last: ${reading.lastReading}.` : ""}
        open={reading !== null}
        onClose={() => {
          setReading(null);
          record.clear();
        }}
        submitLabel="Record reading"
        pending={record.pending}
        failure={record.failure}
        failureTitle="Could not record the reading"
        onSubmit={(form) => {
          if (!reading) return;
          record.run(
            "verity.billing.record_meter_reading",
            { meterId: reading.id, readingUnits: Number.parseInt(formText(form, "units"), 10) },
            () => setReading(null),
          );
        }}
      >
        <Field label="Reading (units)" htmlFor="bm-units" required hint="A reading lower than the last one is refused.">
          <Input id="bm-units" name="units" type="number" min={reading?.lastReadingUnits ?? 0} step={1} required autoFocus />
        </Field>
      </FormModal>

      <FormModal
        title="Change rate"
        description={rating ? `${rating.name} · now ${rating.rate}. Applies to invoices generated from now on.` : ""}
        open={rating !== null}
        onClose={() => {
          setRating(null);
          rate.clear();
        }}
        submitLabel="Save rate"
        pending={rate.pending}
        failure={rate.failure}
        failureTitle="Could not change the rate"
        onSubmit={(form) => {
          if (!rating) return;
          rate.run(
            "verity.billing.set_meter_rate",
            { meterId: rating.id, ratePerUnitMinor: formPaise(form, "rate") ?? 0 },
            () => setRating(null),
          );
        }}
      >
        <Field label="Rate per unit (₹)" htmlFor="bm-new-rate" required>
          <Input
            id="bm-new-rate"
            name="rate"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            required
            autoFocus
            defaultValue={rating ? (rating.ratePaise / 100).toFixed(2) : undefined}
          />
        </Field>
      </FormModal>
    </>
  );
}

/* --------------------------------- periods --------------------------------- */

function PeriodsTab({ periods, meters }: { periods: PeriodRow[]; meters: MeterRow[] }) {
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  const open = useCommand(ROUTE);
  const [generating, startGenerating] = useTransition();
  const [outcome, setOutcome] = useState<{ made: number; skipped: string[] } | null>(null);
  const activeMeters = meters.filter((m) => m.active);

  // One command per meter, each authorised on its own, so one meter with no
  // reading does not stop the rest. Re-running is safe: a meter that already
  // has an invoice for the period is refused by the database and reported.
  function generate(periodId: string) {
    startGenerating(async () => {
      let made = 0;
      const skipped: string[] = [];
      for (const meter of activeMeters) {
        const result = await runCommand("verity.billing.generate_invoice_for_meter", { meterId: meter.id, billingPeriodId: periodId }, ROUTE);
        if (result.ok) made += 1;
        else skipped.push(`${meter.name}: ${result.message.replace(/^E_VALIDATION:\s*/, "")}`);
      }
      setOutcome({ made, skipped });
      router.refresh();
    });
  }

  return (
    <>
      <DataTable
        caption="Billing periods"
        emptyTitle="No billing periods yet"
        emptyDescription="Open a period, record readings in it, then generate its invoices."
        emptyAction={<Button variant="primary" onClick={() => setOpening(true)}>Open period</Button>}
        columns={[
          { key: "period", header: "Period", sortable: true },
          { key: "invoices", header: "Invoices", numeric: true },
          { key: "total", header: "Total", numeric: true },
          { key: "status", header: "Status" },
        ]}
        rows={periods}
        toolbar={<Button variant="primary" onClick={() => setOpening(true)}>Open period</Button>}
        rowActions={(row) => {
          const period = row as unknown as PeriodRow;
          return (
            <Button size="sm" variant="secondary" disabled={generating || activeMeters.length === 0} onClick={() => generate(period.id)}>
              {generating ? "Generating…" : "Generate invoices"}
            </Button>
          );
        }}
      />
      {outcome && (
        <div className="mt-4 rounded-[12px] bg-surface px-4 py-3 text-[14px]" role="status">
          <p className="m-0 text-text">
            {outcome.made} {outcome.made === 1 ? "invoice" : "invoices"} generated.
            {outcome.skipped.length > 0 && ` ${outcome.skipped.length} skipped:`}
          </p>
          {outcome.skipped.length > 0 && (
            <ul className="mb-0 mt-2 pl-5 text-text-secondary">
              {outcome.skipped.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <FormModal
        title="Open billing period"
        description="Readings taken inside the period are billed on its invoices."
        open={opening}
        onClose={() => {
          setOpening(false);
          open.clear();
        }}
        submitLabel="Open period"
        pending={open.pending}
        failure={open.failure}
        failureTitle="Could not open the period"
        onSubmit={(form) =>
          open.run(
            "verity.billing.open_billing_period",
            { periodStart: startOfDay(formText(form, "start")), periodEnd: endOfDay(formText(form, "end")) },
            () => setOpening(false),
          )
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="From" htmlFor="bp-start" required>
            <Input id="bp-start" name="start" type="date" required />
          </Field>
          <Field label="To" htmlFor="bp-end" required>
            <Input id="bp-end" name="end" type="date" required />
          </Field>
        </div>
      </FormModal>
    </>
  );
}

/* -------------------------------- invoices --------------------------------- */

function InvoicesTab({ invoices }: { invoices: InvoiceRow[] }) {
  return (
    <DataTable
      caption="Invoices, newest first"
      emptyTitle="No invoices yet"
      emptyDescription="Generate invoices from a billing period."
      columns={[
        { key: "customer", header: "Customer", sortable: true, subKey: "meter" },
        { key: "period", header: "Period", sortable: true },
        { key: "usage", header: "Usage", numeric: true },
        { key: "amount", header: "Amount", numeric: true },
        { key: "generated", header: "Generated", sortable: true },
      ]}
      rows={invoices}
    />
  );
}

/* ----------------------------------- desk ---------------------------------- */

export function BillingDesk({
  meters,
  periods,
  invoices,
  parties,
}: {
  meters: MeterRow[];
  periods: PeriodRow[];
  invoices: InvoiceRow[];
  parties: PartyOption[];
}) {
  return (
    <Tabs
      tabs={[
        { id: "meters", label: "Meters", count: meters.length, content: <MetersTab meters={meters} parties={parties} /> },
        { id: "periods", label: "Periods", count: periods.length, content: <PeriodsTab periods={periods} meters={meters} /> },
        { id: "invoices", label: "Invoices", count: invoices.length, content: <InvoicesTab invoices={invoices} /> },
      ]}
    />
  );
}
