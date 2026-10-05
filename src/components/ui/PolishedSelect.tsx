"use client";

import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ButtonHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { Icon } from "./icons";

type Option = { value: string; label: string; disabled?: boolean };

function readOptions(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const props = child.props as { value?: unknown; disabled?: boolean; children?: ReactNode };
    const label = (node: ReactNode): string => {
      if (typeof node === "string" || typeof node === "number") return String(node);
      if (Array.isArray(node)) return node.map(label).join("");
      return isValidElement(node) ? label((node.props as { children?: ReactNode }).children) : "";
    };
    return [{
      value: String(props.value ?? ""),
      label: label(props.children),
      disabled: props.disabled,
    }];
  });
}

/**
 * The product-wide select control. The native select remains visually hidden
 * so ordinary forms, server actions, required validation and existing callers
 * keep working; the button/listbox is the user-facing control everywhere.
 */
export function PolishedSelect({ children, className, containerClassName, id, name, value, defaultValue, onChange, disabled, required, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { containerClassName?: string }) {
  const generatedId = useId();
  const controlId = id ?? `select-${generatedId}`;
  const options = readOptions(children);
  const initialValue = String(value ?? defaultValue ?? options[0]?.value ?? "");
  const [selectedValue, setSelectedValue] = useState(initialValue);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.findIndex((option) => option.value === initialValue)));
  const rootRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const currentValue = value == null ? selectedValue : String(value);
  const selected = options.find((option) => option.value === currentValue) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const firstEnabled = options.findIndex((option) => !option.disabled);
    setActiveIndex(Math.max(0, options.findIndex((option) => option.value === currentValue), firstEnabled));
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, currentValue, options]);

  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  function choose(option: Option) {
    if (option.disabled) return;
    setSelectedValue(option.value);
    setOpen(false);
    const event = { target: { value: option.value }, currentTarget: { value: option.value } } as ChangeEvent<HTMLSelectElement>;
    onChange?.(event);
  }

  function move(delta: number) {
    if (options.length === 0) return;
    let next = activeIndex;
    for (let i = 0; i < options.length; i += 1) {
      next = (next + delta + options.length) % options.length;
      if (!options[next]?.disabled) {
        setActiveIndex(next);
        return;
      }
    }
  }

  return (
    <div ref={rootRef} className={`relative min-w-0 w-full ${containerClassName ?? ""}`}>
      <button
        id={controlId}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`bg-control flex h-11 min-w-0 w-full cursor-pointer items-center justify-between gap-3 rounded-[10px] px-4 text-left text-[14px] text-text transition-[border-color,box-shadow] duration-200 focus:outline-none focus:shadow-[0_0_0_3px_var(--color-accent-subtle)] disabled:cursor-not-allowed disabled:opacity-55 ${className ?? ""}`}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowRight") {
            event.preventDefault();
            if (!open) setOpen(true); else move(1);
          } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
            event.preventDefault();
            if (!open) setOpen(true); else move(-1);
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (open && options[activeIndex]) choose(options[activeIndex]!); else setOpen(true);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        {...(rest as Omit<ButtonHTMLAttributes<HTMLButtonElement>, "value">)}
      >
        <span className={selected ? "truncate" : "truncate text-text-tertiary"}>{selected?.label ?? "Select…"}</span>
        <Icon name="chevronDown" size={16} className={`shrink-0 text-text-tertiary transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <select
        {...rest}
        id={`${controlId}-native`}
        name={name}
        value={currentValue}
        required={required}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        onChange={() => undefined}
        className="sr-only"
      >
        {children}
      </select>

      {open && options.length > 0 && (
        <div role="listbox" aria-labelledby={controlId} className="glass-overlay absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-64 overflow-y-auto rounded-xl p-1.5 shadow-[var(--shadow-lg)]">
          {options.map((option, index) => {
            const isSelected = option.value === currentValue;
            return (
              <button
                key={`${option.value}-${index}`}
                ref={(element) => { optionRefs.current[index] = element; }}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={option.disabled}
                className={`flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-[14px] transition-colors ${isSelected ? "bg-accent-subtle text-text" : "text-text-secondary hover:bg-surface-sunken hover:text-text"} disabled:cursor-not-allowed disabled:opacity-45`}
                onClick={() => choose(option)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
                  if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
                  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(option); }
                  if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
                }}
              >
                <span className="truncate">{option.label}</span>
                {isSelected && <Icon name="check" size={16} className="shrink-0 text-accent" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
