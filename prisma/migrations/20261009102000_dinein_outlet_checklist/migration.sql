-- ---------------------------------------------------------------------------
-- Opening and closing checklists per outlet (Task 126 item 1.8)
-- ---------------------------------------------------------------------------
-- An outlet keeps one list of steps for opening and one for closing. Each service
-- day gets a run, created the first time a step is ticked; every tick records who
-- and when, with the step's wording copied so the day reads as it did. This is NOT a
-- gate on selling: an unfinished closing list is surfaced on the outlet's day view.
--
-- Built as three plain tables rather than the platform's template instances, because
-- an outlet's staff would otherwise need a grant on a platform entity to tick a box.

CREATE TABLE "outlet_checklist_step" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "outlet_checklist_step_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "outlet_checklist_step_kind_known" CHECK ("kind" IN ('opening','closing')),
    CONSTRAINT "outlet_checklist_step_label_present" CHECK (length(btrim("label")) > 0)
);

CREATE TABLE "outlet_checklist_run" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "service_day" DATE NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "outlet_checklist_run_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "outlet_checklist_run_kind_known" CHECK ("kind" IN ('opening','closing'))
);

CREATE TABLE "outlet_checklist_tick" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "done_by_user_id" UUID NOT NULL,
    "done_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    CONSTRAINT "outlet_checklist_tick_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "outlet_checklist_step_tenant_scoped_id" ON "outlet_checklist_step"("tenant_id", "id");
CREATE INDEX "outlet_checklist_step_tenant_id_location_id_kind_idx" ON "outlet_checklist_step"("tenant_id", "location_id", "kind");
CREATE UNIQUE INDEX "outlet_checklist_run_day" ON "outlet_checklist_run"("tenant_id", "location_id", "kind", "service_day");
CREATE UNIQUE INDEX "outlet_checklist_run_tenant_scoped_id" ON "outlet_checklist_run"("tenant_id", "id");
CREATE UNIQUE INDEX "outlet_checklist_tick_once" ON "outlet_checklist_tick"("run_id", "step_id");
CREATE INDEX "outlet_checklist_tick_tenant_id_run_id_idx" ON "outlet_checklist_tick"("tenant_id", "run_id");

ALTER TABLE "outlet_checklist_step" ADD CONSTRAINT "outlet_checklist_step_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outlet_checklist_step" ADD CONSTRAINT "outlet_checklist_step_location_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "location"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "outlet_checklist_run" ADD CONSTRAINT "outlet_checklist_run_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outlet_checklist_run" ADD CONSTRAINT "outlet_checklist_run_location_fkey" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "location"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "outlet_checklist_tick" ADD CONSTRAINT "outlet_checklist_tick_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outlet_checklist_tick" ADD CONSTRAINT "outlet_checklist_tick_run_fkey" FOREIGN KEY ("tenant_id", "run_id") REFERENCES "outlet_checklist_run"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "outlet_checklist_tick" ADD CONSTRAINT "outlet_checklist_tick_step_fkey" FOREIGN KEY ("tenant_id", "step_id") REFERENCES "outlet_checklist_step"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "outlet_checklist_step" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outlet_checklist_step" FORCE ROW LEVEL SECURITY;
CREATE POLICY "outlet_checklist_step_isolation" ON "outlet_checklist_step"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

ALTER TABLE "outlet_checklist_run" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outlet_checklist_run" FORCE ROW LEVEL SECURITY;
CREATE POLICY "outlet_checklist_run_isolation" ON "outlet_checklist_run"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

ALTER TABLE "outlet_checklist_tick" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outlet_checklist_tick" FORCE ROW LEVEL SECURITY;
CREATE POLICY "outlet_checklist_tick_isolation" ON "outlet_checklist_tick"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());
