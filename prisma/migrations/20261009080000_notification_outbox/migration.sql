-- ---------------------------------------------------------------------------
-- ADR-039: outbound notifications go through an outbox, per-tenant opt-in
-- ---------------------------------------------------------------------------
-- domain_event is the outbox: a dispatcher reads undelivered events per tenant,
-- turns the ones a tenant subscribed to into notifications for the members of
-- the subscribed role, and only then sets delivered_at (the one column the
-- write-once trigger lets change). At-least-once, so every notification the
-- dispatcher writes carries a dedupe key (event, channel, recipient) and a
-- retry after a crash cannot write it twice. Nothing is sent unless a client
-- administrator subscribed a role to that event type: default off.

CREATE TABLE "notification_subscription" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "event_name" TEXT NOT NULL,
    "role_id" UUID NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'InApp',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_subscription_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notification_subscription_event_shape" CHECK ("event_name" ~ '^[a-z][a-z0-9_.]{2,120}$'),
    -- In-app first (ADR-039 clause 4). Email and WhatsApp-class channels widen this check.
    CONSTRAINT "notification_subscription_channel_known" CHECK ("channel" IN ('InApp'))
);

CREATE UNIQUE INDEX "notification_subscription_tenant_event_role_channel_key"
  ON "notification_subscription"("tenant_id", "event_name", "role_id", "channel");
CREATE INDEX "notification_subscription_tenant_id_event_name_idx" ON "notification_subscription"("tenant_id", "event_name");

ALTER TABLE "notification_subscription" ADD CONSTRAINT "notification_subscription_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_subscription" ADD CONSTRAINT "notification_subscription_role_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "role"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "notification_subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_subscription" FORCE ROW LEVEL SECURITY;
CREATE POLICY "notification_subscription_isolation" ON "notification_subscription"
  USING ("tenant_id" = verity.current_tenant_id()) WITH CHECK ("tenant_id" = verity.current_tenant_id());

-- Idempotency key for dispatcher-written notifications: event id, channel, recipient.
ALTER TABLE "notification" ADD COLUMN "dedupe_key" TEXT;
CREATE UNIQUE INDEX "notification_tenant_id_dedupe_key_key" ON "notification"("tenant_id", "dedupe_key") WHERE "dedupe_key" IS NOT NULL;

-- Existing tenant administrators (not the operator's support role) may read and
-- edit their own alert subscriptions.
DO $$ DECLARE target_tenant_id uuid; BEGIN
  FOR target_tenant_id IN SELECT id FROM public.tenant WHERE NOT is_platform LOOP
    PERFORM set_config('verity.tenant_id', target_tenant_id::text, true);
    INSERT INTO public.permission (id, tenant_id, role_id, verb, entity, scope)
    SELECT gen_random_uuid(), r.tenant_id, r.id, v.verb::"PermissionVerb", 'verity.platform.notification_subscription', 'Tenant'
      FROM public.role r
      CROSS JOIN (VALUES ('Read'), ('Edit')) v(verb)
      WHERE r.tenant_id = target_tenant_id
        AND r.name <> 'Verity Operator'
        AND EXISTS (
          SELECT 1 FROM verity.resolve_permissions(r.id) p
          WHERE p.entity = 'verity.platform.role' AND p.verb = 'Edit' AND p.scope = 'Tenant')
    ON CONFLICT (role_id, verb, entity, scope) DO NOTHING;
  END LOOP;
END $$;
