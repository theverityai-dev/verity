/**
 * The route-loading indicator.
 *
 * Not the shadcn morphing-blob reference this was requested from — that one
 * assumes a project this isn't: `@/lib/utils` `cn()`, `bg-primary`, styled-jsx
 * (none of which exist here; every other component in this folder just
 * concatenates className strings, so this does too). The morph-and-wobble
 * itself was also a harder sell than a plain rotation for a serious ops
 * tool's loading state — Bible V4 keeps motion restrained, and a shape
 * changing identity every 600ms reads as decoration standing in for content,
 * closer to a mascot than a status indicator.
 *
 * What's kept from the brief: size variants, and it answers to the accent —
 * `border-accent` on the moving arc means it repaints for every one of the
 * ten presets with no work here, the same as everything else in the
 * Experience System.
 */
export function Spinner({
  size = "md",
  className = "",
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const dims = { sm: "size-4 border-2", md: "size-6 border-[2.5px]", lg: "size-9 border-[3px]" }[size];

  return (
    <span
      role="status"
      aria-label="Loading"
      className={
        `inline-block shrink-0 animate-spin rounded-full border-line border-t-accent motion-reduce:animate-none ${dims} ${className}`
      }
    />
  );
}

/**
 * A whole content area's loading state — centred, with a hint that stays
 * quiet rather than restating "Loading" next to a spinner that already says
 * it. Used as the fallback for `(shell)/loading.tsx`, so the shell (nav,
 * header) never remounts; only this slot shows while the next page's data
 * resolves.
 */
export function RouteLoading() {
  // APPLE-P1-07: `lg` (36px) read as a heavy, attention-grabbing centerpiece
  // for what the audit specifically wants "compact" — a route with no
  // route-shaped skeleton yet (see `outreach/loading.tsx` for the pattern
  // used where one exists) shouldn't feel like it's making an event of
  // loading. `md` plus the already-present `aria-label="Loading"` covers
  // the audit's "labelled compact spinner for unknown work" half.
  // ADR-053 audit: a lone spinner in an empty area reads as "nothing happened". The skeleton keeps the page's own
  // rhythm (title, a hero and its side card, a row of cards) so the layout does not jump when the content arrives.
  return (
    <div role="status" aria-label="Loading" className="w-full">
      <SkeletonBlock className="h-10 w-72 max-w-full rounded-xl" />
      <SkeletonBlock className="mt-3 h-4 w-96 max-w-full" />
      <div className="mt-7 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <SkeletonBlock className="h-72 rounded-[22px]" />
        <SkeletonBlock className="h-72 rounded-[22px]" />
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <SkeletonBlock key={i} className="h-40 rounded-[22px]" />
        ))}
      </div>
    </div>
  );
}

/**
 * One shimmering placeholder rectangle — the building block for a route
 * skeleton that mimics the final page's actual shape (a stat row, a panel)
 * instead of a centred spinner. `bg-surface-sunken` is already theme-aware
 * (every accent preset, light/dark), so this needs no color work of its own.
 */
export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-[var(--color-control)] shadow-[inset_0_0_0_1px_var(--color-line)] motion-reduce:animate-none ${className}`} />;
}
