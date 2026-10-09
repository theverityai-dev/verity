-- ---------------------------------------------------------------------------
-- A dine-in bill is a GST tax invoice (ADR-040; Task 126 Wave 2)
-- ---------------------------------------------------------------------------
-- Adds, all additive:
--   * outlet_profile: who the seller is at one outlet, its bill-number code, its
--     service day and service charge. An outlet with no profile bills as before.
--   * bill.number and the seller snapshot: a gapless, consecutive invoice number
--     (the allocator is shared with trading) and the seller as it stood that day.
--   * bill_tax_line: the bill split by GST rate, so one bill can carry 5% and 18%.
--   * menu_item.tax_rate_bp / order_line.tax_rate_bp: a rate per dish, snapshotted
--     on the line. Null keeps the tenant default.
--   * bill_refund credit-note number and bill_refund_tax_line: a refund is a credit
--     note and states the tax it reverses.
-- Bills and refunds that already exist keep null numbers and render their old label.

-- Per-dish rate ---------------------------------------------------------------
ALTER TABLE "menu_item" ADD COLUMN "tax_rate_bp" INTEGER;
ALTER TABLE "menu_item" ADD CONSTRAINT "menu_item_tax_rate_range" CHECK ("tax_rate_bp" IS NULL OR "tax_rate_bp" BETWEEN 0 AND 4000);
ALTER TABLE "order_line" ADD COLUMN "tax_rate_bp" INTEGER;
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_tax_rate_range" CHECK ("tax_rate_bp" IS NULL OR "tax_rate_bp" BETWEEN 0 AND 4000);

-- Outlet profile ----------------------------------------------------------------
CREATE TABLE "outlet_profile" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "gstin" VARCHAR(15),
    "state_code" VARCHAR(2),
    "registration_type" TEXT NOT NULL DEFAULT 'regular',
    "fssai" TEXT,
    "address_lines" TEXT,
    "day_start_minute" INTEGER NOT NULL DEFAULT 300,
    "service_charge_bp" INTEGER NOT NULL DEFAULT 0,
    "platform_tax_free" BOOLEAN NOT NULL DEFAULT true,
    "cutover_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "outlet_profile_pkey" PRIMARY KEY ("id"),
    -- Up to three capitals or digits: a bill number must stay within sixteen characters.
    CONSTRAINT "outlet_profile_code_shape" CHECK ("code" ~ '^[A-Z0-9]{1,3}$'),
    CONSTRAINT "outlet_profile_legal_name_present" CHECK (length(btrim("legal_name")) > 0),
    CONSTRAINT "outlet_profile_registration_known" CHECK ("registration_type" IN ('regular','composition','unregistered')),
    CONSTRAINT "outlet_profile_gstin_shape" CHECK ("gstin" IS NULL OR "gstin" ~ '^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$'),
    CONSTRAINT "outlet_profile_gstin_when_registered" CHECK ("registration_type" = 'unregistered' OR "gstin" IS NOT NULL),
    CONSTRAINT "outlet_profile_state_code_shape" CHECK ("state_code" IS NULL OR "state_code" ~ '^[0-9]{2}$'),
    CONSTRAINT "outlet_profile_day_start_range" CHECK ("day_start_minute" BETWEEN 0 AND 1439),
    CONSTRAINT "outlet_profile_service_charge_range" CHECK ("service_charge_bp" BETWEEN 0 AND 2000)
);
CREATE UNIQUE INDEX "outlet_profile_location" ON "outlet_profile"("tenant_id", "location_id");
CREATE UNIQUE INDEX "outlet_profile_code" ON "outlet_profile"("tenant_id", "code");
ALTER TABLE "outlet_profile" ADD CONSTRAINT "outlet_profile_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outlet_profile" ADD CONSTRAINT "outlet_profile_location_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "location"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "outlet_profile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outlet_profile" FORCE ROW LEVEL SECURITY;
CREATE POLICY "outlet_profile_isolation" ON "outlet_profile"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

