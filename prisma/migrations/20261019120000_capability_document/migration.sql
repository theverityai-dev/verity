-- Capability: Document (controlled engineering documents). ADR-048 (PROPOSED), clients/dsew/phase1-design.md 3.2.
-- A document is numbered once, revised through draft, review, release and supersession, linked to the exact
-- revision a job or order relied on, and every open or download is logged. Evidence is not reused.
-- Additive only: new tables, no existing table touched. Every table: tenant column, RLS enabled and forced.

CREATE TABLE "document_type" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "segments" JSONB NOT NULL DEFAULT '[]',
    "requires_approval" BOOLEAN NOT NULL DEFAULT true,
    "valid_months" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_type_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_type_pattern" CHECK (length("pattern") BETWEEN 1 AND 120),
    CONSTRAINT "document_type_valid_months" CHECK ("valid_months" IS NULL OR "valid_months" BETWEEN 1 AND 600)
);
CREATE UNIQUE INDEX "document_type_tenant_id_key_key" ON "document_type"("tenant_id", "key");
-- Composite keys let a child reference its parent within one tenant only (INV-001): a plain foreign key is checked
-- without row-level security and would accept another tenant's id.
CREATE UNIQUE INDEX "document_type_tenant_id_id_key" ON "document_type"("tenant_id", "id");

CREATE TABLE "document_number_counter" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "prefix" TEXT NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "document_number_counter_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_number_counter_next" CHECK ("next_value" >= 1)
);
CREATE UNIQUE INDEX "document_number_counter_tenant_id_prefix_key" ON "document_number_counter"("tenant_id", "prefix");

CREATE TABLE "document" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "type_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "classification" TEXT NOT NULL DEFAULT 'internal',
    "segments" JSONB NOT NULL DEFAULT '{}',
    "current_revision_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_classification" CHECK ("classification" IN ('internal', 'customer'))
);
CREATE UNIQUE INDEX "document_tenant_id_number_key" ON "document"("tenant_id", "number");
CREATE UNIQUE INDEX "document_tenant_id_id_key" ON "document"("tenant_id", "id");
CREATE INDEX "document_tenant_id_type_id_idx" ON "document"("tenant_id", "type_id");

CREATE TABLE "document_revision" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "file_id" UUID,
    "change_reason" TEXT,
    "review_note" TEXT,
    "obsolete_reason" TEXT,
    "effective_from" DATE,
    "valid_until" DATE,
    "authored_by_id" UUID,
    "submitted_by_id" UUID,
    "approved_by_id" UUID,
    "self_approval_reason" TEXT,
    "submitted_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_revision_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_revision_status" CHECK ("status" IN ('draft', 'in_review', 'released', 'superseded', 'obsolete')),
    CONSTRAINT "document_revision_number" CHECK ("revision" >= 1),
    -- A released revision carries the file it was released with and the date it took effect.
    CONSTRAINT "document_revision_release_complete" CHECK (
        "status" NOT IN ('released', 'superseded') OR ("file_id" IS NOT NULL AND "effective_from" IS NOT NULL AND "released_at" IS NOT NULL)
    ),
    CONSTRAINT "document_revision_validity" CHECK ("valid_until" IS NULL OR "effective_from" IS NULL OR "valid_until" >= "effective_from")
);
CREATE UNIQUE INDEX "document_revision_document_id_revision_key" ON "document_revision"("document_id", "revision");
CREATE UNIQUE INDEX "document_revision_tenant_id_id_key" ON "document_revision"("tenant_id", "id");
CREATE INDEX "document_revision_tenant_id_document_id_idx" ON "document_revision"("tenant_id", "document_id");
-- At most one released revision per document: the current one.
CREATE UNIQUE INDEX "document_revision_one_released" ON "document_revision"("document_id") WHERE "status" = 'released';

CREATE TABLE "document_link" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "entity_key" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "linked_by_id" UUID,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_link_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "document_link_revision_id_entity_key_entity_id_key" ON "document_link"("revision_id", "entity_key", "entity_id");
CREATE INDEX "document_link_tenant_id_entity_key_entity_id_idx" ON "document_link"("tenant_id", "entity_key", "entity_id");

