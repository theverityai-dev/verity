import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import Link from "next/link";
import { VeritySymbol } from "@/components/brand/VerityMark";
import { RequestAccessButton } from "./RequestAccessButton";
import { Icon, type IconName } from "./icons";

/**
 * The Verity design system primitives.
 *
 * Authority: the approved brand identity board (`public/image.png`) and Bible
 * V4 §1 (UX Constitution) / §5.A (status semantics).
 *
 * The composition rules the board sets, encoded here once so that individual
 * screens do not each re-decide them:
 *
 *   • The page is a layered material field. A card is a translucent pane with a
 *     hairline, a 14px radius and controlled depth; dense controls can opt back
 *     into the opaque `verity-solid` treatment when text density demands it.
 *   • Hierarchy comes from SIZE, SPACE and POSITION. Headings are Light (300).
 *     Semibold appears exactly twice in the whole system: Heading 3, and the
 *     primary button label.
 *   • Labels are sentence case at 12–13px. The board's application screens use
 *     no tracked-out capitals anywhere; that treatment belongs to the printed
 *     identity sheet, not to the product.
 *   • The tint (blue by default, ADR-033) marks what is actionable, selected or live. Nothing else.
 *   • Status is a coloured dot beside a label, never a coloured pill. Six
 *     competing beds on one screen is noise; a dot and a word is a status.
 */

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------- surfaces -------------------------------- */

/**
 * A content region.
 *
 * Bible V4 §1.A says hierarchy comes from alignment and negative space rather
 * than borders and boxes — but an operational surface does need to say where one
 * record's information stops. The board's answer is a hairline, a radius and
 * white; that is all this is.
 */
export function Surface({
  children,
  bordered = true,
  solid = false,
  className,
}: {
  children: ReactNode;
  bordered?: boolean;
  /**
   * ADR-026: layered glass is the default card/panel material. Pass
   * `solid={true}` for dense tables, long-form text, forms, or destructive
   * confirmation where opacity materially improves reading and decision safety.
   */
  solid?: boolean;
  className?: string;
}) {
  // ADR-033: every card is an iOS inset-grouped cell — opaque, 12px corners, no
  // border and no shadow. `solid` and `bordered` are kept for callers but no
  // longer change the material; content is always opaque on iOS.
  void solid;
  void bordered;
  return <div className={cx("glass-card", className)}>{children}</div>;
}

/**
 * A titled card — the board's repeating unit.
 *
 * The title sits INSIDE the card's padding with no rule beneath it, exactly as
 * the board draws "Orders", "Stock" and "Recyclers". A hairline under every card
 * title turns a page of cards into a page of tables.
 */
export function Panel({
  title,
  action,
  children,
  flush = false,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  /** Content sits edge to edge — for tables and row lists that own their padding. */
  flush?: boolean;
  className?: string;
}) {
  return (
    <Surface className={cx("overflow-hidden", className)}>
      {title && (
        <div
          className={cx(
            "flex items-center justify-between gap-4 px-5 pt-4",
            flush ? "pb-3" : "pb-1",
          )}
        >
          {/* iOS Headline: 17 semibold. */}
          <h2 className="m-0 text-[17px] leading-[22px] tracking-[-0.02em]">{title}</h2>
          {action}
        </div>
      )}
      <div className={flush ? "" : cx("px-5 pb-5", title ? "pt-3" : "pt-5")}>{children}</div>
    </Surface>
  );
}

