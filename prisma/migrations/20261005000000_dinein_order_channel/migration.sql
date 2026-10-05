-- Order channel on dining_order (Colonel Kebabz PRD §8–§9, §47).
--
-- Until now every order required a seated table, so takeaway, phone and
-- delivery-platform orders could not be entered at all. This adds where an
-- order came from and lets orders without a table exist, while a CHECK keeps
-- the old guarantee for dine-in: a dine-in order always has a table.
--
-- Additive and backward compatible: existing rows get channel 'dine_in' and
-- keep their table_id, which satisfies the CHECK. No data is rewritten.
-- The composite FK (tenant_id, table_id) is MATCH SIMPLE, so a NULL table_id
-- simply has no referenced table; tenant isolation (RLS on tenant_id) is
-- unchanged.

ALTER TABLE "dining_order" ALTER COLUMN "table_id" DROP NOT NULL;

ALTER TABLE "dining_order"
  ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'dine_in',
  ADD COLUMN "platform" TEXT,
  ADD COLUMN "platform_order_ref" TEXT;

ALTER TABLE "dining_order"
  ADD CONSTRAINT "dining_order_dine_in_has_table"
  CHECK ("channel" <> 'dine_in' OR "table_id" IS NOT NULL);
