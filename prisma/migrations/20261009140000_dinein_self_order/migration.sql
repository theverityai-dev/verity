-- ---------------------------------------------------------------------------
-- Customer self-order (ADR-042; Task 126 Wave 5). Dark until an outlet turns it on.
-- ---------------------------------------------------------------------------
-- A guest is not an identity. A sticker holds a link; opening it on a seated table starts
-- a short-lived SESSION; what the guest submits is a PROPOSAL staff accept (or is applied
-- at once to an order already with the kitchen). The unauthenticated routes reach data
-- only through the two SECURITY DEFINER functions below, which take a hash and return the
-- minimum; row-level security stays in force everywhere else (the ADR-030 pattern).

ALTER TABLE "outlet_profile"
  ADD COLUMN "self_order_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "self_order_user_id" UUID;

-- Links ------------------------------------------------------------------------------
CREATE TABLE "self_order_link" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "table_id" UUID,
    "kind" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    CONSTRAINT "self_order_link_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "self_order_link_kind_known" CHECK ("kind" IN ('table','pickup')),
    CONSTRAINT "self_order_link_table_iff_table_kind" CHECK (("kind" = 'table') = ("table_id" IS NOT NULL))
);
CREATE UNIQUE INDEX "self_order_link_token_hash_key" ON "self_order_link"("token_hash");
CREATE UNIQUE INDEX "self_order_link_one_live_table" ON "self_order_link"("tenant_id", "table_id") WHERE "revoked_at" IS NULL AND "kind" = 'table';
CREATE UNIQUE INDEX "self_order_link_one_live_pickup" ON "self_order_link"("tenant_id", "location_id") WHERE "revoked_at" IS NULL AND "kind" = 'pickup';
CREATE INDEX "self_order_link_tenant_id_location_id_idx" ON "self_order_link"("tenant_id", "location_id");
ALTER TABLE "self_order_link" ADD CONSTRAINT "self_order_link_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "self_order_link" ADD CONSTRAINT "self_order_link_location_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "location"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "self_order_link" ADD CONSTRAINT "self_order_link_table_fkey" FOREIGN KEY ("tenant_id", "table_id") REFERENCES "dining_table"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Sessions ---------------------------------------------------------------------------
CREATE TABLE "self_order_session" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "table_id" UUID,
    "kind" TEXT NOT NULL,
    "link_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    CONSTRAINT "self_order_session_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "self_order_session_kind_known" CHECK ("kind" IN ('table','pickup')),
    CONSTRAINT "self_order_session_hash_shape" CHECK (length("token_hash") = 64)
);
CREATE UNIQUE INDEX "self_order_session_token_hash_key" ON "self_order_session"("token_hash");
CREATE UNIQUE INDEX "self_order_session_tenant_scoped_id" ON "self_order_session"("tenant_id", "id");
CREATE INDEX "self_order_session_tenant_id_location_id_closed_at_idx" ON "self_order_session"("tenant_id", "location_id", "closed_at");
ALTER TABLE "self_order_session" ADD CONSTRAINT "self_order_session_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "self_order_session" ADD CONSTRAINT "self_order_session_location_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "location"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "self_order_session" ADD CONSTRAINT "self_order_session_table_fkey" FOREIGN KEY ("tenant_id", "table_id") REFERENCES "dining_table"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Submissions --------------------------------------------------------------------------
CREATE TABLE "self_order_submission" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "table_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "customer_name" TEXT,
    "customer_phone" TEXT,
    "auto_applied" BOOLEAN NOT NULL DEFAULT false,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "decided_by_user_id" UUID,
    "reject_reason" TEXT,
    "order_id" UUID,
    CONSTRAINT "self_order_submission_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "self_order_submission_status_known" CHECK ("status" IN ('pending','accepted','rejected'))
);
CREATE UNIQUE INDEX "self_order_submission_tenant_scoped_id" ON "self_order_submission"("tenant_id", "id");
CREATE UNIQUE INDEX "self_order_submission_once" ON "self_order_submission"("session_id", "idempotency_key");
CREATE INDEX "self_order_submission_tenant_id_location_id_status_idx" ON "self_order_submission"("tenant_id", "location_id", "status");
ALTER TABLE "self_order_submission" ADD CONSTRAINT "self_order_submission_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "self_order_submission" ADD CONSTRAINT "self_order_submission_session_fkey" FOREIGN KEY ("tenant_id", "session_id") REFERENCES "self_order_session"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "self_order_submission" ADD CONSTRAINT "self_order_submission_location_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "location"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE TABLE "self_order_submission_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "variant_id" UUID,
    "qty" INTEGER NOT NULL,
    "line_note" TEXT,
    "modifier_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    CONSTRAINT "self_order_submission_line_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "self_order_submission_line_qty_range" CHECK ("qty" BETWEEN 1 AND 20)
);
CREATE INDEX "self_order_submission_line_tenant_id_submission_id_idx" ON "self_order_submission_line"("tenant_id", "submission_id");
ALTER TABLE "self_order_submission_line" ADD CONSTRAINT "self_order_submission_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "self_order_submission_line" ADD CONSTRAINT "self_order_submission_line_submission_fkey" FOREIGN KEY ("tenant_id", "submission_id") REFERENCES "self_order_submission"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Service requests ----------------------------------------------------------------------
CREATE TABLE "service_request" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "table_id" UUID,
    "session_id" UUID,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_user_id" UUID,
    CONSTRAINT "service_request_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "service_request_kind_known" CHECK ("kind" IN ('waiter','bill')),
    CONSTRAINT "service_request_status_known" CHECK ("status" IN ('open','acknowledged','resolved'))
);
CREATE INDEX "service_request_tenant_id_location_id_status_idx" ON "service_request"("tenant_id", "location_id", "status");
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_location_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "location"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_table_fkey" FOREIGN KEY ("tenant_id", "table_id") REFERENCES "dining_table"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_session_fkey" FOREIGN KEY ("tenant_id", "session_id") REFERENCES "self_order_session"("tenant_id", "id") ON DELETE SET NULL ("session_id") ON UPDATE NO ACTION;

