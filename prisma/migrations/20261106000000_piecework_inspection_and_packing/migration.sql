-- Garment export house (Akhand Export demo, 2026-11-06): a lot's quality inspections against the AQL table and its packing lists.
-- Both are generic to any garment maker that ships to a buyer; neither needs a client's own rule. Inspections are APPEND-ONLY
-- (a mistake is a reversal row). A packing list is a document whose cartons are never edited; it can only be cancelled with a reason.

CREATE TABLE "piecework_inspection" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "inspected_on" DATE NOT NULL,
    "inspector" TEXT NOT NULL,
    "offered_pieces" INTEGER NOT NULL,
    "level" TEXT NOT NULL,
    "aql_major" TEXT NOT NULL,
    "aql_minor" TEXT NOT NULL,
    "code_letter" TEXT NOT NULL,
    "sample_size" INTEGER NOT NULL,
    "accept_major" INTEGER NOT NULL,
    "accept_minor" INTEGER NOT NULL,
    "critical_found" INTEGER NOT NULL,
    "major_found" INTEGER NOT NULL,
    "minor_found" INTEGER NOT NULL,
    "result" TEXT NOT NULL,
    "note" TEXT,
    "reverses_id" UUID,
    "entered_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "piecework_inspection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "piecework_inspection_kind" CHECK ("kind" IN ('inline', 'final')),
    CONSTRAINT "piecework_inspection_level" CHECK ("level" IN ('I', 'II', 'III')),
    CONSTRAINT "piecework_inspection_result" CHECK ("result" IN ('pass', 'fail')),
    CONSTRAINT "piecework_inspection_counts" CHECK ("offered_pieces" >= 2 AND "sample_size" >= 1 AND "sample_size" <= "offered_pieces"
      AND "critical_found" >= 0 AND "major_found" >= 0 AND "minor_found" >= 0)
);
CREATE INDEX "piecework_inspection_tenant_id_lot_id_idx" ON "piecework_inspection"("tenant_id", "lot_id");
CREATE UNIQUE INDEX "piecework_inspection_reverses_id_key" ON "piecework_inspection"("reverses_id");
ALTER TABLE "piecework_inspection" ADD CONSTRAINT "piecework_inspection_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "piecework_inspection" ADD CONSTRAINT "piecework_inspection_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "piecework_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "piecework_inspection" ADD CONSTRAINT "piecework_inspection_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "piecework_inspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "piecework_packing_list" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "lot_id" UUID NOT NULL,
    "buyer" TEXT NOT NULL,
    "reference" TEXT,
    "destination" TEXT,
    "packed_on" DATE NOT NULL,
    "cartons" JSONB NOT NULL,
    "note" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "piecework_packing_list_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "piecework_packing_list_cartons_array" CHECK (jsonb_typeof("cartons") = 'array' AND jsonb_array_length("cartons") >= 1)
);
CREATE UNIQUE INDEX "piecework_packing_list_tenant_id_number_key" ON "piecework_packing_list"("tenant_id", "number");
CREATE UNIQUE INDEX "piecework_packing_list_tenant_id_sequence_no_key" ON "piecework_packing_list"("tenant_id", "sequence_no");
CREATE INDEX "piecework_packing_list_tenant_id_lot_id_idx" ON "piecework_packing_list"("tenant_id", "lot_id");
ALTER TABLE "piecework_packing_list" ADD CONSTRAINT "piecework_packing_list_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "piecework_packing_list" ADD CONSTRAINT "piecework_packing_list_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "piecework_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- INV-001.
ALTER TABLE "piecework_inspection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "piecework_inspection" FORCE ROW LEVEL SECURITY;
CREATE POLICY "piecework_inspection_isolation" ON "piecework_inspection"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());
ALTER TABLE "piecework_packing_list" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "piecework_packing_list" FORCE ROW LEVEL SECURITY;
CREATE POLICY "piecework_packing_list_isolation" ON "piecework_packing_list"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

CREATE TRIGGER "piecework_inspection_append_only" BEFORE UPDATE OR DELETE ON "piecework_inspection"
  FOR EACH ROW EXECUTE FUNCTION verity.reject_mutation();

INSERT INTO "entity_definition" (key, capability, class, table_name, tenant_scoped) VALUES
  ('verity.piecework.inspection', 'verity.capability.piecework', 'Persistent', 'piecework_inspection', true),
  ('verity.piecework.packing_list', 'verity.capability.piecework', 'Persistent', 'piecework_packing_list', true)
ON CONFLICT (key) DO NOTHING;

UPDATE "capability_definition"
   SET entity_types = entity_types || ARRAY['verity.piecework.inspection'], updated_at = now()
 WHERE id = 'verity.capability.piecework' AND NOT ('verity.piecework.inspection' = ANY(entity_types));
UPDATE "capability_definition"
   SET entity_types = entity_types || ARRAY['verity.piecework.packing_list'], updated_at = now()
 WHERE id = 'verity.capability.piecework' AND NOT ('verity.piecework.packing_list' = ANY(entity_types));