-- Bill: number, seller snapshot, service charge, tax-free flag -------------------
ALTER TABLE "bill"
  ADD COLUMN "number" TEXT,
  ADD COLUMN "sequence_number" INTEGER,
  ADD COLUMN "financial_year" TEXT,
  ADD COLUMN "seller_legal_name" TEXT,
  ADD COLUMN "seller_gstin" TEXT,
  ADD COLUMN "seller_fssai" TEXT,
  ADD COLUMN "seller_address" TEXT,
  ADD COLUMN "service_charge_bp" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "service_charge_minor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tax_free" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "bill" ADD CONSTRAINT "bill_service_charge_nonnegative" CHECK ("service_charge_bp" >= 0 AND "service_charge_minor" >= 0);
-- A number is unique within the tenant; many bills may have none (NULLs are distinct).
CREATE UNIQUE INDEX "bill_tenant_number" ON "bill"("tenant_id", "number");

-- Bill tax lines -----------------------------------------------------------------
CREATE TABLE "bill_tax_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "rate_bp" INTEGER NOT NULL,
    "gross_minor" INTEGER NOT NULL,
    "taxable_minor" INTEGER NOT NULL,
    "cgst_minor" INTEGER NOT NULL,
    "sgst_minor" INTEGER NOT NULL,
    CONSTRAINT "bill_tax_line_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bill_tax_line_amounts_nonnegative" CHECK ("gross_minor" >= 0 AND "taxable_minor" >= 0 AND "cgst_minor" >= 0 AND "sgst_minor" >= 0),
    CONSTRAINT "bill_tax_line_rate_range" CHECK ("rate_bp" BETWEEN 0 AND 4000)
);
CREATE UNIQUE INDEX "bill_tax_line_rate" ON "bill_tax_line"("bill_id", "rate_bp");
CREATE INDEX "bill_tax_line_tenant_id_bill_id_idx" ON "bill_tax_line"("tenant_id", "bill_id");
ALTER TABLE "bill_tax_line" ADD CONSTRAINT "bill_tax_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bill_tax_line" ADD CONSTRAINT "bill_tax_line_bill_fkey" FOREIGN KEY ("tenant_id", "bill_id") REFERENCES "bill"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "bill_tax_line" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bill_tax_line" FORCE ROW LEVEL SECURITY;
CREATE POLICY "bill_tax_line_isolation" ON "bill_tax_line"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

-- Credit notes ---------------------------------------------------------------------
ALTER TABLE "bill_refund"
  ADD COLUMN "credit_note_number" TEXT,
  ADD COLUMN "credit_note_sequence" INTEGER;
CREATE UNIQUE INDEX "bill_refund_tenant_scoped_id" ON "bill_refund"("tenant_id", "id");
CREATE UNIQUE INDEX "bill_refund_tenant_credit_note" ON "bill_refund"("tenant_id", "credit_note_number");

CREATE TABLE "bill_refund_tax_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "refund_id" UUID NOT NULL,
    "rate_bp" INTEGER NOT NULL,
    "taxable_minor" INTEGER NOT NULL,
    "cgst_minor" INTEGER NOT NULL,
    "sgst_minor" INTEGER NOT NULL,
    CONSTRAINT "bill_refund_tax_line_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bill_refund_tax_line_amounts_nonnegative" CHECK ("taxable_minor" >= 0 AND "cgst_minor" >= 0 AND "sgst_minor" >= 0)
);
CREATE INDEX "bill_refund_tax_line_tenant_id_refund_id_idx" ON "bill_refund_tax_line"("tenant_id", "refund_id");
ALTER TABLE "bill_refund_tax_line" ADD CONSTRAINT "bill_refund_tax_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bill_refund_tax_line" ADD CONSTRAINT "bill_refund_tax_line_refund_fkey" FOREIGN KEY ("tenant_id", "refund_id") REFERENCES "bill_refund"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "bill_refund_tax_line" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bill_refund_tax_line" FORCE ROW LEVEL SECURITY;
CREATE POLICY "bill_refund_tax_line_read" ON "bill_refund_tax_line"
  FOR SELECT USING ("tenant_id" = verity.current_tenant_id());
CREATE POLICY "bill_refund_tax_line_append" ON "bill_refund_tax_line"
  FOR INSERT WITH CHECK ("tenant_id" = verity.current_tenant_id());
CREATE TRIGGER "bill_refund_tax_line_append_only"
  BEFORE UPDATE OR DELETE ON "bill_refund_tax_line"
  FOR EACH ROW EXECUTE FUNCTION verity.reject_mutation();
