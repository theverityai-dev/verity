-- Capability: Project (Jobs). First client: D & S Electric Works (clients/dsew/prd.md).
-- A Job is an engineered order run end to end: enquiry, quote revisions, approval, tasks,
-- milestones, time and cost, linked manufacturing orders. Cost and margin are DERIVED reads,
-- never stored. Money is integer minor units. Every table: tenant column, RLS enabled and forced.

CREATE TABLE "project_job" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_contact" TEXT,
    "description" TEXT,
    "state" TEXT NOT NULL DEFAULT 'enquiry',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "due_date" DATE,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "quoted_value_minor" INTEGER,
    "approved_quote_id" UUID,
    "lost_reason_id" UUID,
    "lost_note" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "project_job_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "project_job_priority" CHECK ("priority" IN ('low', 'normal', 'high', 'urgent')),
    CONSTRAINT "project_job_quoted_value" CHECK ("quoted_value_minor" IS NULL OR "quoted_value_minor" >= 0)
);
CREATE UNIQUE INDEX "project_job_tenant_id_number_key" ON "project_job"("tenant_id", "number");
CREATE INDEX "project_job_tenant_id_state_idx" ON "project_job"("tenant_id", "state");

CREATE TABLE "project_lost_reason" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_lost_reason_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "project_lost_reason_tenant_id_key_key" ON "project_lost_reason"("tenant_id", "key");

CREATE TABLE "project_quote" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "amount_minor" INTEGER NOT NULL,
    "valid_until" DATE,
    "scope_note" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_quote_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "project_quote_status" CHECK ("status" IN ('open', 'approved', 'superseded', 'lost')),
    CONSTRAINT "project_quote_amount" CHECK ("amount_minor" >= 0)
);
CREATE UNIQUE INDEX "project_quote_job_id_revision_key" ON "project_quote"("job_id", "revision");
CREATE INDEX "project_quote_tenant_id_job_id_idx" ON "project_quote"("tenant_id", "job_id");

CREATE TABLE "project_quote_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_price_minor" INTEGER NOT NULL,
    CONSTRAINT "project_quote_line_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "project_quote_line_qty" CHECK ("qty" > 0),
    CONSTRAINT "project_quote_line_price" CHECK ("unit_price_minor" >= 0)
);
CREATE UNIQUE INDEX "project_quote_line_quote_id_sequence_key" ON "project_quote_line"("quote_id", "sequence");

CREATE TABLE "project_milestone" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "due_date" DATE,
    "reached_at" TIMESTAMP(3),
    "customer_visible" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_milestone_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "project_milestone_tenant_id_job_id_idx" ON "project_milestone"("tenant_id", "job_id");

CREATE TABLE "project_task" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "parent_id" UUID,
    "title" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'todo',
    "assignee_label" TEXT,
    "due_date" DATE,
    "expected_minutes" INTEGER,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "project_task_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "project_task_weight" CHECK ("weight" >= 1),
    CONSTRAINT "project_task_expected" CHECK ("expected_minutes" IS NULL OR "expected_minutes" > 0)
);
CREATE INDEX "project_task_tenant_id_job_id_idx" ON "project_task"("tenant_id", "job_id");

CREATE TABLE "project_task_dependency" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "depends_on_id" UUID NOT NULL,
    CONSTRAINT "project_task_dependency_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "project_task_dependency_self" CHECK ("task_id" <> "depends_on_id")
);
CREATE UNIQUE INDEX "project_task_dependency_task_id_depends_on_id_key" ON "project_task_dependency"("task_id", "depends_on_id");

-- Time and cost are append-only facts: a wrong entry is voided (kept, marked) and re-entered.
CREATE TABLE "project_time_entry" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "task_id" UUID,
    "worker_label" TEXT NOT NULL,
    "work_date" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "hourly_rate_minor" INTEGER NOT NULL,
    "note" TEXT,
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_time_entry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "project_time_entry_minutes" CHECK ("minutes" > 0 AND "minutes" <= 1440),
    CONSTRAINT "project_time_entry_rate" CHECK ("hourly_rate_minor" >= 0)
);
CREATE INDEX "project_time_entry_tenant_id_job_id_idx" ON "project_time_entry"("tenant_id", "job_id");