-- Row-level security: tenant isolation on every table ------------------------------------
ALTER TABLE "self_order_link" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "self_order_link" FORCE ROW LEVEL SECURITY;
CREATE POLICY "self_order_link_isolation" ON "self_order_link"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());
ALTER TABLE "self_order_session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "self_order_session" FORCE ROW LEVEL SECURITY;
CREATE POLICY "self_order_session_isolation" ON "self_order_session"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());
ALTER TABLE "self_order_submission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "self_order_submission" FORCE ROW LEVEL SECURITY;
CREATE POLICY "self_order_submission_isolation" ON "self_order_submission"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());
ALTER TABLE "self_order_submission_line" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "self_order_submission_line" FORCE ROW LEVEL SECURITY;
CREATE POLICY "self_order_submission_line_isolation" ON "self_order_submission_line"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());
ALTER TABLE "service_request" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_request" FORCE ROW LEVEL SECURITY;
CREATE POLICY "service_request_isolation" ON "service_request"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

-- Entities the guest's narrow role is granted on -------------------------------------------
INSERT INTO "entity_definition" (key, capability, class, table_name, tenant_scoped) VALUES
  ('verity.dinein.self_order_submission', 'verity.capability.dinein', 'Persistent', 'self_order_submission', true),
  ('verity.dinein.service_request', 'verity.capability.dinein', 'Persistent', 'service_request', true)
ON CONFLICT (key) DO NOTHING;

UPDATE "capability_definition"
   SET entity_types = entity_types || ARRAY['verity.dinein.self_order_submission','verity.dinein.service_request']
         ::text[], updated_at = now()
 WHERE id = 'verity.capability.dinein'
   AND NOT ('verity.dinein.self_order_submission' = ANY(entity_types));

-- The two ways the unauthenticated routes touch the database (ADR-042 items 2 to 4). ---------
-- Each takes hashes, never a tenant id; each returns the least that lets the route act.
-- A wrong, expired, closed or disabled answer is the same null/empty, so nothing can be
-- told apart from outside.

-- Opens a session from a sticker's link hash. The link must be live, the outlet must have
-- turned self-order on, and for a table the table must be seated right now: a photographed
-- sticker cannot order at an empty table.
CREATE OR REPLACE FUNCTION verity.self_order_open_session(p_link_hash TEXT, p_session_hash TEXT)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, verity, pg_temp
AS $$
DECLARE
  l self_order_link%ROWTYPE;
  sid UUID;
BEGIN
  IF p_session_hash IS NULL OR length(p_session_hash) <> 64 THEN RETURN NULL; END IF;
  SELECT * INTO l FROM self_order_link WHERE token_hash = p_link_hash AND revoked_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM outlet_profile op
     WHERE op.tenant_id = l.tenant_id AND op.location_id = l.location_id
       AND op.self_order_enabled AND op.self_order_user_id IS NOT NULL
  ) THEN RETURN NULL; END IF;
  IF l.kind = 'table' AND NOT EXISTS (
    SELECT 1 FROM dining_table t WHERE t.tenant_id = l.tenant_id AND t.id = l.table_id AND t.state = 'occupied'
  ) THEN RETURN NULL; END IF;
  INSERT INTO self_order_session (id, tenant_id, location_id, table_id, kind, link_id, token_hash, expires_at)
  VALUES (gen_random_uuid(), l.tenant_id, l.location_id, l.table_id, l.kind, l.id, p_session_hash, now() + interval '3 hours')
  RETURNING id INTO sid;
  RETURN sid;
END
$$;

-- Resolves a session token to the tenant, outlet, table and the provisioned ordering identity,
-- and counts the visit as activity. Idle 30 minutes, absolute 3 hours, closed, a disabled
-- outlet, or a table no longer seated: all return nothing.
CREATE OR REPLACE FUNCTION verity.self_order_resolve(p_session_hash TEXT)
RETURNS TABLE (o_tenant_id UUID, o_session_id UUID, o_location_id UUID, o_table_id UUID, o_kind TEXT, o_ordering_user_id UUID)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, verity, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  UPDATE self_order_session s
     SET last_activity_at = now()
    FROM outlet_profile op
   WHERE s.token_hash = p_session_hash
     AND s.closed_at IS NULL
     AND s.expires_at > now()
     AND s.last_activity_at > now() - interval '30 minutes'
     AND op.tenant_id = s.tenant_id AND op.location_id = s.location_id
     AND op.self_order_enabled AND op.self_order_user_id IS NOT NULL
     AND (s.kind = 'pickup' OR EXISTS (
           SELECT 1 FROM dining_table t WHERE t.tenant_id = s.tenant_id AND t.id = s.table_id AND t.state = 'occupied'))
  RETURNING s.tenant_id, s.id, s.location_id, s.table_id, s.kind, op.self_order_user_id;
END
$$;

REVOKE ALL ON FUNCTION verity.self_order_open_session(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION verity.self_order_resolve(TEXT) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'verity_app') THEN
    GRANT EXECUTE ON FUNCTION verity.self_order_open_session(TEXT, TEXT) TO verity_app;
    GRANT EXECUTE ON FUNCTION verity.self_order_resolve(TEXT) TO verity_app;
  END IF;
END $$;
