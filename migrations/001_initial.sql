PRAGMA foreign_keys = ON;

CREATE TABLE organizations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  settings_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(settings_json)),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0)
) STRICT;
CREATE TABLE users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT NOT NULL,
  first_name TEXT NOT NULL, last_name TEXT NOT NULL, disabled_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0)
) STRICT;
CREATE TABLE memberships (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','member','viewer')), status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('invited','active','revoked')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  UNIQUE(organization_id,user_id), UNIQUE(id,organization_id),
  FOREIGN KEY(organization_id) REFERENCES organizations(id), FOREIGN KEY(user_id) REFERENCES users(id)
) STRICT;
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, organization_id TEXT NOT NULL, membership_id TEXT NOT NULL,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, last_seen_at TEXT NOT NULL,
  FOREIGN KEY(membership_id,organization_id) REFERENCES memberships(id,organization_id)
) STRICT;
CREATE TABLE companies (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT NOT NULL, organization_number TEXT, external_reference TEXT,
  website TEXT, phone TEXT, industry TEXT, size TEXT, address_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(address_json)),
  lifecycle_status TEXT NOT NULL CHECK(lifecycle_status IN ('lead','prospect','customer','inactive')),
  owner_membership_id TEXT, tags_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags_json)), description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  UNIQUE(id,organization_id), UNIQUE(organization_id,organization_number), UNIQUE(organization_id,external_reference),
  FOREIGN KEY(organization_id) REFERENCES organizations(id), FOREIGN KEY(owner_membership_id,organization_id) REFERENCES memberships(id,organization_id)
) STRICT;
CREATE TABLE contacts (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, company_id TEXT, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
  email TEXT COLLATE NOCASE, phone TEXT, job_title TEXT, owner_membership_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('lead','active','inactive')), tags_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags_json)),
  communication_preference TEXT NOT NULL DEFAULT 'email' CHECK(communication_preference IN ('email','phone','none')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  UNIQUE(id,organization_id), FOREIGN KEY(organization_id) REFERENCES organizations(id),
  FOREIGN KEY(company_id,organization_id) REFERENCES companies(id,organization_id),
  FOREIGN KEY(owner_membership_id,organization_id) REFERENCES memberships(id,organization_id)
) STRICT;
CREATE TABLE pipeline_stages (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT NOT NULL, position INTEGER NOT NULL CHECK(position >= 0),
  color TEXT NOT NULL, is_won INTEGER NOT NULL DEFAULT 0 CHECK(is_won IN (0,1)), is_lost INTEGER NOT NULL DEFAULT 0 CHECK(is_lost IN (0,1)),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  UNIQUE(id,organization_id), UNIQUE(organization_id,position), UNIQUE(organization_id,name), CHECK(NOT(is_won=1 AND is_lost=1)),
  FOREIGN KEY(organization_id) REFERENCES organizations(id)
) STRICT;
CREATE TABLE deals (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, company_id TEXT NOT NULL, owner_membership_id TEXT NOT NULL, stage_id TEXT NOT NULL,
  name TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK(amount_minor >= 0), currency TEXT NOT NULL CHECK(length(currency)=3),
  expected_close_date TEXT, probability INTEGER NOT NULL CHECK(probability BETWEEN 0 AND 100),
  status TEXT NOT NULL CHECK(status IN ('open','won','lost')), loss_reason TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  UNIQUE(id,organization_id), CHECK(status='lost' OR loss_reason IS NULL),
  FOREIGN KEY(organization_id) REFERENCES organizations(id), FOREIGN KEY(company_id,organization_id) REFERENCES companies(id,organization_id),
  FOREIGN KEY(owner_membership_id,organization_id) REFERENCES memberships(id,organization_id),
  FOREIGN KEY(stage_id,organization_id) REFERENCES pipeline_stages(id,organization_id)
) STRICT;
CREATE TABLE deal_contacts (
  organization_id TEXT NOT NULL, deal_id TEXT NOT NULL, contact_id TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(deal_id,contact_id), FOREIGN KEY(deal_id,organization_id) REFERENCES deals(id,organization_id),
  FOREIGN KEY(contact_id,organization_id) REFERENCES contacts(id,organization_id)
) STRICT;
CREATE TABLE deal_stage_history (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, deal_id TEXT NOT NULL, from_stage_id TEXT, to_stage_id TEXT NOT NULL,
  actor_membership_id TEXT NOT NULL, moved_at TEXT NOT NULL,
  FOREIGN KEY(deal_id,organization_id) REFERENCES deals(id,organization_id),
  FOREIGN KEY(from_stage_id,organization_id) REFERENCES pipeline_stages(id,organization_id),
  FOREIGN KEY(to_stage_id,organization_id) REFERENCES pipeline_stages(id,organization_id),
  FOREIGN KEY(actor_membership_id,organization_id) REFERENCES memberships(id,organization_id)
) STRICT;
CREATE TABLE activities (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('call','email','meeting','note','status_change')),
  subject TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', occurred_at TEXT NOT NULL, creator_membership_id TEXT NOT NULL,
  creator_label TEXT NOT NULL, company_id TEXT, contact_id TEXT, deal_id TEXT, follow_up_task_id TEXT,
  related_label_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(related_label_json)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), UNIQUE(id,organization_id),
  FOREIGN KEY(creator_membership_id,organization_id) REFERENCES memberships(id,organization_id),
  FOREIGN KEY(company_id,organization_id) REFERENCES companies(id,organization_id),
  FOREIGN KEY(contact_id,organization_id) REFERENCES contacts(id,organization_id), FOREIGN KEY(deal_id,organization_id) REFERENCES deals(id,organization_id)
) STRICT;
CREATE TABLE activity_participants (
  organization_id TEXT NOT NULL, activity_id TEXT NOT NULL, contact_id TEXT NOT NULL,
  PRIMARY KEY(activity_id,contact_id), FOREIGN KEY(activity_id,organization_id) REFERENCES activities(id,organization_id),
  FOREIGN KEY(contact_id,organization_id) REFERENCES contacts(id,organization_id)
) STRICT;
CREATE TABLE tasks (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  assignee_membership_id TEXT NOT NULL, due_at TEXT, priority TEXT NOT NULL CHECK(priority IN ('low','normal','high','urgent')),
  status TEXT NOT NULL CHECK(status IN ('open','completed')), company_id TEXT, contact_id TEXT, deal_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT, archived_at TEXT, version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  UNIQUE(id,organization_id), CHECK((status='completed')=(completed_at IS NOT NULL)),
  FOREIGN KEY(assignee_membership_id,organization_id) REFERENCES memberships(id,organization_id),
  FOREIGN KEY(company_id,organization_id) REFERENCES companies(id,organization_id), FOREIGN KEY(contact_id,organization_id) REFERENCES contacts(id,organization_id),
  FOREIGN KEY(deal_id,organization_id) REFERENCES deals(id,organization_id)
) STRICT;

