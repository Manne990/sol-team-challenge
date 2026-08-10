CREATE TABLE merge_operations (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, entity_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL, retired_id TEXT NOT NULL, survivor_id TEXT NOT NULL,
  decisions_json TEXT NOT NULL, actor_id TEXT NOT NULL, merged_at TEXT NOT NULL,
  UNIQUE (organization_id, idempotency_key),
  FOREIGN KEY (organization_id,actor_id) REFERENCES memberships(organization_id,user_id),
  CHECK (entity_type IN ('company','contact')), CHECK (json_valid(decisions_json))
);
CREATE INDEX merge_operations_entities_idx
  ON merge_operations(organization_id,entity_type,survivor_id,retired_id);
