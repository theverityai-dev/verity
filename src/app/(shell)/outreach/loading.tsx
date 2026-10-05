import { SkeletonBlock } from "@/components/ui/Spinner";

/**
 * Route-specific loading state for every `/outreach/*` screen — overrides
 * the shared `(shell)/loading.tsx` spinner for just this segment. Shaped
 * like the actual pages (title, stat row, panel blocks) so the transition
 * reads as "the page is arriving" rather than "wait." The shell (nav,
 * header) is above this boundary and never remounts, same as the spinner
 * fallback it replaces here.
 */
export default function OutreachLoading() {
  return (
    <div role="status" aria-label="Loading">
      <SkeletonBlock className="mb-3 h-8 w-56" />
      <SkeletonBlock className="mb-6 h-4 w-[32rem] max-w-full" />

      <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl sm:grid-cols-4 bg-control">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-[86px] rounded-none" />
        ))}
      </div>

      <SkeletonBlock className="mb-6 h-24 w-full rounded-xl" />

      <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_1.6fr]">
        <SkeletonBlock className="h-48 rounded-xl" />
        <SkeletonBlock className="h-48 rounded-xl" />
      </div>

      <SkeletonBlock className="h-64 w-full rounded-xl" />
    </div>
  );
}
