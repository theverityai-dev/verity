-- ADR-049: a membership can be disabled. A disabled membership authorizes nothing from the next check.
--
-- Additive and nullable: every existing membership stays enabled (disabled_at IS NULL), so there is nothing to backfill.
-- Only rows with disabled_at set behave differently after this migration.
--
-- The three SECURITY DEFINER functions that turn a membership into authority now exclude disabled rows:
--   memberships_for_auth_user  (session / bearer-token path: resolveActor)
--   authenticate_api_key       (a disabled member's API keys stop working)
--   is_platform_operator       (a disabled operator loses HQ, and the operator_* functions that call it)
-- Deliberately unchanged, with the reason recorded here so a reviewer need not rediscover it:
--   party_visible / user_visible  directory visibility inside the caller's current tenant. They grant no authority and need
--                                 the disabled person to stay listed so an administrator can see and restore them. They fail
--                                 closed because current_tenant_id() is only ever set for an actor that passed the checks above.
--   operator_platform_audit.is_operator  historical attribution of past activity; it must not rewrite history.
--   operator_client_directory.member_count / people_invited  counts of people in the client, not authority.
--   provision_identity  inserts new memberships, which are enabled by default.

-- Distinct security-stream types: disable and restore answer different questions than a role change.
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'MembershipDisabled';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'MembershipRestored';

ALTER TABLE tenant_membership ADD COLUMN disabled_at TIMESTAMP(3);

CREATE OR REPLACE FUNCTION verity.memberships_for_auth_user(p_auth_user_id uuid)
 RETURNS TABLE(membership_id uuid, user_id uuid, tenant_id uuid, tenant_name text, is_platform boolean, organization_id uuid, organization_name text, role_id uuid, role_name text, tenant_status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'verity', 'pg_temp'
AS $function$
  SELECT m.id, u.id, t.id, t.name, t.is_platform, o.id, o.name, r.id, r.name, t.status
  FROM "user" u
  JOIN tenant_membership m ON m.user_id = u.id
  JOIN tenant t            ON t.id = m.tenant_id
  JOIN organization o      ON o.id = m.organization_id
  LEFT JOIN role r         ON r.id = m.role_id
  WHERE u.auth_user_id = p_auth_user_id
    AND m.disabled_at IS NULL
  ORDER BY t.name, o.name;
$function$;

CREATE OR REPLACE FUNCTION verity.authenticate_api_key(p_key_id text)
 RETURNS TABLE(tenant_id uuid, user_id uuid, membership_id uuid, organization_id uuid, role_id uuid, secret_hash text, expires_at timestamp without time zone, revoked_at timestamp without time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'verity', 'pg_temp'
AS $function$
  SELECT k.tenant_id, m.user_id, m.id, m.organization_id, m.role_id,
         k.secret_hash, k.expires_at, k.revoked_at
  FROM external_api_key k
  JOIN tenant_membership m ON m.id = k.membership_id
  WHERE k.key_id = p_key_id
    AND m.disabled_at IS NULL
$function$;

CREATE OR REPLACE FUNCTION verity.is_platform_operator(p_auth_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'verity', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM "user" u
    JOIN tenant_membership m ON m.user_id = u.id
    JOIN tenant t            ON t.id = m.tenant_id AND t.is_platform
    WHERE u.auth_user_id = p_auth_user_id
      AND m.disabled_at IS NULL
      AND m.role_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM verity.resolve_permissions(m.role_id) rp
        WHERE rp.verb = 'ActionExecute'
          AND rp.entity = 'verity.platform.operator'
      )
  );
$function$;

-- Re-apply the ACL (same treatment as 20260916070000 and 20261006030000): nothing in PUBLIC, the runtime role only.
REVOKE ALL ON FUNCTION verity.memberships_for_auth_user(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION verity.authenticate_api_key(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION verity.is_platform_operator(UUID) FROM PUBLIC;

DO $acl$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'verity_app') THEN
    GRANT EXECUTE ON FUNCTION verity.memberships_for_auth_user(UUID) TO verity_app;
    GRANT EXECUTE ON FUNCTION verity.authenticate_api_key(TEXT) TO verity_app;
    GRANT EXECUTE ON FUNCTION verity.is_platform_operator(UUID) TO verity_app;
  END IF;
END
$acl$;
