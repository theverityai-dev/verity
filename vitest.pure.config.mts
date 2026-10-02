import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  envDir: false,
  test: {
    environment: "node",
    include: [
      "src/test/config.test.ts",
      "src/test/auth-origin.test.ts",
      "src/test/deploy-public-url-preflight.test.ts",
      "src/test/health-readiness.test.ts",
      "src/test/observability.test.ts",
      "src/server/platform/telemetry-scrub.test.ts",
      "src/server/capabilities/trading/import.test.ts",
      "src/server/capabilities/trading/clock.test.ts",
      "src/test/capability-page-guard.test.ts",
      "src/server/platform/capability-ready.test.ts",
      "src/server/platform/oidc-browser.test.ts",
      "src/test/oidc-provider.test.ts",
      "src/test/proxy.test.ts",
      "scripts/scheduler-time.test.mjs",
      "scripts/scale/workload.test.ts",
      "src/test/write-confinement.test.ts",
      "src/test/deploy-env-mode.test.ts",
      "src/test/storage-s3-presign.test.ts",
      "src/test/storage-s3-matrix.test.ts",
      "src/test/storage-s3-ensure-bucket.test.ts",
      "src/test/deploy-image-pins.test.ts",
      "src/test/deploy-bundled-storage.test.ts",
      "src/server/platform/pack-manifest.test.ts",
      "src/test/agent-chat-route.test.ts",
      "src/test/decision-node.test.ts",
      "src/test/external-tools.test.ts",
    ],
    setupFiles: ["./src/test/setup-pure-env.ts"],
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "src/test/server-only-stub.ts"),
    },
  },
});
