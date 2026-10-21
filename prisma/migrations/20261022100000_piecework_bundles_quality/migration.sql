-- Piece-rate capability, second step (Shirt Factory requirement sheet v1.0, 2026-10-21).
-- Ledgers move from lot level to BUNDLE level: every entry names its own lot, bundle, stage and worker. A return
-- settles one issue and splits the pieces into good, rejected, rework and short. Lots gain a status workflow,
-- workers a kind (in-house or outside unit), rates a wage basis, payments a mode, reference and the recovery
-- and deduction kinds. Additive in intent; the piecework tables hold no data anywhere (the capability was inert),
-- and the guard below refuses to run if that has changed, rather than guess how to convert real history.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "piecework_entry") OR EXISTS (SELECT 1 FROM "piecework_payment") OR EXISTS (SELECT 1 FROM "piecework_lot") THEN
    RAISE EXCEPTION 'piecework tables hold rows; this migration restructures the ledgers and will not convert history';
  END IF;
END $$;

-- Lots: planned pieces, working name, fabric type, dates, status. Bundle size now belongs to each bundle.
ALTER TABLE "piecework_lot" RENAME COLUMN "total_pieces" TO "planned_pieces";
ALTER TABLE "piecework_lot" RENAME CONSTRAINT "piecework_lot_total_positive" TO "piecework_lot_planned_positive";
ALTER TABLE "piecework_lot" DROP COLUMN "bundle_size";
ALTER TABLE "piecework_lot"
  ADD COLUMN "name" TEXT,
  ADD COLUMN "fabric_type" TEXT,
  ADD COLUMN "start_date" DATE,
  ADD COLUMN "due_date" DATE,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'draft';

-- Workers: in-house or outside unit, address.
ALTER TABLE "piecework_worker" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'in_house', ADD COLUMN "address" TEXT;

-- Rates: what the rate is paid on.
ALTER TABLE "piecework_worker_rate" ADD COLUMN "wage_basis" TEXT NOT NULL DEFAULT 'good';

-- Payments: mode and reference for money that moved.
ALTER TABLE "piecework_payment" ADD COLUMN "mode" TEXT, ADD COLUMN "reference" TEXT;

-- Bundles.
CREATE TABLE "piecework_bundle" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "net_pieces" INTEGER NOT NULL,
    "size_note" TEXT,
    "parent_bundle_id" UUID,
    "cancelled_at" TIMESTAMP(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "piecework_bundle_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "piecework_bundle_net_positive" CHECK ("net_pieces" > 0),
    CONSTRAINT "piecework_bundle_sequence_positive" CHECK ("sequence_no" > 0)
);
CREATE UNIQUE INDEX "piecework_bundle_tenant_id_number_key" ON "piecework_bundle"("tenant_id", "number");
CREATE UNIQUE INDEX "piecework_bundle_tenant_id_sequence_no_key" ON "piecework_bundle"("tenant_id", "sequence_no");
CREATE INDEX "piecework_bundle_tenant_id_lot_id_idx" ON "piecework_bundle"("tenant_id", "lot_id");
ALTER TABLE "piecework_bundle" ADD CONSTRAINT "piecework_bundle_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "piecework_bundle" ADD CONSTRAINT "piecework_bundle_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "piecework_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "piecework_bundle" ADD CONSTRAINT "piecework_bundle_parent_bundle_id_fkey" FOREIGN KEY ("parent_bundle_id") REFERENCES "piecework_bundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Entries: bundle, the issue a return settles, the four-way split, rework flag, wage basis, due date.
ALTER TABLE "piecework_entry"
  ADD COLUMN "bundle_id" UUID NOT NULL,
  ADD COLUMN "good_pieces" INTEGER,
  ADD COLUMN "rejected_pieces" INTEGER,
  ADD COLUMN "rework_pieces" INTEGER,
  ADD COLUMN "short_pieces" INTEGER,
  ADD COLUMN "issue_id" UUID,
  ADD COLUMN "is_rework" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "wage_basis" TEXT,
  ADD COLUMN "due_date" DATE;
CREATE INDEX "piecework_entry_tenant_id_bundle_id_idx" ON "piecework_entry"("tenant_id", "bundle_id");
ALTER TABLE "piecework_entry" ADD CONSTRAINT "piecework_entry_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "piecework_bundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "piecework_entry" ADD CONSTRAINT "piecework_entry_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "piecework_entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- A return accounts for every piece it names: good + rejected + rework + short = pieces, none negative.
-- Whatever is not accounted for stays OPEN on the issue; it is never silently classified.
ALTER TABLE "piecework_entry" ADD CONSTRAINT "piecework_entry_split_accounts" CHECK (
  ("good_pieces" IS NULL AND "rejected_pieces" IS NULL AND "rework_pieces" IS NULL AND "short_pieces" IS NULL)
  OR ("good_pieces" >= 0 AND "rejected_pieces" >= 0 AND "rework_pieces" >= 0 AND "short_pieces" >= 0
      AND "good_pieces" + "rejected_pieces" + "rework_pieces" + "short_pieces" = "pieces")
);

-- INV-001 for the new table.
ALTER TABLE "piecework_bundle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "piecework_bundle" FORCE ROW LEVEL SECURITY;
CREATE POLICY "piecework_bundle_isolation" ON "piecework_bundle"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

INSERT INTO "entity_definition" (key, capability, class, table_name, tenant_scoped) VALUES
  ('verity.piecework.bundle', 'verity.capability.piecework', 'Persistent', 'piecework_bundle', true)
ON CONFLICT (key) DO NOTHING;

UPDATE "capability_definition"
   SET entity_types = entity_types || ARRAY['verity.piecework.bundle'], updated_at = now()
 WHERE id = 'verity.capability.piecework'
   AND NOT ('verity.piecework.bundle' = ANY(entity_types));
