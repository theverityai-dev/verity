-- Salary on the employee, behind its own permission (Colonel Kebabz DECISIONS.md #3).
-- A manager can run attendance without seeing pay; only roles granted
-- verity.hr.compensation read or set it. The outlet P&L reads totals only.

ALTER TABLE "hr_employee" ADD COLUMN "monthly_salary_minor" INTEGER;
ALTER TABLE "hr_employee" ADD CONSTRAINT "hr_employee_salary_nonneg"
  CHECK ("monthly_salary_minor" IS NULL OR "monthly_salary_minor" >= 0);

INSERT INTO "entity_definition" (key, capability, class, table_name, tenant_scoped) VALUES
  ('verity.hr.compensation', 'verity.capability.hr', 'Persistent', 'hr_employee', true)
ON CONFLICT (key) DO NOTHING;

UPDATE "capability_definition"
   SET entity_types = entity_types || ARRAY['verity.hr.compensation']
 WHERE id = 'verity.capability.hr'
   AND NOT ('verity.hr.compensation' = ANY(entity_types));
