-- Piece-rate capability, fourth step (Stylified flow, clients/stylified/flow.md and the client's requirements v2): everything the
-- owner sets, the fabric the work starts from, and a receipt confirmation when work is handed over. Additive; no row changes.
--   * a default rate on each stage; a rate card per lot and stage (also says which stages a lot skips)
--   * the charge for a lost piece (tenant default, lot and stage override) and the challan heading
--   * reasons for rejected, rework and short pieces, in English and Hindi, as data
--   * fabric rolls (number, QR label, invoice, supplier) and an append-only ledger of fabric issued, returned and adjusted
--   * on each issue: the quantity the sender handed over, how the receiver acknowledged, and the printed challan number

ALTER TABLE "piecework_stage"
  ADD COLUMN "default_rate_minor" INTEGER,
  ADD CONSTRAINT "piecework_stage_default_rate_not_negative" CHECK ("default_rate_minor" IS NULL OR "default_rate_minor" >= 0);

ALTER TABLE "piecework_setting"
  ADD COLUMN "default_lost_piece_charge_minor" INTEGER,
  ADD COLUMN "challan_title" TEXT,
  ADD COLUMN "challan_address" TEXT,
  ADD CONSTRAINT "piecework_setting_charge_not_negative" CHECK ("default_lost_piece_charge_minor" IS NULL OR "default_lost_piece_charge_minor" >= 0);

-- Handover: "pieces" on an issue stays what the RECEIVER counted (the receiver's count is the truth); "sent_pieces" is what the sender
-- handed over. A difference is a handover difference, visible until resolved; the remainder stays with the sender (still available).
ALTER TABLE "piecework_entry"
  ADD COLUMN "challan_number" TEXT,
  ADD COLUMN "sent_pieces" INTEGER,
  ADD COLUMN "ack_method" TEXT,
  ADD CONSTRAINT "piecework_entry_sent_not_below_counted" CHECK ("sent_pieces" IS NULL OR "sent_pieces" >= "pieces"),
  ADD CONSTRAINT "piecework_entry_ack_known" CHECK ("ack_method" IS NULL OR "ack_method" IN ('signature', 'pin', 'attested', 'app'));
-- One challan covers a stack of bundles, so the number is looked up, not unique per entry.
CREATE INDEX "piecework_entry_tenant_id_challan_number_idx" ON "piecework_entry"("tenant_id", "challan_number") WHERE "challan_number" IS NOT NULL;

-- The rate card of one lot: what a stage pays per piece on this lot (it wins over a worker's own rate and the stage default), what a
-- lost piece costs the worker there, and whether the lot skips the stage altogether (the route is configurable per lot).
CREATE TABLE "piecework_lot_rate" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "rate_minor" INTEGER,
    "lost_piece_charge_minor" INTEGER,
    "wage_basis" TEXT,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "piecework_lot_rate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "piecework_lot_rate_not_negative" CHECK (("rate_minor" IS NULL OR "rate_minor" >= 0) AND ("lost_piece_charge_minor" IS NULL OR "lost_piece_charge_minor" >= 0)),
    CONSTRAINT "piecework_lot_rate_basis_known" CHECK ("wage_basis" IS NULL OR "wage_basis" IN ('issued', 'good', 'returned'))
);
CREATE UNIQUE INDEX "piecework_lot_rate_lot_id_stage_id_key" ON "piecework_lot_rate"("lot_id", "stage_id");
CREATE INDEX "piecework_lot_rate_tenant_id_lot_id_idx" ON "piecework_lot_rate"("tenant_id", "lot_id");
ALTER TABLE "piecework_lot_rate" ADD CONSTRAINT "piecework_lot_rate_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "piecework_lot_rate" ADD CONSTRAINT "piecework_lot_rate_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "piecework_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "piecework_lot_rate" ADD CONSTRAINT "piecework_lot_rate_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "piecework_stage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reasons a person picks when pieces are rejected, sent for rework or short. Data, so each factory words its own.
CREATE TABLE "piecework_reason" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "reason_key" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "label_hi" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "piecework_reason_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "piecework_reason_kind_known" CHECK ("kind" IN ('defect', 'short'))
);
CREATE UNIQUE INDEX "piecework_reason_tenant_id_kind_reason_key_key" ON "piecework_reason"("tenant_id", "kind", "reason_key");
ALTER TABLE "piecework_reason" ADD CONSTRAINT "piecework_reason_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Fabric rolls. Quantity is kept in hundredths of the roll's unit (metres or kilograms) so it stays an integer; the balance is derived.
CREATE TABLE "piecework_roll" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "fabric_type" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'm',
    "quantity_centi" INTEGER NOT NULL,
    "supplier" TEXT,
    "invoice_number" TEXT,
    "rate_minor" INTEGER,
    "received_on" DATE NOT NULL,
    "note" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "piecework_roll_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "piecework_roll_quantity_positive" CHECK ("quantity_centi" > 0),
    CONSTRAINT "piecework_roll_rate_not_negative" CHECK ("rate_minor" IS NULL OR "rate_minor" >= 0),
    CONSTRAINT "piecework_roll_unit_known" CHECK ("unit" IN ('m', 'kg'))
);
CREATE UNIQUE INDEX "piecework_roll_tenant_id_number_key" ON "piecework_roll"("tenant_id", "number");
CREATE UNIQUE INDEX "piecework_roll_tenant_id_sequence_no_key" ON "piecework_roll"("tenant_id", "sequence_no");
CREATE INDEX "piecework_roll_tenant_id_invoice_number_idx" ON "piecework_roll"("tenant_id", "invoice_number");
ALTER TABLE "piecework_roll" ADD CONSTRAINT "piecework_roll_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- APPEND-ONLY fabric ledger of one roll: issued to a lot (negative), returned from a lot (positive), or adjusted with a reason (either
-- way). Every movement names a lot or a reason. A mistake is corrected by an adjustment, never by editing a row.
CREATE TABLE "piecework_roll_move" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "roll_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "delta_centi" INTEGER NOT NULL,
    "lot_id" UUID,
    "reason" TEXT,
    "moved_on" DATE NOT NULL,
    "entered_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "piecework_roll_move_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "piecework_roll_move_kind_known" CHECK ("kind" IN ('issue', 'return', 'adjust')),
    CONSTRAINT "piecework_roll_move_delta_direction" CHECK (
      ("kind" = 'issue' AND "delta_centi" < 0 AND "lot_id" IS NOT NULL)
      OR ("kind" = 'return' AND "delta_centi" > 0 AND "lot_id" IS NOT NULL)
      OR ("kind" = 'adjust' AND "delta_centi" <> 0 AND length(coalesce("reason", '')) >= 3)
    )
);
CREATE INDEX "piecework_roll_move_tenant_id_roll_id_idx" ON "piecework_roll_move"("tenant_id", "roll_id");
CREATE INDEX "piecework_roll_move_tenant_id_lot_id_idx" ON "piecework_roll_move"("tenant_id", "lot_id");
ALTER TABLE "piecework_roll_move" ADD CONSTRAINT "piecework_roll_move_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "piecework_roll_move" ADD CONSTRAINT "piecework_roll_move_roll_id_fkey" FOREIGN KEY ("roll_id") REFERENCES "piecework_roll"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "piecework_roll_move" ADD CONSTRAINT "piecework_roll_move_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "piecework_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- INV-001 for every new table.
ALTER TABLE "piecework_lot_rate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "piecework_lot_rate" FORCE ROW LEVEL SECURITY;
CREATE POLICY "piecework_lot_rate_isolation" ON "piecework_lot_rate"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());
ALTER TABLE "piecework_reason" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "piecework_reason" FORCE ROW LEVEL SECURITY;
CREATE POLICY "piecework_reason_isolation" ON "piecework_reason"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());
ALTER TABLE "piecework_roll" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "piecework_roll" FORCE ROW LEVEL SECURITY;
CREATE POLICY "piecework_roll_isolation" ON "piecework_roll"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());
ALTER TABLE "piecework_roll_move" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "piecework_roll_move" FORCE ROW LEVEL SECURITY;
CREATE POLICY "piecework_roll_move_isolation" ON "piecework_roll_move"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

CREATE TRIGGER "piecework_roll_move_append_only" BEFORE UPDATE OR DELETE ON "piecework_roll_move"
  FOR EACH ROW EXECUTE FUNCTION verity.reject_mutation();

INSERT INTO "entity_definition" (key, capability, class, table_name, tenant_scoped) VALUES
  ('verity.piecework.lot_rate', 'verity.capability.piecework', 'Persistent', 'piecework_lot_rate', true),
  ('verity.piecework.reason', 'verity.capability.piecework', 'Persistent', 'piecework_reason', true),
  ('verity.piecework.roll', 'verity.capability.piecework', 'Persistent', 'piecework_roll', true),
  ('verity.piecework.roll_move', 'verity.capability.piecework', 'Persistent', 'piecework_roll_move', true)
ON CONFLICT (key) DO NOTHING;

UPDATE "capability_definition"
   SET entity_types = entity_types || ARRAY['verity.piecework.lot_rate', 'verity.piecework.reason', 'verity.piecework.roll', 'verity.piecework.roll_move'], updated_at = now()
 WHERE id = 'verity.capability.piecework'
   AND NOT ('verity.piecework.roll' = ANY(entity_types));
