import Link from "next/link";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { AppearanceControls } from "@/components/shell/AppearanceControls";
import { Icon, type IconName } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Settings — the one global entry point, reachable from the profile menu by
 * every signed-in actor regardless of role.
 *
 * Appearance renders directly here, ungated: theme is a per-user cookie
 * preference (`AppearanceControls`'s own doc comment), never tenant policy,
 * so gating it behind tenant-admin permission — which is where
 * they lived before, colocated on `/configuration` — was excluding every
 * non-admin actor from changing their own theme. That was the actual bug;
 * this page is the fix.
 *
 * The other sections (Business, Tax, Advanced configuration) ARE genuinely
 * tenant-admin-scoped, so they stay as links rather than embedded panels —
 * each destination gates itself (`PermissionDenied`, which now carries a
 * real recovery action) exactly as it did before. This page does not
 * pre-check those permissions to decide what to show: that would need a
 * second permission read per section for a purely cosmetic filter, and an
 * actor who lacks access already gets a clear, non-dead-end answer at the
 * destination.
 */
export default function SettingsPage() {
  const links: Array<{ href: string; icon: IconName; label: string; description: string }> = [
    { href: "/account", icon: "parties", label: "Account", description: "Your identity, email and password." },
    { href: "/settings/business", icon: "building", label: "Business", description: "Legal name, registration and tax identity." },
    { href: "/settings/outlets", icon: "locations", label: "Outlets", description: "Seller details, bill numbering and service day for each outlet." },
    { href: "/settings/tax", icon: "tax", label: "Tax", description: "Tax rates and calculation rules." },
    { href: "/settings/alerts", icon: "bell", label: "Alerts", description: "Choose which events notify which roles." },
    { href: "/settings/data-export", icon: "evidence", label: "Export your data", description: "Download a copy of your records as spreadsheets." },
    { href: "/configuration", icon: "configuration", label: "Advanced configuration", description: "Raw platform configuration values. Tenant-admin only." },
  ];

  return (
    <>
      <PageHeader title="Settings" description="Customize your workspace, preferences and account." />

      <Panel title="Appearance" className="mb-6">
        <AppearanceControls />
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="glass-card flex items-start gap-3 rounded-[12px] p-4 no-underline shadow-[var(--)] transition-[box-shadow,transform] duration-150 hover:-translate-y-px"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-subtle text-accent-ink">
              <Icon name={l.icon} size={18} />
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-[14px] font-medium text-text">{l.label}</span>
              <span className="text-[12.5px] text-text-tertiary">{l.description}</span>
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
