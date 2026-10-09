-- ---------------------------------------------------------------------------
-- Menu prices by outlet and channel (ADR-043; Task 126 Wave 4)
-- ---------------------------------------------------------------------------
-- The item's own price stays the base. A rule names an optional outlet, an optional
-- channel, a price and the days it holds; the most specific matching rule wins. There
-- are no price-list documents. Orders snapshot the price they were taken at, so ending
-- or editing a rule never rewrites a bill. Rules are kept (ended, not deleted) so the
-- history of what was charged where stays readable.

CREATE TABLE "menu_price_rule" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "location_id" UUID,
    "channel" TEXT,
    "price_minor" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "menu_price_rule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "menu_price_rule_price_nonnegative" CHECK ("price_minor" >= 0),
    CONSTRAINT "menu_price_rule_dates_ordered" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
    CONSTRAINT "menu_price_rule_channel_known" CHECK (
      "channel" IS NULL OR "channel" IN ('dine_in','takeaway','phone','delivery','delivery_platform','website','qr','corporate','catering')
    )
);

CREATE INDEX "menu_price_rule_tenant_id_item_id_idx" ON "menu_price_rule"("tenant_id", "item_id");

ALTER TABLE "menu_price_rule" ADD CONSTRAINT "menu_price_rule_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "menu_price_rule" ADD CONSTRAINT "menu_price_rule_item_fkey" FOREIGN KEY ("tenant_id", "item_id") REFERENCES "menu_item"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "menu_price_rule" ADD CONSTRAINT "menu_price_rule_location_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "location"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "menu_price_rule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menu_price_rule" FORCE ROW LEVEL SECURITY;
CREATE POLICY "menu_price_rule_isolation" ON "menu_price_rule"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());
