-- ---------------------------------------------------------------------------
-- Menu modifiers, part 2: the order line's add-ons as rows, not JSON
-- ---------------------------------------------------------------------------
-- 20261009030000 first stored the snapshot as an `order_line.modifiers` JSON
-- column. The repository keeps JSON to a fixed set of extension points
-- (conformance: "keeps JSON columns to the declared extension points"), and an
-- add-on snapshot is relational data, so it becomes one row per add-on chosen.
-- The JSON column was never populated outside development, so nothing is lost.

ALTER TABLE "order_line" DROP CONSTRAINT "order_line_modifiers_is_array";
ALTER TABLE "order_line" DROP COLUMN "modifiers";

CREATE TABLE "order_line_modifier" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_line_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_delta_minor" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_line_modifier_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "order_line_modifier_name_present" CHECK (length(btrim("name")) > 0),
    CONSTRAINT "order_line_modifier_price_non_negative" CHECK ("price_delta_minor" >= 0)
);

CREATE INDEX "order_line_modifier_tenant_id_order_line_id_idx" ON "order_line_modifier"("tenant_id", "order_line_id");

ALTER TABLE "order_line_modifier" ADD CONSTRAINT "order_line_modifier_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_line_modifier" ADD CONSTRAINT "order_line_modifier_tenant_id_order_line_id_fkey" FOREIGN KEY ("tenant_id", "order_line_id") REFERENCES "order_line"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "order_line_modifier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_line_modifier" FORCE ROW LEVEL SECURITY;
CREATE POLICY "order_line_modifier_isolation" ON "order_line_modifier"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());
