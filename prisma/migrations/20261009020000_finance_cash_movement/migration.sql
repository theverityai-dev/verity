-- ---------------------------------------------------------------------------
-- Cash in and cash out (Colonel Kebabz parity, finance.md; Task 125 item 4.1)
-- ---------------------------------------------------------------------------
-- Money that enters or leaves the till without being a sale, a refund or an
-- approved expense: a float top-up, petty cash, an owner's drawing, a bank
-- deposit. Each is a fact about the drawer, so it is append-only and needs a
-- reason; a mistake is corrected by a new opposite entry, never an edit.
-- The daily reconciliation reads these as expected cash = ... + in - out.

CREATE TABLE "cash_movement" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "movement_date" DATE NOT NULL,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "recorded_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cash_movement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cash_movement_amount_positive" CHECK ("amount_minor" > 0),
    CONSTRAINT "cash_movement_reason_present" CHECK (length(btrim("reason")) > 0),
    CONSTRAINT "cash_movement_direction_check" CHECK ("direction" IN ('in', 'out')),
    CONSTRAINT "cash_movement_kind_matches_direction" CHECK (
      ("direction" = 'in'  AND "kind" IN ('float', 'owner_injection', 'other')) OR
      ("direction" = 'out' AND "kind" IN ('petty_cash', 'owner_drawing', 'bank_deposit', 'other'))
    )
);

CREATE INDEX "cash_movement_tenant_id_location_id_movement_date_idx"
  ON "cash_movement"("tenant_id", "location_id", "movement_date");

ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_tenant_id_location_id_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "location"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "cash_movement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cash_movement" FORCE ROW LEVEL SECURITY;
CREATE POLICY "cash_movement_read" ON "cash_movement"
  FOR SELECT USING ("tenant_id" = verity.current_tenant_id());
CREATE POLICY "cash_movement_append" ON "cash_movement"
  FOR INSERT WITH CHECK ("tenant_id" = verity.current_tenant_id());
CREATE TRIGGER "cash_movement_append_only"
  BEFORE UPDATE OR DELETE ON "cash_movement"
  FOR EACH ROW EXECUTE FUNCTION verity.reject_mutation();
