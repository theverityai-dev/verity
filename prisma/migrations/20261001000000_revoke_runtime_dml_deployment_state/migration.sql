-- Make the runtime role read-only on deployment_state, as 20260916103000 intended.
--
-- 20260916103000_onprem_scheduler created deployment_state, ran
-- `REVOKE ALL ... FROM PUBLIC` and `GRANT SELECT ... TO verity_app`, evidently
-- meaning the web runtime to be able to read the restore-quarantine flag and
-- nothing more. But 20260826000000_runtime_role_privileges installed
-- `ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES
-- TO verity_app` for every table the migration owner creates afterwards. A
-- later `GRANT SELECT` is additive, so verity_app also kept INSERT, UPDATE and
-- DELETE. Observed 2026-10-01: an UPDATE as verity_app succeeded.
--
-- Why it matters: readiness reports 503 while status is not 'normal'
-- (probeRestoreState), and the restore runbook says never to clear quarantine
-- merely to regain traffic. Only deploy/scripts/restore.sh, connecting as
-- postgres, writes this table; the web runtime only reads it
-- (src/server/platform/readiness.ts). Nothing needs the runtime role to write.
--
-- Same shape as the compensations for _prisma_migrations (20260907000000) and
-- request_quota (20260908000000), which use REVOKE ALL and are effective.
-- Guarded by role existence like those, so a database without the runtime role
-- (a bare shadow database) still migrates. Idempotent.
--
-- SELECT is deliberately left in place.

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'verity_app') THEN
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.deployment_state FROM verity_app;
  END IF;
END $$;
