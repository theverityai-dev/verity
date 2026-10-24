-- ADR-055: durable, tenant-scoped agent approvals and a bounded record of each agent turn. Additive: two new tables, no change to
-- any existing table or row.

CREATE TABLE "agent_pending_action" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "command_key" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "decided_at" TIMESTAMP(3),
    "outcome" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_pending_action_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agent_pending_action_status_known" CHECK ("status" IN ('pending', 'approved', 'rejected', 'expired')),
    CONSTRAINT "agent_pending_action_decided_consistently" CHECK (
      ("status" = 'pending' AND "decided_at" IS NULL)
      OR ("status" IN ('approved', 'rejected') AND "decided_at" IS NOT NULL)
      OR "status" = 'expired'
    )
);
CREATE INDEX "agent_pending_action_tenant_id_actor_id_status_idx" ON "agent_pending_action"("tenant_id", "actor_id", "status");
CREATE INDEX "agent_pending_action_created_at_idx" ON "agent_pending_action"("created_at");
ALTER TABLE "agent_pending_action" ADD CONSTRAINT "agent_pending_action_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "agent_turn" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'agent',
    "user_message" TEXT NOT NULL,
    "reply" TEXT NOT NULL,
    "tool_calls" JSONB NOT NULL DEFAULT '[]',
    "pending_action_id" UUID,
    "model" TEXT,
    "duration_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_turn_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "agent_turn_tenant_id_actor_id_created_at_idx" ON "agent_turn"("tenant_id", "actor_id", "created_at");
CREATE INDEX "agent_turn_created_at_idx" ON "agent_turn"("created_at");
ALTER TABLE "agent_turn" ADD CONSTRAINT "agent_turn_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_turn" ADD CONSTRAINT "agent_turn_pending_action_id_fkey" FOREIGN KEY ("pending_action_id") REFERENCES "agent_pending_action"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- INV-001.
ALTER TABLE "agent_pending_action" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_pending_action" FORCE ROW LEVEL SECURITY;
CREATE POLICY "agent_pending_action_isolation" ON "agent_pending_action"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());
ALTER TABLE "agent_turn" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_turn" FORCE ROW LEVEL SECURITY;
CREATE POLICY "agent_turn_isolation" ON "agent_turn"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());
