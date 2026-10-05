"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { prefersReducedMotion, reducedMotionFade, springDefault } from "@/lib/motion";

export type ComboboxOption = {
  value: string;
  label: string;
  /** Second line — availability, GSTIN, a price. Searched as well as shown. */
  note?: string;
  disabled?: boolean;
};

/**
 * A single-select control you can type into.
 *
 * Task 71 item 1. Every picker on the desks was a native `<select>`. That is
 * fine for four godowns and unusable for four hundred boards: the native
 * control's own type-ahead matches a prefix only, resets after a second, and
 * cannot match on the middle of a name — so finding "18mm Gurjan MR" meant
 * scrolling a list the length of the catalogue.
 *
 * Matching is on every word of the query against label and note, in any order
 * and any position, so "gurjan 18" finds "18mm Gurjan MR" and "greenply"
 * finds a board by its brand note.
 *
 * The selected value is submitted through a hidden input, so the surrounding
 * `<form action={…}>` reads it out of FormData exactly like the select it
 * replaces — callers did not have to change how they submit.
 */
export function Combobox({
  id,
  name,
  options,
  value,
  onChange,
  placeholder = "Search…",
  required,
  disabled,
  autoFocus,
  emptyMessage = "Nothing matches",
}: {
  id: string;
  /** Omit for a controlled-only combobox that is not part of a form post. */
  name?: string;
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  emptyMessage?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  /**
   * Where to draw the list, in viewport coordinates.
   *
   * REPORTED: "the dropdown lists are very small, only 1 item is visible."
   *
   * The list was absolutely positioned inside the field, and every form that
   * matters here sits inside a `Modal`, whose body is `overflow-y-auto` so a
   * long form scrolls rather than growing past the viewport. An absolutely
   * positioned child is clipped by the nearest scrolling ancestor, so the list
   * was cut off at the bottom edge of whatever space happened to be left — one
   * row, in a short modal.
   *
   * Fixed positioning in a portal on <body> escapes that: nothing between the
   * field and the body can clip it. The cost is that the position has to be
   * measured and kept up to date, which is what this state and the listener
   * below are for.
   */
  const [anchor, setAnchor] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
    above: boolean;
  } | null>(null);

  /**
   * Where the list is mounted: the nearest <dialog> ancestor, or the body.
   *
   * It CANNOT always be the body. A dialog opened with showModal() is promoted
   * to the browser's TOP LAYER, which is painted above the entire document and
   * is not reachable by z-index — so a list portalled to the body while a modal
   * is open renders underneath it and is invisible. That is the second half of
   * the reported fault: portalling out of the modal's scroll container fixed
   * the clipping and made the list disappear instead.
   *
   * Mounting into the dialog element itself puts the list in the top layer with
   * it, while still being outside the dialog's scrolling body — so neither the
   * clipping nor the stacking problem applies.
   */
  const [host, setHost] = useState<HTMLElement | null>(null);

  const measure = useCallback(() => {
    const field = rootRef.current;
    if (!field) return;
    const box = field.getBoundingClientRect();
    const below = window.innerHeight - box.bottom - 8;
    const above = box.top - 8;
    // Open upward when there is materially more room there. A picker near the
    // bottom of a modal otherwise gets a few pixels of list and nothing else,
    // which is the reported symptom in its other form.
    const openAbove = below < 200 && above > below;
    setAnchor({
      left: box.left,
      width: box.width,
      top: openAbove ? box.top - 4 : box.bottom + 4,
      // Never smaller than about four rows: a list you cannot see is not a
      // list. If the space is genuinely that tight the list scrolls itself.
      maxHeight: Math.max(180, Math.min(320, openAbove ? above : below)),
      above: openAbove,
    });
  }, []);

  // Before paint, so the list never appears at the wrong place for a frame.
  useLayoutEffect(() => {
    if (!open) return;
    setHost(rootRef.current?.closest("dialog") ?? document.body);
    measure();
    // Capture phase: an ancestor scrolling is exactly the case that moves the
    // field, and scroll events on it do not bubble to window.
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open, measure]);

  const selected = options.find((option) => option.value === value) ?? null;

  const matches = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return options;
    return options.filter((option) => {
      const haystack = `${option.label} ${option.note ?? ""}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [options, query]);

  // The highlighted row must exist in the current match set. Without this a
  // filter that shortens the list leaves the highlight past its end, and Enter
  // then selects nothing while looking like it should select something.
  useEffect(() => {
    setActive((current) => (current < matches.length ? current : 0));
  }, [matches.length]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      // The list lives on <body> now, so "inside" is the field OR the list.
      if (rootRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  });

  // Keeps the highlighted row in view under arrow-key navigation. Without it
  // the highlight walks off the bottom of a scrolled list invisibly.
  //
  // The list's own scrollTop, NOT scrollIntoView. The list is
  // position:fixed, and a fixed element cannot be scrolled into view — so
  // scrollIntoView walks up to the page's scroll container and scrolls THAT
  // instead, moving the whole screen under the user for a keypress that was
  // meant to move a highlight one row. That is the "randomly overscrolls and
  // gets stuck" this replaces. Setting scrollTop on the list cannot touch an
  // ancestor at all.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!list || !row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight;
    }
  }, [active, open]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  function commit(option: ComboboxOption) {
    if (option.disabled) return;
    onChange(option.value);
    close();
    inputRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => {
        if (matches.length === 0) return 0;
        return (current + step + matches.length) % matches.length;
      });
      return;
    }
    if (event.key === "Enter") {
      // Only swallow Enter while the list is open. Otherwise this would
      // suppress the surrounding form's submit-on-Enter, which is how people
      // finish short forms.
      if (!open) return;
      event.preventDefault();
      const option = matches[active];
      if (option) commit(option);
      return;
    }
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        close();
      }
      return;
    }
    if (event.key === "Tab") close();
  }

  const controlClass =
    "bg-control flex h-11 w-full items-center gap-2 rounded-[10px] px-4 text-[14px] " +
    "transition-[border-color,box-shadow] duration-200 hover:border-line-strong " +
    "focus-within:border-accent " +
    "focus-within:shadow-[var(--shadow-highlight),0_0_0_3px_var(--color-accent-subtle)] " +
    (disabled ? "cursor-not-allowed opacity-55 " : "");

  return (
    <div ref={rootRef} className="relative">
      {name && (
        <input
          type="hidden"
          name={name}
          value={value}
          // Not `required` on the hidden input — a hidden required field blocks
          // submission with a validation bubble the browser cannot point at.
          // The visible input below carries the requirement instead.
          readOnly
        />
      )}

      <div className={controlClass}>
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && matches[active] ? `${listId}-${active}` : undefined
          }
          autoComplete="off"
          disabled={disabled}
          autoFocus={autoFocus}
          // While closed the input displays the selection; while open it is a
          // search box. Two jobs, but one box — a separate trigger and search
          // field is an extra click on every use.
          value={open ? query : (selected?.label ?? "")}
          placeholder={selected ? selected.label : placeholder}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          // Reports "please fill in this field" against the visible control
          // when nothing is chosen, which is what `required` on a select did.
          required={required && !value}
          className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-text-tertiary"
        />

        {value && !required && !disabled && (
          <button
            type="button"
            aria-label="Clear"
            onClick={() => {
              onChange("");
              setQuery("");
              inputRef.current?.focus();
            }}
            className="shrink-0 text-text-tertiary transition-colors hover:text-text"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        )}

        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="shrink-0 text-text-tertiary"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </div>

      {anchor &&
        host &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.ul
                ref={listRef}
                id={listId}
                role="listbox"
                initial={{ opacity: 0, scaleY: 0.95 }}
                animate={{ opacity: 1, scaleY: 1 }}
                exit={{ opacity: 0, scaleY: 0.95 }}
                transition={prefersReducedMotion() ? reducedMotionFade : springDefault}
                style={{
                  position: "fixed",
                  left: anchor.left,
                  width: anchor.width,
                  maxHeight: anchor.maxHeight,
                  // Scale from the edge nearest the field it's anchored to
                  // (apple-design §7: anchor interactions to their source),
                  // not a fixed top-of-list origin — the list can open
                  // upward when there's no room below.
                  transformOrigin: anchor.above ? "bottom" : "top",
                  ...(anchor.above
                    ? { bottom: window.innerHeight - anchor.top }
                    : { top: anchor.top }),
                }}
                className={
                  "glass-overlay z-[100] m-0 list-none overflow-y-auto overscroll-contain rounded-lg p-1"
                }
              >
            {matches.length === 0 && (
              <li className="px-3 py-2 text-[13px] text-text-tertiary">
                {emptyMessage}
              </li>
            )}
            {matches.map((option, index) => (
              <li
                key={option.value}
                id={`${listId}-${index}`}
                data-index={index}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                // pointerdown, not click: the outside-click handler also
                // listens on pointerdown, and a click handler would fire after
                // the list had already closed.
                onPointerDown={(event) => {
                  event.preventDefault();
                  commit(option);
                }}
                onPointerEnter={() => setActive(index)}
                className={
                  "cursor-pointer rounded-md px-3 py-2 text-[14px] " +
                  (option.disabled
                    ? "cursor-not-allowed text-text-tertiary "
                    : index === active
                      ? "bg-accent-subtle text-text "
                      : "text-text ") +
                  (option.value === value ? "font-medium " : "")
                }
              >
                <span className="block truncate">{option.label}</span>
                {option.note && (
                  <span className="mt-0.5 block truncate text-[12px] text-text-tertiary">
                    {option.note}
                  </span>
                )}
              </li>
            ))}
              </motion.ul>
            )}
          </AnimatePresence>,
          host,
        )}

    </div>
  );
}

/**
 * A `Combobox` for a plain `<form action={…}>` that reads FormData.
 *
 * Some forms are uncontrolled on purpose — a filter bar, a two-field admin
 * panel — and making them controlled just to swap a `<select>` for a searchable
 * one would be a rewrite for no gain. This holds the selection itself and posts
 * it through the hidden input, so the surrounding form reads `formData.get(name)`
 * exactly as it did before.
 *
 * Use `Combobox` directly wherever the parent already needs to know the value:
 * two sources of truth for one field is the bug this deliberately avoids
 * everywhere it can.
 */
export function FormCombobox({
  defaultValue = "",
  ...rest
}: Omit<React.ComponentProps<typeof Combobox>, "value" | "onChange"> & {
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  return <Combobox {...rest} value={value} onChange={setValue} />;
}
