CREATE TABLE organizations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  settings_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK (length(id) >= 12), CHECK (json_valid(settings_json))
);
CREATE TABLE users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, disabled_at TEXT
);
CREATE TABLE memberships (
  organization_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL,
  created_at TEXT NOT NULL, revoked_at TEXT, PRIMARY KEY (organization_id,user_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CHECK (role IN ('owner','member','viewer'))
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, organization_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
  revoked_at TEXT, last_seen_at TEXT,
  FOREIGN KEY (organization_id,user_id) REFERENCES memberships(organization_id,user_id) ON DELETE CASCADE
);
CREATE TABLE companies (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT NOT NULL,
  organization_number TEXT, external_reference TEXT, website TEXT, phone TEXT, industry TEXT,
  size TEXT, address TEXT, lifecycle_status TEXT NOT NULL DEFAULT 'prospect', owner_id TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]', description TEXT NOT NULL DEFAULT '', archived_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (organization_id,id), UNIQUE (organization_id,organization_number),
  UNIQUE (organization_id,external_reference),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,owner_id) REFERENCES memberships(organization_id,user_id),
  CHECK (lifecycle_status IN ('lead','prospect','customer','former_customer','partner')),
  CHECK (version > 0), CHECK (json_valid(tags_json))
);
CREATE INDEX companies_list_idx ON companies(organization_id,archived_at,name,id);
CREATE TABLE contacts (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, company_id TEXT, first_name TEXT NOT NULL,
  last_name TEXT NOT NULL, email TEXT, phone TEXT, job_title TEXT, owner_id TEXT,
  status TEXT NOT NULL DEFAULT 'active', tags_json TEXT NOT NULL DEFAULT '[]',
  communication_preference TEXT NOT NULL DEFAULT 'email', archived_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,company_id) REFERENCES companies(organization_id,id),
  FOREIGN KEY (organization_id,owner_id) REFERENCES memberships(organization_id,user_id),
  CHECK (status IN ('active','inactive','do_not_contact')),
  CHECK (communication_preference IN ('email','phone','sms','none')),
  CHECK (version > 0), CHECK (json_valid(tags_json))
);
CREATE INDEX contacts_list_idx ON contacts(organization_id,archived_at,last_name,first_name,id);
CREATE TABLE pipeline_stages (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT NOT NULL, position INTEGER NOT NULL,
  color TEXT NOT NULL DEFAULT '#64748b', is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (organization_id,id), UNIQUE (organization_id,position),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  CHECK (position >= 0), CHECK (is_active IN (0,1)), CHECK (version > 0)
);
CREATE TABLE deals (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT NOT NULL, company_id TEXT NOT NULL,
  owner_id TEXT NOT NULL, amount_minor INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD',
  expected_close_date TEXT, probability INTEGER NOT NULL DEFAULT 0, stage_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', loss_reason TEXT, archived_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,company_id) REFERENCES companies(organization_id,id),
  FOREIGN KEY (organization_id,owner_id) REFERENCES memberships(organization_id,user_id),
  FOREIGN KEY (organization_id,stage_id) REFERENCES pipeline_stages(organization_id,id),
  CHECK (amount_minor >= 0), CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  CHECK (probability BETWEEN 0 AND 100), CHECK (status IN ('open','won','lost')),
  CHECK (status != 'lost' OR length(trim(loss_reason)) > 0), CHECK (version > 0)
);
CREATE INDEX deals_list_idx ON deals(organization_id,archived_at,status,stage_id,id);
CREATE TABLE deal_contacts (
  organization_id TEXT NOT NULL, deal_id TEXT NOT NULL, contact_id TEXT NOT NULL,
  created_at TEXT NOT NULL, PRIMARY KEY (organization_id,deal_id,contact_id),
  FOREIGN KEY (organization_id,deal_id) REFERENCES deals(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,contact_id) REFERENCES contacts(organization_id,id) ON DELETE CASCADE
);
CREATE TABLE deal_stage_history (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, deal_id TEXT NOT NULL,
  from_stage_id TEXT, to_stage_id TEXT NOT NULL, actor_id TEXT NOT NULL, occurred_at TEXT NOT NULL,
  FOREIGN KEY (organization_id,deal_id) REFERENCES deals(organization_id,id),
  FOREIGN KEY (organization_id,from_stage_id) REFERENCES pipeline_stages(organization_id,id),
  FOREIGN KEY (organization_id,to_stage_id) REFERENCES pipeline_stages(organization_id,id),
  FOREIGN KEY (organization_id,actor_id) REFERENCES memberships(organization_id,user_id)
);
CREATE TABLE activities (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, type TEXT NOT NULL, subject TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '', occurred_at TEXT NOT NULL, creator_id TEXT NOT NULL,
  creator_name_snapshot TEXT NOT NULL, company_id TEXT, company_name_snapshot TEXT,
  contact_id TEXT, contact_name_snapshot TEXT, deal_id TEXT, deal_name_snapshot TEXT,
  follow_up_task_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,creator_id) REFERENCES memberships(organization_id,user_id),
  FOREIGN KEY (organization_id,company_id) REFERENCES companies(organization_id,id),
  FOREIGN KEY (organization_id,contact_id) REFERENCES contacts(organization_id,id),
  FOREIGN KEY (organization_id,deal_id) REFERENCES deals(organization_id,id),
  FOREIGN KEY (organization_id,follow_up_task_id) REFERENCES tasks(organization_id,id),
  CHECK (type IN ('call','email','meeting','note','status_change')), CHECK (version > 0)
);
CREATE INDEX activities_timeline_idx ON activities(organization_id,occurred_at DESC,id DESC);
CREATE TABLE activity_participants (
  organization_id TEXT NOT NULL, activity_id TEXT NOT NULL, contact_id TEXT NOT NULL,
  display_name_snapshot TEXT NOT NULL, PRIMARY KEY (organization_id,activity_id,contact_id),
  FOREIGN KEY (organization_id,activity_id) REFERENCES activities(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,contact_id) REFERENCES contacts(organization_id,id)
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  assignee_id TEXT NOT NULL, due_at TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open', company_id TEXT, contact_id TEXT, deal_id TEXT,
  archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1, UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,assignee_id) REFERENCES memberships(organization_id,user_id),
  FOREIGN KEY (organization_id,company_id) REFERENCES companies(organization_id,id),
  FOREIGN KEY (organization_id,contact_id) REFERENCES contacts(organization_id,id),
  FOREIGN KEY (organization_id,deal_id) REFERENCES deals(organization_id,id),
  CHECK (priority IN ('low','normal','high','urgent')),
  CHECK (status IN ('open','in_progress','completed')), CHECK (version > 0),
  CHECK ((status='completed' AND completed_at IS NOT NULL) OR (status!='completed' AND completed_at IS NULL))
);
CREATE INDEX tasks_due_idx ON tasks(organization_id,status,due_at,id);
CREATE TABLE notifications (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, recipient_id TEXT NOT NULL,
  kind TEXT NOT NULL, deduplication_key TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  entity_type TEXT, entity_id TEXT, created_at TEXT NOT NULL, read_at TEXT,
  UNIQUE (organization_id,recipient_id,deduplication_key),
  FOREIGN KEY (organization_id,recipient_id) REFERENCES memberships(organization_id,user_id)
);
CREATE TABLE saved_views (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, user_id TEXT NOT NULL, resource TEXT NOT NULL,
  name TEXT NOT NULL, definition_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, UNIQUE (organization_id,user_id,resource,name),
  FOREIGN KEY (organization_id,user_id) REFERENCES memberships(organization_id,user_id),
  CHECK (json_valid(definition_json)), CHECK (version > 0)
);
CREATE TABLE imports (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, creator_id TEXT NOT NULL, kind TEXT NOT NULL,
  idempotency_key TEXT NOT NULL, status TEXT NOT NULL, row_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, committed_at TEXT,
  UNIQUE (organization_id,idempotency_key),
  FOREIGN KEY (organization_id,creator_id) REFERENCES memberships(organization_id,user_id),
  CHECK (kind IN ('companies','contacts')), CHECK (status IN ('preview','committed','failed'))
);
CREATE TABLE merge_redirects (
  organization_id TEXT NOT NULL, entity_type TEXT NOT NULL, retired_id TEXT NOT NULL,
  survivor_id TEXT NOT NULL, merged_by TEXT NOT NULL, merged_at TEXT NOT NULL,
  PRIMARY KEY (organization_id,entity_type,retired_id),
  FOREIGN KEY (organization_id,merged_by) REFERENCES memberships(organization_id,user_id),
  CHECK (entity_type IN ('company','contact')), CHECK (retired_id != survivor_id)
);
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, actor_id TEXT, action TEXT NOT NULL,
  entity_type TEXT NOT NULL, entity_id TEXT, correlation_id TEXT NOT NULL,
  summary_json TEXT NOT NULL, occurred_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  CHECK (json_valid(summary_json))
);
CREATE INDEX audit_events_list_idx ON audit_events(organization_id,occurred_at DESC,id DESC);
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,'audit events are append-only'); END;
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT,'audit events are append-only'); END;
CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
