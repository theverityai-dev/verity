-- Task 118: order consolidation into a batch, and BOM reservation on release.

CREATE TABLE "manufacturing_batch" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "reference" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "manufacturing_batch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "manufacturing_batch_tenant_id_idx" ON "manufacturing_batch"("tenant_id");
ALTER TABLE "manufacturing_batch" ADD CONSTRAINT "manufacturing_batch_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "manufacturing_order" ADD COLUMN "batch_id" UUID;
ALTER TABLE "manufacturing_order" ADD CONSTRAINT "manufacturing_order_batch_id_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "manufacturing_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "manufacturing_reservation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "component_item_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "released_at" TIMESTAMP(3),
    "release_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "manufacturing_reservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "manufacturing_reservation_qty" CHECK ("qty" > 0)
);
CREATE INDEX "manufacturing_reservation_hold_idx"
  ON "manufacturing_reservation"("tenant_id", "component_item_id", "location_id", "released_at");
CREATE INDEX "manufacturing_reservation_tenant_id_order_id_idx" ON "manufacturing_reservation"("tenant_id", "order_id");
-- One live hold per order and component: reserving twice is a no-op, never a double hold.
CREATE UNIQUE INDEX "manufacturing_reservation_live_key"
  ON "manufacturing_reservation"("order_id", "component_item_id") WHERE "released_at" IS NULL;
ALTER TABLE "manufacturing_reservation" ADD CONSTRAINT "manufacturing_reservation_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manufacturing_reservation" ADD CONSTRAINT "manufacturing_reservation_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "manufacturing_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manufacturing_reservation" ADD CONSTRAINT "manufacturing_reservation_component_item_id_fkey"
  FOREIGN KEY ("component_item_id") REFERENCES "inventory_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- INV-001 on both tables.
ALTER TABLE "manufacturing_batch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "manufacturing_batch" FORCE ROW LEVEL SECURITY;
CREATE POLICY "manufacturing_batch_isolation" ON "manufacturing_batch"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());
ALTER TABLE "manufacturing_reservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "manufacturing_reservation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "manufacturing_reservation_isolation" ON "manufacturing_reservation"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

INSERT INTO "entity_definition" (key, capability, class, table_name, tenant_scoped) VALUES
  ('verity.manufacturing.batch', 'verity.capability.manufacturing', 'Persistent', 'manufacturing_batch', true),
  ('verity.manufacturing.reservation', 'verity.capability.manufacturing', 'Persistent', 'manufacturing_reservation', true)
ON CONFLICT (key) DO NOTHING;

UPDATE "capability_definition"
   SET entity_types = entity_types
       || ARRAY(SELECT e FROM unnest(ARRAY['verity.manufacturing.batch', 'verity.manufacturing.reservation']) e WHERE NOT (e = ANY(entity_types))),
       updated_at = now()
 WHERE id = 'verity.capability.manufacturing';
