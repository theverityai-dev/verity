-- Task 129 A2: let the application role ask which migrations the database has applied.
--
-- WHY: Vercel deploys every push to main, and `npm run build` only runs `prisma generate`. A commit whose migration had not
-- reached production went live anyway on 2026-10-20 and every read of a whole membership row failed on a missing column.
-- The production build now asserts (scripts/assert-migrations-applied.mjs) that every migration in the commit is applied,
-- and fails the deploy otherwise, so the previous deployment stays live.
--
-- WHY A FUNCTION: the runtime role has no privilege on public._prisma_migrations, deliberately (see 20261001000000 and the
-- CI grant step). This definer function exposes exactly the migration names and nothing else, so that guarantee is unchanged.
-- Additive: nothing existing is altered.

CREATE OR REPLACE FUNCTION verity.applied_migration_names()
 RETURNS SETOF text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'verity', 'pg_temp'
AS $function$
  SELECT m.migration_name
  FROM public._prisma_migrations m
  WHERE m.finished_at IS NOT NULL
    AND m.rolled_back_at IS NULL
$function$;

REVOKE ALL ON FUNCTION verity.applied_migration_names() FROM PUBLIC;

DO $acl$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'verity_app') THEN
    GRANT EXECUTE ON FUNCTION verity.applied_migration_names() TO verity_app;
  END IF;
END
$acl$;
