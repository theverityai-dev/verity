"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { runCommand } from "@/server/actions/platform";
import type { ActionResult } from "@/server/platform/action-error";
import { LANG_COOKIE, isLang } from "./labels";

/** Remembers the language on this device for a year. Not an authorization matter: it changes labels only. */
export async function setFloorLanguage(lang: string): Promise<void> {
  if (!isLang(lang)) return;
  (await cookies()).set(LANG_COOKIE, lang, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/shopfloor", "layout");
}

/**
 * Runs a piece-rate command for the floor screens. The platform command returns the wage an entry earned; a supervisor never
 * sees money, so it is dropped here before the result leaves the server.
 */
export async function runFloorCommand<T extends Record<string, unknown> = Record<string, unknown>>(key: string, input: unknown, revalidate: string): Promise<ActionResult<Omit<T, "wageMinor">>> {
  const result = await runCommand<T>(key, input, revalidate);
  if (result.ok && result.data && typeof result.data === "object") {
    const { wageMinor: _dropped, ...safe } = result.data as T & { wageMinor?: number };
    void _dropped;
    return { ok: true, data: safe as Omit<T, "wageMinor"> };
  }
  return result as ActionResult<Omit<T, "wageMinor">>;
}
