import { withTenant } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { readUrlFor } from "@/server/platform/files";
import { ENTITY_EVIDENCE } from "@/server/capabilities/evidence";
import { ENTITY_PIECEWORK_ENTRY } from "@/server/capabilities/piecework";
import type { ActorContext } from "@/server/platform/command";

/**
 * Photographs attached to return entries, as short-lived read URLs. Empty for a reader who may not read evidence and
 * for a deployment with no file storage; a screen shows a typed tile instead, never a broken image.
 */
export async function photosFor(actor: ActorContext, entryIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const ids = [...new Set(entryIds)];
  if (ids.length === 0) return out;
  return withTenant(actor.tenantId, async (tx) => {
    if (!(await hasTenantPermission(tx, actor.roleId, "Read", ENTITY_EVIDENCE))) return out;
    const rows = await tx.evidence.findMany({
      where: { entityKey: ENTITY_PIECEWORK_ENTRY, entityId: { in: ids }, kind: "Photo", fileId: { not: null } },
      orderBy: { capturedAt: "asc" },
    });
    for (const row of rows) {
      try {
        const url = await readUrlFor(tx, row.fileId!);
        out.set(row.entityId, [...(out.get(row.entityId) ?? []), url]);
      } catch {
        // storage not set up, or the file is not readable: no photo to show
      }
    }
    return out;
  });
}
