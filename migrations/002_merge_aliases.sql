CREATE TABLE merge_aliases (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('company','contact')),
  survivor_id TEXT NOT NULL, retired_id TEXT NOT NULL, alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(organization_id,entity_type,normalized_alias,retired_id),
  FOREIGN KEY(organization_id) REFERENCES organizations(id)
) STRICT;
CREATE INDEX merge_alias_lookup_idx ON merge_aliases(organization_id,entity_type,normalized_alias);
CREATE TRIGGER merged_company_cannot_restore BEFORE UPDATE OF archived_at ON companies
WHEN NEW.archived_at IS NULL AND EXISTS(SELECT 1 FROM merge_redirects WHERE organization_id=NEW.organization_id AND entity_type='company' AND retired_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'merged company cannot be restored'); END;
CREATE TRIGGER merged_contact_cannot_restore BEFORE UPDATE OF archived_at ON contacts
WHEN NEW.archived_at IS NULL AND EXISTS(SELECT 1 FROM merge_redirects WHERE organization_id=NEW.organization_id AND entity_type='contact' AND retired_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'merged contact cannot be restored'); END;
