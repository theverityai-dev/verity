-- Stylified demo, stage 1: the style master. A tenant owns its attribute lists (colour, size, ...);
-- a style (item template) offers chosen values on ordered axes; variants are generated as ordinary
-- inventory items. HSN code and GST rate become real item fields (null = not yet classified).
-- Additive only. Every new table is tenant-isolated with row-level security forced (INV-001).

-- AlterTable
ALTER TABLE "inventory_item" ADD COLUMN     "hsn_code" TEXT,
ADD COLUMN     "tax_rate_bp" INTEGER,
ADD COLUMN     "template_id" UUID,
ADD COLUMN     "variant_key" TEXT;

-- CreateTable
CREATE TABLE "inventory_attribute" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "inventory_attribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_attribute_value" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "attribute_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "swatch_hex" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "inventory_attribute_value_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_item_template" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "item_group_id" UUID,
    "unit_label" TEXT NOT NULL DEFAULT 'pcs',
    "hsn_code" TEXT,
    "tax_rate_bp" INTEGER,
    "season" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "inventory_item_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_template_axis" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "attribute_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,

    CONSTRAINT "inventory_template_axis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_template_axis_value" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "axis_id" UUID NOT NULL,
    "value_id" UUID NOT NULL,

    CONSTRAINT "inventory_template_axis_value_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_item_variant_value" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "attribute_id" UUID NOT NULL,
    "value_id" UUID NOT NULL,

    CONSTRAINT "inventory_item_variant_value_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_attribute_tenant_id_key_key" ON "inventory_attribute"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "inventory_attribute_value_tenant_id_attribute_id_idx" ON "inventory_attribute_value"("tenant_id", "attribute_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_attribute_value_attribute_id_code_key" ON "inventory_attribute_value"("attribute_id", "code");

-- CreateIndex
CREATE INDEX "inventory_item_template_tenant_id_active_idx" ON "inventory_item_template"("tenant_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_item_template_tenant_id_code_key" ON "inventory_item_template"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_template_axis_template_id_sequence_key" ON "inventory_template_axis"("template_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_template_axis_template_id_attribute_id_key" ON "inventory_template_axis"("template_id", "attribute_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_template_axis_value_axis_id_value_id_key" ON "inventory_template_axis_value"("axis_id", "value_id");

-- CreateIndex
CREATE INDEX "inventory_item_variant_value_tenant_id_value_id_idx" ON "inventory_item_variant_value"("tenant_id", "value_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_item_variant_value_item_id_attribute_id_key" ON "inventory_item_variant_value"("item_id", "attribute_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_item_template_id_variant_key_key" ON "inventory_item"("template_id", "variant_key");

-- AddForeignKey
ALTER TABLE "inventory_item" ADD CONSTRAINT "inventory_item_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "inventory_item_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_attribute" ADD CONSTRAINT "inventory_attribute_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_attribute_value" ADD CONSTRAINT "inventory_attribute_value_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_attribute_value" ADD CONSTRAINT "inventory_attribute_value_attribute_id_fkey" FOREIGN KEY ("attribute_id") REFERENCES "inventory_attribute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_item_template" ADD CONSTRAINT "inventory_item_template_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_item_template" ADD CONSTRAINT "inventory_item_template_item_group_id_fkey" FOREIGN KEY ("item_group_id") REFERENCES "inventory_item_group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_template_axis" ADD CONSTRAINT "inventory_template_axis_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_template_axis" ADD CONSTRAINT "inventory_template_axis_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "inventory_item_template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_template_axis" ADD CONSTRAINT "inventory_template_axis_attribute_id_fkey" FOREIGN KEY ("attribute_id") REFERENCES "inventory_attribute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_template_axis_value" ADD CONSTRAINT "inventory_template_axis_value_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_template_axis_value" ADD CONSTRAINT "inventory_template_axis_value_axis_id_fkey" FOREIGN KEY ("axis_id") REFERENCES "inventory_template_axis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_template_axis_value" ADD CONSTRAINT "inventory_template_axis_value_value_id_fkey" FOREIGN KEY ("value_id") REFERENCES "inventory_attribute_value"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_item_variant_value" ADD CONSTRAINT "inventory_item_variant_value_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_item_variant_value" ADD CONSTRAINT "inventory_item_variant_value_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_item_variant_value" ADD CONSTRAINT "inventory_item_variant_value_attribute_id_fkey" FOREIGN KEY ("attribute_id") REFERENCES "inventory_attribute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_item_variant_value" ADD CONSTRAINT "inventory_item_variant_value_value_id_fkey" FOREIGN KEY ("value_id") REFERENCES "inventory_attribute_value"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backstops for what the commands already check.
ALTER TABLE "inventory_item" ADD CONSTRAINT "inventory_item_tax_rate_range" CHECK ("tax_rate_bp" IS NULL OR ("tax_rate_bp" BETWEEN 0 AND 10000));
ALTER TABLE "inventory_item_template" ADD CONSTRAINT "inventory_item_template_tax_rate_range" CHECK ("tax_rate_bp" IS NULL OR ("tax_rate_bp" BETWEEN 0 AND 10000));
ALTER TABLE "inventory_template_axis" ADD CONSTRAINT "inventory_template_axis_sequence_positive" CHECK ("sequence" >= 1);
-- A variant is wholly specified or not a variant at all.
ALTER TABLE "inventory_item" ADD CONSTRAINT "inventory_item_variant_pair" CHECK (("template_id" IS NULL) = ("variant_key" IS NULL));

-- INV-001.
ALTER TABLE "inventory_attribute" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_attribute" FORCE ROW LEVEL SECURITY;
CREATE POLICY "inventory_attribute_isolation" ON "inventory_attribute"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

ALTER TABLE "inventory_attribute_value" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_attribute_value" FORCE ROW LEVEL SECURITY;
CREATE POLICY "inventory_attribute_value_isolation" ON "inventory_attribute_value"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

ALTER TABLE "inventory_item_template" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_item_template" FORCE ROW LEVEL SECURITY;
CREATE POLICY "inventory_item_template_isolation" ON "inventory_item_template"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

ALTER TABLE "inventory_template_axis" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_template_axis" FORCE ROW LEVEL SECURITY;
CREATE POLICY "inventory_template_axis_isolation" ON "inventory_template_axis"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

ALTER TABLE "inventory_template_axis_value" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_template_axis_value" FORCE ROW LEVEL SECURITY;
CREATE POLICY "inventory_template_axis_value_isolation" ON "inventory_template_axis_value"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

ALTER TABLE "inventory_item_variant_value" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_item_variant_value" FORCE ROW LEVEL SECURITY;
CREATE POLICY "inventory_item_variant_value_isolation" ON "inventory_item_variant_value"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

-- Entities and their capability registration. Master lists and styles are persistent, tenant-scoped,
-- retired rather than deleted; neither has a state machine.
INSERT INTO "entity_definition" (key, capability, class, table_name, tenant_scoped) VALUES
  ('verity.inventory.attribute', 'verity.capability.inventory', 'Persistent', 'inventory_attribute',     true),
  ('verity.inventory.template',  'verity.capability.inventory', 'Persistent', 'inventory_item_template', true)
ON CONFLICT (key) DO NOTHING;

UPDATE "capability_definition"
   SET entity_types = entity_types || ARRAY['verity.inventory.attribute', 'verity.inventory.template'],
       updated_at = now()
 WHERE id = 'verity.capability.inventory'
   AND NOT ('verity.inventory.attribute' = ANY(entity_types));