/**
 * The page's masthead.
 *
 * One line, Heading 1 at the board's printed 32/40 Light. There is deliberately
 * no eyebrow: the board's screens go straight to the title, and a kicker above a
 * heading is a label doing work the heading already does. Operating context
 * lives in the shell's own context control, which is where a reader looks for
 * it, rather than being restated above every title.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6">
      <div className="min-w-0">
        <h1 className="truncate">{title}</h1>
        {description && (
          <p className="mb-0 mt-1.5 max-w-[62ch] text-[15px] leading-[20px] text-text-secondary">
            {description}
          </p>
        )}
      </div>
      {/* Page actions read as a toolbar under the masthead rather than beside
          the title. That is where the board puts an action — at the head of the
          content it acts on — and it is the only placement that cannot collide
          with the shell controls sharing the title's row. */}
      {actions && (
        <div className="mt-5 flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
      )}
    </header>
  );
}

/** A quiet label above a block of content. Pairs with `Panel`'s title row. */
export function SectionHeading({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      {/* iOS grouped-list section header: footnote, uppercase, secondary. */}
      <h2 className="m-0 px-4 text-[13px] font-normal uppercase leading-[18px] tracking-[0.02em] text-text-secondary">
        {children}
      </h2>
      {note && <span className="text-[13px] text-text-tertiary">{note}</span>}
    </div>
  );
}

/* --------------------------------- stats --------------------------------- */

/**
 * One real number with its label — value first, label beneath.
 *
 * That order is the board's, and it is the right one: the number is what the
 * reader came for and the label only qualifies it. Labels above turn a row of
 * figures into a row of captions.
 *
 * Takes a `value` the caller has actually counted. There is no placeholder, no
 * trend arrow and no sparkline, because the platform has nothing to compare
 * against yet and inventing the comparison is exactly the fake metric §18
 * forbids. Zero is displayed as zero and reads as a fact.
 */
export function Stat({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: number | string;
  hint?: string;
  href?: string;
}) {
  const body = (
    <>
      <span
        className={
          "tabular text-[28px] font-bold leading-[34px] tracking-[0.01em] " +
          "text-text transition-colors group-hover:text-accent-ink"
        }
      >
        {value}
      </span>
      <span className="mt-1 text-[13px] leading-[18px] text-text-secondary">{label}</span>
      {hint && <span className="mt-auto pt-3 text-[12px] text-text-tertiary">{hint}</span>}
    </>
  );

  if (href) {
    // A stat that leads somewhere is ACTIONABLE, which is what the accent is
    // for (ADR-011/012). It stays quiet until the pointer is on it: an accent
    // sitting permanently on every linked figure would make the accent mean
    // "a number" rather than "you can act on this".
    return (
      <a
        href={href}
        className={
          "group flex flex-col rounded-md px-5 py-4 no-underline transition-colors " +
          "hover:bg-accent-subtle focus-visible:outline-none " +
          "focus-visible:shadow-[inset_0_0_0_2px_var(--color-accent-line)]"
        }
      >
        {body}
      </a>
    );
  }
  return <div className="flex flex-col px-5 py-4">{body}</div>;
}

/**
 * A band of stats inside ONE card, the way the board groups them.
 *
 * Four separate bordered cards for four numbers is four frames around nothing;
 * the board draws one card with the figures ranged across it. Hairlines run
 * between the columns on desktop only — on a phone they stack, and a vertical
 * rule between stacked blocks points the wrong way.
 */
export function StatRow({
  cols = 4,
  className,
  children,
}: {
  cols?: 2 | 3 | 4;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Surface
      className={cx(
        "grid grid-cols-2 divide-line [&>*]:min-w-0",
        cols === 2 ? "sm:grid-cols-2" : cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-4",
        "sm:divide-x",
        className,
      )}
    >
      {children}
    </Surface>
  );
}

/**
 * Icon-chip stat tile — Authority: ADR-025 pattern 2.
 *
 * One headline metric per card: a circular icon-chip (accent-tinted, never a
 * filled background — ADR-024's tint-only rule), a label, a large number,
 * and an optional delta-vs-prior-period line. `menu` is a caller-supplied
 * slot (pass an `<OverflowMenu>`) rather than an import here, so this file
 * doesn't need to depend on `OverflowMenu.tsx` — which itself imports
 * `IconButton` from here and would otherwise create a circular import.
 *
 * Distinct from `Stat`/`StatRow` above: those are for cramming several
 * related figures into one shared card (a record's stage/health/next-action
 * strip). This is for 3+ independent, page-level headline metrics — the
 * "Total Customers / Active Projects / Revenue" row a dashboard opens with.
 */
