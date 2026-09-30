-- ADR-029 / Task 120: machine credentials and idempotency for the external
-- tool-invocation surface.

-- CreateTable
CREATE TABLE "external_api_key" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "key_id" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_api_key_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "external_api_key_key_id_key" ON "external_api_key"("key_id");
CREATE INDEX "external_api_key_tenant_id_idx" ON "external_api_key"("tenant_id");
CREATE INDEX "external_api_key_membership_id_idx" ON "external_api_key"("membership_id");

ALTER TABLE "external_api_key" ADD CONSTRAINT "external_api_key_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "external_api_key" ADD CONSTRAINT "external_api_key_membership_id_fkey"
  FOREIGN KEY ("membership_id") REFERENCES "tenant_membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "external_idempotency" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_idempotency_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "external_idempotency_tenant_id_key_id_idempotency_key_key"
  ON "external_idempotency"("tenant_id", "key_id", "idempotency_key");

ALTER TABLE "external_idempotency" ADD CONSTRAINT "external_idempotency_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- INV-001: both tables are tenant-scoped, same policy shape as every other one.
ALTER TABLE "external_api_key" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "external_api_key" FORCE ROW LEVEL SECURITY;
CREATE POLICY "external_api_key_isolation" ON "external_api_key"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

ALTER TABLE "external_idempotency" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "external_idempotency" FORCE ROW LEVEL SECURITY;
CREATE POLICY "external_idempotency_isolation" ON "external_idempotency"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

-- The one lookup that must run BEFORE a tenant is known: the key row is what
-- names the tenant (PLA-TEN-006), so an ordinary RLS read of it returns nothing
-- by design. This SECURITY DEFINER function is the deliberate, narrow exception:
-- it takes a key id and returns only what authentication needs about that one
-- key, and exposes nothing else. It is a lookup, never a list, so it cannot be
-- used to enumerate keys.
CREATE OR REPLACE FUNCTION verity.authenticate_api_key(p_key_id TEXT)
RETURNS TABLE (
  tenant_id UUID,
  user_id UUID,
  membership_id UUID,
  organization_id UUID,
  role_id UUID,
  secret_hash TEXT,
  expires_at TIMESTAMP,
  revoked_at TIMESTAMP
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, verity, pg_temp
AS $$
  SELECT k.tenant_id, m.user_id, m.id, m.organization_id, m.role_id,
         k.secret_hash, k.expires_at, k.revoked_at
  FROM external_api_key k
  JOIN tenant_membership m ON m.id = k.membership_id
  WHERE k.key_id = p_key_id
$$;

REVOKE ALL ON FUNCTION verity.authenticate_api_key(TEXT) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'verity_app') THEN
    GRANT EXECUTE ON FUNCTION verity.authenticate_api_key(TEXT) TO verity_app;
  END IF;
END $$;
