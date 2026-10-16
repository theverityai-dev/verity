import { notFound } from "next/navigation";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_MANUFACTURING_ROUTE, MANUFACTURING_CAPABILITY } from "@/server/capabilities/manufacturing";
import { readCheckpoints } from "@/server/capabilities/manufacturing/stages";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { Panel, PermissionDenied, SectionHeading, StatTile, StatTileRow } from "@/components/ui/primitives";
import { DataTable } from "@/components/ui/DataTable";
import { EntityHeader } from "@/components/ui/EntityHeader";
import { JourneyMap, type JourneyStep } from "@/components/ui/JourneyMap";
import { ChecklistRows } from "@/components/ui/Checklist";
import { STAGE_KIND_LABEL, kindPresentation, stageKindFor } from "@/components/ui/business/domains";
import { RouteActions } from "./RouteActions";

export const dynamic = "force-dynamic";

/**
 * One production route, drawn as its journey (Task 127 Phase 2, the route-detail mockup). A route is
 * tenant data: the ordered stages an order passes through and each stage's QC checklist template.
 * Every figure here is counted from the route itself; nothing is sample data.
 */
async function RoutePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ stage?: string }> }) {
  installCapabilities();
  const [{ id }, { stage }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const actor = await requireActor();

  const route = await withTenant(actor.tenantId, async (tx) => {
    if (!(await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_MANUFACTURING_ROUTE))) return "denied" as const;
    return tx.manufacturingRoute.findUnique({ where: { id }, include: { stages: { orderBy: { sequence: "asc" } } } });
  });
  if (route === "denied") return <PermissionDenied what="reading production routes" />;
  if (!route) notFound();

  const stages = route.stages.map((s) => {
    const kind = stageKindFor(s.stageKey, s.label);
    const checks = readCheckpoints(s.checkpoints);
    return { ...s, kind, checks };
  });
  const checkCount = stages.reduce((n, s) => n + s.checks.length, 0);
  const photoChecks = stages.reduce((n, s) => n + s.checks.filter((c) => c.requireEvidence).length, 0);
  const selected = stages.find((s) => s.stageKey === stage);
  const base = `/manufacturing/routes/${route.id}`;

  const steps: JourneyStep[] = stages.map((s) => ({
    key: s.stageKey,
    label: s.label,
    kind: s.kind,
    description: s.checks.length > 0 ? s.checks.map((c) => c.label).slice(0, 2).join(", ") + (s.checks.length > 2 ? "…" : "") : undefined,
    chip:
      s.checks.length > 0
        ? { icon: "stage-testing", label: `${s.checks.length} quality ${s.checks.length === 1 ? "check" : "checks"}` }
        : { icon: kindPresentation(s.kind).icon, label: STAGE_KIND_LABEL[s.kind] ?? "Production stage" },
    href: s.stageKey === stage ? base : `${base}?stage=${encodeURIComponent(s.stageKey)}`,
  }));

  return (
    <>
      <EntityHeader
        crumbs={[{ label: "Routes", href: "/manufacturing/routes" }, { label: route.code }]}
        title={route.name}
        code={route.code}
        state={{ category: route.active ? "Active" : "Cancelled", label: route.active ? "Active" : "Archived" }}
        meta={["Production route", `${stages.length} ${stages.length === 1 ? "stage" : "stages"}`]}
        actions={<RouteActions routeId={route.id} active={route.active} />}
      />

      <Panel title="Production journey" className="mb-5">
        <p className="m-0 mb-4 text-[15px] text-text-secondary">
          Follow each stage in order. Select a stage to see its checklist.
        </p>
        {steps.length > 0 ? (
          <JourneyMap steps={steps} selectedKey={selected?.stageKey} label={`${route.name} stages`} />
        ) : (
          <p className="m-0 text-[15px] text-text-secondary">This route has no stages yet.</p>
        )}
      </Panel>

      {selected && (
        <Panel title={`${selected.label}: checklist`} className="mb-5">
          {selected.checks.length > 0 ? (
            <ChecklistRows
              rows={selected.checks.map((c) => ({
                key: c.key,
                label: c.label,
                verdict: "none",
                requirement:
                  [c.requireEvidence ? "Photo required" : "", c.requireRemarks ? "Remarks required" : ""].filter(Boolean).join(" · ") ||
                  undefined,
              }))}
            />
          ) : (
            <p className="m-0 text-[15px] text-text-secondary">No quality checks at this stage.</p>
          )}
          <p className="m-0 mt-3 text-[13px] text-text-tertiary">
            This is the template. Each order copies it when its stages are planned, so later edits never change an order already running.
          </p>
        </Panel>
      )}

      <SectionHeading>Route overview</SectionHeading>
      <StatTileRow cols={3} className="mb-5">
        <StatTile kind="stage" label="Stages" value={stages.length} />
        <StatTile kind="certificate" label="Quality checks" value={checkCount} />
        <StatTile icon="photo" hue="olive" label="Checks needing a photo" value={photoChecks} />
      </StatTileRow>

      <Panel title="Stages at a glance" flush>
        <div className="px-5 pb-4">
          <DataTable
            caption={`${route.name} stages`}
            filterable={false}
            rowKey="stageKey"
            rows={stages.map((s) => ({
              stageKey: s.stageKey,
              sequence: s.sequence,
              label: s.label,
              kind: s.kind,
              kindLabel: STAGE_KIND_LABEL[s.kind] ?? "Production stage",
              checks: s.checks.length,
              checkList: s.checks.map((c) => c.label).join(", ") || "—",
            }))}
            columns={[
              { key: "sequence", header: "#", numeric: true, sortable: false },
              { key: "label", header: "Stage", kindKey: "kind", subKey: "kindLabel", sortable: false },
              { key: "checkList", header: "Checks", sortable: false },
              { key: "checks", header: "Count", numeric: true, sortable: false },
            ]}
          />
        </div>
      </Panel>
    </>
  );
}

export default withCapabilityPageAccess(MANUFACTURING_CAPABILITY, RoutePage);
