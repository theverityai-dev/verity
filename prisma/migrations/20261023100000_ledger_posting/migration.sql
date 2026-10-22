-- Task 130 / ADR-044: business documents post to the ledger.
--
-- Additive. Three changes:
--   1. journal_entry learns which document it came from (source_kind, source_id) with a tenant-scoped UNIQUE key. That key is the
--      idempotency guarantee: posting the same document twice is a unique violation the consumer treats as "already posted".
--      NULLs are distinct in a Postgres unique index, so manual journal entries (no source) are unaffected.
--   2. account_map says which account plays which role (receivable, sales income, GST output, cash, bank) for a tenant. Nothing
--      posts to a guessed account: with a role unmapped, the document waits in ledger_posting_pending with the reason.
--   3. ledger_posting_pending is the visible list of documents that could not post yet. Mutable on purpose (a row is removed once
--      the document posts); the ledger itself stays append-only.
-- journal_entry is append-only by trigger on UPDATE and DELETE; adding columns is neither.

ALTER TABLE "journal_entry" ADD COLUMN "source_kind" TEXT;
ALTER TABLE "journal_entry" ADD COLUMN "source_id" UUID;
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_source_pair"
  CHECK (("source_kind" IS NULL) = ("source_id" IS NULL));
CREATE UNIQUE INDEX "journal_entry_tenant_id_source_kind_source_id_key"
  ON "journal_entry"("tenant_id", "source_kind", "source_id");

CREATE TABLE "account_map" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "role" TEXT NOT NULL,
  "account_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_map_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "account_map_role_known"
    CHECK ("role" IN ('receivable', 'sales_income', 'gst_output', 'cash', 'bank'))
);
CREATE UNIQUE INDEX "account_map_tenant_id_role_key" ON "account_map"("tenant_id", "role");
ALTER TABLE "account_map" ADD CONSTRAINT "account_map_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "account_map" ADD CONSTRAINT "account_map_account_fkey"
  FOREIGN KEY ("tenant_id", "account_id") REFERENCES "account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "account_map" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_map" FORCE ROW LEVEL SECURITY;
CREATE POLICY "account_map_isolation" ON "account_map"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

CREATE TABLE "ledger_posting_pending" (
  "tenant_id" UUID NOT NULL,
  "source_kind" TEXT NOT NULL,
  "source_id" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ledger_posting_pending_pkey" PRIMARY KEY ("tenant_id", "source_kind", "source_id")
);
ALTER TABLE "ledger_posting_pending" ADD CONSTRAINT "ledger_posting_pending_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ledger_posting_pending" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ledger_posting_pending" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ledger_posting_pending_isolation" ON "ledger_posting_pending"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());
