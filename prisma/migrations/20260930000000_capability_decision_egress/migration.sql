-- Task 119 / ADR-027 constraint 2: tenant opt-in for sending data to an external
-- structured-decision model.
--
-- Egress is a different kind of decision from turning a feature on (data leaves
-- the tenant boundary), so it gets its own capability definition rather than
-- riding on the workflow capability. A tenant that has not activated this
-- capability never has anything sent: `verity.decision.ask` reads
-- `tenant_activation` and falls back to its declared value instead.
--
-- No tables, no entities: the opt-in is the activation row and nothing else.
INSERT INTO "capability_definition" (id, name, version, dependencies, entity_types, updated_at) VALUES
  ('verity.capability.decision_egress', 'External decision model (data egress)', '1.0.0',
   ARRAY[]::text[], ARRAY[]::text[], now())
ON CONFLICT (id) DO NOTHING;
