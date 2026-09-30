-- ADR-030: public verification passport for a completed, inspected order.

CREATE TABLE "manufacturing_passport" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "issued_by_id" UUID,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "revoked_by_id" UUID,
    CONSTRAINT "manufacturing_passport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "manufacturing_passport_token_hash_key" ON "manufacturing_passport"("token_hash");
CREATE INDEX "manufacturing_passport_tenant_id_order_id_idx" ON "manufacturing_passport"("tenant_id", "order_id");
-- One ACTIVE passport per order. A recall is a revocation followed by a new issue.
CREATE UNIQUE INDEX "manufacturing_passport_one_active_per_order"
  ON "manufacturing_passport"("order_id") WHERE "revoked_at" IS NULL;

ALTER TABLE "manufacturing_passport" ADD CONSTRAINT "manufacturing_passport_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manufacturing_passport" ADD CONSTRAINT "manufacturing_passport_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "manufacturing_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- INV-001. The table is tenant-scoped like every other; the PUBLIC path does not
-- read it through policies but through the one function below.
ALTER TABLE "manufacturing_passport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "manufacturing_passport" FORCE ROW LEVEL SECURITY;
CREATE POLICY "manufacturing_passport_isolation" ON "manufacturing_passport"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

INSERT INTO "entity_definition" (key, capability, class, table_name, tenant_scoped) VALUES
  ('verity.manufacturing.passport', 'verity.capability.manufacturing', 'Persistent', 'manufacturing_passport', true)
ON CONFLICT (key) DO NOTHING;

UPDATE "capability_definition"
   SET entity_types = array_append(entity_types, 'verity.manufacturing.passport'), updated_at = now()
 WHERE id = 'verity.capability.manufacturing'
   AND NOT ('verity.manufacturing.passport' = ANY(entity_types));

-- The ONE way the unauthenticated route reads anything (ADR-030 constraint 4).
-- It takes a token hash and returns only the frozen snapshot of an ACTIVE
-- passport; it is a lookup, never a list, so it cannot enumerate passports, and
-- it exposes no other table, column or tenant. A wrong token and a revoked token
-- both return NULL.
CREATE OR REPLACE FUNCTION verity.passport_lookup(p_token_hash TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, verity, pg_temp
AS $$
  SELECT p.snapshot
  FROM manufacturing_passport p
  WHERE p.token_hash = p_token_hash AND p.revoked_at IS NULL
$$;

REVOKE ALL ON FUNCTION verity.passport_lookup(TEXT) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'verity_app') THEN
    GRANT EXECUTE ON FUNCTION verity.passport_lookup(TEXT) TO verity_app;
  END IF;
END $$;
