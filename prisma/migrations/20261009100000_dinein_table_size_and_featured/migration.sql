-- ---------------------------------------------------------------------------
-- Table size on the floor plan, and a "special dish" flag (Task 126 items 1.6, 1.9)
-- ---------------------------------------------------------------------------
-- A table is drawn at a size, not only a point. Defaults match the size the editor
-- already drew every table at, so nothing moves on screen until a manager resizes one.
-- `featured` marks a special or priority dish so the order pad can filter to it.

ALTER TABLE "dining_table"
  ADD COLUMN "width" INTEGER NOT NULL DEFAULT 110,
  ADD COLUMN "height" INTEGER NOT NULL DEFAULT 84;

ALTER TABLE "dining_table"
  ADD CONSTRAINT "dining_table_size_range" CHECK ("width" BETWEEN 40 AND 600 AND "height" BETWEEN 40 AND 600);

ALTER TABLE "menu_item" ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false;