export function StatTile({
  icon,
  label,
  value,
  delta,
  menu,
  className,
}: {
  icon: IconName;
  label: string;
  value: string | number;
  /** Positive/negative/flat phrasing is the caller's — this only picks the color. */
  delta?: { label: string; direction: "up" | "down" | "flat" };
  menu?: ReactNode;
  className?: string;
}) {
  return (
    <Surface className={cx("flex flex-col gap-3 p-5", className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-subtle text-accent-ink">
          <Icon name={icon} size={19} />
        </span>
        {menu}
      </div>
      <div>
        <p className="m-0 text-[13px] text-text-secondary">{label}</p>
        <p className="tabular m-0 mt-1 text-[28px] font-bold leading-[34px] text-text">{value}</p>
      </div>
      {delta && (
        <p
          className={cx(
            "m-0 text-[12.5px]",
            delta.direction === "up" && "text-success",
            delta.direction === "down" && "text-danger",
            delta.direction === "flat" && "text-text-tertiary",
          )}
        >
          {delta.label}
        </p>
      )}
    </Surface>
  );
}

/** A responsive row of `StatTile`s — 1 col on phone, up to 4 on desktop. */
export function StatTileRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4", className)}>{children}</div>;
}

/* -------------------------------- button --------------------------------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

/**
 * The board draws exactly three button weights: a tint fill, a white fill with
 * a hairline, and a bare glyph. This is those three plus `danger`, which the
 * board has no example of and which is drawn as the secondary shape in danger
 * ink rather than as a red fill — a destructive action should be legible, not
 * loud, on a screen an operator uses all day.
 */
export function Button({ variant = "secondary", size = "md", className, ...rest }: ButtonProps) {
  // ADR-024 motion: press feedback on pointer-down territory, not click —
  // apple-design skill §1. A 3% scale is small enough that reduced-motion
  // doesn't need a guard (it's not the vestibular kind of motion §14 warns
  // about), and it's the exact value the skill's own CSS example ships.
  // ADR-033: iOS button styles. Pressed state dims, as UIKit buttons do.
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-[10px] font-semibold transition-[color,background-color,opacity,transform] duration-150 active:opacity-70 " +
    "disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap cursor-pointer";

  // 44pt minimum touch target (HIG and WCAG) for md; sm is the compact
  // in-row size used inside tables.
  const sizes = {
    sm: "h-9 px-3 text-[14px] max-sm:h-11",
    md: "h-11 px-5 text-[15px]",
  };

  // primary = iOS filled (tint background; ink chosen by accent.ts for AA),
  // secondary = iOS gray (system fill, tint label), ghost = iOS plain (tint
  // label only), danger = iOS destructive tinted.
  const variants = {
    primary: "bg-accent text-accent-on hover:bg-accent-hover",
    secondary: "bg-[var(--color-control)] text-accent-ink hover:bg-[var(--color-control-strong)]",
    ghost: "bg-transparent text-accent-ink hover:bg-[var(--color-control)]",
    danger: "bg-danger-subtle text-danger hover:bg-[var(--color-control-strong)]",
  };

  return <button className={cx(base, sizes[size], variants[variant], className)} {...rest} />;
}

/**
 * Filter-chip row — Authority: ADR-025 pattern 5.
 *
 * Generalizes the count-chip idiom Outreach's `WorkQueuePanel` grew
 * independently (Task 114 P0.1: Overdue/Due today/No next action/At risk)
 * into a shared, capability-agnostic primitive. Purely presentational — no
 * internal state, so it needs no "use client" boundary; the caller (which
 * is already a client component wherever chips filter something) owns
 * which chip is active and what clicking one does.
 */
export function FilterChipRow({
  chips,
  className,
}: {
  chips: Array<{ label: string; count?: number; active: boolean; onClick: () => void }>;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-wrap gap-1.5", className)}>
      {chips.map((chip) => (
        <button
          key={chip.label}
          type="button"
          onClick={chip.onClick}
          aria-pressed={chip.active}
          className={cx(
            "rounded-pill px-3.5 py-1.5 text-[14px] font-medium transition-colors",
            chip.active
              ? "bg-accent text-accent-on"
              : "bg-[var(--color-control)] text-text hover:bg-[var(--color-control-strong)]",
          )}
        >
          {chip.label}
          {typeof chip.count === "number" && (
            <span className="tabular ml-1.5 opacity-70">{chip.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * A square control holding a single glyph.
 *
 * The board's header and toolbar are built from these: 36px, 10px radius, white,
 * hairline. `label` is required — an icon-only control with no accessible name
 * is a button only sighted mouse users can operate.
 */
export function IconButton({
  label,
  children,
  tone = "default",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
  /** `accent` is the board's single tint action at the end of a toolbar. */
  tone?: "default" | "accent" | "bare";
}) {
  const tones = {
    // iOS bar buttons: a tint glyph, with a gray circle when it needs a frame.
    default: "bg-[var(--color-control)] text-accent-ink hover:bg-[var(--color-control-strong)]",
    accent: "bg-accent text-accent-on hover:bg-accent-hover",
    bare: "bg-transparent text-accent-ink hover:bg-[var(--color-control)]",
  };
  return (
    <button
      type="button"
      title={label}
      className={cx(
        "grid size-11 shrink-0 place-items-center rounded-full transition-[background-color,opacity] active:opacity-70 cursor-pointer",
        tones[tone],
        className,
      )}
      {...rest}
    >
      {children}
      <span className="sr-only">{label}</span>
    </button>
  );
}

/**
 * The small control that sits at the top-right of a card.
 *
 * The mockup gives cards two kinds: a quiet pill with a glyph ("This month")
 * and a plain accent link ("View all"). Both are the same size and the same
 * optical weight, so a row of cards reads as one system rather than as a row of
 * differently-decorated boxes.
 */
export function CardAction({
  children,
  href,
  icon,
  variant = "pill",
}: {
  children: ReactNode;
  href?: string;
  icon?: ReactNode;
  variant?: "pill" | "link";
}) {
  const className =
    variant === "pill"
      ? "inline-flex h-8 max-sm:h-11 items-center gap-1.5 rounded-full bg-[var(--color-control)] px-3 text-[13px] font-medium text-text no-underline transition-colors hover:bg-[var(--color-control-strong)]"
      : "inline-flex h-8 max-sm:h-11 items-center text-[15px] text-accent-ink no-underline transition-opacity hover:opacity-70";

  if (href) {
    return (
      <a href={href} className={className}>
        {icon}
        {children}
      </a>
    );
  }
  return (
    <span className={className}>
      {icon}
      {children}
    </span>
  );
}

/* --------------------------------- form ---------------------------------- */

/**
 * A labelled control.
 *
 * The label is 13px medium sentence case, matching every other label in the
 * system. Hint and error occupy the same slot so the layout does not jump when
 * validation appears.
 */
/**
 * A row of fields whose labels, controls and hints line up across the row.
 *
 * Task 71 item 2. The desks laid fields out with `flex items-end`, so a field
 * carrying a hint under its control was taller than its neighbours and aligning
 * their BOTTOMS pushed its label and input upward — which is exactly the
 * staircase in the reported screenshot: Supplier's input sat a row below
 * GSTIN's, which sat below State code's, which sat below Phone's.
 *
 * A three-row subgrid fixes it structurally rather than by hand-tuning
 * padding: every field spans the same label row, control row and hint row, so
 * the three baselines are shared whether or not a given field has a hint.
 * Fields with no hint simply leave the third row empty.
 *
 * `columns` is a raw `grid-template-columns` value so a caller states the
 * intended widths once, in one place, instead of hanging a width class on a
 * wrapper div around every field.
 */
export function FormRow({
  columns = "repeat(auto-fit, minmax(200px, 1fr))",
  className,
  children,
}: {
  columns?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx("form-row grid gap-x-3 gap-y-4", className)}
      style={{
        gridTemplateColumns: columns,
        // Three explicit bands. A field that wraps to a second visual row then
        // gets its own three implicit rows rather than colliding with these.
        gridTemplateRows: "auto auto auto",
        alignItems: "start",
      }}
    >
      {children}
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  const errorId = error ? `${htmlFor}-error` : undefined;
  const hintId = hint ? `${htmlFor}-hint` : undefined;

  // `verity-field` carries the layout, from globals.css, rather than utility
  // classes here. `FormRow` needs to override the display for its children, and
  // `.form-row > .verity-field` beats `.verity-field` by specificity — which is
  // a rule the cascade guarantees, unlike two Tailwind utilities of equal
  // weight where the winner depends on stylesheet order.
  return (
    <div className="verity-field">
      <label htmlFor={htmlFor} className="px-1 text-[13px] text-text-secondary">
        {label}
        {required && (
          <span className="ml-1 text-text-tertiary" aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {children}
      {hint && !error && (
        <p id={hintId} className="m-0 text-[12px] text-text-tertiary">
          {hint}
        </p>
      )}
      {/* role=alert so a screen reader announces a validation failure without
          the user having to hunt for it. */}
      {error && (
        <p id={errorId} role="alert" className="m-0 text-[12px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Control chrome — the board's input: white, a Neutral 200 hairline, 10px
 * radius, 38px tall.
 *
 * The focus ring is drawn with `box-shadow` rather than `outline` so it follows
 * the border radius exactly; a square outline around a 10px-rounded input reads
 * as unfinished without anyone being able to say why.
 */
// ADR-033: iOS rounded text field — system fill, no border, 10px corners.
const controlClass =
  "min-w-0 w-full h-11 px-3.5 rounded-[10px] border-0 bg-[var(--color-control)] text-text text-[15px] " +
  "placeholder:text-text-tertiary transition-[box-shadow,background-color] duration-200 " +
  "focus:outline-none focus:shadow-[0_0_0_3px_var(--color-accent-subtle)] " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(controlClass, props.className)} />;
}

export { PolishedSelect as Select } from "./PolishedSelect";

/** A multi-line entry control with the same material, border, and focus grammar as Input. */
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cx(
        "min-w-0 w-full min-h-24 resize-y rounded-[10px] border-0 bg-[var(--color-control)] px-3.5 py-2.5 text-[15px] text-text " +
          "placeholder:text-text-tertiary transition-[box-shadow] duration-200 " +
          "focus:outline-none focus:shadow-[0_0_0_3px_var(--color-accent-subtle)] " +
          "disabled:cursor-not-allowed disabled:opacity-50",
        props.className,
      )}
    />
  );
}

/**
 * A labelled checkbox, styled to the same glass/accent/focus-ring language as
 * `Input`/`Select` rather than the browser default box.
 */
const CHECKBOX_TICK =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='white' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3.5 8.5l3 3 6-7'/%3E%3C/svg%3E\")";

export function Checkbox({
  label,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cx("flex cursor-pointer items-center gap-2.5 text-[13px] text-text", className)}>
      <input
        type="checkbox"
        {...rest}
        style={{
          // Only painted when actually checked — a plain CSS background-image
          // is not gated by `:checked` like the Tailwind `checked:` variant is,
          // so an unconditional one here would show the tick on every box.
          backgroundImage: rest.checked ? CHECKBOX_TICK : "none",
          backgroundSize: "12px",
          ...rest.style,
        }}
        className={cx(
          // iOS selection circle.
          "size-[22px] shrink-0 cursor-pointer appearance-none rounded-full border-[1.5px] border-line-strong",
          "bg-surface bg-center bg-no-repeat transition-[background-color,border-color,box-shadow] duration-150",
          "checked:border-accent checked:bg-accent",
          "hover:border-line-strong focus-visible:outline-none",
          "focus-visible:shadow-[0_0_0_3px_var(--color-accent-subtle)]",
          "disabled:cursor-not-allowed disabled:opacity-55",
        )}
      />
      {label}
    </label>
  );
}

/**
 * A group of fields under one heading, separated from the next by a hairline.
 *
 * Long forms need visible grouping or every field looks equally important. This
 * is the form equivalent of `Panel` and keeps that rhythm consistent.
 */
export function FieldSet({
  legend,
  description,
  children,
}: {
  legend: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="mb-1 p-0 text-[13px] font-medium text-text">{legend}</legend>
      {description && (
        <p className="mb-4 mt-0.5 max-w-[52ch] text-[12px] text-text-tertiary">{description}</p>
      )}
      <div className={cx("flex flex-col gap-4", !description && "mt-4")}>{children}</div>
    </fieldset>
  );
}

/* -------------------------------- status --------------------------------- */

/**
 * Renders a platform StateCategory (ADR-009).
 *
 * The board's own status vocabulary is a small coloured dot beside a plain
 * label — see its "In Stock / Border Soon / Out of Stock / Low Stock" list. That
 * is what this draws. A coloured pill per state would put up to six competing
 * beds on one table, and on a Sand page an amber pill reads as "selected"
 * rather than as "pending".
 *
 * Two rules the brief is explicit about. The UI must not invent a second state
 * taxonomy, so this accepts only the six canonical categories. And state must
 * never be communicated by colour alone, which is why the label is not optional
 * decoration here — the word carries the meaning and the dot reinforces it.
 */
const CATEGORY_PRESENTATION: Record<string, { label: string; color: string }> = {
  Draft: { label: "Draft", color: "bg-[var(--color-state-draft)]" },
  Pending: { label: "Pending", color: "bg-[var(--color-state-pending)]" },
  // Active is not the tint. The tint means "selected or actionable" everywhere else in
  // the shell; letting one StateCategory also claim it would make a tinted row
  // ambiguous between "this is where you are" and "this record is running".
  Active: { label: "Active", color: "bg-[var(--color-state-active)]" },
  Blocked: { label: "Blocked", color: "bg-[var(--color-state-blocked)]" },
  Completed: { label: "Completed", color: "bg-[var(--color-state-completed)]" },
  Cancelled: { label: "Cancelled", color: "bg-[var(--color-state-cancelled)]" },
};

/**
 * A derived health signal (Task 106, spec §21) — distinct from `StateBadge`,
 * which owns the six `StateCategory` values and must not gain a second use.
 * Health is orthogonal to category: two `Active` leads can be `Hot` and
 * `AtRisk` respectively. Semantic colour (danger/warning/success) here is
 * deliberately independent of the accent (ADR-011/012) — health is meaning,
 * not theme.
 */
const HEALTH_PRESENTATION: Record<string, { label: string; color: string }> = {
  Hot: { label: "Hot", color: "bg-[var(--color-success)]" },
  Healthy: { label: "Healthy", color: "bg-[var(--color-state-active)]" },
  AtRisk: { label: "At risk", color: "bg-[var(--color-warning)]" },
  Stale: { label: "Stale", color: "bg-[var(--color-danger)]" },
  Closed: { label: "Closed", color: "bg-[var(--color-text-tertiary)]" },
};

export function HealthBadge({ health }: { health: string }) {
  const preset = HEALTH_PRESENTATION[health] ?? { label: health, color: "bg-[var(--color-text-tertiary)]" };
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-[13px] text-text">
      <span aria-hidden="true" className={cx("size-[7px] shrink-0 rounded-full", preset.color)} />
      {preset.label}
    </span>
  );
}

export function StateBadge({ category, label }: { category: string; label?: string }) {
  const preset = CATEGORY_PRESENTATION[category] ?? {
    label: category,
    color: "bg-[var(--color-text-tertiary)]",
  };

  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-[13px] text-text">
      <span aria-hidden="true" className={cx("size-[7px] shrink-0 rounded-full", preset.color)} />
      {/* The tenant's own label when there is one, the category otherwise. */}
      {label ?? preset.label}
    </span>
  );
}

/**
 * A small neutral label pill — for provenance, not for `StateCategory`.
 *
 * `StateBadge` owns the six canonical categories (Bible V4 §5.A) and must not
 * gain a second use. This is for facts like "Tenant Override" / "Platform
 * Default" that are never a business state.
 */
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold",
        tone === "accent"
          ? "bg-accent-subtle text-accent-ink"
          : "bg-[var(--color-control)] text-text-secondary",
      )}
    >
      {children}
    </span>
  );
}

/* ----------------------------- state displays ---------------------------- */

/**
 * Nothing to show — composed, not apologised for.
 *
 * The mark sits above the message at low opacity. An empty operational surface
 * is the state a new tenant spends its first week in, and a bare line of grey
 * text in the middle of a white rectangle reads as a page that failed to load.
 */
export function EmptyState({
  title,
  description,
  action,
  compact = false,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  /** For an empty block inside a panel, where full height would dominate the page. */
  compact?: boolean;
}) {
  return (
    <div className={cx("flex flex-col items-center px-6 text-center", compact ? "py-10" : "py-16")}>
      <VeritySymbol size={compact ? 20 : 26} className="text-accent opacity-30" />
      <p className={cx("m-0 text-text", compact ? "mt-4 text-[14px]" : "mt-5 text-[15px]")}>
        {title}
      </p>
      {description && (
        <p className="mx-auto mb-0 mt-2 max-w-[44ch] text-[13px] leading-relaxed text-text-secondary">
          {description}
        </p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/**
 * An error the user can act on.
 *
 * Says what happened, what the user can do, and whether the action completed.
 * `retryable` distinguishes "try again" from "this will not succeed however many
 * times you try", which is the difference between a useful message and a shrug.
 *
 * Rendered as a bordered notice rather than a saturated block: an operator meets
 * these several times a day, and a shouting red panel each time is exhausting
 * without being more informative.
 */
/**
 * Strips the platform's error code off a message bound for a person.
 *
 * Audit finding U1-6. Refusals reached the screen reading
 * `E_VALIDATION: no price for Century MR Commercial Plywood 19mm for this
 * customer, and none given`. The sentence after the colon is good writing; the
 * prefix is platform vocabulary, which a client must never be shown (§0).
 *
 * Stripped HERE, at the presentation boundary, rather than at each of the
 * fifteen call sites — and deliberately not in the errors themselves, because
 * the code is genuinely useful in a log, in the audit trail and in a support
 * ticket. It should leave the screen, not the system.
 */
function withoutErrorCode(message: string): string {
  return message.replace(/^E_[A-Z_]+:\s*/, "");
}

export function ErrorState({
  title,
  message,
  issues,
  retryable,
}: {
  title: string;
  message: string;
  issues?: string[];
  retryable?: boolean;
}) {
  return (
    <div role="alert" className="rounded-[12px] bg-danger-subtle px-4 py-3.5">
      <p className="m-0 flex items-center gap-2 text-[13px] font-medium text-danger">
        <span aria-hidden="true" className="size-[7px] shrink-0 rounded-full bg-danger" />
        {title}
      </p>
      <p className="mb-0 mt-1.5 text-[13px] leading-relaxed text-text">
        {withoutErrorCode(message)}
      </p>
      {issues && issues.length > 0 && (
        <ul className="mb-0 mt-2 list-none p-0 text-[13px] text-text-secondary">
          {issues.map((issue) => (
            <li key={issue} className="before:mr-2 before:content-['—']">
              {withoutErrorCode(issue)}
            </li>
          ))}
        </ul>
      )}
      <p className="mb-0 mt-2.5 text-[12px] text-text-tertiary">
        {retryable
          ? "Nothing was changed. Trying again is safe."
          // U1-6: the old wording — "retrying will not help until something
          // changes" — is true and tells the reader nothing. The message above
          // is where the specific next step belongs, so this line stops
          // pretending to be advice and just states the outcome.
          : "Nothing was changed. Fix the point above and try again."}
      </p>
    </div>
  );
}

/**
 * Authorization refused.
 *
 * Deliberately says nothing about what exists behind the boundary — naming the
 * records would leak them. It does name the one thing the user can act on:
 * their operating context, which is genuinely what changes the answer.
 */
export function PermissionDenied({ what }: { what: string }) {
  return (
    <Surface className="mt-2">
      <EmptyState
        title="You do not have access to this"
        description={`Your current role does not permit ${what}. Switching organization in the header may change what you can see.`}
        action={
          // Task 114 P1.5 item 9: two real recovery actions — ask someone who
          // can actually grant it (notifies every tenant member holding
          // Edit-on-tenant; see access-request.ts), or leave.
          <div className="flex flex-wrap items-center gap-2">
            <RequestAccessButton what={what} />
            <Link
              href="/"
              className="inline-flex items-center rounded-[10px] bg-control px-3 py-1.5 text-[13px] max-sm:min-h-11 max-sm:px-4 max-sm:text-[15px] font-semibold text-accent-ink no-underline transition-colors hover:bg-control-strong"
            >
              Go to dashboard
            </Link>
          </div>
        }
      />
    </Surface>
  );
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-3 p-5">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-4 rounded-sm bg-surface-sunken" />
      ))}
    </div>
  );
}

/* --------------------------------- misc ---------------------------------- */

export function DemoDataNotice() {
  return (
    <p className="m-0 text-[12px] text-text-tertiary">
      Records prefixed “Demo” are development fixtures, not production data.
    </p>
  );
}

/**
 * Term/value pairs for a detail record.
 *
 * Hairline-separated rows rather than a two-column grid. On a detail page the
 * eye scans down the values, and a grid with a shared column boundary makes long
 * values wrap into a ragged block that is harder to scan than it looks in a
 * mockup with short sample data.
 */
export function DefinitionList({ items }: { items: Array<{ term: string; value: ReactNode }> }) {
  return (
    <dl className="m-0">
      {items.map(({ term, value }, i) => (
        <div
          key={term}
          className={cx(
            "flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-2.5",
            i > 0 && "border-t border-line",
          )}
        >
          <dt className="text-[13px] text-text-tertiary">{term}</dt>
          <dd className="m-0 min-w-0 break-words text-right text-[14px] text-text">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A hairline-separated list of records inside a `Panel flush`.
 *
 * Shared so that scheduling bookings, evidence captures, approval steps and
 * audit rows all sit on the same rhythm instead of each inventing a row height.
 */
export function RowList({ children }: { children: ReactNode }) {
  return <ul className="m-0 list-none divide-y divide-line p-0">{children}</ul>;
}

export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <li
      className={cx(
        "flex items-center justify-between gap-4 px-5 py-3.5",
        // A record in a list is nearly always something you open. The tint is
        // the accent at its lightest, so a long list reads as a list and not as
        // a stack of buttons.
        "transition-colors hover:bg-accent-subtle/40",
        className,
      )}
    >
      {children}
    </li>
  );
}
