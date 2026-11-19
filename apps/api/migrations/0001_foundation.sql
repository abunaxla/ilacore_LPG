-- 0001 foundation: tenants, tenant isolation (row-level security), append-only event ledger,
-- outbox and audit log. See docs/adr/0003-state-and-event-ledger.md.
--
-- Migrations are immutable once applied: the runner refuses to start if a file's checksum changes.
-- The application connects as a login role that is a member of ilacore_app (never a superuser),
-- so row-level security always applies to it.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ilacore_app') THEN
    CREATE ROLE ilacore_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO ilacore_app;

-- The tenant for the current transaction, set by the API with set_config('app.tenant_id', ..., true).
-- When it is not set this returns NULL, so every tenant policy matches nothing: deny by default.
CREATE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION reject_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

-- Tenants (organisations). Created by provisioning, never by the application role.
CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(btrim(name)) > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Append-only business event ledger: every business change writes here in the same transaction.
CREATE TABLE business_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id        uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id),
  event_type      text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  aggregate_type  text NOT NULL,
  aggregate_id    text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id        uuid,
  device_id       uuid,
  occurred_at     timestamptz NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX business_events_aggregate_idx
  ON business_events (tenant_id, aggregate_type, aggregate_id, id);

-- Outbox: work for background workers (SMS, alerts, report refresh), written with the event.
CREATE TABLE outbox (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants (id),
  event_id      uuid NOT NULL REFERENCES business_events (event_id),
  topic         text NOT NULL,
  payload       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  available_at  timestamptz NOT NULL DEFAULT now(),
  attempts      integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error    text,
  published_at  timestamptz
);
CREATE INDEX outbox_pending_idx ON outbox (available_at) WHERE published_at IS NULL;

-- Audit log: who did what, when, from where. Append-only.
CREATE TABLE audit_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants (id),
  actor_id     uuid,
  device_id    uuid,
  action       text NOT NULL,
  target_type  text,
  target_id    text,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip           inet,
  user_agent   text,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_tenant_at_idx ON audit_log (tenant_id, at);

-- Append-only enforcement: applies to every role, including the table owner.
CREATE TRIGGER business_events_append_only
  BEFORE UPDATE OR DELETE ON business_events FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER business_events_no_truncate
  BEFORE TRUNCATE ON business_events FOR EACH STATEMENT EXECUTE FUNCTION reject_change();
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION reject_change();

-- Row-level security: tenant isolation enforced by the database, not only by application code.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants
  USING (id = current_tenant_id());

ALTER TABLE business_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON business_events
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON outbox
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_log
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Least privilege for the application role.
GRANT SELECT ON tenants TO ilacore_app;
GRANT SELECT, INSERT ON business_events TO ilacore_app;
GRANT SELECT, INSERT ON audit_log TO ilacore_app;
GRANT SELECT, INSERT ON outbox TO ilacore_app;
GRANT UPDATE (attempts, last_error, published_at, available_at) ON outbox TO ilacore_app;
