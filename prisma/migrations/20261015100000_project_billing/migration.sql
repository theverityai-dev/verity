-- Job billing record: invoices a business has raised for a job, and money received against it.
--
-- Deliberately NOT a GST invoice generator. Trading's invoice engine bills stocked catalogue products issued
-- from a godown; a made-to-order job is not that, and tax is not computed here. The business raises its GST
-- invoice where it does today and records the number and amounts here, as entered, so the job can answer
-- "what have we billed, what has been paid, what is still to collect".
--
-- Money is integer minor units. Both tables are append-only in spirit: a wrong entry is voided with a reason
-- and entered again, never edited or deleted.

CREATE TABLE "project_invoice" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "issued_on" DATE NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "tax_minor" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_invoice_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "project_invoice_kind" CHECK ("kind" IN ('advance', 'progress', 'final')),
    CONSTRAINT "project_invoice_amount" CHECK ("amount_minor" > 0),
    CONSTRAINT "project_invoice_tax" CHECK ("tax_minor" >= 0)
);
CREATE INDEX "project_invoice_tenant_id_job_id_idx" ON "project_invoice"("tenant_id", "job_id");
-- An invoice number is used once while it is live; a voided number may be reused.
CREATE UNIQUE INDEX "project_invoice_live_number_key" ON "project_invoice"("tenant_id", "number") WHERE "voided_at" IS NULL;
-- Composite key so a receipt can reference an invoice only inside the same tenant and the same job.
CREATE UNIQUE INDEX "project_invoice_tenant_job_id_key" ON "project_invoice"("tenant_id", "job_id", "id");

CREATE TABLE "project_receipt" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "invoice_id" UUID,
    "received_on" DATE NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_receipt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "project_receipt_method" CHECK ("method" IN ('bank', 'cheque', 'cash', 'upi', 'other')),
    CONSTRAINT "project_receipt_amount" CHECK ("amount_minor" > 0)
);
CREATE INDEX "project_receipt_tenant_id_job_id_idx" ON "project_receipt"("tenant_id", "job_id");

ALTER TABLE "project_invoice" ADD CONSTRAINT "project_invoice_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_invoice" ADD CONSTRAINT "project_invoice_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "project_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_receipt" ADD CONSTRAINT "project_receipt_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_receipt" ADD CONSTRAINT "project_receipt_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "project_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_receipt" ADD CONSTRAINT "project_receipt_invoice_fkey" FOREIGN KEY ("tenant_id", "job_id", "invoice_id") REFERENCES "project_invoice"("tenant_id", "job_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- INV-001: tenant isolation.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['project_invoice', 'project_receipt'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = verity.current_tenant_id()) WITH CHECK (tenant_id = verity.current_tenant_id())',
      t || '_isolation', t);
  END LOOP;
END $$;

INSERT INTO "entity_definition" (key, capability, class, table_name, tenant_scoped) VALUES
  ('verity.project.invoice', 'verity.capability.project', 'Persistent', 'project_invoice', true),
  ('verity.project.receipt', 'verity.capability.project', 'Persistent', 'project_receipt', true)
ON CONFLICT (key) DO NOTHING;

UPDATE "capability_definition"
   SET entity_types = entity_types
       || ARRAY(SELECT e FROM unnest(ARRAY['verity.project.invoice', 'verity.project.receipt']) e WHERE NOT (e = ANY(entity_types))),
       updated_at = now()
 WHERE id = 'verity.capability.project';
