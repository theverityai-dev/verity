import type { FieldDescriptor, FormDescriptor } from "@/server/platform/experience";
import { Checkbox, Field, Input, Select } from "@/components/ui/primitives";

/**
 * Renders a form from a descriptor (implementation/08-experience/metadata-driven-ui.md).
 *
 * The component makes no decisions: which fields exist, whether they are
 * editable, and which are secondary are all resolved server-side by the
 * experience runtime. That is deliberate — a capability adding an entity or a
 * tenant adding a custom field must change the interface without any component
 * being edited.
 *
 * This is platform scaffolding, not product UI. It is intentionally unstyled.
 */

function Control({ field, disabled, id }: { field: FieldDescriptor; disabled: boolean; id: string }) {
  const locked = disabled || field.readOnly;

  switch (field.control) {
    case "checkbox":
      return <Checkbox id={id} name={field.name} disabled={locked} label={field.name} />;
    case "number":
      return <Input id={id} type="number" name={field.name} required={field.required} disabled={locked} />;
    case "date":
      return <Input id={id} type="date" name={field.name} required={field.required} disabled={locked} />;
    case "select":
      return (
        <Select id={id} name={field.name} required={field.required} disabled={locked}>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      );
    case "readonly":
      // Unknown declared type: show it, never edit it, never crash the form.
      return <Input id={id} type="text" name={field.name} readOnly disabled />;
    default:
      return <Input id={id} type="text" name={field.name} required={field.required} disabled={locked} />;
  }
}

function DescriptorField({ field, disabled }: { field: FieldDescriptor; disabled: boolean }) {
  const id = `dynamic-${field.name}`;
  if (field.control === "checkbox") {
    return <Control field={field} disabled={disabled} id={id} />;
  }
  return (
    <Field label={field.name} htmlFor={id} required={field.required}>
      <Control field={field} disabled={disabled} id={id} />
    </Field>
  );
}

export function DynamicForm({ descriptor }: { descriptor: FormDescriptor }) {
  const primary = descriptor.fields.filter((f) => !f.secondary);
  const secondary = descriptor.fields.filter((f) => f.secondary);

  return (
    <form className="flex flex-col gap-5" data-entity={descriptor.entityKey} data-readonly={descriptor.readOnly}>
      <fieldset className="m-0 flex flex-col gap-4 border-0 p-0" disabled={descriptor.readOnly}>
        {primary.map((field) => (
          <DescriptorField key={field.name} field={field} disabled={descriptor.readOnly} />
        ))}

        {/* PRN-002: secondary metadata sits behind disclosure rather than
            competing with the fields most users came for. */}
        {secondary.length > 0 && (
          <details className="rounded-[12px] bg-surface px-4 py-3 text-[13px] text-text">
            <summary className="cursor-pointer font-medium marker:text-text-tertiary">Additional fields</summary>
            <div className="mt-4 flex flex-col gap-4">
              {secondary.map((field) => (
                <DescriptorField key={field.name} field={field} disabled={descriptor.readOnly} />
              ))}
            </div>
          </details>
        )}
      </fieldset>
    </form>
  );
}
