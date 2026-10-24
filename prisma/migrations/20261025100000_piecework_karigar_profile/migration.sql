-- Stylified team management: a karigar's profile (joined on, ID note, emergency contact) and the supervisor who looks after them.
-- All additive and nullable, so existing rows and running code are unaffected. The supervisor is a user of the same tenant,
-- checked by the commands rather than a foreign key (no cross-table cascade on a person leaving; the history stays).
ALTER TABLE "piecework_worker"
  ADD COLUMN "supervisor_user_id" UUID,
  ADD COLUMN "joined_on" DATE,
  ADD COLUMN "id_note" TEXT,
  ADD COLUMN "emergency_contact" TEXT;

CREATE INDEX "piecework_worker_supervisor_idx" ON "piecework_worker" ("tenant_id", "supervisor_user_id");
