"use server";

import { activeAuthProviderName, createSupabaseServerClient, getAuthUser } from "@/server/platform/auth";
import { toActionFailure, type ActionResult } from "@/server/platform/action-error";

/**
 * Self-service password change — every role, every tenant. Not a platform
 * command: `User`/`Party` carry no credential material by design (Bible V2
 * Primitive 2 §1, superseded in practice by the Supabase decision — see
 * `src/server/platform/CLAUDE.md`'s identity-shape section). Supabase Auth
 * owns the password; this is direct provider glue, same posture as
 * `signInWithPassword`/`signOut` in `server/actions/platform.ts`.
 *
 * Re-verifies the current password via `signInWithPassword` before calling
 * `updateUser` — Supabase's own API will happily change a live session's
 * password without proof of the old one, which is the wrong default for a
 * "change my password" form (a device left signed in should not become a
 * silent account-takeover vector).
 */
export async function changeOwnPassword(currentPassword: string, newPassword: string): Promise<ActionResult<{ ok: true }>> {
  try {
    // Under OIDC the identity provider owns the password; there is no Supabase project to ask.
    if (activeAuthProviderName() === "oidc") {
      return { ok: false, code: "E_VALIDATION", message: "Your password is managed by your organization's identity provider. Change it there.", issues: [], retryable: false };
    }
    if (newPassword.length < 8) {
      return { ok: false, code: "E_VALIDATION", message: "New password must be at least 8 characters.", issues: [], retryable: true };
    }

    const authUser = await getAuthUser();
    if (!authUser?.email) {
      return { ok: false, code: "E_FORBIDDEN", message: "Not signed in.", issues: [], retryable: false };
    }

    const supabase = await createSupabaseServerClient();

    const verify = await supabase.auth.signInWithPassword({ email: authUser.email, password: currentPassword });
    if (verify.error) {
      return { ok: false, code: "E_VALIDATION", message: "Current password is incorrect.", issues: [], retryable: true };
    }

    const update = await supabase.auth.updateUser({ password: newPassword });
    if (update.error) throw update.error;

    return { ok: true, data: { ok: true } };
  } catch (error) {
    return toActionFailure(error);
  }
}
