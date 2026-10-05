import Link from "next/link";

/**
 * Which month a tax screen is showing, and how to change it.
 *
 * Found in the second functional audit. The tax centre correctly defaults to
 * the month the business is in — and on 1 September that is September, which is
 * empty. An accountant opening this screen in the first week of a month is
 * almost always working on the month that just ENDED: that is when a return is
 * prepared and filed.
 *
 * With no way to change period, the screen was least useful exactly when it was
 * most needed, and an accountant seeing zeros had no way to tell an empty month
 * from a broken page.
 *
 * Every query behind these screens already accepted a window; only the screens
 * refused to offer one.
 */
export function PeriodSwitch({
  basePath,
  periodKey,
}: {
  /** The route this control lives on, e.g. `/tax/gstr-1`. */
  basePath: string;
  /** The period being shown, `YYYY-MM`. */
  periodKey: string;
}) {
  const [year, month] = periodKey.split("-").map(Number) as [number, number];
  const shift = (by: number) => {
    const zeroBased = month - 1 + by;
    const y = year + Math.floor(zeroBased / 12);
    const m = ((zeroBased % 12) + 12) % 12;
    return `${y}-${String(m + 1).padStart(2, "0")}`;
  };

  const label = (key: string) => {
    const [y, m] = key.split("-").map(Number) as [number, number];
    // Constructed at midday UTC so the label cannot slip a month by timezone —
    // the mistake this whole audit finding is about.
    return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-IN", {
      month: "long",
      year: "numeric",
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={`${basePath}?period=${shift(-1)}`}
        className="rounded-[10px] bg-control px-2.5 py-1 text-[13px] font-semibold text-accent-ink no-underline transition-colors hover:bg-control-strong"
      >
        ← {label(shift(-1))}
      </Link>
      <span className="text-[13px] font-medium text-text">{label(periodKey)}</span>
      <Link
        href={`${basePath}?period=${shift(1)}`}
        className="rounded-[10px] bg-control px-2.5 py-1 text-[13px] font-semibold text-accent-ink no-underline transition-colors hover:bg-control-strong"
      >
        {label(shift(1))} →
      </Link>
    </div>
  );
}

/** A `YYYY-MM` from a query string, or null when absent or malformed. */
export function periodFromParam(value: string | undefined): string | null {
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : null;
}
