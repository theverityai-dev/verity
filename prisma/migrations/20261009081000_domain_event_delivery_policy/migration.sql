-- ADR-039: the dispatcher marks an event delivered by setting delivered_at, the
-- one column the write-once trigger (MET-EVE-001) lets change. Row-level
-- security had only read and append policies, so that update matched no rows and
-- the outbox could never drain. This adds the missing UPDATE policy, scoped to
-- the tenant like the others. The trigger still rejects a change to any other
-- column, so this widens nothing except "an event may be marked delivered".

CREATE POLICY "domain_event_mark_delivered" ON "domain_event"
  FOR UPDATE
  USING ("tenant_id" = verity.current_tenant_id())
  WITH CHECK ("tenant_id" = verity.current_tenant_id());
