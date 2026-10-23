-- Stylified, second part (clients/stylified/flow.md): what a lot cost beyond fabric and wages.
--   * cost categories are data, kept with the floor's reasons (kind 'cost'), so each factory names its own in English and Hindi
--   * an APPEND-ONLY ledger of other costs per lot (thread, buttons, packing, washing ...). A cost shared by several lots is split
--     across them by the pieces each lot cut; the rows of one split share a batch id. A mistake is a reversal row, never an edit.

ALTER TABLE "piecework_reason" DROP CONSTRAINT "piecework_reason_kind_known";
ALTER TABLE "piecework_reason" ADD CONSTRAINT "piecework_reason_kind_known" CHECK ("kind" IN ('defect', 'short', 'cost'));

CREATE TABLE "piecework_lot_cost" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "note" TEXT,
    "incurred_on" DATE NOT NULL,
    "batch_id" UUID,
    "reverses_id" UUID,
    "entered_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "piecework_lot_cost_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "piecework_lot_cost_amount_positive" CHECK ("amount_minor" > 0),
    CONSTRAINT "piecework_lot_cost_category_named" CHECK (length("category") >= 1)
);
CREATE INDEX "piecework_lot_cost_tenant_id_lot_id_idx" ON "piecework_lot_cost"("tenant_id", "lot_id");
CREATE UNIQUE INDEX "piecework_lot_cost_reverses_id_key" ON "piecework_lot_cost"("reverses_id");
ALTER TABLE "piecework_lot_cost" ADD CONSTRAINT "piecework_lot_cost_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "piecework_lot_cost" ADD CONSTRAINT "piecework_lot_cost_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "piecework_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "piecework_lot_cost" ADD CONSTRAINT "piecework_lot_cost_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "piecework_lot_cost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- INV-001.
ALTER TABLE "piecework_lot_cost" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "piecework_lot_cost" FORCE ROW LEVEL SECURITY;
CREATE POLICY "piecework_lot_cost_isolation" ON "piecework_lot_cost"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

CREATE TRIGGER "piecework_lot_cost_append_only" BEFORE UPDATE OR DELETE ON "piecework_lot_cost"
  FOR EACH ROW EXECUTE FUNCTION verity.reject_mutation();

INSERT INTO "entity_definition" (key, capability, class, table_name, tenant_scoped) VALUES
  ('verity.piecework.lot_cost', 'verity.capability.piecework', 'Persistent', 'piecework_lot_cost', true)
ON CONFLICT (key) DO NOTHING;

UPDATE "capability_definition"
   SET entity_types = entity_types || ARRAY['verity.piecework.lot_cost'], updated_at = now()
 WHERE id = 'verity.capability.piecework'
   AND NOT ('verity.piecework.lot_cost' = ANY(entity_types));
