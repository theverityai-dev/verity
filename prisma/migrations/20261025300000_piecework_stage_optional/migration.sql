-- Stylified (FR-028): a stage is required or optional. A lot may skip only an optional stage on its rate card; every other stage is on every lot's
-- route. Additive with a default, so existing stages stay required and running code is unaffected.
ALTER TABLE "piecework_stage" ADD COLUMN "optional" BOOLEAN NOT NULL DEFAULT false;