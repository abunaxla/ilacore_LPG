-- 0002 access: organisation directory, locations, users, role assignments, devices, sessions, MFA.
-- See docs/design/security-and-accessibility.md and docs/drafts/permission-matrix.md.
--
-- Credentials are never stored in a usable form: passwords and PINs as Argon2id hashes, session tokens,
-- device secrets and recovery codes as SHA-256 hashes, and MFA secrets encrypted by the API.

-- Maps the organisation code typed at sign-in to a tenant. It is read before any tenant is known,
-- so it has no row-level security. It holds nothing but the code and the id.
CREATE TABLE tenant_directory (
  slug       text PRIMARY KEY CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  tenant_id  uuid NOT NULL UNIQUE REFERENCES tenants (id)
);

CREATE TABLE locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  name        text NOT NULL CHECK (length(btrim(name)) > 0),
  kind        text NOT NULL CHECK (kind IN ('depot', 'filling_plant', 'warehouse', 'office')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants (id),
  phone                 text NOT NULL CHECK (phone ~ '^\+254[17][0-9]{8}$'),
  display_name          text NOT NULL CHECK (length(btrim(display_name)) > 0),
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  password_hash         text,
  must_change_password  boolean NOT NULL DEFAULT false,
  pin_hash              text,
  mfa_secret            bytea,
  mfa_enabled_at        timestamptz,
  mfa_last_counter      bigint,
  failed_attempts       integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone),
  CHECK (mfa_enabled_at IS NULL OR mfa_secret IS NOT NULL)
);

CREATE TABLE role_assignments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants (id),
  user_id      uuid NOT NULL REFERENCES users (id),
  role         text NOT NULL CHECK (role ~ '^[a-z_]+$'),
  location_id  uuid REFERENCES locations (id),
  granted_by   uuid REFERENCES users (id),
  granted_at   timestamptz NOT NULL DEFAULT now(),
  revoked_by   uuid REFERENCES users (id),
  revoked_at   timestamptz
);
-- One live grant per user, role and scope.
CREATE UNIQUE INDEX role_assignments_live_idx
  ON role_assignments (user_id, role, coalesce(location_id, '00000000-0000-0000-0000-000000000000'))
  WHERE revoked_at IS NULL;

CREATE TABLE devices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id),
  name           text NOT NULL CHECK (length(btrim(name)) > 0),
  kind           text NOT NULL CHECK (kind IN ('handheld', 'reader')),
  location_id    uuid REFERENCES locations (id),
  secret_hash    bytea NOT NULL,
  registered_by  uuid REFERENCES users (id),
  registered_at  timestamptz NOT NULL DEFAULT now(),
  revoked_by     uuid REFERENCES users (id),
  revoked_at     timestamptz,
  last_seen_at   timestamptz
);

CREATE TABLE sessions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants (id),
  token_hash           bytea NOT NULL UNIQUE,
  user_id              uuid NOT NULL REFERENCES users (id),
  device_id            uuid REFERENCES devices (id),
  channel              text NOT NULL CHECK (channel IN ('web', 'device')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  last_seen_at         timestamptz NOT NULL DEFAULT now(),
  idle_expires_at      timestamptz NOT NULL,
  absolute_expires_at  timestamptz NOT NULL,
  mfa_verified_at      timestamptz,
  revoked_at           timestamptz,
  ip                   inet,
  user_agent           text,
  CHECK ((channel = 'device') = (device_id IS NOT NULL))
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE mfa_recovery_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants (id),
  user_id    uuid NOT NULL REFERENCES users (id),
  code_hash  bytea NOT NULL,
  used_at    timestamptz,
  UNIQUE (user_id, code_hash)
);

-- Row-level security on every tenant table, forced for the owner too.
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON locations
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON role_assignments
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON devices
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sessions
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_recovery_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mfa_recovery_codes
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- Least privilege for the application role. No DELETE anywhere except spent recovery codes;
-- people, grants and devices are disabled or revoked, never erased.
GRANT SELECT ON tenant_directory TO lpg_app;
GRANT SELECT, INSERT ON locations TO lpg_app;
GRANT UPDATE (name) ON locations TO lpg_app;
GRANT SELECT, INSERT ON users TO lpg_app;
GRANT UPDATE (display_name, status, password_hash, must_change_password, pin_hash, mfa_secret, mfa_enabled_at,
              mfa_last_counter, failed_attempts, locked_until) ON users TO lpg_app;
GRANT SELECT, INSERT ON role_assignments TO lpg_app;
GRANT UPDATE (revoked_by, revoked_at) ON role_assignments TO lpg_app;
GRANT SELECT, INSERT ON devices TO lpg_app;
GRANT UPDATE (revoked_by, revoked_at, last_seen_at) ON devices TO lpg_app;
GRANT SELECT, INSERT ON sessions TO lpg_app;
GRANT UPDATE (last_seen_at, idle_expires_at, mfa_verified_at, revoked_at) ON sessions TO lpg_app;
GRANT SELECT, INSERT, DELETE ON mfa_recovery_codes TO lpg_app;
GRANT UPDATE (used_at) ON mfa_recovery_codes TO lpg_app;