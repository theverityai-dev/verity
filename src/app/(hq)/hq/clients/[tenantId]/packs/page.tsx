import { EmptyState, ErrorState, Panel } from "@/components/ui/primitives";
import { clientPacks } from "@/server/platform/operator";
import { PacksAdmin } from "./PacksAdmin";

export const dynamic = "force-dynamic";

/**
 * Industry Packs for one client (HQ audit B1; ADR-022). Which signed packs this
 * installation holds, what applying each would change here, and what this
 * client already runs. Applying re-plans on the server, so the preview shown is
 * re-derived at apply time rather than trusted.
 */
export default async function ClientPacksPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  let data: Awaited<ReturnType<typeof clientPacks>>;
  try {
    data = await clientPacks(tenantId);
  } catch (error) {
    return (
      <ErrorState
        title="Could not load packs for this client"
        message={error instanceof Error ? error.message.replace(/^E_[A-Z_]+:\s*/, "") : "Unknown error"}
        retryable
      />
    );
  }

  if (data.releases.length === 0 && data.instances.length === 0) {
    return (
      <Panel title="Packs">
        <EmptyState
          title="No packs on this installation"
          description="Signed Industry Packs are imported by the platform team with the import tool. Once one is imported it appears here to preview and apply."
        />
      </Panel>
    );
  }

  return <PacksAdmin tenantId={tenantId} releases={data.releases} instances={data.instances} />;
}
