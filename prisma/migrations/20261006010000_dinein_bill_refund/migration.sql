-- ---------------------------------------------------------------------------
-- Refunds after settlement (Colonel Kebabz parity, pos-restaurant.md §6).
-- ---------------------------------------------------------------------------
-- A settled bill is closed and its payments are facts. A refund is a new
-- append-only row beside them, never an edit to either.

CREATE TABLE "bill_refund" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "refunded_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bill_refund_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bill_refund_amount_positive" CHECK ("amount_minor" > 0),
    CONSTRAINT "bill_refund_method_check"
      CHECK ("method" IN ('cash', 'card', 'upi', 'wallet', 'bank_transfer', 'other')),
    CONSTRAINT "bill_refund_reason_present" CHECK (length(btrim("reason")) > 0)
);

CREATE INDEX "bill_refund_tenant_id_bill_id_idx" ON "bill_refund"("tenant_id", "bill_id");
CREATE INDEX "bill_refund_tenant_id_created_at_idx" ON "bill_refund"("tenant_id", "created_at");

ALTER TABLE "bill_refund" ADD CONSTRAINT "bill_refund_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bill_refund" ADD CONSTRAINT "bill_refund_tenant_id_bill_id_fkey" FOREIGN KEY ("tenant_id", "bill_id") REFERENCES "bill"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "bill_refund" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bill_refund" FORCE ROW LEVEL SECURITY;
CREATE POLICY "bill_refund_read" ON "bill_refund"
  FOR SELECT USING ("tenant_id" = verity.current_tenant_id());
CREATE POLICY "bill_refund_append" ON "bill_refund"
  FOR INSERT WITH CHECK ("tenant_id" = verity.current_tenant_id());
CREATE TRIGGER "bill_refund_append_only"
  BEFORE UPDATE OR DELETE ON "bill_refund"
  FOR EACH ROW EXECUTE FUNCTION verity.reject_mutation();