CREATE TABLE notifications (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, recipient_membership_id TEXT NOT NULL, deduplication_key TEXT NOT NULL,
  type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, entity_type TEXT, entity_id TEXT, created_at TEXT NOT NULL, read_at TEXT,
  UNIQUE(organization_id,recipient_membership_id,deduplication_key),
  FOREIGN KEY(recipient_membership_id,organization_id) REFERENCES memberships(id,organization_id)
) STRICT;
CREATE TABLE saved_views (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, owner_membership_id TEXT NOT NULL, resource TEXT NOT NULL,
  name TEXT NOT NULL, definition_json TEXT NOT NULL CHECK(json_valid(definition_json)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), UNIQUE(organization_id,owner_membership_id,resource,name),
  FOREIGN KEY(owner_membership_id,organization_id) REFERENCES memberships(id,organization_id)
) STRICT;
CREATE TABLE imports (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, creator_membership_id TEXT NOT NULL, resource TEXT NOT NULL CHECK(resource IN ('companies','contacts')),
  status TEXT NOT NULL CHECK(status IN ('preview','committed','failed')), content_hash TEXT NOT NULL, mapping_json TEXT NOT NULL CHECK(json_valid(mapping_json)),
  summary_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(summary_json)), created_at TEXT NOT NULL, committed_at TEXT,
  UNIQUE(organization_id,content_hash,resource), FOREIGN KEY(creator_membership_id,organization_id) REFERENCES memberships(id,organization_id)
) STRICT;
CREATE TABLE import_rows (
  id TEXT PRIMARY KEY, import_id TEXT NOT NULL, row_number INTEGER NOT NULL CHECK(row_number > 0), status TEXT NOT NULL CHECK(status IN ('valid','warning','invalid','committed')),
  normalized_json TEXT NOT NULL CHECK(json_valid(normalized_json)), errors_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(errors_json)), entity_id TEXT,
  UNIQUE(import_id,row_number), FOREIGN KEY(import_id) REFERENCES imports(id) ON DELETE CASCADE
) STRICT;
CREATE TABLE merge_redirects (
  organization_id TEXT NOT NULL, entity_type TEXT NOT NULL CHECK(entity_type IN ('company','contact')), retired_id TEXT NOT NULL, survivor_id TEXT NOT NULL,
  merged_by_membership_id TEXT NOT NULL, merged_at TEXT NOT NULL, PRIMARY KEY(entity_type,retired_id), CHECK(retired_id<>survivor_id),
  FOREIGN KEY(merged_by_membership_id,organization_id) REFERENCES memberships(id,organization_id)
) STRICT;
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, actor_membership_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL,
  entity_id TEXT, correlation_id TEXT NOT NULL, summary_json TEXT NOT NULL CHECK(json_valid(summary_json)), created_at TEXT NOT NULL,
  FOREIGN KEY(organization_id) REFERENCES organizations(id), FOREIGN KEY(actor_membership_id,organization_id) REFERENCES memberships(id,organization_id)
) STRICT;

