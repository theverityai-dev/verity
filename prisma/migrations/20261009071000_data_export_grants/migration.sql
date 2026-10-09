-- ADR-037: existing tenant administrators receive Read and Export on their own
-- data export. A separate migration from the one that adds the Export verb,
-- because a new enum value cannot be used in the transaction that creates it.
-- The operator's support role is excluded by name: the operator never exports a
-- client's data (ADR-037 clause 3), even though that role can edit roles.

DO $$ DECLARE target_tenant_id uuid; BEGIN
  FOR target_tenant_id IN SELECT id FROM public.tenant WHERE NOT is_platform LOOP
    PERFORM set_config('verity.tenant_id', target_tenant_id::text, true);
    INSERT INTO public.permission (id, tenant_id, role_id, verb, entity, scope)
    SELECT gen_random_uuid(), r.tenant_id, r.id, v.verb::"PermissionVerb", 'verity.platform.data_export', 'Tenant'
      FROM public.role r
      CROSS JOIN (VALUES ('Read'), ('Export')) v(verb)
      WHERE r.tenant_id = target_tenant_id
        AND r.name <> 'Verity Operator'
        AND EXISTS (
          SELECT 1 FROM verity.resolve_permissions(r.id) p
          WHERE p.entity = 'verity.platform.role' AND p.verb = 'Edit' AND p.scope = 'Tenant')
    ON CONFLICT (role_id, verb, entity, scope) DO NOTHING;
  END LOOP;
END $$;
