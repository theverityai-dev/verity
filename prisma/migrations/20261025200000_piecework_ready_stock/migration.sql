-- Stylified: ready garment inventory (FR-019). What production makes ready is derived from the bundles and never stored; this APPEND-ONLY
-- ledger holds the rest: stock that existed before Verity (opening, no lot, named by a label), stock taken out (sold, dispatched, sample ...)
-- and count corrections. A mistake is a reversal row, never an edit.

CREATE TABLE "piecework_ready_move" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lot_id" UUID,
    "label" TEXT,
    "kind" TEXT NOT NULL,
    "pieces" INTEGER NOT NULL,
    "reason" TEXT,
    "party" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "moved_on" DATE NOT NULL,
    "reverses_id" UUID,
    "entered_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "piecework_ready_move_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "piecework_ready_move_pieces_positive" CHECK ("pieces" > 0),
    CONSTRAINT "piecework_ready_move_kind_known" CHECK ("kind" IN ('opening', 'out', 'adjust_in', 'adjust_out')),
    -- Stock is either a lot's or an opening line's: never both, never neither.
    CONSTRAINT "piecework_ready_move_lot_xor_label" CHECK (("lot_id" IS NULL) <> ("label" IS NULL)),
    CONSTRAINT "piecework_ready_move_opening_has_label" CHECK ("kind" <> 'opening' OR "lot_id" IS NULL)
);
CREATE INDEX "piecework_ready_move_tenant_id_lot_id_idx" ON "piecework_ready_move"("tenant_id", "lot_id");
CREATE UNIQUE INDEX "piecework_ready_move_reverses_id_key" ON "piecework_ready_move"("reverses_id");
ALTER TABLE "piecework_ready_move" ADD CONSTRAINT "piecework_ready_move_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "piecework_ready_move" ADD CONSTRAINT "piecework_ready_move_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "piecework_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "piecework_ready_move" ADD CONSTRAINT "piecework_ready_move_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "piecework_ready_move"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- INV-001.
ALTER TABLE "piecework_ready_move" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "piecework_ready_move" FORCE ROW LEVEL SECURITY;
CREATE POLICY "piecework_ready_move_isolation" ON "piecework_ready_move"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

CREATE TRIGGER "piecework_ready_move_append_only" BEFORE UPDATE OR DELETE ON "piecework_ready_move"
  FOR EACH ROW EXECUTE FUNCTION verity.reject_mutation();

INSERT INTO "entity_definition" (key, capability, class, table_name, tenant_scoped) VALUES
  ('verity.piecework.ready_move', 'verity.capability.piecework', 'Persistent', 'piecework_ready_move', true)
ON CONFLICT (key) DO NOTHING;

UPDATE "capability_definition"
   SET entity_types = entity_types || ARRAY['verity.piecework.ready_move'], updated_at = now()
 WHERE id = 'verity.capability.piecework'
   AND NOT ('verity.piecework.ready_move' = ANY(entity_types));