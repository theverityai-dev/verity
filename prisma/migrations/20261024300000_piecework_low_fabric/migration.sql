-- Stylified (FR-024): warn when a fabric runs low. One number per factory, in the unit the rolls are measured in (metres or kilograms);
-- empty means no warning. Additive and nullable, so existing rows and running code are unaffected.
ALTER TABLE "piecework_setting"
  ADD COLUMN "low_fabric_centi" INTEGER,
  ADD CONSTRAINT "piecework_setting_low_fabric_nonneg" CHECK ("low_fabric_centi" IS NULL OR "low_fabric_centi" >= 0);
