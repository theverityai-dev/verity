-- ---------------------------------------------------------------------------
-- Restore the SECURITY DEFINER ACL for the functions ADR-034 recreated.
-- ---------------------------------------------------------------------------
-- 20261006020000_hq_client_lifecycle_health dropped and recreated three
-- SECURITY DEFINER functions and granted EXECUTE to PUBLIC, which undid
-- 20260916070000_security_definer_acl_hardening for them (CI's "not public
-- executable" check caught it). Same treatment as that migration: nothing in
-- PUBLIC, the runtime role only. Idempotent.

REVOKE ALL ON FUNCTION verity.operator_client_directory(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION verity.operator_platform_activity(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION verity.memberships_for_auth_user(UUID) FROM PUBLIC;

DO $acl$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'verity_app') THEN
    GRANT EXECUTE ON FUNCTION verity.operator_client_directory(UUID) TO verity_app;
    GRANT EXECUTE ON FUNCTION verity.operator_platform_activity(UUID) TO verity_app;
    GRANT EXECUTE ON FUNCTION verity.memberships_for_auth_user(UUID) TO verity_app;
  END IF;
END
$acl$;
