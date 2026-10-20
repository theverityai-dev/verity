-- Capability: relationship (B2B CRM, Task 128) and the platform's saved views (ADR-051).
-- ADR-050: companies and people are tenant-owned rows, not Party rows (party is global; one shared row would let one
-- tenant's edit change another's view). Additive only: new tables, no existing table touched. Every table carries a
-- tenant column with RLS enabled and forced; children reference parents through (tenant_id, id) (INV-001).


-- CreateTable
CREATE TABLE "saved_view" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "visibility" TEXT NOT NULL,
    "owner_user_id" UUID,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_view_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "relationship_stage" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "probability" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "relationship_stage_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "relationship_company" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "industry" TEXT,
    "size_band" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "tax_id" TEXT,
    "address_line" TEXT,
    "city" TEXT,
    "region" TEXT,
    "country" TEXT,
    "postal_code" TEXT,
    "owner_user_id" UUID,
    "source" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "relationship_company_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "relationship_person" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID,
    "given_name" TEXT NOT NULL,
    "family_name" TEXT,
    "job_title" TEXT,
    "emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "phones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "city" TEXT,
    "owner_user_id" UUID,
    "archived_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "relationship_person_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "relationship_opportunity" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "company_id" UUID,
    "contact_id" UUID,
    "owner_user_id" UUID,
    "amount" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "stage_id" UUID NOT NULL,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expected_close_on" DATE,
    "submission_due_on" DATE,
    "source" TEXT,
    "lost_reason" TEXT,
    "lost_note" TEXT,
    "closed_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "relationship_opportunity_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "relationship_note" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID,
    "person_id" UUID,
    "opportunity_id" UUID,
    "body" TEXT NOT NULL,
    "author_user_id" UUID,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "relationship_note_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "relationship_interaction" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID,
    "person_id" UUID,
    "opportunity_id" UUID,
    "kind" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "summary" TEXT,
    "outcome" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "duration_minutes" INTEGER,
    "logged_by_id" UUID,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "relationship_interaction_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "relationship_follow_up" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID,
    "person_id" UUID,
    "opportunity_id" UUID,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "due_at" TIMESTAMP(3),
    "assignee_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'open',
    "done_at" TIMESTAMP(3),
    "done_by_id" UUID,
    "reminded_on" DATE,
    "created_by_id" UUID,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "relationship_follow_up_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE INDEX "saved_view_tenant_id_object_key_idx" ON "saved_view"("tenant_id", "object_key");


-- CreateIndex
CREATE UNIQUE INDEX "relationship_stage_tenant_id_key_key" ON "relationship_stage"("tenant_id", "key");


-- CreateIndex
CREATE UNIQUE INDEX "relationship_stage_tenant_id_id_key" ON "relationship_stage"("tenant_id", "id");


-- CreateIndex
CREATE INDEX "relationship_company_tenant_id_name_idx" ON "relationship_company"("tenant_id", "name");


-- CreateIndex
CREATE INDEX "relationship_company_tenant_id_domain_idx" ON "relationship_company"("tenant_id", "domain");


-- CreateIndex
CREATE UNIQUE INDEX "relationship_company_tenant_id_id_key" ON "relationship_company"("tenant_id", "id");


-- CreateIndex
CREATE INDEX "relationship_person_tenant_id_company_id_idx" ON "relationship_person"("tenant_id", "company_id");


-- CreateIndex
CREATE INDEX "relationship_person_tenant_id_family_name_given_name_idx" ON "relationship_person"("tenant_id", "family_name", "given_name");


-- CreateIndex
CREATE UNIQUE INDEX "relationship_person_tenant_id_id_key" ON "relationship_person"("tenant_id", "id");


-- CreateIndex
CREATE INDEX "relationship_opportunity_tenant_id_stage_id_position_idx" ON "relationship_opportunity"("tenant_id", "stage_id", "position");


-- CreateIndex
CREATE INDEX "relationship_opportunity_tenant_id_company_id_idx" ON "relationship_opportunity"("tenant_id", "company_id");


-- CreateIndex
CREATE UNIQUE INDEX "relationship_opportunity_tenant_id_number_key" ON "relationship_opportunity"("tenant_id", "number");


-- CreateIndex
CREATE UNIQUE INDEX "relationship_opportunity_tenant_id_id_key" ON "relationship_opportunity"("tenant_id", "id");


-- CreateIndex
CREATE INDEX "relationship_note_tenant_id_company_id_idx" ON "relationship_note"("tenant_id", "company_id");


