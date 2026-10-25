import Link from "next/link";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { executeQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { ENTITY_PIECEWORK_SETTING, PIECEWORK_CAPABILITY, setupProgress } from "@/server/capabilities/piecework";
import { withCapabilityPageAccess } from "@/components/ui/PageAccess";
import { Badge, PageHeader, PermissionDenied, Surface } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { ProgressRing } from "@/components/ui/viz";

export const dynamic = "force-dynamic";

/**
 * Set up the factory: the order a new workspace is made ready in, as a journey. Every step's state is worked out from what exists, so it can
 * never be ticked by hand and drift from the truth, and every step opens the real screen that does the work. Optional steps never hold the
 * count back.
 */
async function SetupPage() {
  installCapabilities();
  const actor = await requireActor();
  const allowed = await withTenant(actor.tenantId, (tx) => hasTenantPermission(tx, actor.roleId, "Read", ENTITY_PIECEWORK_SETTING));
  if (!allowed) return <PermissionDenied what="set-up" />;
  const { steps, done, required } = await executeQuery(actor, setupProgress, {});
  const next = steps.find((s) => !s.done && !s.optional);

  return (
    <>
      <PageHeader title="Set up the factory" description={next ? `${done} of ${required} steps done. Next: ${next.title.toLowerCase()}.` : "Every step is done. The factory is ready for its first full day."} />

      <Surface className="mb-6 flex flex-wrap items-center gap-5 p-5">
        <ProgressRing value={done} total={required} label="Set-up steps done" size={72} tone={done === required ? "completed" : "active"} />
        <div className="min-w-0 flex-1 basis-60">
          <p className="m-0 text-[17px] font-medium leading-[22px] tracking-[-0.02em] text-text">{done === required ? "Ready" : `${required - done} to go`}</p>
          <p className="m-0 mt-1 text-[13px] leading-[19px] text-text-secondary">Each step is worked out from what is in the system, so this list is always true. Open a step to do it where it lives.</p>
        </div>
        {next && (
          <Link href={next.href} className="inline-flex min-h-11 items-center rounded-[10px] bg-accent px-5 text-[15px] font-semibold text-accent-on no-underline transition-opacity hover:opacity-90 active:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]">{next.action}</Link>
        )}
      </Surface>

      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {steps.map((s, i) => (
          <li key={s.key} className="list-none">
            <Link href={s.href} className="block no-underline transition-transform duration-150 hover:-translate-y-px active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]">
              <Surface className={`flex items-center gap-4 p-4 ${s.done ? "opacity-80" : ""}`}>
                <span
                  aria-hidden="true"
                  className="tabular grid size-9 shrink-0 place-items-center rounded-full text-[14px] font-semibold"
                  style={s.done ? { backgroundColor: "var(--color-state-completed-fill)", color: "var(--color-state-completed-on)" } : { backgroundColor: "var(--color-control)", color: "var(--color-text)" }}
                >
                  {s.done ? <Icon name="check" size={18} /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-medium text-text">{s.title}</span>
                    {s.optional && <Badge>Optional</Badge>}
                    <span className="sr-only">{s.done ? "Done" : "Not done"}</span>
                  </span>
                  <span className="mt-0.5 block text-[13px] leading-[19px] text-text-secondary">{s.detail}</span>
                </span>
                <span className="hidden shrink-0 text-[13px] font-medium text-accent-ink sm:block">{s.done ? "Open" : s.action} →</span>
              </Surface>
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}

export default withCapabilityPageAccess(PIECEWORK_CAPABILITY, SetupPage);
