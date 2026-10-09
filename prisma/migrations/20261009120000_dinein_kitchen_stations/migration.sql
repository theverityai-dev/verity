-- ---------------------------------------------------------------------------
-- Kitchen stations, courses and tickets (ADR-041; Task 126 Wave 3)
-- ---------------------------------------------------------------------------
-- A station is a view over an outlet's kitchen, not a security boundary: it names the
-- categories it cooks, and a line is routed to it when added (the station is copied onto
-- the line, so re-mapping a category never moves a dish already cooking). A course orders
-- the pass. A ticket is a stored fact of what the kitchen was told and when, numbered per
-- outlet per service day, never edited; reprints are separate rows.

-- Courses ---------------------------------------------------------------------------
CREATE TABLE "menu_course" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "menu_course_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "menu_course_name_present" CHECK (length(btrim("name")) > 0),
    CONSTRAINT "menu_course_priority_range" CHECK ("priority" BETWEEN 0 AND 99)
);
CREATE UNIQUE INDEX "menu_course_tenant_id_name_key" ON "menu_course"("tenant_id", "name");
CREATE UNIQUE INDEX "menu_course_tenant_scoped_id" ON "menu_course"("tenant_id", "id");
ALTER TABLE "menu_course" ADD CONSTRAINT "menu_course_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "menu_course" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menu_course" FORCE ROW LEVEL SECURITY;
CREATE POLICY "menu_course_isolation" ON "menu_course"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

ALTER TABLE "menu_item" ADD COLUMN "course_id" UUID;
ALTER TABLE "menu_item" ADD CONSTRAINT "menu_item_course_fkey" FOREIGN KEY ("tenant_id", "course_id") REFERENCES "menu_course"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Stations ---------------------------------------------------------------------------
CREATE TABLE "kitchen_station" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "kitchen_station_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kitchen_station_name_present" CHECK (length(btrim("name")) > 0)
);
CREATE UNIQUE INDEX "kitchen_station_tenant_id_location_id_name_key" ON "kitchen_station"("tenant_id", "location_id", "name");
CREATE UNIQUE INDEX "kitchen_station_tenant_scoped_id" ON "kitchen_station"("tenant_id", "id");
-- At most one default station per outlet: the one that takes any category no station claims.
CREATE UNIQUE INDEX "kitchen_station_one_default" ON "kitchen_station"("tenant_id", "location_id") WHERE "is_default";
ALTER TABLE "kitchen_station" ADD CONSTRAINT "kitchen_station_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kitchen_station" ADD CONSTRAINT "kitchen_station_location_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "location"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "kitchen_station" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kitchen_station" FORCE ROW LEVEL SECURITY;
CREATE POLICY "kitchen_station_isolation" ON "kitchen_station"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

CREATE TABLE "kitchen_station_category" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "station_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    CONSTRAINT "kitchen_station_category_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "kitchen_station_category_once" ON "kitchen_station_category"("tenant_id", "location_id", "category_id");
ALTER TABLE "kitchen_station_category" ADD CONSTRAINT "kitchen_station_category_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kitchen_station_category" ADD CONSTRAINT "kitchen_station_category_location_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "location"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "kitchen_station_category" ADD CONSTRAINT "kitchen_station_category_station_fkey" FOREIGN KEY ("tenant_id", "station_id") REFERENCES "kitchen_station"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "kitchen_station_category" ADD CONSTRAINT "kitchen_station_category_category_fkey" FOREIGN KEY ("tenant_id", "category_id") REFERENCES "menu_category"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "kitchen_station_category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kitchen_station_category" FORCE ROW LEVEL SECURITY;
CREATE POLICY "kitchen_station_category_isolation" ON "kitchen_station_category"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

-- Order line: routing and course snapshots, kitchen acknowledgement ----------------------
ALTER TABLE "order_line"
  ADD COLUMN "station_id" UUID,
  ADD COLUMN "course_name" TEXT,
  ADD COLUMN "course_priority" INTEGER,
  ADD COLUMN "needs_kitchen_ack" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "kitchen_ack_at" TIMESTAMP(3);
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_station_fkey" FOREIGN KEY ("tenant_id", "station_id") REFERENCES "kitchen_station"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
-- A line is either waiting to be acknowledged or has been; never both.
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_ack_consistent" CHECK ("kitchen_ack_at" IS NULL OR "needs_kitchen_ack" = false);
CREATE INDEX "order_line_needs_kitchen_ack_idx" ON "order_line"("tenant_id", "station_id") WHERE "needs_kitchen_ack";

