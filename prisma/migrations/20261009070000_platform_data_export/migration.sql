-- ---------------------------------------------------------------------------
-- ADR-037: a client exports its own data
-- ---------------------------------------------------------------------------
-- A client administrator holding Export on verity.platform.data_export requests a
-- full export of their own tenant. It runs as that person through the policy
-- gate, reads each exportable dataset through the client's own RLS, and leaves
-- out whatever that person may not read. The ZIP lives in the tenant's own
-- object-storage prefix; this table records the request and where the file is.
-- The operator never exports a client's business rows (ADR-037 clause 3), so
-- this verb is not part of the operator's grants.

ALTER TYPE "PermissionVerb" ADD VALUE IF NOT EXISTS 'Export';

CREATE TABLE "data_export" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "storage_key" TEXT,
    "byte_size" INTEGER,
    "checksum" TEXT,
    "dataset_count" INTEGER NOT NULL DEFAULT 0,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "data_export_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "data_export_status_check" CHECK ("status" IN ('requested', 'completed', 'failed')),
    CONSTRAINT "data_export_completed_has_file" CHECK ("status" <> 'completed' OR ("storage_key" IS NOT NULL AND "byte_size" IS NOT NULL AND "checksum" IS NOT NULL))
);

CREATE INDEX "data_export_tenant_id_requested_at_idx" ON "data_export"("tenant_id", "requested_at");

ALTER TABLE "data_export" ADD CONSTRAINT "data_export_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "data_export" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_export" FORCE ROW LEVEL SECURITY;
CREATE POLICY "data_export_isolation" ON "data_export"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());