-- CreateIndex
CREATE INDEX "relationship_note_tenant_id_person_id_idx" ON "relationship_note"("tenant_id", "person_id");


-- CreateIndex
CREATE INDEX "relationship_note_tenant_id_opportunity_id_idx" ON "relationship_note"("tenant_id", "opportunity_id");


-- CreateIndex
CREATE INDEX "relationship_interaction_tenant_id_company_id_occurred_at_idx" ON "relationship_interaction"("tenant_id", "company_id", "occurred_at");


-- CreateIndex
CREATE INDEX "relationship_interaction_tenant_id_person_id_occurred_at_idx" ON "relationship_interaction"("tenant_id", "person_id", "occurred_at");


-- CreateIndex
CREATE INDEX "relationship_interaction_tenant_id_opportunity_id_occurred__idx" ON "relationship_interaction"("tenant_id", "opportunity_id", "occurred_at");


-- CreateIndex
CREATE INDEX "relationship_follow_up_tenant_id_assignee_id_status_due_at_idx" ON "relationship_follow_up"("tenant_id", "assignee_id", "status", "due_at");


-- CreateIndex
CREATE INDEX "relationship_follow_up_tenant_id_company_id_idx" ON "relationship_follow_up"("tenant_id", "company_id");


-- CreateIndex
CREATE INDEX "relationship_follow_up_tenant_id_person_id_idx" ON "relationship_follow_up"("tenant_id", "person_id");


-- CreateIndex
CREATE INDEX "relationship_follow_up_tenant_id_opportunity_id_idx" ON "relationship_follow_up"("tenant_id", "opportunity_id");


-- AddForeignKey
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "relationship_stage" ADD CONSTRAINT "relationship_stage_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "relationship_company" ADD CONSTRAINT "relationship_company_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "relationship_person" ADD CONSTRAINT "relationship_person_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "relationship_person" ADD CONSTRAINT "relationship_person_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "relationship_company"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;


-- AddForeignKey
ALTER TABLE "relationship_opportunity" ADD CONSTRAINT "relationship_opportunity_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "relationship_opportunity" ADD CONSTRAINT "relationship_opportunity_tenant_id_stage_id_fkey" FOREIGN KEY ("tenant_id", "stage_id") REFERENCES "relationship_stage"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;


-- AddForeignKey
ALTER TABLE "relationship_opportunity" ADD CONSTRAINT "relationship_opportunity_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "relationship_company"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;


-- AddForeignKey
ALTER TABLE "relationship_opportunity" ADD CONSTRAINT "relationship_opportunity_tenant_id_contact_id_fkey" FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "relationship_person"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;


-- AddForeignKey
ALTER TABLE "relationship_note" ADD CONSTRAINT "relationship_note_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "relationship_note" ADD CONSTRAINT "relationship_note_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "relationship_company"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;


-- AddForeignKey
ALTER TABLE "relationship_note" ADD CONSTRAINT "relationship_note_tenant_id_person_id_fkey" FOREIGN KEY ("tenant_id", "person_id") REFERENCES "relationship_person"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;


-- AddForeignKey
ALTER TABLE "relationship_note" ADD CONSTRAINT "relationship_note_tenant_id_opportunity_id_fkey" FOREIGN KEY ("tenant_id", "opportunity_id") REFERENCES "relationship_opportunity"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;


-- AddForeignKey
ALTER TABLE "relationship_interaction" ADD CONSTRAINT "relationship_interaction_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "relationship_interaction" ADD CONSTRAINT "relationship_interaction_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "relationship_company"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;


-- AddForeignKey
ALTER TABLE "relationship_interaction" ADD CONSTRAINT "relationship_interaction_tenant_id_person_id_fkey" FOREIGN KEY ("tenant_id", "person_id") REFERENCES "relationship_person"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;


-- AddForeignKey
ALTER TABLE "relationship_interaction" ADD CONSTRAINT "relationship_interaction_tenant_id_opportunity_id_fkey" FOREIGN KEY ("tenant_id", "opportunity_id") REFERENCES "relationship_opportunity"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;


-- AddForeignKey
ALTER TABLE "relationship_follow_up" ADD CONSTRAINT "relationship_follow_up_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "relationship_follow_up" ADD CONSTRAINT "relationship_follow_up_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "relationship_company"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;


