-- Jobs belong to a customer record, not a typed name (INV-003 spirit; trading owns the customer).
-- The name and contact stay on the job as a snapshot of what was agreed at the time.
-- Nullable only so rows written before this migration stay valid; the create command requires it.

ALTER TABLE "project_job" ADD COLUMN "customer_id" UUID;

ALTER TABLE "project_job" ADD CONSTRAINT "project_job_customer_fkey"
  FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "trading_customer"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE INDEX "project_job_tenant_id_customer_id_idx" ON "project_job"("tenant_id", "customer_id");

-- Jobs now need the trading capability (the customer master) to be active first.
UPDATE "capability_definition"
   SET dependencies = ARRAY(SELECT DISTINCT unnest(dependencies || ARRAY['verity.capability.trading']::text[])),
       updated_at = now()
 WHERE id = 'verity.capability.project'
   AND NOT ('verity.capability.trading' = ANY(dependencies));
