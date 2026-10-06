"use client";

import { useState } from "react";
import { FormModal, formText, useCommand } from "@/components/ui/CommandForm";
import { Button, Field, Input } from "@/components/ui/primitives";

/** Sets the monthly salary. Shown only to roles that may edit pay (DECISIONS.md #3). */
export function SalaryEditor({ employeeId, current }: { employeeId: string; current: number | null }) {
  const [open, setOpen] = useState(false);
  const command = useCommand(`/hr/${employeeId}`);
  return (
    <>
      <Button onClick={() => setOpen(true)}>{current === null ? "Set salary" : "Change salary"}</Button>
      <FormModal
        title="Monthly salary"
        description="Only people allowed to see pay can read this. Leave blank to clear it."
        open={open}
        onClose={() => {
          setOpen(false);
          command.clear();
        }}
        submitLabel="Save salary"
        pending={command.pending}
        failure={command.failure}
        failureTitle="Could not save the salary"
        onSubmit={(form) => {
          const raw = formText(form, "salary").replace(/[,₹\s]/g, "");
          command.run(
            "verity.hr.set_employee_salary",
            { employeeId, monthlySalaryMinor: raw === "" ? null : Math.round(Number(raw) * 100) },
            () => setOpen(false),
          );
        }}
      >
        <Field label="Monthly salary (₹)" htmlFor="salary" hint="Gross, before deductions.">
          <Input
            id="salary"
            name="salary"
            inputMode="decimal"
            defaultValue={current === null ? "" : (current / 100).toFixed(2)}
            pattern="[0-9,]*(\.[0-9]{1,2})?"
            autoFocus
          />
        </Field>
      </FormModal>
    </>
  );
}
