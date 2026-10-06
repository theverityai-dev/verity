-- ---------------------------------------------------------------------------
-- Outlet stock requests and vendor payments (Colonel Kebabz parity,
-- inventory.md transfers workflow and procurement.md bill and payment;
-- decisions 2026-10-06).
-- ---------------------------------------------------------------------------
-- A stock request is an outlet asking for an item: Requested, then Approved
-- (which sends the stock from a chosen outlet through the transfer path) or
-- Rejected with a reason. A vendor payment is money paid to a vendor; what is
-- owed is the value of accepted goods received less payments, so payments are
-- append-only facts.

CREATE TABLE "inventory_stock_request" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "to_location_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Requested',
    "requested_by_id" UUID NOT NULL,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "from_location_id" UUID,
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "inventory_stock_request_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_stock_request_qty_positive" CHECK ("qty" > 0),
    CONSTRAINT "inventory_stock_request_status_check" CHECK ("status" IN ('Requested', 'Approved', 'Rejected'))
);
CREATE INDEX "inventory_stock_request_tenant_id_status_idx" ON "inventory_stock_request"("tenant_id", "status");
ALTER TABLE "inventory_stock_request" ADD CONSTRAINT "inventory_stock_request_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_stock_request" ADD CONSTRAINT "inventory_stock_request_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_stock_request" ADD CONSTRAINT "inventory_stock_request_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "inventory_vendor_payment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "paid_by_id" UUID NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_vendor_payment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_vendor_payment_amount_positive" CHECK ("amount_paise" > 0),
    CONSTRAINT "inventory_vendor_payment_method_check" CHECK ("method" IN ('cash', 'bank_transfer', 'upi', 'cheque', 'card', 'other'))
);
CREATE INDEX "inventory_vendor_payment_vendor_id_idx" ON "inventory_vendor_payment"("vendor_id");
ALTER TABLE "inventory_vendor_payment" ADD CONSTRAINT "inventory_vendor_payment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_vendor_payment" ADD CONSTRAINT "inventory_vendor_payment_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "inventory_vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_stock_request" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_stock_request" FORCE ROW LEVEL SECURITY;
CREATE POLICY "inventory_stock_request_isolation" ON "inventory_stock_request"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

ALTER TABLE "inventory_vendor_payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_vendor_payment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "inventory_vendor_payment_read" ON "inventory_vendor_payment"
  FOR SELECT USING ("tenant_id" = verity.current_tenant_id());
CREATE POLICY "inventory_vendor_payment_append" ON "inventory_vendor_payment"
  FOR INSERT WITH CHECK ("tenant_id" = verity.current_tenant_id());
CREATE TRIGGER "inventory_vendor_payment_append_only"
  BEFORE UPDATE OR DELETE ON "inventory_vendor_payment"
  FOR EACH ROW EXECUTE FUNCTION verity.reject_mutation();
