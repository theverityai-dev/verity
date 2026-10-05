"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input, Select } from "@/components/ui/primitives";

type Option = { value: string; label: string; group?: string };

export type ProspectFilterOptions = {
  statuses: Option[];
  domains: Option[];
  tracks: Option[];
  healths: Option[];
  /** Absent for a Junior — they only ever see their own prospects. */
  teams?: Option[];
  owners?: Option[];
};

const SORTS: Option[] = [
  { value: "updated", label: "Recently updated" },
  { value: "created", label: "Newest first" },
  { value: "nextAction", label: "Next action due" },
  { value: "score", label: "Fit score (high to low)" },
  { value: "name", label: "Company A–Z" },
];

const FILTER_KEYS = ["q", "status", "domain", "track", "health", "team", "owner", "needsAction"] as const;

/**
 * The prospect list's filter/sort bar. State lives in the URL, never in
 * component state, so a filtered view is shareable and the server page
 * applies every narrowing inside the actor's own scope.
 */
export function ProspectFilters({ options, viewerId }: { options: ProspectFilterOptions; viewerId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const query = next.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname));
  }

  const active = FILTER_KEYS.some((k) => params.get(k));
  const view = params.get("view") === "table" ? "table" : "cards";

  function setView(v: "cards" | "table") {
    const next = new URLSearchParams(params.toString());
    if (v === "table") next.set("view", "table");
    else next.delete("view");
    const query = next.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname));
  }

  function setChip(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const k of FILTER_KEYS) next.delete(k);
    for (const [k, v] of Object.entries(patch)) next.set(k, v);
    const query = next.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname));
  }

  const chipActive = (patch: Record<string, string>) =>
    Object.entries(patch).every(([k, v]) => (params.get(k) ?? "") === v) &&
    FILTER_KEYS.every((k) => !(k in patch) || (params.get(k) ?? "") === (patch[k] ?? ""));

  const select = (key: string, label: string, opts: Option[], allLabel: string) => (
    <label className="flex min-w-[150px] flex-1 flex-col gap-1">
      <span className="text-[13px] uppercase tracking-[0.02em] text-text-secondary">{label}</span>
      <Select value={params.get(key) ?? ""} onChange={(e) => setParam(key, e.target.value)}>
        <option value="">{allLabel}</option>
        {opts.some((o) => o.group)
          ? [...new Set(opts.map((o) => o.group ?? ""))].map((g) => (
              <optgroup key={g} label={g || "Other"}>
                {opts
                  .filter((o) => (o.group ?? "") === g)
                  .map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
              </optgroup>
            ))
          : opts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
      </Select>
    </label>
  );

  return (
    <div className="glass-card border border-line mb-6 rounded-xl px-4 py-4" aria-busy={pending}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              { label: "My leads", patch: { owner: viewerId } as Record<string, string> },
              { label: "Needs action", patch: { needsAction: "1" } as Record<string, string> },
              { label: "At risk", patch: { health: "AtRisk" } as Record<string, string> },
            ]
          ).map((chip) => {
            const isActive = chipActive(chip.patch);
            return (
              <button
                key={chip.label}
                type="button"
                onClick={() => setChip(isActive ? {} : chip.patch)}
                aria-pressed={isActive}
                className={
                  "rounded-pill border px-3 py-1 text-[12.5px] font-medium transition-colors " +
                  (isActive
                    ? "border-transparent bg-accent-subtle text-accent-ink"
                    : "border-line text-text-secondary hover:bg-surface-sunken hover:text-text")
                }
              >
                {chip.label}
              </button>
            );
          })}
        </div>
        <div role="radiogroup" aria-label="View" className="glass-control flex items-center gap-1 rounded-full border border-line p-1">
          {(["cards", "table"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={view === v}
              onClick={() => setView(v)}
              className={
                "rounded-full px-3 py-1 text-[12.5px] font-medium capitalize transition-colors " +
                (view === v ? "bg-accent-subtle text-accent-ink" : "text-text-secondary hover:text-text")
              }
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      <form
        className="mb-3"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setParam("q", String(new FormData(e.currentTarget).get("q") ?? "").trim());
        }}
      >
        <Input
          key={params.get("q") ?? ""}
          name="q"
          type="search"
          defaultValue={params.get("q") ?? ""}
          placeholder="Search company, contact, location… (press Enter)"
          aria-label="Search prospects"
        />
      </form>
      <div className="flex flex-wrap gap-3">
        {select("status", "Status", options.statuses, "All statuses")}
        {select("domain", "Domain", options.domains, "All domains")}
        {select("track", "Track", options.tracks, "All tracks")}
        {select("health", "Health", options.healths, "Any health")}
        {options.teams && options.teams.length > 1 && select("team", "Team", options.teams, "All teams")}
        {options.owners && options.owners.length > 0 && select("owner", "Assigned to", options.owners, "Anyone")}
        <label className="flex min-w-[150px] flex-1 flex-col gap-1">
          <span className="text-[13px] uppercase tracking-[0.02em] text-text-secondary">Sort</span>
          <Select
            value={params.get("sort") ?? "updated"}
            onChange={(e) => setParam("sort", e.target.value === "updated" ? "" : e.target.value)}
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {active && (
        <button
          type="button"
          onClick={() => {
            const sort = params.get("sort");
            startTransition(() => router.replace(sort ? `${pathname}?sort=${sort}` : pathname));
          }}
          className="mt-3 rounded-md px-2 py-1 text-[12px] text-text-tertiary transition-colors hover:text-accent-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent active:opacity-70"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
