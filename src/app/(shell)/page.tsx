import { redirect } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { installCapabilities } from "@/server/capabilities/registry";
import { PLYWOOD_CAPABILITY, landingRouteFor } from "@/server/capabilities/plywood";
import { OUTREACH_CAPABILITY, outreachLandingRouteFor } from "@/server/capabilities/outreach";
import { DINEIN_CAPABILITY, dineinLandingRouteFor } from "@/server/capabilities/dinein";
import { PROJECT_CAPABILITY, projectLandingRouteFor } from "@/server/capabilities/project";
import { MANUFACTURING_CAPABILITY, manufacturingLandingRouteFor } from "@/server/capabilities/manufacturing";
import { withTenant } from "@/server/platform/tenancy";
import { resolvePermissions, hasTenantPermission } from "@/server/platform/authorization";
import {
  Button,
  CardAction,
  DemoDataNotice,
  PageHeader,
  Panel,
  PermissionDenied,
} from "@/components/ui/primitives";
import { BarStrip, Donut, FeatureCard, Legend, StairFigure } from "@/components/ui/charts";
import { DataTable } from "@/components/ui/DataTable";
import { Icon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Platform overview.
 *
 * Composed as the approved mockup composes it: a row of three cards, a wide
 * card beneath, then a toolbar and a table.
 *
 * §10 forbids invented KPIs, and nothing here breaks that. Every figure is a
 * row the platform can count right now, and the two charts render those same
 * counts rather than a series — there are no trend arrows, no targets and no
 * projections, because the platform has no analytics layer to derive one from.
 * A count of zero is drawn as zero and reads as a fact.
 */
export default async function OverviewPage() {
  const actor = await requireActor();
  if (!actor.roleId) return <PermissionDenied what="the overview — no role has been assigned" />;

  // §1 — start each role where its work is.
  //
  // Only when the plywood capability is active for this tenant: this route is
  // the platform's own overview and belongs to every tenant, so a pack must not
  // redirect it for a tenant that never installed the pack.
  //
  // Derived from what the role can DO, never from its name — matching on
  // "Accountant" breaks the moment a business calls the job something else,
  // which they will. A null answer means leave them here, because a redirect
  // guessed wrong puts someone on a screen they did not ask for and cannot
  // explain.
  installCapabilities();
  const landing = await withTenant(actor.tenantId, async (tx) => {
    if (!actor.roleId) return null;
    const [plywoodActive, outreachActive, dineinActive, projectActive, manufacturingActive] = await Promise.all([
      tx.tenantActivation.findFirst({
        where: { capabilityId: PLYWOOD_CAPABILITY, status: "Active" },
        select: { capabilityId: true },
      }),
      tx.tenantActivation.findFirst({
        where: { capabilityId: OUTREACH_CAPABILITY, status: "Active" },
        select: { capabilityId: true },
      }),
      tx.tenantActivation.findFirst({
        where: { capabilityId: DINEIN_CAPABILITY, status: "Active" },
        select: { capabilityId: true },
      }),
      tx.tenantActivation.findFirst({
        where: { capabilityId: PROJECT_CAPABILITY, status: "Active" },
        select: { capabilityId: true },
      }),
      tx.tenantActivation.findFirst({
        where: { capabilityId: MANUFACTURING_CAPABILITY, status: "Active" },
        select: { capabilityId: true },
      }),
    ]);
    if (!plywoodActive && !outreachActive && !dineinActive && !projectActive && !manufacturingActive) return null;
    const permissions = await resolvePermissions(tx, actor.roleId);
    // A tenant runs at most one of these packs today, but check all rather
    // than assume — a null from one is exactly the "leave them here" signal
    // another might still override.
    return (
      (plywoodActive ? landingRouteFor(permissions) : null) ??
      (outreachActive ? outreachLandingRouteFor(permissions) : null) ??
      (dineinActive ? dineinLandingRouteFor(permissions) : null) ??
      (projectActive ? projectLandingRouteFor(permissions) : null) ??
      (manufacturingActive ? manufacturingLandingRouteFor(permissions) : null)
    );
  });
  if (landing) redirect(landing);

  // This aggregate spans capabilities; it requires its own explicit grant.
  const canRead = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Read", "verity.platform.overview"));
  if (!canRead) return <PermissionDenied what="the overview" />;
  const data = await withTenant(actor.tenantId, async (tx) => {
    const [
      organization,
      activations,
      permissions,
      recentEvents,
      pendingApprovals,
      openExceptions,
      assets,
      assetStates,
      locationCount,
      evidenceCount,
    ] = await Promise.all([
      tx.organization.findUnique({ where: { id: actor.organizationId } }),
      tx.tenantActivation.findMany({ where: { status: "Active" }, include: { capability: true } }),
      actor.roleId ? resolvePermissions(tx, actor.roleId) : Promise.resolve([]),
      tx.domainEvent.findMany({ orderBy: { occurredAt: "desc" }, take: 60 }),
      tx.approvalStep.count({
        where: { decision: "Pending", approverRoleId: actor.roleId ?? undefined },
      }),
      tx.syncException.count({ where: { resolvedAt: null } }),
      tx.asset.findMany({
        orderBy: { updatedAt: "desc" },
        include: { location: { select: { name: true } } },
      }),
      // The state vocabulary the Asset capability actually declares. Grouping
      // by CATEGORY rather than by state key is ADR-009: the six categories are
      // behavioural and stable, while keys and labels belong to the tenant.
      tx.stateDefinition.findMany({ where: { entityKey: "verity.asset.asset" } }),
      tx.location.count(),
      tx.evidence.count(),
    ]);

    return {
      organization,
      activations,
      permissions,
      recentEvents,
      pendingApprovals,
      openExceptions,
      assets,
      assetStates,
      locationCount,
      evidenceCount,
    };
  });

  const categoryOf = new Map(data.assetStates.map((s) => [s.key, s.category]));
  const count = (category: string) =>
    data.assets.filter((a) => categoryOf.get(a.state) === category).length;

  // The donut's segments and the staircase's figures are the same six canonical
  // categories, so the two charts can never disagree with each other.
  // The ring shows a DISTRIBUTION, so it is drawn in the accent's tonal ladder
  // rather than in semantic colour — the same choice the reference boards make.
  // Meaning is not lost: every segment is labelled, and semantic colour still
  // carries state everywhere it identifies a single record (see StateBadge).
  const segments = [
    { label: "Active", value: count("Active"), color: "var(--accent-500)" },
    { label: "Pending", value: count("Pending"), color: "var(--accent-400)" },
    { label: "Blocked", value: count("Blocked"), color: "var(--accent-300)" },
    { label: "Completed", value: count("Completed"), color: "var(--accent-200)" },
    { label: "Draft", value: count("Draft"), color: "var(--color-text-tertiary)" },
  ];

  // Activity per day for the last twelve days — a real count of real events,
  // which is the only series the platform can honestly produce.
  const days = Array.from({ length: 12 }, (_, i) => {
    const day = new Date();
    day.setUTCDate(day.getUTCDate() - (11 - i));
    const key = day.toISOString().slice(0, 10);
    return data.recentEvents.filter((e) => e.occurredAt.toISOString().slice(0, 10) === key).length;
  });

  const needsAttention = data.pendingApprovals > 0 || data.openExceptions > 0;
  const newestAsset = data.assets[0];

  const eventRows = data.recentEvents.slice(0, 40).map((e) => ({
    id: e.id,
    name: e.name,
    entity: e.entityKey ?? "—",
    at: e.occurredAt.toISOString().replace("T", " ").slice(0, 16),
  }));

  if (!data.organization) return <PermissionDenied what="reading this organization" />;

  return (
    <>
      <PageHeader
        title="Overview"
        description="The platform's current state in this organization — what is active, what is waiting, and what has happened recently."
      />

      {/* ---- the mockup's three-card row ---------------------------------- */}
      <div className="grid gap-5 lg:grid-cols-3">
        {/* A. the staircase of real counts, over a field of real activity */}
        <Panel
          title="Platform"
          action={<CardAction icon={<Icon name="audit" size={14} />}>Last 12 days</CardAction>}
        >
          <div className="grid grid-cols-4 items-end gap-3">
            <StairFigure value={data.locationCount} label="Locations" />
            <StairFigure value={data.assets.length} label="Assets" />
            <StairFigure value={data.activations.length} label="Capabilities" />
            <StairFigure value={data.permissions.length} label="Grants" accent />
          </div>
          <div className="mt-5">
            <BarStrip values={days} label="Events per day over the last twelve days" />
          </div>
          <div className="mt-3 h-[3px] w-16 rounded-pill bg-accent" aria-hidden="true" />
        </Panel>

        {/* B. the ring: asset states by canonical category (ADR-009) */}
        <Panel
          title="Asset states"
          action={<CardAction href="/assets" variant="link">View all</CardAction>}
        >
          <div className="flex items-center gap-6">
            <div className="min-w-0 flex-1">
              <Legend segments={segments} />
            </div>
            <Donut
              segments={segments}
              centreValue={data.assets.length}
              centreLabel="Total assets"
              size={150}
            />
          </div>
        </Panel>

        {/* C. the feature card: the single thing asking to be acted on */}
        <Panel
          title="Needs attention"
          action={
            needsAttention ? (
              <CardAction href="/approvals" variant="link">
                Review
              </CardAction>
            ) : undefined
          }
          className="flex flex-col"
        >
          {needsAttention ? (
            <FeatureCard
              tone="warning"
              pill={data.pendingApprovals > 0 ? "Awaiting your role" : "Unresolved"}
              title={
                data.pendingApprovals > 0
                  ? `${data.pendingApprovals} approval${data.pendingApprovals === 1 ? "" : "s"}`
                  : `${data.openExceptions} sync exception${data.openExceptions === 1 ? "" : "s"}`
              }
              meta={
                data.pendingApprovals > 0
                  ? "Blocked until a decision is recorded"
                  : "Conflicts held for manual resolution"
              }
              action={
                <Button variant="primary" size="sm" className="shrink-0">
                  Open
                </Button>
              }
            />
          ) : (
            <FeatureCard
              tone="quiet"
              pill="Nothing waiting"
              title={newestAsset?.name ?? "No records yet"}
              meta={
                newestAsset
                  ? `Most recently changed · ${newestAsset.location?.name ?? "no location"}`
                  : "Records appear here as commands run"
              }
            />
          )}
        </Panel>
      </div>

      {/* ---- the wide card ------------------------------------------------ */}
      <div className="mt-5">
        <Panel
          title="Operating context"
          action={<CardAction>{data.organization.name}</CardAction>}
        >
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { term: "Organization", value: data.organization.name },
              { term: "Role", value: actor.roleId ? "Assigned" : "No role assigned" },
              { term: "Evidence captured", value: String(data.evidenceCount) },
              { term: "Unresolved exceptions", value: String(data.openExceptions) },
            ].map((item) => (
              <div key={item.term} className="min-w-0">
                <p className="m-0 text-[13px] text-text-tertiary">{item.term}</p>
                <p className="m-0 mt-1.5 truncate text-[16px] text-text">{item.value}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-5">
            {data.activations.map((a) => (
              <span
                key={a.capabilityId}
                className="inline-flex items-center gap-2 rounded-pill bg-surface-sunken px-3 py-1.5 text-[12.5px] text-text-secondary"
              >
                <span aria-hidden="true" className="size-[6px] rounded-full bg-accent" />
                {a.capability.name}
                <span className="text-text-tertiary">
                  v{a.pinnedVersion ?? a.capability.version}
                </span>
              </span>
            ))}
          </div>
        </Panel>
      </div>

      {/* ---- toolbar + table ---------------------------------------------- */}
      <div className="mt-8">
        <DataTable
          caption="Recent activity"
          rows={eventRows}
          columns={[
            { key: "name", header: "Event", subKey: "entity" },
            { key: "at", header: "Occurred" },
          ]}
          emptyTitle="Nothing has happened yet"
          emptyDescription="Platform events appear here as commands run. An empty stream means this organization has not executed one."
        />
      </div>

      <div className="mt-6">
        <DemoDataNotice />
      </div>
    </>
  );
}
