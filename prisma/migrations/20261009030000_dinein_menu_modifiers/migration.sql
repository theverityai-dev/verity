-- ---------------------------------------------------------------------------
-- Menu modifiers (Colonel Kebabz parity, menu-recipes.md; Task 125 item 3.1)
-- ---------------------------------------------------------------------------
-- An add-on the guest asks for on one item: "extra cheese +Rs 30", "extra spicy"
-- at no charge. Independent options per item, price zero or more. The order
-- line keeps a snapshot (name and price at the time) in `modifiers`, so a bill
-- reprinted next year shows what was charged even after the menu changes.

CREATE TABLE "menu_modifier" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_delta_minor" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "menu_modifier_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "menu_modifier_name_present" CHECK (length(btrim("name")) > 0),
    CONSTRAINT "menu_modifier_price_non_negative" CHECK ("price_delta_minor" >= 0)
);

CREATE UNIQUE INDEX "menu_modifier_tenant_id_item_id_name_key" ON "menu_modifier"("tenant_id", "item_id", "name");
CREATE UNIQUE INDEX "menu_modifier_tenant_id_id_key" ON "menu_modifier"("tenant_id", "id");

ALTER TABLE "menu_modifier" ADD CONSTRAINT "menu_modifier_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "menu_modifier" ADD CONSTRAINT "menu_modifier_tenant_id_item_id_fkey" FOREIGN KEY ("tenant_id", "item_id") REFERENCES "menu_item"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "menu_modifier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menu_modifier" FORCE ROW LEVEL SECURITY;
CREATE POLICY "menu_modifier_isolation" ON "menu_modifier"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

-- What was ordered on the line: [{"name": "Extra cheese", "priceDeltaMinor": 3000}], sorted by name.
-- Existing lines default to none.
ALTER TABLE "order_line" ADD COLUMN "modifiers" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_modifiers_is_array" CHECK (jsonb_typeof("modifiers") = 'array');
