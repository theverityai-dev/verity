-- ---------------------------------------------------------------------------
-- Menu availability rules (Task 125 items 3.2 and 3.3)
-- ---------------------------------------------------------------------------
-- Replaces "one active flag for everyone, always" with scoped rules. An item with
-- no rule is available wherever it is active. An item with one or more rules is
-- available only where some rule matches: a rule names an outlet, a channel, a
-- daily window in the outlet's own clock, or any mix. A null scope means "any".
-- The window is minutes since local midnight; a window that ends before it starts
-- wraps past midnight (22:00 to 02:00 is from 1320 to 120).

CREATE TABLE "menu_availability" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "location_id" UUID,
    "channel" TEXT,
    "from_minute" INTEGER,
    "to_minute" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "menu_availability_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "menu_availability_window_both_or_neither" CHECK (("from_minute" IS NULL) = ("to_minute" IS NULL)),
    CONSTRAINT "menu_availability_window_range" CHECK (
      "from_minute" IS NULL OR ("from_minute" BETWEEN 0 AND 1439 AND "to_minute" BETWEEN 0 AND 1439 AND "from_minute" <> "to_minute")
    ),
    CONSTRAINT "menu_availability_channel_known" CHECK (
      "channel" IS NULL OR "channel" IN ('dine_in','takeaway','phone','delivery','delivery_platform','website','qr','corporate','catering')
    ),
    -- A rule that restricts nothing is the same as no rule; reject it so it cannot hide that.
    CONSTRAINT "menu_availability_restricts_something" CHECK (
      "location_id" IS NOT NULL OR "channel" IS NOT NULL OR "from_minute" IS NOT NULL
    )
);

CREATE INDEX "menu_availability_tenant_id_item_id_idx" ON "menu_availability"("tenant_id", "item_id");

ALTER TABLE "menu_availability" ADD CONSTRAINT "menu_availability_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "menu_availability" ADD CONSTRAINT "menu_availability_item_fkey" FOREIGN KEY ("tenant_id", "item_id") REFERENCES "menu_item"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "menu_availability" ADD CONSTRAINT "menu_availability_location_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "location"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "menu_availability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menu_availability" FORCE ROW LEVEL SECURITY;
CREATE POLICY "menu_availability_isolation" ON "menu_availability"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());
