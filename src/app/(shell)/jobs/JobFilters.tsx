"use client";

import { useRouter } from "next/navigation";
import { FilterChipRow } from "@/components/ui/primitives";

import { JOB_FILTERS, type JobFilterKey } from "./filters";

/** Status chips for the Jobs list. The filter lives in the URL, so a filtered view can be bookmarked and shared. */
export function JobFilters({ active, counts, customer }: { active: JobFilterKey; counts: Record<JobFilterKey, number>; customer?: string }) {
  const router = useRouter();
  return (
    <FilterChipRow
      className="mb-4"
      chips={JOB_FILTERS.map(([key, label]) => ({
        label,
        count: counts[key],
        active: active === key,
        onClick: () => {
          const q = new URLSearchParams();
          if (customer) q.set("customer", customer);
          if (key !== "all") q.set("status", key);
          const qs = q.toString();
          router.push(qs ? `/jobs?${qs}` : "/jobs");
        },
      }))}
    />
  );
}