CREATE TABLE "document_access_log" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_access_log_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_access_log_action" CHECK ("action" IN ('open', 'download'))
);
CREATE INDEX "document_access_log_tenant_id_document_id_at_idx" ON "document_access_log"("tenant_id", "document_id", "at");

ALTER TABLE "document_type" ADD CONSTRAINT "document_type_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_number_counter" ADD CONSTRAINT "document_number_counter_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document" ADD CONSTRAINT "document_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document" ADD CONSTRAINT "document_tenant_id_type_id_fkey" FOREIGN KEY ("tenant_id", "type_id") REFERENCES "document_type"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "document_revision" ADD CONSTRAINT "document_revision_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_revision" ADD CONSTRAINT "document_revision_tenant_id_document_id_fkey" FOREIGN KEY ("tenant_id", "document_id") REFERENCES "document"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "document_revision" ADD CONSTRAINT "document_revision_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_file"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_tenant_id_document_id_fkey" FOREIGN KEY ("tenant_id", "document_id") REFERENCES "document"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_tenant_id_revision_id_fkey" FOREIGN KEY ("tenant_id", "revision_id") REFERENCES "document_revision"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "document_access_log" ADD CONSTRAINT "document_access_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- INV-001: tenant isolation.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['document_type', 'document_number_counter', 'document', 'document_revision', 'document_link', 'document_access_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = verity.current_tenant_id()) WITH CHECK (tenant_id = verity.current_tenant_id())',
      t || '_isolation', t);
  END LOOP;
END $$;

-- A revision's history is never rewritten. The commands enforce the lifecycle; this trigger makes the guarantee hold
-- against any other path. While a revision is a draft it may be edited and its file attached. From submission the
-- file is fixed. Once released nothing about it changes except its status moving on (superseded, or obsolete with a
-- reason). A revision is never deleted by the application role (a privileged role may, for tenant teardown).
CREATE OR REPLACE FUNCTION verity.guard_document_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_privileged BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT rolbypassrls OR rolsuper INTO v_privileged FROM pg_roles WHERE rolname = current_user;
    IF NOT COALESCE(v_privileged, FALSE) THEN
      RAISE EXCEPTION 'document_revision is never deleted: DELETE is not permitted for the application role (ADR-048)'
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.tenant_id <> OLD.tenant_id OR NEW.document_id <> OLD.document_id OR NEW.revision <> OLD.revision OR NEW.label <> OLD.label THEN
    RAISE EXCEPTION 'document_revision identity is fixed (ADR-048)' USING ERRCODE = '42501';
  END IF;

  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'draft' AND NEW.status = 'in_review')
    OR (OLD.status = 'in_review' AND NEW.status IN ('draft', 'released'))
    OR (OLD.status = 'released' AND NEW.status IN ('superseded', 'obsolete'))
  ) THEN
    RAISE EXCEPTION 'document_revision cannot move from % to % (ADR-048)', OLD.status, NEW.status USING ERRCODE = '42501';
  END IF;

  IF OLD.status <> 'draft' AND NEW.file_id IS DISTINCT FROM OLD.file_id THEN
    RAISE EXCEPTION 'the file of a submitted document revision is fixed (ADR-048)' USING ERRCODE = '42501';
  END IF;

  IF OLD.status IN ('released', 'superseded', 'obsolete') THEN
    IF ROW(NEW.change_reason, NEW.review_note, NEW.effective_from, NEW.valid_until, NEW.authored_by_id, NEW.submitted_by_id,
           NEW.approved_by_id, NEW.self_approval_reason, NEW.submitted_at, NEW.released_at, NEW.created_at)
       IS DISTINCT FROM
       ROW(OLD.change_reason, OLD.review_note, OLD.effective_from, OLD.valid_until, OLD.authored_by_id, OLD.submitted_by_id,
           OLD.approved_by_id, OLD.self_approval_reason, OLD.submitted_at, OLD.released_at, OLD.created_at) THEN
      RAISE EXCEPTION 'a released document revision is immutable (ADR-048)' USING ERRCODE = '42501';
    END IF;
    IF NEW.obsolete_reason IS DISTINCT FROM OLD.obsolete_reason AND NEW.status <> 'obsolete' THEN
      RAISE EXCEPTION 'an obsolete reason belongs only to an obsolete revision (ADR-048)' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "document_revision_guard"
  BEFORE UPDATE OR DELETE ON "document_revision"
  FOR EACH ROW EXECUTE FUNCTION verity.guard_document_revision();