CREATE TABLE "project_cost_entry" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "supplier_name" TEXT,
    "amount_minor" INTEGER NOT NULL,
    "incurred_on" DATE NOT NULL,
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_cost_entry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "project_cost_entry_kind" CHECK ("kind" IN ('outsourced', 'testing', 'freight', 'other')),
    CONSTRAINT "project_cost_entry_amount" CHECK ("amount_minor" > 0)
);
CREATE INDEX "project_cost_entry_tenant_id_job_id_idx" ON "project_cost_entry"("tenant_id", "job_id");

-- A manufacturing order belongs to at most one job; a job may span several orders.
CREATE TABLE "project_job_order" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_job_order_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "project_job_order_order_id_key" ON "project_job_order"("order_id");
CREATE INDEX "project_job_order_tenant_id_job_id_idx" ON "project_job_order"("tenant_id", "job_id");

-- Foreign keys. Tenant cascade on every table; same-tenant parents cascade or restrict.
ALTER TABLE "project_job" ADD CONSTRAINT "project_job_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_job" ADD CONSTRAINT "project_job_lost_reason_id_fkey" FOREIGN KEY ("lost_reason_id") REFERENCES "project_lost_reason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_lost_reason" ADD CONSTRAINT "project_lost_reason_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_quote" ADD CONSTRAINT "project_quote_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_quote" ADD CONSTRAINT "project_quote_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "project_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_quote_line" ADD CONSTRAINT "project_quote_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_quote_line" ADD CONSTRAINT "project_quote_line_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "project_quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_milestone" ADD CONSTRAINT "project_milestone_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_milestone" ADD CONSTRAINT "project_milestone_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "project_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_task" ADD CONSTRAINT "project_task_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_task" ADD CONSTRAINT "project_task_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "project_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_task" ADD CONSTRAINT "project_task_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "project_task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_task_dependency" ADD CONSTRAINT "project_task_dependency_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_task_dependency" ADD CONSTRAINT "project_task_dependency_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "project_task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_task_dependency" ADD CONSTRAINT "project_task_dependency_depends_on_id_fkey" FOREIGN KEY ("depends_on_id") REFERENCES "project_task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_time_entry" ADD CONSTRAINT "project_time_entry_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_time_entry" ADD CONSTRAINT "project_time_entry_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "project_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_time_entry" ADD CONSTRAINT "project_time_entry_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "project_task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_cost_entry" ADD CONSTRAINT "project_cost_entry_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_cost_entry" ADD CONSTRAINT "project_cost_entry_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "project_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_job_order" ADD CONSTRAINT "project_job_order_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_job_order" ADD CONSTRAINT "project_job_order_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "project_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_job_order" ADD CONSTRAINT "project_job_order_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "manufacturing_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- INV-001: tenant isolation on every table.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'project_job', 'project_lost_reason', 'project_quote', 'project_quote_line', 'project_milestone',
    'project_task', 'project_task_dependency', 'project_time_entry', 'project_cost_entry', 'project_job_order'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = verity.current_tenant_id()) WITH CHECK (tenant_id = verity.current_tenant_id())',
      t || '_isolation', t);
  END LOOP;
END $$;

