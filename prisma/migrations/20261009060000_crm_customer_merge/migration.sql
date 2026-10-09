-- ---------------------------------------------------------------------------
-- Merge duplicate guests (Task 125 item 5.1; ADR-007: identity follows a
-- verified contact, history is not rewritten)
-- ---------------------------------------------------------------------------
-- Two guest rows for one person (a second phone number) are joined by pointing
-- the duplicate at the guest to keep. Nothing is deleted and no past order,
-- bill or loyalty entry is edited: the loyalty ledger is append-only and orders
-- find their guest by phone, so the kept guest simply answers for every phone
-- in its group. Reads follow the link; there is one level (a group is a root
-- and the rows pointing straight at it).

ALTER TABLE "customer"
  ADD COLUMN "merged_into_id" UUID,
  ADD COLUMN "merged_at" TIMESTAMP(3);

-- Tenant-scoped, so a guest can only be merged into a guest of the same client (INV-001).
CREATE UNIQUE INDEX "customer_tenant_id_id_key" ON "customer"("tenant_id", "id");

ALTER TABLE "customer"
  ADD CONSTRAINT "customer_merged_into_fkey" FOREIGN KEY ("tenant_id", "merged_into_id") REFERENCES "customer"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "customer_not_merged_into_self" CHECK ("merged_into_id" IS NULL OR "merged_into_id" <> "id"),
  ADD CONSTRAINT "customer_merged_at_with_link" CHECK (("merged_into_id" IS NULL) = ("merged_at" IS NULL));

CREATE INDEX "customer_tenant_id_merged_into_id_idx" ON "customer"("tenant_id", "merged_into_id");
