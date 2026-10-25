-- Stylified leave and cover: a supervisor is away for some dates and another person covers. While the cover is current, the covering person
-- works at the stages of the absent supervisor and gives out to their karigars as well as their own. Cover ends on its last date or when it is ended.
-- Nothing is deleted: an ended cover keeps its row.

CREATE TABLE "piecework_cover" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "absent_user_id" UUID NOT NULL,
    "cover_user_id" UUID NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "reason" TEXT,
    "ended_at" TIMESTAMP(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "piecework_cover_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "piecework_cover_dates_ordered" CHECK ("to_date" >= "from_date"),
    CONSTRAINT "piecework_cover_distinct_people" CHECK ("absent_user_id" <> "cover_user_id")
);
CREATE INDEX "piecework_cover_tenant_id_cover_user_id_idx" ON "piecework_cover"("tenant_id", "cover_user_id");
CREATE INDEX "piecework_cover_tenant_id_absent_user_id_idx" ON "piecework_cover"("tenant_id", "absent_user_id");
ALTER TABLE "piecework_cover" ADD CONSTRAINT "piecework_cover_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- INV-001.
ALTER TABLE "piecework_cover" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "piecework_cover" FORCE ROW LEVEL SECURITY;
CREATE POLICY "piecework_cover_isolation" ON "piecework_cover"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

INSERT INTO "entity_definition" (key, capability, class, table_name, tenant_scoped) VALUES
  ('verity.piecework.cover', 'verity.capability.piecework', 'Persistent', 'piecework_cover', true)
ON CONFLICT (key) DO NOTHING;

UPDATE "capability_definition"
   SET entity_types = entity_types || ARRAY['verity.piecework.cover'], updated_at = now()
 WHERE id = 'verity.capability.piecework'
   AND NOT ('verity.piecework.cover' = ANY(entity_types));