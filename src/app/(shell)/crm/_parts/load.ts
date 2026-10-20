import "server-only";
import { requireActor } from "@/server/platform/auth";
import { executeQuery, getQuery } from "@/server/platform/query";
import { installCapabilities } from "@/server/capabilities/registry";
import { listViews, type SavedViewRow } from "@/server/platform/views";
import { describeObject, type DescribedObject } from "@/server/capabilities/relationship";
import type { Described, ListResult } from "@/components/records/model";

export type RecordPageData =
  | { ok: true; described: Described; views: SavedViewRow[]; viewId: string; initial: ListResult; actorUserId: string }
  | { ok: false; reason: "forbidden" };

/**
 * What a CRM list page needs on first paint: the described object, its views, the chosen view and its first page of
 * rows, all read as the signed-in person through the ordinary query pipeline. A refusal becomes a permission screen.
 */
export async function loadRecordPage(objectKey: string, requestedView?: string): Promise<RecordPageData> {
  installCapabilities();
  const actor = await requireActor();
  let described: DescribedObject;
  try {
    described = await executeQuery(actor, describeObject, { objectKey });
  } catch {
    return { ok: false, reason: "forbidden" };
  }
  const views = (await executeQuery(actor, listViews, { objectKey }).catch(() => [])) as SavedViewRow[];
  const chosen =
    views.find((v) => v.id === requestedView) ??
    views.find((v) => v.isDefault && v.visibility === "personal") ??
    views.find((v) => v.isDefault) ??
    views[0]!;
  const query = getQuery(described.listQuery);
  if (!query) throw new Error(`No list query ${described.listQuery}`);
  let initial: ListResult;
  try {
    initial = (await executeQuery(actor, query, {
      filters: chosen.config.filters,
      match: chosen.config.match,
      sorts: chosen.type === "board" ? [] : chosen.config.sorts,
      aggregates: chosen.type === "board" ? {} : chosen.config.aggregates,
      limit: chosen.type === "board" ? 500 : 100,
    })) as ListResult;
  } catch {
    return { ok: false, reason: "forbidden" };
  }
  const { fields, ...rest } = described;
  return {
    ok: true,
    described: { ...rest, fields } as Described,
    views,
    viewId: chosen.id,
    initial,
    actorUserId: actor.userId,
  };
}
