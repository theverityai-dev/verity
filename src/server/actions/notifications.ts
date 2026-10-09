"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/platform/auth";
import { withTenant } from "@/server/platform/tenancy";
import { markRead } from "@/server/platform/notification";
import { toActionFailure, type ActionResult } from "@/server/platform/action-error";

/**
 * Mark the caller's own notifications read (one, or all when no id is given).
 *
 * Like `changeOwnPassword` and `requestAccess`, this acts only on behalf of its
 * caller and needs no entity grant: `markRead` is scoped to the signed-in user's
 * own rows, and row-level security keeps every other tenant out.
 */
export async function markNotificationsRead(notificationId?: string): Promise<ActionResult<{ marked: number }>> {
  try {
    const actor = await requireActor();
    const marked = await withTenant(actor.tenantId, (tx) => markRead(tx, { userId: actor.userId, notificationId }));
    revalidatePath("/notifications");
    return { ok: true, data: { marked } };
  } catch (error) {
    return toActionFailure(error);
  }
}
