-- Task 128 stages 3 and 4: merging duplicates, stage playbooks, opening a job from a won deal, and the permission
-- to declare custom fields. Additive only: new nullable columns, a default, indexes and grants.

-- A duplicate is merged, never deleted: it points at the record it was merged into, stays archived, and its
-- immutable interactions keep pointing at it; the survivor's timeline reads both. Composite keys keep both within
-- one tenant (INV-001).
ALTER TABLE "relationship_company" ADD COLUMN "merged_into_id" UUID;
ALTER TABLE "relationship_company" ADD CONSTRAINT "relationship_company_tenant_id_merged_into_id_fkey"
  FOREIGN KEY ("tenant_id", "merged_into_id") REFERENCES "relationship_company"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "relationship_company" ADD CONSTRAINT "relationship_company_not_self_merged" CHECK ("merged_into_id" IS NULL OR "merged_into_id" <> "id");
CREATE INDEX "relationship_company_tenant_id_merged_into_id_idx" ON "relationship_company"("tenant_id", "merged_into_id");

ALTER TABLE "relationship_person" ADD COLUMN "merged_into_id" UUID;
ALTER TABLE "relationship_person" ADD CONSTRAINT "relationship_person_tenant_id_merged_into_id_fkey"
  FOREIGN KEY ("tenant_id", "merged_into_id") REFERENCES "relationship_person"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "relationship_person" ADD CONSTRAINT "relationship_person_not_self_merged" CHECK ("merged_into_id" IS NULL OR "merged_into_id" <> "id");
CREATE INDEX "relationship_person_tenant_id_merged_into_id_idx" ON "relationship_person"("tenant_id", "merged_into_id");

-- A stage's playbook: follow-ups to plan and whether to tell the owner when a deal enters it.
ALTER TABLE "relationship_stage" ADD COLUMN "config" JSONB NOT NULL DEFAULT '{}';

-- The won opportunity a job was opened from. A keyed reference, not a foreign key: jobs never need the CRM active.
-- At most one job per opportunity.
ALTER TABLE "project_job" ADD COLUMN "opportunity_id" UUID;
CREATE INDEX "project_job_tenant_id_opportunity_id_idx" ON "project_job"("tenant_id", "opportunity_id");
CREATE UNIQUE INDEX "project_job_one_per_opportunity" ON "project_job"("tenant_id", "opportunity_id") WHERE "opportunity_id" IS NOT NULL;

-- Declaring custom fields (PLA-EXT-002) is administration: roles that can edit roles may do it.
DO $$ DECLARE target_tenant_id uuid; BEGIN
  FOR target_tenant_id IN SELECT id FROM public.tenant WHERE NOT is_platform LOOP
    PERFORM set_config('verity.tenant_id', target_tenant_id::text, true);
    INSERT INTO public.permission (id, tenant_id, role_id, verb, entity, scope)
    SELECT gen_random_uuid(), r.tenant_id, r.id, 'Edit'::"PermissionVerb", 'verity.platform.custom_field', 'Tenant'
      FROM public.role r
     WHERE r.tenant_id = target_tenant_id AND r.name <> 'Verity Operator'
       AND EXISTS (SELECT 1 FROM verity.resolve_permissions(r.id) p
                    WHERE p.entity = 'verity.platform.role' AND p.verb = 'Edit' AND p.scope = 'Tenant')
    ON CONFLICT (role_id, verb, entity, scope) DO NOTHING;
  END LOOP;
END $$;
