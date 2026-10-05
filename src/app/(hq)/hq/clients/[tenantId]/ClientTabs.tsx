"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Sub-navigation within one client.
 *
 * A tab strip rather than more sidebar entries: the sidebar answers "where in
 * HQ am I", and nesting a client's seven administrative surfaces there would
 * make the rail change shape depending on which page you were on. The strip
 * keeps the client the subject and the surfaces its facets.
 */
const TABS = [
  { slug: "", label: "Overview" },
  { slug: "people", label: "People" },
  { slug: "roles", label: "Roles" },
  { slug: "organizations", label: "Organizations" },
  { slug: "modules", label: "Modules" },
  { slug: "packs", label: "Packs" },
  { slug: "operations", label: "Operations" },
  { slug: "settings", label: "Settings" },
];

export function ClientTabs({ tenantId }: { tenantId: string }) {
  const pathname = usePathname();
  const base = `/hq/clients/${tenantId}`;

  return (
    <nav aria-label="Client administration" className="mb-6 overflow-x-auto">
      <ul className="m-0 flex list-none gap-1 border-b border-line p-0">
        {TABS.map((tab) => {
          const href = tab.slug ? `${base}/${tab.slug}` : base;
          const current = tab.slug ? pathname.startsWith(href) : pathname === base;
          return (
            <li key={tab.slug}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className={
                  "-mb-px inline-flex h-10 items-center whitespace-nowrap rounded-t-md px-3.5 text-[14px] no-underline " +
                  "transition-colors duration-150 " +
                  (current
                    ? "border-b-2 border-accent font-medium text-text"
                    : "border-b-2 border-transparent text-text-secondary hover:text-text")
                }
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
