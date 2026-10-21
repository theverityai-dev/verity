-- Capability: piecework (Stylified, Garment Lot and Karigar PRD). Lot-based, piece-rate production:
-- pieces are issued to a worker at a stage and received back; the worker is paid per piece.
-- Two APPEND-ONLY ledgers (entries, payments) carry every fact; the rate history is append-only too.
-- A mistake is corrected by a reversal row, never an edit or a delete. Everything shown on a screen
-- (pending, stage, days, wages, balance due) is derived from these rows, never stored.
-- Additive only. Every table is tenant-isolated with row-level security forced (INV-001).

-- CreateTable
CREATE TABLE "piecework_stage" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stage_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "piecework_stage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "piecework_lot" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "design" TEXT NOT NULL,
    "total_pieces" INTEGER NOT NULL,
    "bundle_size" INTEGER NOT NULL DEFAULT 20,
    "note" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "piecework_lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "piecework_worker" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "piecework_worker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "piecework_worker_rate" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "rate_minor" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "piecework_worker_rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "piecework_entry" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "pieces" INTEGER NOT NULL,
    "rate_minor" INTEGER,
    "reverses_id" UUID,
    "entry_date" DATE NOT NULL,
    "note" TEXT,
    "entered_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "piecework_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "piecework_payment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "reverses_id" UUID,
    "paid_on" DATE NOT NULL,
    "note" TEXT,
    "entered_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "piecework_payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "piecework_stage_tenant_id_stage_key_key" ON "piecework_stage"("tenant_id", "stage_key");

-- CreateIndex
CREATE UNIQUE INDEX "piecework_stage_tenant_id_sequence_key" ON "piecework_stage"("tenant_id", "sequence");

-- CreateIndex
CREATE INDEX "piecework_lot_tenant_id_cancelled_at_idx" ON "piecework_lot"("tenant_id", "cancelled_at");

-- CreateIndex
CREATE UNIQUE INDEX "piecework_lot_tenant_id_number_key" ON "piecework_lot"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "piecework_lot_tenant_id_sequence_no_key" ON "piecework_lot"("tenant_id", "sequence_no");

-- CreateIndex
CREATE UNIQUE INDEX "piecework_worker_tenant_id_name_key" ON "piecework_worker"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "piecework_worker_rate_tenant_id_worker_id_idx" ON "piecework_worker_rate"("tenant_id", "worker_id");

