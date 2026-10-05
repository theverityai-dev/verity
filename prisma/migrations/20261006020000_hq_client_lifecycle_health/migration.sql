-- ---------------------------------------------------------------------------
-- ADR-034: client lifecycle and operational health for HQ (accepted 2026-10-06)
-- ---------------------------------------------------------------------------
-- 1. A client has a lifecycle: onboarding | active | suspended. Suspension never
--    alters tenant data; it stops the client's own users from acting
--    (enforced where the session resolves to a membership, application side)
--    while an operator can still enter to inspect.
-- 2. The status column changes only through the operator action, which sets a
--    transaction-local flag. A tenant user's own scope can update its tenant
--    row (tenant_isolation is FOR ALL), so without this guard any future
--    command that writes the tenant row could lift its own suspension.
-- 3. Health is four more COUNT columns on the existing platform-activity
--    projection (projection 2 of 3, ADR-013), not a fourth projection. Counts
--    only, fixed columns, STABLE, operator-gated, invocation logged.
-- ---------------------------------------------------------------------------

ALTER TABLE "tenant"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN "status_reason" TEXT,
  ADD COLUMN "status_changed_at" TIMESTAMP(3);

ALTER TABLE "tenant"
  ADD CONSTRAINT "tenant_status_check" CHECK ("status" IN ('onboarding', 'active', 'suspended'));

CREATE OR REPLACE FUNCTION verity.guard_tenant_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND coalesce(current_setting('verity.client_status_change', true), '') <> 'on' THEN
    RAISE EXCEPTION 'a client''s status changes only through the HQ operator action'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "tenant_status_guard"
  BEFORE UPDATE OF "status" ON "tenant"
  FOR EACH ROW EXECUTE FUNCTION verity.guard_tenant_status();

-- Projection 1 — client directory, now with the lifecycle state. ------------------
DROP FUNCTION IF EXISTS verity.operator_client_directory(UUID);

CREATE FUNCTION verity.operator_client_directory(p_auth_user_id UUID)
RETURNS TABLE (
  tenant_id     UUID,
  name          TEXT,
  time_zone     TEXT,
  created_at    TIMESTAMP(3),
  member_count  BIGINT,
  org_count     BIGINT,
  status        TEXT,
  status_reason TEXT
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

  RAISE LOG 'verity.operator_client_directory invoked by auth user %', p_auth_user_id;

  RETURN QUERY
    SELECT t.id, t.name, t.time_zone, t.created_at,
           (SELECT count(*) FROM tenant_membership m WHERE m.tenant_id = t.id),
           (SELECT count(*) FROM organization o WHERE o.tenant_id = t.id),
           t.status, t.status_reason
    FROM tenant t
    WHERE NOT t.is_platform
    ORDER BY t.name;
END;
$$;

COMMENT ON FUNCTION verity.operator_client_directory IS
  'Cross-tenant projection 1 of 3 (ADR-013, ADR-034). Client metadata, lifecycle state and counts only — never client business rows. Returns nothing for a non-operator.';

-- Projection 2 — platform activity, now with health counts. ----------------------
DROP FUNCTION IF EXISTS verity.operator_platform_activity(UUID);

CREATE FUNCTION verity.operator_platform_activity(p_auth_user_id UUID)
RETURNS TABLE (
  tenant_id           UUID,
  name                TEXT,
  activity_30d        BIGINT,
  security_events_30d BIGINT,
  last_activity_at    TIMESTAMP(3),
  undelivered_events  BIGINT,
  sync_exceptions     BIGINT,
  sla_breached        BIGINT,
  people_invited      BIGINT
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

  RAISE LOG 'verity.operator_platform_activity invoked by auth user %', p_auth_user_id;

  RETURN QUERY
    SELECT t.id, t.name,
           (SELECT count(*) FROM activity a
             WHERE a.tenant_id = t.id AND a.occurred_at > now() - interval '30 days'),
           (SELECT count(*) FROM security_audit_event s
             WHERE s.tenant_id = t.id AND s.occurred_at > now() - interval '30 days'),
           (SELECT max(a.occurred_at) FROM activity a WHERE a.tenant_id = t.id),
           (SELECT count(*) FROM domain_event e WHERE e.tenant_id = t.id AND e.delivered_at IS NULL),
           (SELECT count(*) FROM sync_exception x WHERE x.tenant_id = t.id AND x.resolved_at IS NULL),
           (SELECT count(*) FROM sla_clock c WHERE c.tenant_id = t.id AND c.status = 'Breached'),
           (SELECT count(*) FROM tenant_membership m
              JOIN "user" u ON u.id = m.user_id
              JOIN party p ON p.id = u.party_id
             WHERE m.tenant_id = t.id AND p.state = 'Invited')
    FROM tenant t
    WHERE NOT t.is_platform
    ORDER BY t.name;
END;
$$;

COMMENT ON FUNCTION verity.operator_platform_activity IS
  'Cross-tenant projection 2 of 3 (ADR-013, ADR-034). Per-client counts for the operational and needs-attention views. No payloads, no business rows.';

-- Membership resolution carries the client's lifecycle so a suspended client's
-- users resolve to no actor (fail closed), while operators still can.
DROP FUNCTION IF EXISTS verity.memberships_for_auth_user(UUID);

CREATE FUNCTION verity.memberships_for_auth_user(p_auth_user_id UUID)
RETURNS TABLE (
  membership_id     UUID,
  user_id           UUID,
  tenant_id         UUID,
  tenant_name       TEXT,
  is_platform       BOOLEAN,
  organization_id   UUID,
  organization_name TEXT,
  role_id           UUID,
  role_name         TEXT,
  tenant_status     TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, verity, pg_temp
AS $$
  SELECT m.id, u.id, t.id, t.name, t.is_platform, o.id, o.name, r.id, r.name, t.status
  FROM "user" u
  JOIN tenant_membership m ON m.user_id = u.id
  JOIN tenant t            ON t.id = m.tenant_id
  JOIN organization o      ON o.id = m.organization_id
  LEFT JOIN role r         ON r.id = m.role_id
  WHERE u.auth_user_id = p_auth_user_id
  ORDER BY t.name, o.name;
$$;

COMMENT ON FUNCTION verity.memberships_for_auth_user IS
  'Memberships held by one authenticated principal, for actor resolution before a tenant context exists. Keyed on the Supabase auth user id so it can only return that principal''s own memberships. Includes is_platform so sign-in can route an operator to /hq, and tenant_status so a suspended client resolves to no actor for its own users (ADR-034).';

GRANT EXECUTE ON FUNCTION verity.operator_client_directory(UUID) TO PUBLIC;
GRANT EXECUTE ON FUNCTION verity.operator_platform_activity(UUID) TO PUBLIC;
GRANT EXECUTE ON FUNCTION verity.memberships_for_auth_user(UUID) TO PUBLIC;
