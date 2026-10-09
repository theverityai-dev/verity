-- ---------------------------------------------------------------------------
-- ADR-036: failed commands are recorded as metadata, and HQ reads only totals
-- ---------------------------------------------------------------------------
-- A command that throws is rolled back and, until now, left no row anywhere, so
-- there was no list of failures in any tenant. This records the failure after the
-- rollback, in its own transaction: which command, which error code, who, over
-- which channel, and the request's correlation id. NEVER the input payload and
-- NEVER the message text, either of which can carry a guest's name or a figure.
--
-- The client reads its own rows through the ordinary RLS-scoped path. HQ reads
-- only totals, through one SECURITY DEFINER function that returns counts and
-- times and no row id, no user id and no free text (the shape of ADR-034's
-- health columns). Append-only, like the other audit tables.

CREATE TABLE "command_failure" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "command_key" TEXT NOT NULL,
    "error_code" TEXT NOT NULL,
    "actor_user_id" UUID,
    "channel" TEXT,
    "correlation_id" UUID,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "command_failure_pkey" PRIMARY KEY ("id"),
    -- A code, not a sentence: this is what keeps message text out of the table.
    CONSTRAINT "command_failure_code_shape" CHECK ("error_code" ~ '^E_[A-Z_]{1,60}$')
);

CREATE INDEX "command_failure_tenant_id_occurred_at_idx" ON "command_failure"("tenant_id", "occurred_at");
CREATE INDEX "command_failure_tenant_id_command_key_idx" ON "command_failure"("tenant_id", "command_key");

ALTER TABLE "command_failure" ADD CONSTRAINT "command_failure_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "command_failure" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "command_failure" FORCE ROW LEVEL SECURITY;
CREATE POLICY "command_failure_read" ON "command_failure"
  FOR SELECT USING ("tenant_id" = verity.current_tenant_id());
CREATE POLICY "command_failure_append" ON "command_failure"
  FOR INSERT WITH CHECK ("tenant_id" = verity.current_tenant_id());
CREATE TRIGGER "command_failure_append_only"
  BEFORE UPDATE OR DELETE ON "command_failure"
  FOR EACH ROW EXECUTE FUNCTION verity.reject_mutation();

-- The HQ projection: totals per client, command and code over a window. ---------
CREATE FUNCTION verity.operator_command_failures(p_auth_user_id UUID, p_days INT)
RETURNS TABLE (
  tenant_id     UUID,
  name          TEXT,
  command_key   TEXT,
  error_code    TEXT,
  expected      BOOLEAN,
  failures      BIGINT,
  worst_user    BIGINT,
  last_at       TIMESTAMP(3)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, verity, pg_temp
AS $$
BEGIN
  IF NOT verity.is_platform_operator(p_auth_user_id) THEN
    RETURN;
  END IF;

  RAISE LOG 'verity.operator_command_failures invoked by auth user %', p_auth_user_id;

  RETURN QUERY
    WITH windowed AS (
      SELECT f.* FROM command_failure f
       WHERE f.occurred_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 90)))
    ),
    per_user AS (
      SELECT w.tenant_id, w.command_key, w.error_code, w.actor_user_id, count(*) AS n
        FROM windowed w GROUP BY w.tenant_id, w.command_key, w.error_code, w.actor_user_id
    )
    SELECT t.id, t.name, w.command_key, w.error_code,
           (w.error_code IN ('E_VALIDATION', 'E_FORBIDDEN')) AS expected,
           count(*)::bigint AS failures,
           -- The most failures any one person had on this command: a number, never who.
           (SELECT max(p.n) FROM per_user p
             WHERE p.tenant_id = w.tenant_id AND p.command_key = w.command_key AND p.error_code = w.error_code)::bigint,
           max(w.occurred_at)
      FROM windowed w
      JOIN tenant t ON t.id = w.tenant_id
     WHERE NOT t.is_platform
     GROUP BY t.id, t.name, w.tenant_id, w.command_key, w.error_code
     ORDER BY t.name, w.command_key, w.error_code;
END;
$$;

COMMENT ON FUNCTION verity.operator_command_failures IS
  'Cross-tenant read authorised by ADR-036. Per client, command and error code: counts and the latest time only. No row id, no user id, no payload, no message text. Returns nothing for a non-operator.';

REVOKE ALL ON FUNCTION verity.operator_command_failures(UUID, INT) FROM PUBLIC;
DO $acl$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'verity_app') THEN
    GRANT EXECUTE ON FUNCTION verity.operator_command_failures(UUID, INT) TO verity_app;
  END IF;
END
$acl$;

-- Existing tenant administrators may read their own failures (the new entity
-- verity.platform.command_failure), the same way they read the security stream.
DO $$ DECLARE target_tenant_id uuid; BEGIN
  FOR target_tenant_id IN SELECT id FROM public.tenant LOOP
    PERFORM set_config('verity.tenant_id', target_tenant_id::text, true);
    INSERT INTO public.permission (id, tenant_id, role_id, verb, entity, scope)
    SELECT gen_random_uuid(), r.tenant_id, r.id, 'Read', 'verity.platform.command_failure', 'Tenant'
      FROM public.role r
      WHERE r.tenant_id = target_tenant_id AND EXISTS (
        SELECT 1 FROM verity.resolve_permissions(r.id) p
        WHERE p.entity = 'verity.platform.role' AND p.verb = 'Edit' AND p.scope = 'Tenant')
    ON CONFLICT (role_id, verb, entity, scope) DO NOTHING;
  END LOOP;
END $$;
