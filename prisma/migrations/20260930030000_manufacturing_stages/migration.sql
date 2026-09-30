-- Task 118: stage-wise production (routes + per-order operations).
-- Derived from Carxen's factory floor (CAD, Cutting, Stitching, QC, Packing),
-- but the stages are tenant DATA, never a hard-coded department list.

CREATE TABLE "manufacturing_route" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "manufacturing_route_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "manufacturing_route_stage" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "stage_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    CONSTRAINT "manufacturing_route_stage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "manufacturing_operation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "stage_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "rework_of_id" UUID,
    "started_at" TIMESTAMP(3),
    "started_by_id" UUID,
    "completed_at" TIMESTAMP(3),
    "completed_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "manufacturing_operation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "manufacturing_route_tenant_id_code_key" ON "manufacturing_route"("tenant_id", "code");
CREATE UNIQUE INDEX "manufacturing_route_stage_route_id_sequence_key" ON "manufacturing_route_stage"("route_id", "sequence");
CREATE UNIQUE INDEX "manufacturing_route_stage_route_id_stage_key_key" ON "manufacturing_route_stage"("route_id", "stage_key");
CREATE UNIQUE INDEX "manufacturing_operation_order_id_sequence_key" ON "manufacturing_operation"("order_id", "sequence");
CREATE INDEX "manufacturing_operation_tenant_id_state_stage_key_idx" ON "manufacturing_operation"("tenant_id", "state", "stage_key");

ALTER TABLE "manufacturing_route" ADD CONSTRAINT "manufacturing_route_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manufacturing_route_stage" ADD CONSTRAINT "manufacturing_route_stage_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manufacturing_route_stage" ADD CONSTRAINT "manufacturing_route_stage_route_id_fkey"
  FOREIGN KEY ("route_id") REFERENCES "manufacturing_route"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manufacturing_operation" ADD CONSTRAINT "manufacturing_operation_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manufacturing_operation" ADD CONSTRAINT "manufacturing_operation_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "manufacturing_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manufacturing_operation" ADD CONSTRAINT "manufacturing_operation_rework_of_id_fkey"
  FOREIGN KEY ("rework_of_id") REFERENCES "manufacturing_operation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- INV-001.
ALTER TABLE "manufacturing_route" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "manufacturing_route" FORCE ROW LEVEL SECURITY;
CREATE POLICY "manufacturing_route_isolation" ON "manufacturing_route"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());
ALTER TABLE "manufacturing_route_stage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "manufacturing_route_stage" FORCE ROW LEVEL SECURITY;
CREATE POLICY "manufacturing_route_stage_isolation" ON "manufacturing_route_stage"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());
ALTER TABLE "manufacturing_operation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "manufacturing_operation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "manufacturing_operation_isolation" ON "manufacturing_operation"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

-- Entities.
INSERT INTO "entity_definition" (key, capability, class, table_name, tenant_scoped) VALUES
  ('verity.manufacturing.route',     'verity.capability.manufacturing', 'Persistent', 'manufacturing_route',     true),
  ('verity.manufacturing.operation', 'verity.capability.manufacturing', 'Persistent', 'manufacturing_operation', true)
ON CONFLICT (key) DO NOTHING;

UPDATE "capability_definition"
   SET entity_types = entity_types
        || ARRAY(SELECT e FROM unnest(ARRAY['verity.manufacturing.route','verity.manufacturing.operation']) e WHERE NOT (e = ANY(entity_types))),
       updated_at = now()
 WHERE id = 'verity.capability.manufacturing';

-- Operation lifecycle (ADR-009 categories, behavioural not domain):
-- pending: Pending, initial. in_progress: Active. on_hold: Blocked.
-- completed: Completed, terminal (INV-002 read-only). cancelled: Cancelled, terminal.
INSERT INTO "state_definition" (id, entity_key, key, category, is_initial, is_terminal) VALUES
  (gen_random_uuid(), 'verity.manufacturing.operation', 'pending',     'Pending',   true,  false),
  (gen_random_uuid(), 'verity.manufacturing.operation', 'in_progress', 'Active',    false, false),
  (gen_random_uuid(), 'verity.manufacturing.operation', 'on_hold',     'Blocked',   false, false),
  (gen_random_uuid(), 'verity.manufacturing.operation', 'completed',   'Completed', false, true),
  (gen_random_uuid(), 'verity.manufacturing.operation', 'cancelled',   'Cancelled', false, true)
ON CONFLICT (entity_key, key) DO NOTHING;

INSERT INTO "transition_definition" (id, entity_key, from_state_id, to_state_id)
SELECT gen_random_uuid(), 'verity.manufacturing.operation', f.id, t.id
FROM state_definition f, state_definition t
WHERE f.entity_key = 'verity.manufacturing.operation' AND t.entity_key = 'verity.manufacturing.operation'
  AND (f.key, t.key) IN (
    ('pending','in_progress'), ('pending','cancelled'),
    ('in_progress','on_hold'), ('in_progress','completed'), ('in_progress','cancelled'),
    ('on_hold','in_progress'), ('on_hold','cancelled')
  )
ON CONFLICT (from_state_id, to_state_id) DO NOTHING;
