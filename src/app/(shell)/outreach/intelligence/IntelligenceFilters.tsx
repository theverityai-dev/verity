"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/primitives";

type Option = { value: string; label: string };

/**
 * Team/owner cohort filters for Intelligence (Task 114 P1.5 item 7). State
 * lives in the URL, same pattern as `ProspectFilters` — a filtered
 * Intelligence view is shareable and survives a reload.
 */
export function IntelligenceFilters({ teams, owners }: { teams: Option[]; owners: Option[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const query = next.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname));
  }

  return (
    <div className="mb-6 flex flex-wrap gap-3">
      <label className="flex min-w-[160px] flex-1 flex-col gap-1 sm:flex-none sm:w-56">
        <span className="text-[13px] uppercase tracking-[0.02em] text-text-secondary">Team</span>
        <Select value={params.get("team") ?? ""} onChange={(e) => setParam("team", e.target.value)}>
          <option value="">All teams</option>
          {teams.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex min-w-[160px] flex-1 flex-col gap-1 sm:flex-none sm:w-56">
        <span className="text-[13px] uppercase tracking-[0.02em] text-text-secondary">Owner</span>
        <Select value={params.get("owner") ?? ""} onChange={(e) => setParam("owner", e.target.value)}>
          <option value="">Anyone</option>
          {owners.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </label>
    </div>
  );
}
