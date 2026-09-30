-- Task 118: reusable Bill of Materials for the manufacturing capability.
-- First design partner: Carxen (custom car seat covers). Vehicle-specific
-- attributes are custom fields on the BOM entity, never columns (PLA-EXT-001).

-- CreateTable
CREATE TABLE "manufacturing_bom" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "output_item_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "manufacturing_bom_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "manufacturing_bom_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "bom_id" UUID NOT NULL,
    "component_item_id" UUID NOT NULL,
    "qty_per_unit" INTEGER NOT NULL,

    CONSTRAINT "manufacturing_bom_line_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "manufacturing_bom_tenant_id_code_key" ON "manufacturing_bom"("tenant_id", "code");
CREATE INDEX "manufacturing_bom_tenant_id_active_idx" ON "manufacturing_bom"("tenant_id", "active");
CREATE UNIQUE INDEX "manufacturing_bom_line_bom_id_component_item_id_key" ON "manufacturing_bom_line"("bom_id", "component_item_id");

-- A BOM line must be a positive quantity; the command checks this too, the
-- database is the backstop.
ALTER TABLE "manufacturing_bom_line" ADD CONSTRAINT "manufacturing_bom_line_qty_positive" CHECK ("qty_per_unit" > 0);

ALTER TABLE "manufacturing_bom" ADD CONSTRAINT "manufacturing_bom_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manufacturing_bom" ADD CONSTRAINT "manufacturing_bom_output_item_id_fkey"
  FOREIGN KEY ("output_item_id") REFERENCES "inventory_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manufacturing_bom_line" ADD CONSTRAINT "manufacturing_bom_line_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manufacturing_bom_line" ADD CONSTRAINT "manufacturing_bom_line_bom_id_fkey"
  FOREIGN KEY ("bom_id") REFERENCES "manufacturing_bom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manufacturing_bom_line" ADD CONSTRAINT "manufacturing_bom_line_component_item_id_fkey"
  FOREIGN KEY ("component_item_id") REFERENCES "inventory_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Traceability: which BOM an order was made from. Nullable (orders may still be
-- built by hand) and RESTRICT so a BOM an order points at can never be removed.
ALTER TABLE "manufacturing_order" ADD COLUMN "bom_id" UUID;
ALTER TABLE "manufacturing_order" ADD CONSTRAINT "manufacturing_order_bom_id_fkey"
  FOREIGN KEY ("bom_id") REFERENCES "manufacturing_bom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- INV-001.
ALTER TABLE "manufacturing_bom" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "manufacturing_bom" FORCE ROW LEVEL SECURITY;
CREATE POLICY "manufacturing_bom_isolation" ON "manufacturing_bom"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

ALTER TABLE "manufacturing_bom_line" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "manufacturing_bom_line" FORCE ROW LEVEL SECURITY;
CREATE POLICY "manufacturing_bom_line_isolation" ON "manufacturing_bom_line"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

-- Entity registration: the BOM is a persistent, tenant-scoped entity of the
-- manufacturing capability. No state machine: it is archived (`active`), and
-- INV-002 has no closed state to protect here.
INSERT INTO "entity_definition" (key, capability, class, table_name, tenant_scoped) VALUES
  ('verity.manufacturing.bom', 'verity.capability.manufacturing', 'Persistent', 'manufacturing_bom', true)
ON CONFLICT (key) DO NOTHING;

UPDATE "capability_definition"
   SET entity_types = array_append(entity_types, 'verity.manufacturing.bom'), updated_at = now()
 WHERE id = 'verity.capability.manufacturing'
   AND NOT ('verity.manufacturing.bom' = ANY(entity_types));
