"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/primitives";

/**
 * A modal dialog.
 *
 * Task 71 item 6. Creating a supplier, an order or a payment used to expand a
 * panel *inside* the page, which pushed the table it belonged to down the
 * screen and left the user filling a form with unrelated rows still competing
 * for attention. Worse, two panels could be open at once and neither said which
 * of them a refusal banner referred to.
 *
 * Implemented on the native `<dialog>` element rather than a div with a
 * z-index. `showModal()` gives the top layer, the inert backdrop, focus
 * containment and Escape-to-close from the platform — all four of which are
 * where hand-rolled modals go wrong, and none of which we can implement better.
 *
 * ADR-011: the dialog surface is the elevated material and carries glass. The
 * form inside does not — these are dense forms, and ADR-011 keeps dense forms
 * solid. So the glass is on the shell and the body is `bg-surface`.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** One line under the title. Say what the form does, not what it is. */
  description?: string;
  children: ReactNode;
  /** Actions. Rendered right-aligned on a hairline; the primary goes last. */
  footer?: ReactNode;
  width?: "sm" | "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // `open` is React state; the dialog's own openness is DOM state. They are
  // synchronised here rather than by rendering the `open` attribute, because
  // the attribute opens a NON-modal dialog — no top layer, no backdrop, no
  // focus containment. Only showModal() gives those.
  //
  // `mounted` is a dependency here, not just a guard above. A Modal that is
  // conditionally created already-open (e.g. `{order && <Modal open ...>}`,
  // as the receive/edit forms do) returns null on its very first render —
  // `ref.current` is still null then, so this effect's first run is a no-op.
  // Once the `mounted` effect flips true, the dialog element finally exists,
  // but `open` itself never changed (it was `true` from birth), so with only
  // `[open]` as the dependency array this effect never fires again and
  // `showModal()` is never called — the dialog mounts, sits in the DOM, and
  // never opens. A Modal that instead stays permanently mounted and toggles
  // `open` after the fact (Cancel, New order) never hit this, because `open`
  // genuinely changes once the ref already exists — which is why only the
  // conditionally-mounted forms were silently broken, not every modal.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open, mounted]);

  // The page behind a modal must not scroll: on a phone, a form with the
  // keyboard up otherwise scrolls the list underneath instead of the form.
  //
  // The SHELL's scroll container, not document.body. html and body are
  // height:100dvh with overflow:hidden in this app, so locking the body was a
  // no-op and the page carried on scrolling behind every open dialog. body is
  // still locked as well, for any surface that does scroll the document.
  useEffect(() => {
    if (!open) return;
    const targets = [
      document.body,
      ...document.querySelectorAll<HTMLElement>("[data-shell-scroll]"),
    ];
    const previous = targets.map((el) => el.style.overflow);
    for (const el of targets) el.style.overflow = "hidden";
    return () => {
      targets.forEach((el, index) => {
        el.style.overflow = previous[index] ?? "";
      });
    };
  }, [open]);

  const handleCancel = useCallback(
    (event: React.SyntheticEvent<HTMLDialogElement>) => {
      // Escape fires `cancel`, which would close the dialog directly and leave
      // React's `open` prop saying it is still open.
      event.preventDefault();
      onClose();
    },
    [onClose],
  );

  // Rendered into the body so an ancestor's `overflow: hidden`, `transform` or
  // stacking context cannot clip or trap it.
  //
  // Gated on a MOUNTED flag rather than on `typeof document`. The document
  // check is false on the server and true during hydration, so the client's
  // first render emitted a <dialog> the server never sent — React reported it
  // as a hydration mismatch on every page that holds a modal. A portal must
  // wait for the effect pass, when the two trees have already agreed.
  if (!mounted) return null;

  return createPortal(
    <dialog
      ref={ref}
      onCancel={handleCancel}
      onClick={(event) => {
        // The backdrop is painted by the dialog element itself, so a click on
        // it targets the dialog rather than a child. Comparing the target to
        // the element is how you tell "outside" from "inside" without adding a
        // wrapper div that would break the native backdrop.
        if (event.target === ref.current) onClose();
      }}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className={
        // ADR-024: modal is a transient overlay, not dense content — glass.
        //
        // Motion via CSS `@starting-style` + `allow-discrete`, not
        // framer-motion. This dialog is built on the native element's own
        // showModal()/close() lifecycle (top layer, inert backdrop, focus
        // containment, Escape) rather than conditional mounting -- three
        // separate hard-won bugs are already documented above this
        // component about exactly that lifecycle. A framer-motion exit
        // animation needs the actual `dialog.close()` call deferred until
        // the animation finishes, which means rebuilding that lifecycle.
        // `@starting-style` animates a native <dialog> correctly in BOTH
        // directions with zero JS changes -- the platform-native answer to
        // this specific problem, and lower risk than touching working code.
        // `prefers-reduced-motion` is handled for free: `globals.css` already
        // has a blanket `@media (prefers-reduced-motion: reduce)` block that
        // collapses every transition/animation duration to ~0, this one
        // included -- no separate guard needed here.
        // ADR-033: an iOS sheet. Phones: bottom sheet, full width, rounded top
        // corners, slides up (motion in globals.css). Wider: centred form sheet.
        // Dimming view is iOS's plain 40% black, no blur.
        "glass-overlay verity-modal-motion m-auto w-[calc(100vw-2rem)] rounded-[14px] p-0 " +
        "max-sm:mb-0 max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none max-sm:rounded-t-[12px] " +
        "text-text backdrop:bg-[rgba(0,0,0,0.4)] " +
        (width === "sm"
          ? "max-w-[420px] "
          : width === "lg"
            ? "max-w-[900px] "
            : "max-w-[640px] ")
      }
    >
      <div className="relative border-b border-line px-14 pb-3 pt-4 text-center">
        {/* iOS sheet navigation bar: centred Headline title. */}
        <div className="min-w-0">
          <h2 id={titleId} className="m-0 text-[17px] font-semibold leading-[22px] tracking-[-0.02em] text-text">
            {title}
          </h2>
          {description && (
            <p
              id={descriptionId}
              className="m-0 mt-1 text-[13px] leading-[18px] text-text-secondary"
            >
              {description}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className={
            // iOS close button: a small gray circle with a glyph.
            "absolute right-4 top-3.5 grid size-[30px] shrink-0 place-items-center rounded-full " +
            "bg-[var(--color-control)] text-text-secondary transition-opacity duration-150 active:opacity-70 " +
            "focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--color-accent-subtle)]"
          }
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      {/* Capped so a long form scrolls inside the dialog rather than growing
          past the viewport with its submit button unreachable. */}
      <div className="max-h-[min(70vh,640px)] overflow-y-auto px-5 py-4">
        {children}
      </div>

      {footer && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3 max-sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))] max-sm:[&>*]:flex-1">
          {footer}
        </div>
      )}
    </dialog>,
    document.body,
  );
}

/**
 * The cancel button every modal footer wants, so none of them re-decide it.
 *
 * APPLE-P0-04: pinned explicitly to `variant="secondary"` rather than relying
 * on `Button`'s default. A cancel action must never visually compete with a
 * modal's real commit action (Apple's "make the likely action unambiguous");
 * relying on an unstated default means one future change to that default
 * silently turns every cancel button in the app into the loud one.
 */
export function ModalCancel({
  onClose,
  disabled,
  children = "Cancel",
}: {
  onClose: () => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <Button type="button" variant="secondary" onClick={onClose} disabled={disabled}>
      {children}
    </Button>
  );
}