-- A number is never re-used or edited, and a document is never deleted by the application role.
CREATE OR REPLACE FUNCTION verity.guard_document()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_privileged BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT rolbypassrls OR rolsuper INTO v_privileged FROM pg_roles WHERE rolname = current_user;
    IF NOT COALESCE(v_privileged, FALSE) THEN
      RAISE EXCEPTION 'document is never deleted: DELETE is not permitted for the application role (ADR-048)'
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.number <> OLD.number OR NEW.type_id <> OLD.type_id OR NEW.tenant_id <> OLD.tenant_id THEN
    RAISE EXCEPTION 'a document number and type are fixed once issued (ADR-048)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "document_guard"
  BEFORE UPDATE OR DELETE ON "document"
  FOR EACH ROW EXECUTE FUNCTION verity.guard_document();

-- A link records which revision was relied on; it is never moved or removed. The access log is append-only.
CREATE TRIGGER "document_link_append_only"
  BEFORE UPDATE OR DELETE ON "document_link"
  FOR EACH ROW EXECUTE FUNCTION verity.reject_mutation();

CREATE TRIGGER "document_access_log_append_only"
  BEFORE UPDATE OR DELETE ON "document_access_log"
  FOR EACH ROW EXECUTE FUNCTION verity.reject_mutation();

-- Capability, entities, states and transitions (ADR-009 categories). The release entities carry permissions only.
INSERT INTO "capability_definition" (id, name, version, dependencies, entity_types, updated_at) VALUES
  ('verity.capability.document', 'Documents', '1.0.0', ARRAY[]::text[],
   ARRAY['verity.document.type', 'verity.document.document', 'verity.document.revision',
         'verity.document.release', 'verity.document.self_release'], now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO "entity_definition" (key, capability, class, table_name, tenant_scoped) VALUES
  ('verity.document.type', 'verity.capability.document', 'Persistent', 'document_type', true),
  ('verity.document.document', 'verity.capability.document', 'Persistent', 'document', true),
  ('verity.document.revision', 'verity.capability.document', 'Persistent', 'document_revision', true),
  ('verity.document.release', 'verity.capability.document', 'Abstract', NULL, true),
  ('verity.document.self_release', 'verity.capability.document', 'Abstract', NULL, true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO "state_definition" (id, entity_key, key, category, is_initial, is_terminal) VALUES
  (gen_random_uuid(), 'verity.document.revision', 'draft',      'Draft',     true,  false),
  (gen_random_uuid(), 'verity.document.revision', 'in_review',  'Pending',   false, false),
  (gen_random_uuid(), 'verity.document.revision', 'released',   'Active',    false, false),
  (gen_random_uuid(), 'verity.document.revision', 'superseded', 'Completed', false, true),
  (gen_random_uuid(), 'verity.document.revision', 'obsolete',   'Cancelled', false, true)
ON CONFLICT (entity_key, key) DO NOTHING;

INSERT INTO "transition_definition" (id, entity_key, from_state_id, to_state_id)
SELECT gen_random_uuid(), 'verity.document.revision', f.id, t.id
FROM state_definition f, state_definition t
WHERE f.entity_key = 'verity.document.revision' AND t.entity_key = 'verity.document.revision'
  AND (f.key, t.key) IN (
    ('draft','in_review'), ('in_review','draft'), ('in_review','released'),
    ('released','superseded'), ('released','obsolete')
  )
ON CONFLICT (from_state_id, to_state_id) DO NOTHING;
