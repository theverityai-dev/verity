-- ---------------------------------------------------------------------------
-- Saved guest segments (Colonel Kebabz parity, crm-loyalty.md; Task 125 item 5.2)
-- ---------------------------------------------------------------------------
-- A segment is a named filter over guests ("3+ visits, not seen in 30 days"),
-- not a list of guests: membership is always computed live from settled bills,
-- so a saved segment never goes stale. At least one filter is required, so a
-- segment is never just "everyone".

CREATE TABLE "customer_segment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "min_visits" INTEGER,
    "min_spend_minor" INTEGER,
    "days_since_last_order" INTEGER,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_segment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "customer_segment_name_present" CHECK (length(btrim("name")) > 0),
    CONSTRAINT "customer_segment_has_filter"
      CHECK ("min_visits" IS NOT NULL OR "min_spend_minor" IS NOT NULL OR "days_since_last_order" IS NOT NULL),
    CONSTRAINT "customer_segment_non_negative"
      CHECK (coalesce("min_visits", 0) >= 0 AND coalesce("min_spend_minor", 0) >= 0 AND coalesce("days_since_last_order", 0) >= 0)
);

CREATE UNIQUE INDEX "customer_segment_tenant_id_name_key" ON "customer_segment"("tenant_id", "name");

ALTER TABLE "customer_segment" ADD CONSTRAINT "customer_segment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_segment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_segment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "customer_segment_isolation" ON "customer_segment"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());