-- AddForeignKey
ALTER TABLE "relationship_follow_up" ADD CONSTRAINT "relationship_follow_up_tenant_id_person_id_fkey" FOREIGN KEY ("tenant_id", "person_id") REFERENCES "relationship_person"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;


-- AddForeignKey
ALTER TABLE "relationship_follow_up" ADD CONSTRAINT "relationship_follow_up_tenant_id_opportunity_id_fkey" FOREIGN KEY ("tenant_id", "opportunity_id") REFERENCES "relationship_opportunity"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;


-- Saved views (ADR-051).
ALTER TABLE "saved_view"
  ADD CONSTRAINT "saved_view_type" CHECK ("type" IN ('table', 'board')),
  ADD CONSTRAINT "saved_view_visibility" CHECK ("visibility" IN ('personal', 'shared')),
  -- A personal view always has its owner; a shared one never does.
  ADD CONSTRAINT "saved_view_owner" CHECK (("visibility" = 'personal') = ("owner_user_id" IS NOT NULL)),
  ADD CONSTRAINT "saved_view_name" CHECK (length(btrim("name")) BETWEEN 1 AND 80);
-- One default for everyone per object, and one personal default per person per object.
CREATE UNIQUE INDEX "saved_view_one_shared_default" ON "saved_view"("tenant_id", "object_key")
  WHERE "is_default" AND "visibility" = 'shared';
CREATE UNIQUE INDEX "saved_view_one_personal_default" ON "saved_view"("tenant_id", "object_key", "owner_user_id")
  WHERE "is_default" AND "visibility" = 'personal';

-- Relationship rules the commands also enforce, held in the database against any other path.
ALTER TABLE "relationship_stage"
  ADD CONSTRAINT "relationship_stage_category" CHECK ("category" IN ('Active', 'Completed', 'Cancelled')),
  ADD CONSTRAINT "relationship_stage_probability" CHECK ("probability" BETWEEN 0 AND 100),
  ADD CONSTRAINT "relationship_stage_key" CHECK ("key" ~ '^[a-z][a-z0-9_]{0,39}$');
ALTER TABLE "relationship_company"
  ADD CONSTRAINT "relationship_company_name" CHECK (length(btrim("name")) BETWEEN 1 AND 200);
ALTER TABLE "relationship_person"
  ADD CONSTRAINT "relationship_person_name" CHECK (length(btrim("given_name")) BETWEEN 1 AND 100);
ALTER TABLE "relationship_opportunity"
  ADD CONSTRAINT "relationship_opportunity_name" CHECK (length(btrim("name")) BETWEEN 1 AND 200),
  ADD CONSTRAINT "relationship_opportunity_amount" CHECK ("amount" IS NULL OR "amount" >= 0),
  ADD CONSTRAINT "relationship_opportunity_currency" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "relationship_opportunity_number" CHECK ("number" >= 1);
ALTER TABLE "relationship_note"
  ADD CONSTRAINT "relationship_note_target" CHECK (num_nonnulls("company_id", "person_id", "opportunity_id") >= 1),
  ADD CONSTRAINT "relationship_note_body" CHECK (length(btrim("body")) BETWEEN 1 AND 20000);
ALTER TABLE "relationship_interaction"
  ADD CONSTRAINT "relationship_interaction_target" CHECK (num_nonnulls("company_id", "person_id", "opportunity_id") >= 1),
  ADD CONSTRAINT "relationship_interaction_kind" CHECK ("kind" IN ('call', 'meeting', 'visit', 'email', 'message')),
  ADD CONSTRAINT "relationship_interaction_duration" CHECK ("duration_minutes" IS NULL OR "duration_minutes" BETWEEN 0 AND 1440);
ALTER TABLE "relationship_follow_up"
  ADD CONSTRAINT "relationship_follow_up_target" CHECK (num_nonnulls("company_id", "person_id", "opportunity_id") >= 1),
  ADD CONSTRAINT "relationship_follow_up_status" CHECK ("status" IN ('open', 'done')),
  ADD CONSTRAINT "relationship_follow_up_done" CHECK (("status" = 'done') = ("done_at" IS NOT NULL));

-- INV-001: tenant isolation.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['saved_view', 'relationship_stage', 'relationship_company', 'relationship_person',
                           'relationship_opportunity', 'relationship_note', 'relationship_interaction',
                           'relationship_follow_up'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = verity.current_tenant_id()) WITH CHECK (tenant_id = verity.current_tenant_id())',
      t || '_isolation', t);
  END LOOP;
END $$;

