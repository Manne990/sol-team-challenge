CREATE TRIGGER memberships_keep_last_owner_on_role_change
BEFORE UPDATE OF role ON memberships
WHEN OLD.role = 'owner' AND NEW.role != 'owner' AND OLD.revoked_at IS NULL
  AND (SELECT count(*) FROM memberships
       WHERE organization_id = OLD.organization_id AND role = 'owner' AND revoked_at IS NULL) <= 1
BEGIN
  SELECT RAISE(ABORT, 'organization must retain an owner');
END;

CREATE TRIGGER memberships_keep_last_owner_on_revoke
BEFORE UPDATE OF revoked_at ON memberships
WHEN OLD.role = 'owner' AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
  AND (SELECT count(*) FROM memberships
       WHERE organization_id = OLD.organization_id AND role = 'owner' AND revoked_at IS NULL) <= 1
BEGIN
  SELECT RAISE(ABORT, 'organization must retain an owner');
END;