-- Tickets (append-only) ------------------------------------------------------------------
CREATE TABLE "kitchen_ticket" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "station_id" UUID,
    "order_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "sequence_number" INTEGER NOT NULL,
    "service_day" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kitchen_ticket_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kitchen_ticket_kind_known" CHECK ("kind" IN ('new','addition','void'))
);
CREATE UNIQUE INDEX "kitchen_ticket_number" ON "kitchen_ticket"("tenant_id", "location_id", "service_day", "number");
CREATE UNIQUE INDEX "kitchen_ticket_tenant_scoped_id" ON "kitchen_ticket"("tenant_id", "id");
CREATE INDEX "kitchen_ticket_tenant_id_location_id_created_at_idx" ON "kitchen_ticket"("tenant_id", "location_id", "created_at");
ALTER TABLE "kitchen_ticket" ADD CONSTRAINT "kitchen_ticket_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kitchen_ticket" ADD CONSTRAINT "kitchen_ticket_location_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "location"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "kitchen_ticket" ADD CONSTRAINT "kitchen_ticket_station_fkey" FOREIGN KEY ("tenant_id", "station_id") REFERENCES "kitchen_station"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "kitchen_ticket" ADD CONSTRAINT "kitchen_ticket_order_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "dining_order"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "kitchen_ticket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kitchen_ticket" FORCE ROW LEVEL SECURITY;
CREATE POLICY "kitchen_ticket_read" ON "kitchen_ticket" FOR SELECT USING ("tenant_id" = verity.current_tenant_id());
CREATE POLICY "kitchen_ticket_append" ON "kitchen_ticket" FOR INSERT WITH CHECK ("tenant_id" = verity.current_tenant_id());
CREATE TRIGGER "kitchen_ticket_append_only" BEFORE UPDATE OR DELETE ON "kitchen_ticket"
  FOR EACH ROW EXECUTE FUNCTION verity.reject_mutation();

CREATE TABLE "kitchen_ticket_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "order_line_id" UUID NOT NULL,
    CONSTRAINT "kitchen_ticket_line_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "kitchen_ticket_line_once" ON "kitchen_ticket_line"("ticket_id", "order_line_id");
ALTER TABLE "kitchen_ticket_line" ADD CONSTRAINT "kitchen_ticket_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kitchen_ticket_line" ADD CONSTRAINT "kitchen_ticket_line_ticket_fkey" FOREIGN KEY ("tenant_id", "ticket_id") REFERENCES "kitchen_ticket"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "kitchen_ticket_line" ADD CONSTRAINT "kitchen_ticket_line_line_fkey" FOREIGN KEY ("tenant_id", "order_line_id") REFERENCES "order_line"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "kitchen_ticket_line" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kitchen_ticket_line" FORCE ROW LEVEL SECURITY;
CREATE POLICY "kitchen_ticket_line_read" ON "kitchen_ticket_line" FOR SELECT USING ("tenant_id" = verity.current_tenant_id());
CREATE POLICY "kitchen_ticket_line_append" ON "kitchen_ticket_line" FOR INSERT WITH CHECK ("tenant_id" = verity.current_tenant_id());
CREATE TRIGGER "kitchen_ticket_line_append_only" BEFORE UPDATE OR DELETE ON "kitchen_ticket_line"
  FOR EACH ROW EXECUTE FUNCTION verity.reject_mutation();

CREATE TABLE "kitchen_ticket_print" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "printed_by_user_id" UUID NOT NULL,
    "printed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reprint" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "kitchen_ticket_print_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "kitchen_ticket_print_tenant_id_ticket_id_idx" ON "kitchen_ticket_print"("tenant_id", "ticket_id");
ALTER TABLE "kitchen_ticket_print" ADD CONSTRAINT "kitchen_ticket_print_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kitchen_ticket_print" ADD CONSTRAINT "kitchen_ticket_print_ticket_fkey" FOREIGN KEY ("tenant_id", "ticket_id") REFERENCES "kitchen_ticket"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "kitchen_ticket_print" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kitchen_ticket_print" FORCE ROW LEVEL SECURITY;
CREATE POLICY "kitchen_ticket_print_read" ON "kitchen_ticket_print" FOR SELECT USING ("tenant_id" = verity.current_tenant_id());
CREATE POLICY "kitchen_ticket_print_append" ON "kitchen_ticket_print" FOR INSERT WITH CHECK ("tenant_id" = verity.current_tenant_id());
CREATE TRIGGER "kitchen_ticket_print_append_only" BEFORE UPDATE OR DELETE ON "kitchen_ticket_print"
  FOR EACH ROW EXECUTE FUNCTION verity.reject_mutation();
