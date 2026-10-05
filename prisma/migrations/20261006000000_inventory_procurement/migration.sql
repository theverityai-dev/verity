-- ---------------------------------------------------------------------------
-- Inventory procurement: vendors, purchase orders, goods receipts
-- (Colonel Kebabz parity, procurement.md §7; decision 2026-10-06).
-- ---------------------------------------------------------------------------
-- Goods receipts are historical facts and append-only, like the stock ledger
-- they feed. Orders and vendors are ordinary mutable rows under tenant RLS.

CREATE TABLE "inventory_vendor" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "gstin" TEXT,
    "phone" TEXT,
    "payment_terms_days" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "inventory_vendor_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_vendor_terms_nonneg" CHECK ("payment_terms_days" >= 0)
);

CREATE TABLE "inventory_purchase_order" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "vendor_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "expected_date" DATE,
    "notes" TEXT,
    "total_paise" INTEGER NOT NULL,
    "created_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "inventory_purchase_order_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_purchase_order_status_check"
      CHECK ("status" IN ('Draft', 'PendingApproval', 'Approved', 'PartiallyReceived', 'Received', 'Cancelled')),
    CONSTRAINT "inventory_purchase_order_total_nonneg" CHECK ("total_paise" >= 0)
);

CREATE TABLE "inventory_purchase_order_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_price_paise" INTEGER NOT NULL,
    "received_qty" INTEGER NOT NULL DEFAULT 0,
    "rejected_qty" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "inventory_purchase_order_line_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_purchase_order_line_qty_positive" CHECK ("qty" > 0),
    CONSTRAINT "inventory_purchase_order_line_price_nonneg" CHECK ("unit_price_paise" >= 0),
    CONSTRAINT "inventory_purchase_order_line_received_range" CHECK ("received_qty" >= 0 AND "received_qty" <= "qty"),
    CONSTRAINT "inventory_purchase_order_line_rejected_nonneg" CHECK ("rejected_qty" >= 0)
);

CREATE TABLE "inventory_goods_receipt" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "received_by_id" UUID NOT NULL,
    "invoice_ref" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_goods_receipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_goods_receipt_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "order_line_id" UUID NOT NULL,
    "accepted_qty" INTEGER NOT NULL,
    "rejected_qty" INTEGER NOT NULL DEFAULT 0,
    "reject_reason" TEXT,
    "unit_price_paise" INTEGER NOT NULL,
    CONSTRAINT "inventory_goods_receipt_line_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_goods_receipt_line_qty_nonneg" CHECK ("accepted_qty" >= 0 AND "rejected_qty" >= 0),
    CONSTRAINT "inventory_goods_receipt_line_reject_reason"
      CHECK ("rejected_qty" = 0 OR "reject_reason" IS NOT NULL)
);

CREATE UNIQUE INDEX "inventory_vendor_tenant_id_name_key" ON "inventory_vendor"("tenant_id", "name");
CREATE UNIQUE INDEX "inventory_purchase_order_tenant_id_seq_key" ON "inventory_purchase_order"("tenant_id", "seq");
CREATE INDEX "inventory_purchase_order_tenant_id_status_idx" ON "inventory_purchase_order"("tenant_id", "status");
CREATE INDEX "inventory_purchase_order_line_order_id_idx" ON "inventory_purchase_order_line"("order_id");
CREATE INDEX "inventory_goods_receipt_order_id_idx" ON "inventory_goods_receipt"("order_id");
CREATE INDEX "inventory_goods_receipt_line_receipt_id_idx" ON "inventory_goods_receipt_line"("receipt_id");

ALTER TABLE "inventory_vendor" ADD CONSTRAINT "inventory_vendor_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_purchase_order" ADD CONSTRAINT "inventory_purchase_order_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_purchase_order" ADD CONSTRAINT "inventory_purchase_order_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "inventory_vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_purchase_order" ADD CONSTRAINT "inventory_purchase_order_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_purchase_order_line" ADD CONSTRAINT "inventory_purchase_order_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_purchase_order_line" ADD CONSTRAINT "inventory_purchase_order_line_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "inventory_purchase_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_purchase_order_line" ADD CONSTRAINT "inventory_purchase_order_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_goods_receipt" ADD CONSTRAINT "inventory_goods_receipt_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_goods_receipt" ADD CONSTRAINT "inventory_goods_receipt_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "inventory_purchase_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_goods_receipt_line" ADD CONSTRAINT "inventory_goods_receipt_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_goods_receipt_line" ADD CONSTRAINT "inventory_goods_receipt_line_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "inventory_goods_receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_goods_receipt_line" ADD CONSTRAINT "inventory_goods_receipt_line_order_line_id_fkey" FOREIGN KEY ("order_line_id") REFERENCES "inventory_purchase_order_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_vendor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_vendor" FORCE ROW LEVEL SECURITY;
CREATE POLICY "inventory_vendor_isolation" ON "inventory_vendor"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

ALTER TABLE "inventory_purchase_order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_purchase_order" FORCE ROW LEVEL SECURITY;
CREATE POLICY "inventory_purchase_order_isolation" ON "inventory_purchase_order"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

ALTER TABLE "inventory_purchase_order_line" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_purchase_order_line" FORCE ROW LEVEL SECURITY;
CREATE POLICY "inventory_purchase_order_line_isolation" ON "inventory_purchase_order_line"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

ALTER TABLE "inventory_goods_receipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_goods_receipt" FORCE ROW LEVEL SECURITY;
CREATE POLICY "inventory_goods_receipt_read" ON "inventory_goods_receipt"
  FOR SELECT USING ("tenant_id" = verity.current_tenant_id());
CREATE POLICY "inventory_goods_receipt_append" ON "inventory_goods_receipt"
  FOR INSERT WITH CHECK ("tenant_id" = verity.current_tenant_id());
CREATE TRIGGER "inventory_goods_receipt_append_only"
  BEFORE UPDATE OR DELETE ON "inventory_goods_receipt"
  FOR EACH ROW EXECUTE FUNCTION verity.reject_mutation();

ALTER TABLE "inventory_goods_receipt_line" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_goods_receipt_line" FORCE ROW LEVEL SECURITY;
CREATE POLICY "inventory_goods_receipt_line_read" ON "inventory_goods_receipt_line"
  FOR SELECT USING ("tenant_id" = verity.current_tenant_id());
CREATE POLICY "inventory_goods_receipt_line_append" ON "inventory_goods_receipt_line"
  FOR INSERT WITH CHECK ("tenant_id" = verity.current_tenant_id());
CREATE TRIGGER "inventory_goods_receipt_line_append_only"
  BEFORE UPDATE OR DELETE ON "inventory_goods_receipt_line"
  FOR EACH ROW EXECUTE FUNCTION verity.reject_mutation();

-- Entities and their capability registration.
INSERT INTO "entity_definition" (key, capability, class, table_name, tenant_scoped) VALUES
  ('verity.inventory.vendor',         'verity.capability.inventory', 'Persistent', 'inventory_vendor',         true),
  ('verity.inventory.purchase_order', 'verity.capability.inventory', 'Persistent', 'inventory_purchase_order', true)
ON CONFLICT (key) DO NOTHING;

UPDATE "capability_definition"
   SET entity_types = entity_types || ARRAY['verity.inventory.vendor', 'verity.inventory.purchase_order']
 WHERE id = 'verity.capability.inventory'
   AND NOT ('verity.inventory.vendor' = ANY(entity_types));