-- An interaction is a record of something that happened: it is never rewritten or deleted, only archived.
CREATE OR REPLACE FUNCTION verity.guard_relationship_interaction()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_privileged BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT rolbypassrls OR rolsuper INTO v_privileged FROM pg_roles WHERE rolname = current_user;
    IF NOT COALESCE(v_privileged, FALSE) THEN
      RAISE EXCEPTION 'relationship_interaction is never deleted; archive it (Task 128)' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF ROW(NEW.tenant_id, NEW.kind, NEW.subject, NEW.summary, NEW.outcome, NEW.occurred_at, NEW.duration_minutes,
         NEW.logged_by_id, NEW.company_id, NEW.person_id, NEW.opportunity_id, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.tenant_id, OLD.kind, OLD.subject, OLD.summary, OLD.outcome, OLD.occurred_at, OLD.duration_minutes,
         OLD.logged_by_id, OLD.company_id, OLD.person_id, OLD.opportunity_id, OLD.created_at) THEN
    RAISE EXCEPTION 'a logged interaction is not rewritten; archive it and log it again (Task 128)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "relationship_interaction_guard"
  BEFORE UPDATE OR DELETE ON "relationship_interaction"
  FOR EACH ROW EXECUTE FUNCTION verity.guard_relationship_interaction();

-- Capability and entities. Stages are tenant data (relationship_stage), not platform state definitions, because each
-- tenant names its own pipeline; every stage still maps to a closed ADR-009 category.
INSERT INTO "capability_definition" (id, name, version, dependencies, entity_types, updated_at) VALUES
  ('verity.capability.relationship', 'CRM', '1.0.0', ARRAY[]::text[],
   ARRAY['verity.relationship.company', 'verity.relationship.person', 'verity.relationship.opportunity',
         'verity.relationship.stage', 'verity.relationship.note', 'verity.relationship.interaction',
         'verity.relationship.follow_up'], now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO "entity_definition" (key, capability, class, table_name, tenant_scoped) VALUES
  ('verity.relationship.company',     'verity.capability.relationship', 'Persistent', 'relationship_company', true),
  ('verity.relationship.person',      'verity.capability.relationship', 'Persistent', 'relationship_person', true),
  ('verity.relationship.opportunity', 'verity.capability.relationship', 'Persistent', 'relationship_opportunity', true),
  ('verity.relationship.stage',       'verity.capability.relationship', 'Persistent', 'relationship_stage', true),
  ('verity.relationship.note',        'verity.capability.relationship', 'Persistent', 'relationship_note', true),
  ('verity.relationship.interaction', 'verity.capability.relationship', 'Persistent', 'relationship_interaction', true),
  ('verity.relationship.follow_up',   'verity.capability.relationship', 'Persistent', 'relationship_follow_up', true)
ON CONFLICT (key) DO NOTHING;

-- ADR-051 clause 5: every existing role may keep its own views; roles that can edit roles may also share them.
-- The operator's support role is left out, as for data export (ADR-037).
DO $$ DECLARE target_tenant_id uuid; BEGIN
  FOR target_tenant_id IN SELECT id FROM public.tenant WHERE NOT is_platform LOOP
    PERFORM set_config('verity.tenant_id', target_tenant_id::text, true);
    INSERT INTO public.permission (id, tenant_id, role_id, verb, entity, scope)
    SELECT gen_random_uuid(), r.tenant_id, r.id, v.verb::"PermissionVerb", 'verity.platform.saved_view', 'Tenant'
      FROM public.role r CROSS JOIN (VALUES ('Read'), ('Create')) v(verb)
     WHERE r.tenant_id = target_tenant_id AND r.name <> 'Verity Operator'
    ON CONFLICT (role_id, verb, entity, scope) DO NOTHING;
    INSERT INTO public.permission (id, tenant_id, role_id, verb, entity, scope)
    SELECT gen_random_uuid(), r.tenant_id, r.id, 'Edit'::"PermissionVerb", 'verity.platform.saved_view', 'Tenant'
      FROM public.role r
     WHERE r.tenant_id = target_tenant_id AND r.name <> 'Verity Operator'
       AND EXISTS (SELECT 1 FROM verity.resolve_permissions(r.id) p
                    WHERE p.entity = 'verity.platform.role' AND p.verb = 'Edit' AND p.scope = 'Tenant')
    ON CONFLICT (role_id, verb, entity, scope) DO NOTHING;
  END LOOP;
END $$;