CREATE INDEX companies_list_idx ON companies(organization_id,archived_at,lifecycle_status,name,id);
CREATE INDEX contacts_list_idx ON contacts(organization_id,archived_at,status,last_name,id);
CREATE INDEX activities_timeline_idx ON activities(organization_id,occurred_at DESC,id DESC);
CREATE INDEX deals_pipeline_idx ON deals(organization_id,status,stage_id,expected_close_date,id);
CREATE INDEX tasks_due_idx ON tasks(organization_id,status,due_at,id);
CREATE INDEX notifications_recipient_idx ON notifications(organization_id,recipient_membership_id,read_at,created_at DESC);
CREATE INDEX audit_events_list_idx ON audit_events(organization_id,created_at DESC,id DESC);

CREATE TRIGGER activities_follow_up_fk BEFORE INSERT ON activities WHEN NEW.follow_up_task_id IS NOT NULL
BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM tasks WHERE id=NEW.follow_up_task_id AND organization_id=NEW.organization_id) THEN RAISE(ABORT,'cross-organization follow-up task') END; END;
CREATE TRIGGER activities_follow_up_fk_update BEFORE UPDATE OF follow_up_task_id,organization_id ON activities WHEN NEW.follow_up_task_id IS NOT NULL
BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM tasks WHERE id=NEW.follow_up_task_id AND organization_id=NEW.organization_id) THEN RAISE(ABORT,'cross-organization follow-up task') END; END;
CREATE TRIGGER merge_redirect_company_fk BEFORE INSERT ON merge_redirects WHEN NEW.entity_type='company'
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM companies WHERE id=NEW.retired_id AND organization_id=NEW.organization_id AND archived_at IS NOT NULL) THEN RAISE(ABORT,'invalid retired company') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM companies WHERE id=NEW.survivor_id AND organization_id=NEW.organization_id) THEN RAISE(ABORT,'invalid survivor company') END;
END;
CREATE TRIGGER merge_redirect_contact_fk BEFORE INSERT ON merge_redirects WHEN NEW.entity_type='contact'
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM contacts WHERE id=NEW.retired_id AND organization_id=NEW.organization_id AND archived_at IS NOT NULL) THEN RAISE(ABORT,'invalid retired contact') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM contacts WHERE id=NEW.survivor_id AND organization_id=NEW.organization_id) THEN RAISE(ABORT,'invalid survivor contact') END;
END;
CREATE TRIGGER audit_events_immutable_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,'audit events are immutable'); END;
CREATE TRIGGER audit_events_immutable_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT,'audit events are immutable'); END;
