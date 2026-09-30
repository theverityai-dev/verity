-- Task 118: dispatch of finished orders (Carxen): transporter, vehicle, tracking,
-- a packaging photograph, and a dispatched -> delivered pipeline.
--
-- An append-only ledger, like the QC findings: each row is one event, the latest
-- being the order's logistics state, and a mistake is a newer row, never an edit.

CREATE TABLE "manufacturing_dispatch" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "transporter" TEXT,
    "vehicle_no" TEXT,
    "tracking_ref" TEXT,
    "packaging_evidence_id" UUID,
    "note" TEXT,
    "recorded_by_id" UUID,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "manufacturing_dispatch_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "manufacturing_dispatch_status" CHECK ("status" IN ('dispatched', 'delivered')),
    -- Leaving the factory needs proof it was packed; arriving does not.
    CONSTRAINT "manufacturing_dispatch_packaged" CHECK ("status" <> 'dispatched' OR "packaging_evidence_id" IS NOT NULL)
);

CREATE INDEX "manufacturing_dispatch_tenant_id_order_id_recorded_at_idx"
  ON "manufacturing_dispatch"("tenant_id", "order_id", "recorded_at");

ALTER TABLE "manufacturing_dispatch" ADD CONSTRAINT "manufacturing_dispatch_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manufacturing_dispatch" ADD CONSTRAINT "manufacturing_dispatch_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "manufacturing_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manufacturing_dispatch" ADD CONSTRAINT "manufacturing_dispatch_packaging_evidence_id_fkey"
  FOREIGN KEY ("packaging_evidence_id") REFERENCES "evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- INV-001, append-only (same shape as manufacturing_checkpoint_result).
ALTER TABLE "manufacturing_dispatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "manufacturing_dispatch" FORCE ROW LEVEL SECURITY;
CREATE POLICY "manufacturing_dispatch_read" ON "manufacturing_dispatch"
  FOR SELECT USING ("tenant_id" = verity.current_tenant_id());
CREATE POLICY "manufacturing_dispatch_append" ON "manufacturing_dispatch"
  FOR INSERT WITH CHECK ("tenant_id" = verity.current_tenant_id());
CREATE TRIGGER "manufacturing_dispatch_append_only"
  BEFORE UPDATE OR DELETE ON "manufacturing_dispatch"
  FOR EACH ROW EXECUTE FUNCTION verity.reject_mutation();

INSERT INTO "entity_definition" (key, capability, class, table_name, tenant_scoped) VALUES
  ('verity.manufacturing.dispatch', 'verity.capability.manufacturing', 'Persistent', 'manufacturing_dispatch', true)
ON CONFLICT (key) DO NOTHING;

UPDATE "capability_definition"
   SET entity_types = array_append(entity_types, 'verity.manufacturing.dispatch'), updated_at = now()
 WHERE id = 'verity.capability.manufacturing'
   AND NOT ('verity.manufacturing.dispatch' = ANY(entity_types));
