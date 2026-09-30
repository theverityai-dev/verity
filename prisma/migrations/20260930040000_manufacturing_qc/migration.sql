-- Task 118: QC checklists and findings for the production floor (Carxen).
--
-- A stage carries a checklist template; each operation carries a SNAPSHOT of it
-- (so editing a route never changes what an order already has); findings are an
-- append-only ledger, the latest per checkpoint being the current verdict.

ALTER TABLE "manufacturing_route_stage" ADD COLUMN "checkpoints" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "manufacturing_operation"   ADD COLUMN "checkpoints" JSONB NOT NULL DEFAULT '[]';

CREATE TABLE "manufacturing_checkpoint_result" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "checkpoint_key" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "remarks" TEXT,
    "evidence_id" UUID,
    "recorded_by_id" UUID,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "manufacturing_checkpoint_result_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "manufacturing_checkpoint_result_verdict" CHECK ("result" IN ('pass', 'fail'))
);

CREATE INDEX "manufacturing_checkpoint_result_operation_id_checkpoint_key_recorded_at_idx"
  ON "manufacturing_checkpoint_result"("operation_id", "checkpoint_key", "recorded_at");

ALTER TABLE "manufacturing_checkpoint_result" ADD CONSTRAINT "manufacturing_checkpoint_result_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manufacturing_checkpoint_result" ADD CONSTRAINT "manufacturing_checkpoint_result_operation_id_fkey"
  FOREIGN KEY ("operation_id") REFERENCES "manufacturing_operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manufacturing_checkpoint_result" ADD CONSTRAINT "manufacturing_checkpoint_result_evidence_id_fkey"
  FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- INV-001, and append-only like `evidence`: the application can read and insert,
-- never rewrite a finding. (Retention/teardown by a privileged role is the same
-- deliberate path every other append-only table has; see verity.reject_mutation.)
ALTER TABLE "manufacturing_checkpoint_result" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "manufacturing_checkpoint_result" FORCE ROW LEVEL SECURITY;
CREATE POLICY "manufacturing_checkpoint_result_read" ON "manufacturing_checkpoint_result"
  FOR SELECT USING ("tenant_id" = verity.current_tenant_id());
CREATE POLICY "manufacturing_checkpoint_result_append" ON "manufacturing_checkpoint_result"
  FOR INSERT WITH CHECK ("tenant_id" = verity.current_tenant_id());

CREATE TRIGGER "manufacturing_checkpoint_result_append_only"
  BEFORE UPDATE OR DELETE ON "manufacturing_checkpoint_result"
  FOR EACH ROW EXECUTE FUNCTION verity.reject_mutation();
