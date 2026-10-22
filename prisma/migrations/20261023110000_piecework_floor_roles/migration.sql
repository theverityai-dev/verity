-- Piece-rate capability, third step (Stylified MVP, proposal document 2): the floor.
-- Which stages a supervisor looks after, approval requests (deduction, shortage write-off, lot hold, lot close) with the
-- limits the owner sets for a manager, and the supervisor day close. Additive: no existing row changes.
--
-- Stage assignment is checked by the capability commands (a supervisor can issue and receive only at an assigned
-- stage), not by a new platform scope. An approval is a request that one person raises and another decides; deciding
-- it writes the ordinary ledger or status change through the same rules as any other caller.

CREATE TABLE "piecework_stage_assignment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "piecework_stage_assignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "piecework_stage_assignment_user_id_stage_id_key" ON "piecework_stage_assignment"("user_id", "stage_id");
CREATE INDEX "piecework_stage_assignment_tenant_id_user_id_idx" ON "piecework_stage_assignment"("tenant_id", "user_id");
ALTER TABLE "piecework_stage_assignment" ADD CONSTRAINT "piecework_stage_assignment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "piecework_stage_assignment" ADD CONSTRAINT "piecework_stage_assignment_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "piecework_stage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "piecework_approval" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    -- deduction | writeoff | hold | close. Closed set owned by the capability (APPROVAL_KINDS).
    "kind" TEXT NOT NULL,
    -- pending | approved | declined
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lot_id" UUID,
    "bundle_id" UUID,
    "worker_id" UUID,
    -- The return entry the rejected or short pieces came from; its photographs are the evidence.
    "entry_id" UUID,
    "pieces" INTEGER,
    "amount_minor" INTEGER,
    "reason" TEXT NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    CONSTRAINT "piecework_approval_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "piecework_approval_kind_known" CHECK ("kind" IN ('deduction', 'writeoff', 'hold', 'close')),
    CONSTRAINT "piecework_approval_status_known" CHECK ("status" IN ('pending', 'approved', 'declined')),
    CONSTRAINT "piecework_approval_amount_positive" CHECK ("amount_minor" IS NULL OR "amount_minor" > 0),
    CONSTRAINT "piecework_approval_pieces_positive" CHECK ("pieces" IS NULL OR "pieces" > 0),
    -- A decision names who made it and when; a pending request names neither.
    CONSTRAINT "piecework_approval_decided_consistent" CHECK (
      ("status" = 'pending' AND "decided_by_id" IS NULL AND "decided_at" IS NULL)
      OR ("status" <> 'pending' AND "decided_by_id" IS NOT NULL AND "decided_at" IS NOT NULL)
    )
);
CREATE INDEX "piecework_approval_tenant_id_status_idx" ON "piecework_approval"("tenant_id", "status");
CREATE INDEX "piecework_approval_tenant_id_entry_id_idx" ON "piecework_approval"("tenant_id", "entry_id");
ALTER TABLE "piecework_approval" ADD CONSTRAINT "piecework_approval_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "piecework_approval" ADD CONSTRAINT "piecework_approval_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "piecework_lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "piecework_approval" ADD CONSTRAINT "piecework_approval_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "piecework_bundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "piecework_approval" ADD CONSTRAINT "piecework_approval_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "piecework_worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "piecework_approval" ADD CONSTRAINT "piecework_approval_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "piecework_entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One row per tenant: the limits the owner sets for what a manager may approve alone.
CREATE TABLE "piecework_setting" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "manager_deduction_limit_minor" INTEGER NOT NULL DEFAULT 100000,
    "manager_writeoff_limit_pieces" INTEGER NOT NULL DEFAULT 5,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "piecework_setting_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "piecework_setting_limits_not_negative" CHECK ("manager_deduction_limit_minor" >= 0 AND "manager_writeoff_limit_pieces" >= 0)
);
CREATE UNIQUE INDEX "piecework_setting_tenant_id_key" ON "piecework_setting"("tenant_id");
ALTER TABLE "piecework_setting" ADD CONSTRAINT "piecework_setting_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A supervisor closed day: the summary is frozen at submission so the owner and manager read what was handed over.
CREATE TABLE "piecework_day_close" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "close_date" DATE NOT NULL,
    "summary" JSONB NOT NULL,
    "note" TEXT,
    "lang" TEXT NOT NULL DEFAULT 'en',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "piecework_day_close_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "piecework_day_close_lang_known" CHECK ("lang" IN ('en', 'hi'))
);
CREATE UNIQUE INDEX "piecework_day_close_user_id_close_date_key" ON "piecework_day_close"("user_id", "close_date");
CREATE INDEX "piecework_day_close_tenant_id_close_date_idx" ON "piecework_day_close"("tenant_id", "close_date");
ALTER TABLE "piecework_day_close" ADD CONSTRAINT "piecework_day_close_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- INV-001 for every new table.
ALTER TABLE "piecework_stage_assignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "piecework_stage_assignment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "piecework_stage_assignment_isolation" ON "piecework_stage_assignment"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());
ALTER TABLE "piecework_approval" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "piecework_approval" FORCE ROW LEVEL SECURITY;
CREATE POLICY "piecework_approval_isolation" ON "piecework_approval"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());
ALTER TABLE "piecework_setting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "piecework_setting" FORCE ROW LEVEL SECURITY;
CREATE POLICY "piecework_setting_isolation" ON "piecework_setting"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());
ALTER TABLE "piecework_day_close" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "piecework_day_close" FORCE ROW LEVEL SECURITY;
CREATE POLICY "piecework_day_close_isolation" ON "piecework_day_close"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

-- A closed day is a record of what was handed over: it is never edited or removed.
CREATE TRIGGER "piecework_day_close_append_only" BEFORE UPDATE OR DELETE ON "piecework_day_close"
  FOR EACH ROW EXECUTE FUNCTION verity.reject_mutation();

INSERT INTO "entity_definition" (key, capability, class, table_name, tenant_scoped) VALUES
  ('verity.piecework.stage_assignment', 'verity.capability.piecework', 'Persistent', 'piecework_stage_assignment', true),
  ('verity.piecework.approval', 'verity.capability.piecework', 'Persistent', 'piecework_approval', true),
  ('verity.piecework.setting', 'verity.capability.piecework', 'Persistent', 'piecework_setting', true),
  ('verity.piecework.day_close', 'verity.capability.piecework', 'Persistent', 'piecework_day_close', true)
ON CONFLICT (key) DO NOTHING;

UPDATE "capability_definition"
   SET entity_types = entity_types || ARRAY['verity.piecework.stage_assignment', 'verity.piecework.approval', 'verity.piecework.setting', 'verity.piecework.day_close'], updated_at = now()
 WHERE id = 'verity.capability.piecework'
   AND NOT ('verity.piecework.approval' = ANY(entity_types));
