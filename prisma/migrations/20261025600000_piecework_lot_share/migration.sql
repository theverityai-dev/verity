-- Stylified: join or link lots with cost re-allocation (FR-009, FR-018). A lot can carry a part of another lot's cost. This APPEND-ONLY
-- ledger holds each share (a part of the source lot's own cost, in basis points); the source's own records are never edited and a
-- mistake is a reversal row. Costs are read with the shares applied; nothing is copied or stored twice.

CREATE TABLE "piecework_lot_share" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "source_lot_id" UUID NOT NULL,
    "target_lot_id" UUID NOT NULL,
    "basis_points" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "reverses_id" UUID,
    "entered_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "piecework_lot_share_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "piecework_lot_share_basis_points_range" CHECK ("basis_points" BETWEEN 1 AND 10000),
    CONSTRAINT "piecework_lot_share_two_lots" CHECK ("source_lot_id" <> "target_lot_id")
);
CREATE INDEX "piecework_lot_share_tenant_id_source_lot_id_idx" ON "piecework_lot_share"("tenant_id", "source_lot_id");
CREATE INDEX "piecework_lot_share_tenant_id_target_lot_id_idx" ON "piecework_lot_share"("tenant_id", "target_lot_id");
CREATE UNIQUE INDEX "piecework_lot_share_reverses_id_key" ON "piecework_lot_share"("reverses_id");
ALTER TABLE "piecework_lot_share" ADD CONSTRAINT "piecework_lot_share_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "piecework_lot_share" ADD CONSTRAINT "piecework_lot_share_source_lot_id_fkey" FOREIGN KEY ("source_lot_id") REFERENCES "piecework_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "piecework_lot_share" ADD CONSTRAINT "piecework_lot_share_target_lot_id_fkey" FOREIGN KEY ("target_lot_id") REFERENCES "piecework_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "piecework_lot_share" ADD CONSTRAINT "piecework_lot_share_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "piecework_lot_share"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- INV-001.
ALTER TABLE "piecework_lot_share" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "piecework_lot_share" FORCE ROW LEVEL SECURITY;
CREATE POLICY "piecework_lot_share_isolation" ON "piecework_lot_share"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

CREATE TRIGGER "piecework_lot_share_append_only" BEFORE UPDATE OR DELETE ON "piecework_lot_share"
  FOR EACH ROW EXECUTE FUNCTION verity.reject_mutation();

INSERT INTO "entity_definition" (key, capability, class, table_name, tenant_scoped) VALUES
  ('verity.piecework.lot_share', 'verity.capability.piecework', 'Persistent', 'piecework_lot_share', true)
ON CONFLICT (key) DO NOTHING;

UPDATE "capability_definition"
   SET entity_types = entity_types || ARRAY['verity.piecework.lot_share'], updated_at = now()
 WHERE id = 'verity.capability.piecework'
   AND NOT ('verity.piecework.lot_share' = ANY(entity_types));