-- CreateIndex
CREATE UNIQUE INDEX "piecework_worker_rate_worker_id_stage_id_effective_from_key" ON "piecework_worker_rate"("worker_id", "stage_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "piecework_entry_reverses_id_key" ON "piecework_entry"("reverses_id");

-- CreateIndex
CREATE INDEX "piecework_entry_tenant_id_lot_id_stage_id_idx" ON "piecework_entry"("tenant_id", "lot_id", "stage_id");

-- CreateIndex
CREATE INDEX "piecework_entry_tenant_id_worker_id_idx" ON "piecework_entry"("tenant_id", "worker_id");

-- CreateIndex
CREATE UNIQUE INDEX "piecework_payment_reverses_id_key" ON "piecework_payment"("reverses_id");

-- CreateIndex
CREATE INDEX "piecework_payment_tenant_id_worker_id_idx" ON "piecework_payment"("tenant_id", "worker_id");

-- AddForeignKey
ALTER TABLE "piecework_stage" ADD CONSTRAINT "piecework_stage_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piecework_lot" ADD CONSTRAINT "piecework_lot_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piecework_worker" ADD CONSTRAINT "piecework_worker_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piecework_worker_rate" ADD CONSTRAINT "piecework_worker_rate_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piecework_worker_rate" ADD CONSTRAINT "piecework_worker_rate_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "piecework_worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piecework_worker_rate" ADD CONSTRAINT "piecework_worker_rate_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "piecework_stage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piecework_entry" ADD CONSTRAINT "piecework_entry_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piecework_entry" ADD CONSTRAINT "piecework_entry_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "piecework_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piecework_entry" ADD CONSTRAINT "piecework_entry_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "piecework_stage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piecework_entry" ADD CONSTRAINT "piecework_entry_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "piecework_worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piecework_entry" ADD CONSTRAINT "piecework_entry_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "piecework_entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piecework_payment" ADD CONSTRAINT "piecework_payment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piecework_payment" ADD CONSTRAINT "piecework_payment_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "piecework_worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piecework_payment" ADD CONSTRAINT "piecework_payment_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "piecework_payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backstops for what the commands already check.
ALTER TABLE "piecework_stage" ADD CONSTRAINT "piecework_stage_sequence_positive" CHECK ("sequence" >= 1);
ALTER TABLE "piecework_lot" ADD CONSTRAINT "piecework_lot_total_positive" CHECK ("total_pieces" > 0);
ALTER TABLE "piecework_lot" ADD CONSTRAINT "piecework_lot_bundle_positive" CHECK ("bundle_size" > 0);
ALTER TABLE "piecework_lot" ADD CONSTRAINT "piecework_lot_sequence_positive" CHECK ("sequence_no" > 0);
ALTER TABLE "piecework_worker_rate" ADD CONSTRAINT "piecework_worker_rate_nonnegative" CHECK ("rate_minor" >= 0);
ALTER TABLE "piecework_entry" ADD CONSTRAINT "piecework_entry_pieces_positive" CHECK ("pieces" > 0);
ALTER TABLE "piecework_entry" ADD CONSTRAINT "piecework_entry_rate_nonnegative" CHECK ("rate_minor" IS NULL OR "rate_minor" >= 0);
ALTER TABLE "piecework_payment" ADD CONSTRAINT "piecework_payment_amount_positive" CHECK ("amount_minor" > 0);

-- INV-001: ordinary tables.
ALTER TABLE "piecework_stage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "piecework_stage" FORCE ROW LEVEL SECURITY;
CREATE POLICY "piecework_stage_isolation" ON "piecework_stage"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

ALTER TABLE "piecework_lot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "piecework_lot" FORCE ROW LEVEL SECURITY;
CREATE POLICY "piecework_lot_isolation" ON "piecework_lot"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

ALTER TABLE "piecework_worker" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "piecework_worker" FORCE ROW LEVEL SECURITY;
CREATE POLICY "piecework_worker_isolation" ON "piecework_worker"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

-- INV-001: append-only ledgers. SELECT and INSERT policies only, and a trigger refuses UPDATE and DELETE.
ALTER TABLE "piecework_worker_rate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "piecework_worker_rate" FORCE ROW LEVEL SECURITY;
CREATE POLICY "piecework_worker_rate_read" ON "piecework_worker_rate"
  FOR SELECT USING ("tenant_id" = verity.current_tenant_id());
CREATE POLICY "piecework_worker_rate_append" ON "piecework_worker_rate"
  FOR INSERT WITH CHECK ("tenant_id" = verity.current_tenant_id());
CREATE TRIGGER "piecework_worker_rate_append_only"
  BEFORE UPDATE OR DELETE ON "piecework_worker_rate"
  FOR EACH ROW EXECUTE FUNCTION verity.reject_mutation();

ALTER TABLE "piecework_entry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "piecework_entry" FORCE ROW LEVEL SECURITY;
CREATE POLICY "piecework_entry_read" ON "piecework_entry"
  FOR SELECT USING ("tenant_id" = verity.current_tenant_id());
CREATE POLICY "piecework_entry_append" ON "piecework_entry"
  FOR INSERT WITH CHECK ("tenant_id" = verity.current_tenant_id());
CREATE TRIGGER "piecework_entry_append_only"
  BEFORE UPDATE OR DELETE ON "piecework_entry"
  FOR EACH ROW EXECUTE FUNCTION verity.reject_mutation();

ALTER TABLE "piecework_payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "piecework_payment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "piecework_payment_read" ON "piecework_payment"
  FOR SELECT USING ("tenant_id" = verity.current_tenant_id());
CREATE POLICY "piecework_payment_append" ON "piecework_payment"
  FOR INSERT WITH CHECK ("tenant_id" = verity.current_tenant_id());
CREATE TRIGGER "piecework_payment_append_only"
  BEFORE UPDATE OR DELETE ON "piecework_payment"
  FOR EACH ROW EXECUTE FUNCTION verity.reject_mutation();

-- Capability and entities. Stages, lots and workers have no state machine: a lot is cancelled by a dated
-- fact and is otherwise active until its pieces are ready, which is derived.
INSERT INTO "capability_definition" (id, name, version, dependencies, entity_types, updated_at) VALUES
  ('verity.capability.piecework', 'Piece-rate lots', '1.0.0', ARRAY[]::text[],
   ARRAY['verity.piecework.stage', 'verity.piecework.lot', 'verity.piecework.worker',
         'verity.piecework.entry', 'verity.piecework.payment'], now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO "entity_definition" (key, capability, class, table_name, tenant_scoped) VALUES
  ('verity.piecework.stage',   'verity.capability.piecework', 'Persistent', 'piecework_stage',   true),
  ('verity.piecework.lot',     'verity.capability.piecework', 'Persistent', 'piecework_lot',     true),
  ('verity.piecework.worker',  'verity.capability.piecework', 'Persistent', 'piecework_worker',  true),
  ('verity.piecework.entry',   'verity.capability.piecework', 'Persistent', 'piecework_entry',   true),
  ('verity.piecework.payment', 'verity.capability.piecework', 'Persistent', 'piecework_payment', true)
ON CONFLICT (key) DO NOTHING;
