ALTER TABLE imports ADD COLUMN source_digest TEXT;
ALTER TABLE imports ADD COLUMN mapping_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE imports ADD COLUMN preview_json TEXT NOT NULL DEFAULT '[]';

CREATE UNIQUE INDEX imports_source_replay_idx
  ON imports(organization_id, creator_id, kind, source_digest)
  WHERE source_digest IS NOT NULL;
