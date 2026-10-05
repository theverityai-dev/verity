"use server";

import { revalidatePath } from "next/cache";
import { listMemberships, setActiveMembership } from "@/server/platform/auth";
import { redirect } from "next/navigation";
import {
  applyPackRelease,
  createClient,
  enterClient,
  operatorActorFor,
  removePack,
  rollbackPack,
  setClientStatus,
  upgradeCapability,
  type ClientStatus,
  type PackReleaseView,
} from "@/server/platform/operator";
import { executeCommand, getCommand } from "@/server/platform/command";
import { executeQuery, getQuery } from "@/server/platform/query";
import { installAdministration } from "@/server/platform/administration";
import { installCapabilities } from "@/server/capabilities/registry";
import { toActionFailure, type ActionResult } from "@/server/platform/action-error";

/**
 * HQ operator actions.
 *
 * Thin by design. Every one of these delegates to the platform — the operator
 * check, the audit write and the scope handling all live in
 * `src/server/platform/operator.ts` and the command runtime. An action that did
 * any of that itself would be a second security path, and ADR-013 exists
 * precisely to keep there being one.
 *
 * The actor is never read from the payload. `operatorActorFor` derives it from
 * the verified session and the operator's platform authority, so a forged tenant
 * id in a form field produces a refusal rather than the wrong tenant
 * (PLA-TEN-006).
 */

export type HqActionResult = { ok: true } | { ok: false; message: string };

function message(error: unknown): string {
  const failure = toActionFailure(error);
  // E_FORBIDDEN and E_VALIDATION are safe to surface — the first tells an
  // operator they lack authority, the second tells them what to fix. Anything
  // else is an internal failure whose text is not the operator's business.
  if (failure.code === "E_FORBIDDEN") return "You do not have operator authority for that.";
  if (failure.code === "E_VALIDATION") {
    return failure.message.replace(/^E_VALIDATION:\s*/, "");
  }
  return "Something went wrong. The action was not applied.";
}

/* ------------------------------- clients --------------------------------- */

export async function createClientAction(
  _prev: HqActionResult | null,
  form: FormData,
): Promise<HqActionResult> {
  try {
    await createClient({
      name: String(form.get("name") ?? ""),
      timeZone: (form.get("timeZone") as string) || null,
    });
  } catch (error) {
    return { ok: false, message: message(error) };
  }

  revalidatePath("/hq/clients");
  revalidatePath("/hq");
  return { ok: true };
}

/**
 * Enters a client and lands in that client's workspace.
 *
 * The redirect is the point: entering is a context change, and leaving the
 * operator on an HQ page afterwards would leave them unsure which tenant their
 * next click applies to.
 */
export async function enterClientAction(
  _prev: HqActionResult | null,
  form: FormData,
): Promise<HqActionResult> {
  const tenantId = String(form.get("tenantId") ?? "");
  if (!tenantId) return { ok: false, message: "Choose a client." };
  try {
    await enterClient(tenantId, String(form.get("reason") ?? ""));
  } catch (error) {
    return { ok: false, message: message(error) };
  }
  redirect("/");
}

/** ADR-034: onboarding, active or suspended, always with a reason. */
export async function setClientStatusAction(
  _prev: HqActionResult | null,
  form: FormData,
): Promise<HqActionResult> {
  const tenantId = String(form.get("tenantId") ?? "");
  try {
    await setClientStatus(tenantId, String(form.get("status") ?? "") as ClientStatus, String(form.get("reason") ?? ""));
  } catch (error) {
    return { ok: false, message: message(error) };
  }
  revalidatePath("/hq");
  revalidatePath("/hq/clients");
  revalidatePath(`/hq/clients/${tenantId}`);
  return { ok: true };
}

/* -------------------------- administration bridge ------------------------- */

/**
 * Runs a registered command inside one client, as the operator.
 *
 * This is the only write path HQ has, and it is the ordinary one: the same
 * `executeCommand` a tenant user's action goes through, with an actor whose
 * authority in that client is a real membership and a real role. Nothing here
 * elevates anything — the elevation, such as it is, happened when
 * `operatorActorFor` verified platform authority and produced the actor.
 */
export async function runClientCommand<T = unknown>(
  tenantId: string,
  key: string,
  input: unknown,
  revalidate?: string,
): Promise<ActionResult<T>> {
  installCapabilities();
  installAdministration();
  try {
    const definition = getCommand(key);
    if (!definition) throw new Error(`Unknown command: ${key}`);

    const actor = await operatorActorFor(tenantId);
    const data = (await executeCommand(actor, definition, input)) as T;

    if (revalidate) revalidatePath(revalidate);
    return { ok: true, data };
  } catch (error) {
    return toActionFailure(error);
  }
}

/** Runs a registered query inside one client, as the operator. */
export async function runClientQuery<T = unknown>(
  tenantId: string,
  key: string,
  input: unknown,
): Promise<ActionResult<T>> {
  installCapabilities();
  installAdministration();
  try {
    const definition = getQuery(key);
    if (!definition) throw new Error(`Unknown query: ${key}`);

    const actor = await operatorActorFor(tenantId);
    const data = (await executeQuery(actor, definition, input)) as T;
    return { ok: true, data };
  } catch (error) {
    return toActionFailure(error);
  }
}

/* ------------------------- packs and upgrades (B1, B2) ------------------------- */

function packMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : "";
  const coded = /^(E_PACK_[A-Z_]+|E_UPGRADE_[A-Z_]+):\s*(.*)$/.exec(text);
  if (coded) return coded[2] || coded[1]!;
  return message(error);
}

export async function applyPackAction(tenantId: string, releaseId: string, kind: PackReleaseView["kind"]): Promise<HqActionResult> {
  try {
    await applyPackRelease(tenantId, releaseId, kind);
  } catch (error) {
    return { ok: false, message: packMessage(error) };
  }
  revalidatePath(`/hq/clients/${tenantId}/packs`);
  return { ok: true };
}

export async function rollbackPackAction(tenantId: string, instanceId: string): Promise<HqActionResult> {
  try {
    await rollbackPack(tenantId, instanceId);
  } catch (error) {
    return { ok: false, message: packMessage(error) };
  }
  revalidatePath(`/hq/clients/${tenantId}/packs`);
  return { ok: true };
}

export async function removePackAction(tenantId: string, instanceId: string): Promise<HqActionResult> {
  try {
    await removePack(tenantId, instanceId);
  } catch (error) {
    return { ok: false, message: packMessage(error) };
  }
  revalidatePath(`/hq/clients/${tenantId}/packs`);
  return { ok: true };
}

export async function upgradeCapabilityAction(tenantId: string, capabilityId: string): Promise<HqActionResult> {
  try {
    await upgradeCapability(tenantId, capabilityId);
  } catch (error) {
    return { ok: false, message: packMessage(error) };
  }
  revalidatePath(`/hq/clients/${tenantId}/modules`);
  return { ok: true };
}

/**
 * Ends a support session: makes the operator's platform membership the active
 * one again and opens HQ. HQ refuses an operator whose active membership is a
 * client (resolveOperator), so a plain link back would land on a refusal.
 * Only the caller's own memberships are considered (listMemberships).
 */
export async function returnToHqAction(): Promise<void> {
  const memberships = await listMemberships();
  const platform = memberships.find((m) => m.isPlatform);
  if (!platform) redirect("/");
  await setActiveMembership(platform.membershipId);
  redirect("/hq");
}
