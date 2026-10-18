"use server";
import { limitActorRequests } from "@/server/platform/request-limits";

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { executeCommand } from "@/server/platform/command";
import { authorize } from "@/server/platform/authorization";
import { activeAuthProviderName, requireActor } from "@/server/platform/auth";
import { runtimeConfig } from "@/server/platform/config";
import {
  ENTITY_MEMBERSHIP,
  invitePerson,
} from "@/server/platform/administration";
import { withTenant } from "@/server/platform/tenancy";
import {
  toActionFailure,
  type ActionResult,
} from "@/server/platform/action-error";

/**
 * Creates a login for a member of staff.
 *
 * REQUESTED: "instead of inviting someone, make it such that the owner makes a
 * login for them."
 *
 * `invite_person` provisioned a Party, a User and a membership against a
 * RANDOMLY GENERATED auth id — a person who existed in every list and could
 * never sign in, because no Supabase account had that id. For a five-person
 * yard where the proprietor hands out the passwords, an invitation flow is
 * ceremony around a thing they were going to do themselves anyway.
 *
 * WHY THIS IS AN ACTION AND NOT A COMMAND. Creating an auth account is a write
 * to Supabase Auth, which is not the tenant database and not inside the
 * command's transaction. A command that reached out to another system mid-
 * transaction would roll back its own half and leave the account behind.
 *
 * ORDER MATTERS, and it is deliberate: authorize FIRST, create the account
 * SECOND, provision the identity THIRD, and delete the account if the third
 * fails. Creating the account before checking permission would let anyone who
 * can reach this action mint Supabase users; leaving it behind on a failure
 * would accumulate accounts with no person attached.
 */
export async function createTeamLogin(input: {
  displayName: string;
  email: string;
  password: string;
  organizationId: string;
  roleId?: string | null;
  phone?: string;
}): Promise<ActionResult<{ userId: string; membershipId: string }>> {
  try {
    // Logins live in the Supabase project. Under OIDC an administrator creates the account in the organization's
    // identity provider and Verity is then told about it by the operator provisioning step, never from here.
    if (activeAuthProviderName() === "oidc") {
      return {
        ok: false,
        code: "E_VALIDATION",
        message: "Accounts are created by your administrator in your organization's identity provider. Ask them to add this person, then have the operator link the account to Verity.",
        retryable: false,
      };
    }
    const actor = await requireActor();
    await limitActorRequests(actor.tenantId, actor.userId, "command");

    // The same grant `invite_person` requires, checked before anything outside
    // this system is touched.
    await withTenant(actor.tenantId, (tx) =>
      authorize(tx, actor.roleId, "Create", ENTITY_MEMBERSHIP),
    );

    const url = runtimeConfig.storage.supabaseUrl;
    const serviceRoleKey = runtimeConfig.storage.serviceRoleKey;
    if (!url || !serviceRoleKey) {
      // Named precisely. "Something went wrong" would send someone hunting
      // through the code for a missing environment variable.
      return {
        ok: false,
        code: "E_VALIDATION",
        message:
          "This deployment has no Supabase service key configured, so a login " +
          "cannot be created. Set SUPABASE_SERVICE_ROLE_KEY.",
        retryable: false,
      };
    }

    const admin = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const created = await admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      // The owner is standing next to them. Requiring an email round-trip to
      // confirm an address the proprietor just typed would stop the person
      // signing in for a reason nobody in the room cares about.
      email_confirm: true,
      user_metadata: { display_name: input.displayName },
    });

    if (created.error || !created.data.user) {
      return {
        ok: false,
        code: "E_VALIDATION",
        message: created.error?.message ?? "That login could not be created",
        retryable: false,
      };
    }

    const authUserId = created.data.user.id;

    try {
      const identity = await executeCommand(actor, invitePerson, {
        displayName: input.displayName,
        email: input.email,
        organizationId: input.organizationId,
        roleId: input.roleId ?? null,
        ...(input.phone ? { phone: input.phone } : {}),
        authUserId,
      });
      revalidatePath("/people");
      return { ok: true, data: identity };
    } catch (error) {
      // The account exists and the person does not. Removing it keeps the two
      // systems agreeing, and a failed attempt leaves nothing behind to
      // collide with when it is retried.
      await admin.auth.admin.deleteUser(authUserId).catch(() => {});
      throw error;
    }
  } catch (error) {
    const failure = toActionFailure(error);
    // An owner creating a login is the one person who can act on the real
    // reason (a duplicate email, a role they may not grant, a database
    // refusal) — "Something went wrong" sent them to support with nothing
    // to say (2026-09-15). Platform errors keep their own codes above; only
    // the catch-all gets the underlying message appended.
    if (failure.code === "E_UNKNOWN" && error instanceof Error && error.message) {
      return { ...failure, issues: [error.message.slice(0, 300)] };
    }
    return failure;
  }
}

/** Sets a new password for a member of staff, for when they forget it. */
export async function resetTeamPassword(input: {
  authUserId: string;
  password: string;
}): Promise<ActionResult<null>> {
  try {
    if (activeAuthProviderName() === "oidc") {
      return { ok: false, code: "E_VALIDATION", message: "Passwords are managed by your organization's identity provider. Reset it there.", retryable: false };
    }
    const actor = await requireActor();
    await limitActorRequests(actor.tenantId, actor.userId, "command");
    await withTenant(actor.tenantId, (tx) =>
      authorize(tx, actor.roleId, "Edit", ENTITY_MEMBERSHIP),
    );

    const url = runtimeConfig.storage.supabaseUrl;
    const serviceRoleKey = runtimeConfig.storage.serviceRoleKey;
    if (!url || !serviceRoleKey) {
      return {
        ok: false,
        code: "E_VALIDATION",
        message:
          "This deployment has no Supabase service key configured, so a password " +
          "cannot be changed. Set SUPABASE_SERVICE_ROLE_KEY.",
        retryable: false,
      };
    }

    // Only for someone who is actually a member of THIS tenant. Without this
    // check the action would change the password of any account in the project
    // whose id a caller could name.
    const member = await withTenant(actor.tenantId, (tx) =>
      tx.tenantMembership.findFirst({
        where: { user: { authUserId: input.authUserId } },
        select: { id: true },
      }),
    );
    if (!member) {
      return {
        ok: false,
        code: "E_VALIDATION",
        message: "That person is not a member of this business",
        retryable: false,
      };
    }

    const admin = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const updated = await admin.auth.admin.updateUserById(input.authUserId, {
      password: input.password,
    });
    if (updated.error) {
      return {
        ok: false,
        code: "E_VALIDATION",
        message: updated.error.message,
        retryable: false,
      };
    }

    revalidatePath("/people");
    return { ok: true, data: null };
  } catch (error) {
    return toActionFailure(error);
  }
}

/** A password that is not guessable and not the person's name. */
export async function suggestPassword(): Promise<string> {
  // Ambiguous characters left out: someone is going to read this aloud or write
  // it on paper, and 0/O and 1/l/I are where that goes wrong.
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomUUID().replace(/-/g, "");
  let out = "";
  for (let i = 0; i < 12; i += 1) {
    out += alphabet[parseInt(bytes.slice(i * 2, i * 2 + 2), 16) % alphabet.length];
  }
  return out;
}
