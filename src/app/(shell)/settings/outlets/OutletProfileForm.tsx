"use client";

import { CommandButton } from "@/components/ui/CommandAccess";
import { CommandFailure, useCommand } from "@/components/ui/CommandForm";
import { Checkbox, Field, Input, Panel, Select, Textarea } from "@/components/ui/primitives";
import type { OutletProfileView } from "@/server/capabilities/dinein";

function clock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/**
 * One outlet's billing identity (ADR-040): the code that starts its bill numbers,
 * the seller named on every invoice, the day it keeps, and its service charge.
 * Until it is saved the outlet bills as it always has.
 */
export function OutletProfileForm({ outlet }: { outlet: OutletProfileView }) {
  const save = useCommand("/settings/outlets");
  const p = outlet.profile;

  return (
    <Panel title={outlet.locationName} action={<span className="text-[12px] text-text-tertiary">{p ? `Bills start with ${p.code}/` : "Not set up: bills use the old label"}</span>}>
      <CommandFailure failure={save.failure} title="Could not save the outlet" />
      <form
        className="grid gap-4 sm:grid-cols-2"
        action={(formData) => {
          const [h, m] = String(formData.get("dayStart") ?? "05:00").split(":").map(Number);
          save.run("verity.dinein.save_outlet_profile", {
            locationId: outlet.locationId,
            code: String(formData.get("code") ?? ""),
            legalName: String(formData.get("legalName") ?? ""),
            gstin: String(formData.get("gstin") ?? "") || null,
            stateCode: String(formData.get("stateCode") ?? "") || null,
            registrationType: String(formData.get("registrationType") ?? "regular"),
            fssai: String(formData.get("fssai") ?? "") || null,
            addressLines: String(formData.get("addressLines") ?? "") || null,
            dayStartMinute: (h ?? 5) * 60 + (m ?? 0),
            serviceChargeBp: Math.round(Number(formData.get("serviceCharge") ?? 0) * 100),
            platformTaxFree: formData.get("platformTaxFree") === "on",
          });
        }}
      >
        <Field label="Bill code" htmlFor={`code-${outlet.locationId}`} hint="Up to 3 letters or digits. Cannot change once bills carry it." required>
          <Input id={`code-${outlet.locationId}`} name="code" required maxLength={3} defaultValue={p?.code ?? ""} className="uppercase" />
        </Field>
        <Field label="Legal name on the invoice" htmlFor={`legal-${outlet.locationId}`} required>
          <Input id={`legal-${outlet.locationId}`} name="legalName" required defaultValue={p?.legalName ?? ""} />
        </Field>
        <Field label="Registration" htmlFor={`reg-${outlet.locationId}`} hint="A composition or unregistered outlet issues an invoice with no tax.">
          <Select id={`reg-${outlet.locationId}`} name="registrationType" defaultValue={p?.registrationType ?? "regular"}>
            <option value="regular">Regular GST registration</option>
            <option value="composition">Composition scheme</option>
            <option value="unregistered">Not registered</option>
          </Select>
        </Field>
        <Field label="GSTIN" htmlFor={`gstin-${outlet.locationId}`} hint="15 characters. Required unless not registered.">
          <Input id={`gstin-${outlet.locationId}`} name="gstin" maxLength={15} defaultValue={p?.gstin ?? ""} className="uppercase" />
        </Field>
        <Field label="State code" htmlFor={`state-${outlet.locationId}`} hint="The first two digits of the GSTIN.">
          <Input id={`state-${outlet.locationId}`} name="stateCode" maxLength={2} inputMode="numeric" defaultValue={p?.stateCode ?? ""} />
        </Field>
        <Field label="FSSAI licence number" htmlFor={`fssai-${outlet.locationId}`}>
          <Input id={`fssai-${outlet.locationId}`} name="fssai" maxLength={40} defaultValue={p?.fssai ?? ""} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Address on the invoice" htmlFor={`address-${outlet.locationId}`}>
            <Textarea id={`address-${outlet.locationId}`} name="addressLines" rows={3} maxLength={400} defaultValue={p?.addressLines ?? ""} />
          </Field>
        </div>
        <Field label="Service day starts at" htmlFor={`day-${outlet.locationId}`} hint="Sales before this time count toward the day before.">
          <Input id={`day-${outlet.locationId}`} name="dayStart" type="time" required defaultValue={clock(p?.dayStartMinute ?? 300)} />
        </Field>
        <Field label="Service charge (%)" htmlFor={`sc-${outlet.locationId}`} hint="Table service only. A guest can have it taken off. 0 for none.">
          <Input id={`sc-${outlet.locationId}`} name="serviceCharge" type="number" min={0} max={20} step="0.5" defaultValue={(p?.serviceChargeBp ?? 0) / 100} />
        </Field>
        <div className="sm:col-span-2">
          <Checkbox
            name="platformTaxFree"
            defaultChecked={p?.platformTaxFree ?? true}
            label="No tax on our own invoice for delivery-platform orders (the platform collects and pays it). Confirm with your tax adviser."
            className="min-h-11"
          />
        </div>
        <div className="sm:col-span-2">
          <CommandButton commands={"verity.dinein.save_outlet_profile"} type="submit" variant="primary" disabled={save.pending}>
            {save.pending ? "Saving…" : p ? "Save outlet" : "Set up this outlet"}
          </CommandButton>
        </div>
      </form>
    </Panel>
  );
}
