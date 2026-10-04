import "server-only";
import { registerStorageDriver } from "@/server/platform/files";
import { runtimeConfig } from "@/server/platform/config";
import { supabaseStorageDriver } from "./supabase";
import { s3StorageDriver } from "./s3";

/**
 * Storage provider selection.
 *
 * Authority: taskplans/archive/41_s3_storage_implementation.md.
 *
 * The one place that decides which object store this deployment uses. Every
 * `if` about a provider lives here and nowhere else — a capability, a command
 * or `files.ts` asking "is this S3?" would be the coupling the seam exists to
 * prevent, and there is a test that walks the tree to confirm none does.
 *
 * SILENT WHEN NOTHING IS CONFIGURED, DELIBERATELY
 * A deployment without storage is a valid deployment. `files.ts` refuses with
 * `E_STORAGE_UNAVAILABLE` at the point of use, which names the actual problem;
 * failing at boot instead would take down sign-in over a feature nobody on that
 * deployment had reached for yet. This is the decision Task 27 made and Task 41
 * keeps.
 */

let installed = false;

export function installStorage(): void {
  if (installed) return;

  const config = runtimeConfig.storage;

  if (config.driver === "s3") {
    const s3 = config.s3;
    if (!s3) return; // Incomplete configuration binds nothing. See above.
    installed = true;
    registerStorageDriver(s3StorageDriver(s3));
    return;
  }

  const { supabaseUrl: url, serviceRoleKey, bucket } = config;
  if (!url || !serviceRoleKey || !bucket) return;
  installed = true;
  registerStorageDriver(supabaseStorageDriver({ url, serviceRoleKey, bucket }));
}

/** Test seam: allows a fresh selection after the environment changes. */
export function resetStorageInstallation(): void {
  installed = false;
}
