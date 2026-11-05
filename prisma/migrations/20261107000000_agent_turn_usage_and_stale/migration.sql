-- Task 132 stage 1. Additive: two nullable columns, one index, and one more allowed status. No existing row changes.

-- A3: provider-reported tokens per turn, summed per tenant over 24 hours for the daily ceiling.
ALTER TABLE "agent_turn" ADD COLUMN "prompt_tokens" INTEGER, ADD COLUMN "completion_tokens" INTEGER;
CREATE INDEX "agent_turn_tenant_id_created_at_idx" ON "agent_turn"("tenant_id", "created_at");

-- A4: a pending action whose named record changed before Confirm is marked stale and never runs.
ALTER TABLE "agent_pending_action" DROP CONSTRAINT "agent_pending_action_status_known";
ALTER TABLE "agent_pending_action" ADD CONSTRAINT "agent_pending_action_status_known"
  CHECK ("status" IN ('pending', 'approved', 'rejected', 'expired', 'stale'));
ALTER TABLE "agent_pending_action" DROP CONSTRAINT "agent_pending_action_decided_consistently";
ALTER TABLE "agent_pending_action" ADD CONSTRAINT "agent_pending_action_decided_consistently" CHECK (
  ("status" = 'pending' AND "decided_at" IS NULL)
  OR ("status" IN ('approved', 'rejected', 'stale') AND "decided_at" IS NOT NULL)
  OR "status" = 'expired'
);