-- Capability, entities, states and transitions (ADR-009 categories).
INSERT INTO "capability_definition" (id, name, version, dependencies, entity_types, updated_at) VALUES
  ('verity.capability.project', 'Jobs', '1.0.0',
   ARRAY['verity.capability.location', 'verity.capability.inventory', 'verity.capability.manufacturing'],
   ARRAY['verity.project.job', 'verity.project.quote', 'verity.project.milestone', 'verity.project.task',
         'verity.project.time_entry', 'verity.project.cost_entry', 'verity.project.lost_reason'], now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO "entity_definition" (key, capability, class, table_name, tenant_scoped) VALUES
  ('verity.project.job', 'verity.capability.project', 'Persistent', 'project_job', true),
  ('verity.project.quote', 'verity.capability.project', 'Persistent', 'project_quote', true),
  ('verity.project.milestone', 'verity.capability.project', 'Persistent', 'project_milestone', true),
  ('verity.project.task', 'verity.capability.project', 'Persistent', 'project_task', true),
  ('verity.project.time_entry', 'verity.capability.project', 'Persistent', 'project_time_entry', true),
  ('verity.project.cost_entry', 'verity.capability.project', 'Persistent', 'project_cost_entry', true),
  ('verity.project.lost_reason', 'verity.capability.project', 'Persistent', 'project_lost_reason', true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO "state_definition" (id, entity_key, key, category, is_initial, is_terminal) VALUES
  (gen_random_uuid(), 'verity.project.job', 'enquiry',     'Draft',     true,  false),
  (gen_random_uuid(), 'verity.project.job', 'quoted',      'Pending',   false, false),
  (gen_random_uuid(), 'verity.project.job', 'approved',    'Pending',   false, false),
  (gen_random_uuid(), 'verity.project.job', 'in_progress', 'Active',    false, false),
  (gen_random_uuid(), 'verity.project.job', 'on_hold',     'Blocked',   false, false),
  (gen_random_uuid(), 'verity.project.job', 'completed',   'Completed', false, true),
  (gen_random_uuid(), 'verity.project.job', 'lost',        'Cancelled', false, true),
  (gen_random_uuid(), 'verity.project.job', 'cancelled',   'Cancelled', false, true),
  (gen_random_uuid(), 'verity.project.task', 'todo',        'Pending',   true,  false),
  (gen_random_uuid(), 'verity.project.task', 'in_progress', 'Active',    false, false),
  (gen_random_uuid(), 'verity.project.task', 'blocked',     'Blocked',   false, false),
  (gen_random_uuid(), 'verity.project.task', 'done',        'Completed', false, true),
  (gen_random_uuid(), 'verity.project.task', 'cancelled',   'Cancelled', false, true)
ON CONFLICT (entity_key, key) DO NOTHING;

INSERT INTO "transition_definition" (id, entity_key, from_state_id, to_state_id)
SELECT gen_random_uuid(), 'verity.project.job', f.id, t.id
FROM state_definition f, state_definition t
WHERE f.entity_key = 'verity.project.job' AND t.entity_key = 'verity.project.job'
  AND (f.key, t.key) IN (
    ('enquiry','quoted'), ('enquiry','lost'), ('enquiry','cancelled'),
    ('quoted','approved'), ('quoted','lost'), ('quoted','cancelled'),
    ('approved','in_progress'), ('approved','cancelled'),
    ('in_progress','on_hold'), ('in_progress','completed'), ('in_progress','cancelled'),
    ('on_hold','in_progress'), ('on_hold','cancelled')
  )
ON CONFLICT (from_state_id, to_state_id) DO NOTHING;

INSERT INTO "transition_definition" (id, entity_key, from_state_id, to_state_id)
SELECT gen_random_uuid(), 'verity.project.task', f.id, t.id
FROM state_definition f, state_definition t
WHERE f.entity_key = 'verity.project.task' AND t.entity_key = 'verity.project.task'
  AND (f.key, t.key) IN (
    ('todo','in_progress'), ('todo','blocked'), ('todo','cancelled'),
    ('in_progress','blocked'), ('in_progress','done'), ('in_progress','cancelled'), ('in_progress','todo'),
    ('blocked','in_progress'), ('blocked','todo'), ('blocked','cancelled')
  )
ON CONFLICT (from_state_id, to_state_id) DO NOTHING;
