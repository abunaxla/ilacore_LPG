-- 0003 items: the tracked-item core (ADR 0004) with the cylinder as its first type, RFID tags,
-- cylinder sizes, organisation settings, and scan sessions with their raw reads.
-- See docs/drafts/cylinder-state-model.md.
--
-- A tracked item's state is four independent dimensions. Three live on tracked_items / cylinders;
-- the restricted security dimension lives in its own table so ordinary queries never touch it.
-- Every state change is written to business_events in the same transaction (by the API).

-- Organisation-wide settings. One row per tenant. NULL means "not set yet".
CREATE TABLE tenant_settings (
  tenant_id               uuid PRIMARY KEY REFERENCES tenants (id),
  retest_interval_months  integer CHECK (retest_interval_months BETWEEN 1 AND 240),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid REFERENCES users (id)
);

-- Sizes each organisation runs. Retired sizes stay so old records keep their size; never deleted.
CREATE TABLE cylinder_sizes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants (id),
  name             text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 30),
  nominal_fill_kg  numeric(7, 2) NOT NULL CHECK (nominal_fill_kg > 0 AND nominal_fill_kg <= 1000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES users (id),
  retired_at       timestamptz,
  retired_by       uuid REFERENCES users (id)
);
CREATE UNIQUE INDEX cylinder_sizes_name_idx ON cylinder_sizes (tenant_id, lower(btrim(name)));

-- The permanent identity of anything tracked. Never deleted; the id survives tag replacement.
CREATE TABLE tracked_items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants (id),
  item_type            text NOT NULL CHECK (item_type IN ('cylinder')),
  -- Ownership is separate from custody: the distributor owns it until it is sold outright.
  owner_kind           text NOT NULL DEFAULT 'distributor' CHECK (owner_kind IN ('distributor', 'buyer')),
  physical_state       text NOT NULL CHECK (physical_state IN ('empty', 'filling', 'full', 'damaged', 'scrapped')),
  custody_kind         text NOT NULL CHECK (custody_kind IN
                         ('depot', 'truck', 'wholesaler', 'retailer', 'end_customer', 'sold_outright', 'missing')),
  custody_location_id  uuid REFERENCES locations (id),
  -- The truck, wholesaler or retailer holding it. Their tables arrive with custody (step 4).
  custody_holder_id    uuid,
  registered_at        timestamptz NOT NULL DEFAULT now(),
  registered_by        uuid REFERENCES users (id),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK ((custody_kind = 'depot') = (custody_location_id IS NOT NULL))
);
CREATE INDEX tracked_items_custody_idx ON tracked_items (tenant_id, custody_kind, custody_location_id);

-- Restricted: only investigation roles may see this. The API never joins it into ordinary reads.
CREATE TABLE item_security (
  item_id     uuid PRIMARY KEY REFERENCES tracked_items (id),
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  state       text NOT NULL DEFAULT 'normal'
                CHECK (state IN ('normal', 'missing', 'sighted', 'under_investigation', 'recovered')),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Cylinder-specific attributes of a tracked item.
CREATE TABLE cylinders (
  item_id          uuid PRIMARY KEY REFERENCES tracked_items (id),
  tenant_id        uuid NOT NULL REFERENCES tenants (id),
  size_id          uuid NOT NULL REFERENCES cylinder_sizes (id),
  -- The stamped serial, normalised (upper case). Optional: not every cylinder has a readable one.
  serial           text CHECK (serial IS NULL OR length(serial) BETWEEN 1 AND 40),
  manufacturer     text CHECK (manufacturer IS NULL OR length(btrim(manufacturer)) BETWEEN 1 AND 80),
  manufactured_on  date,
  tare_kg          numeric(7, 2) CHECK (tare_kg IS NULL OR (tare_kg > 0 AND tare_kg <= 1000)),
  last_test_on     date,
  -- An explicit due date (for example stamped). When NULL the API derives it from last_test_on + the interval.
  next_test_due    date,
  -- A hold set by QC or an inspector. Time never lifts it.
  safety_hold      text NOT NULL DEFAULT 'none' CHECK (safety_hold IN ('none', 'quarantined', 'condemned')),
  CHECK (next_test_due IS NULL OR last_test_on IS NULL OR next_test_due > last_test_on),
  CHECK (manufactured_on IS NULL OR last_test_on IS NULL OR last_test_on >= manufactured_on)
);
-- Two manufacturers may use the same serial, so the serial is unique per manufacturer.
CREATE UNIQUE INDEX cylinders_serial_idx
  ON cylinders (tenant_id, lower(coalesce(btrim(manufacturer), '')), serial) WHERE serial IS NOT NULL;
CREATE INDEX cylinders_size_idx ON cylinders (tenant_id, size_id);

-- RFID tags. A tag number belongs to one item forever: once retired it can never be attached again.
CREATE TABLE item_tags (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id),
  epc            text NOT NULL CHECK (epc ~ '^[0-9A-F]{8,64}$'),
  item_id        uuid NOT NULL REFERENCES tracked_items (id),
  attached_at    timestamptz NOT NULL DEFAULT now(),
  attached_by    uuid REFERENCES users (id),
  retired_at     timestamptz,
  retired_by     uuid REFERENCES users (id),
  retire_reason  text CHECK (retire_reason IN ('damaged', 'unreadable', 'lost', 'other')),
  UNIQUE (tenant_id, epc),
  CHECK ((retired_at IS NULL) = (retire_reason IS NULL))
);
-- At most one active tag per item.
CREATE UNIQUE INDEX item_tags_active_idx ON item_tags (item_id) WHERE retired_at IS NULL;

-- A retired tag stays retired, and a tag never moves to another item.
CREATE FUNCTION item_tags_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'tag % is retired and can never change', OLD.epc USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.epc <> OLD.epc OR NEW.item_id <> OLD.item_id THEN
    RAISE EXCEPTION 'a tag never changes number or item' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER item_tags_guard BEFORE UPDATE ON item_tags FOR EACH ROW EXECUTE FUNCTION item_tags_guard();
CREATE TRIGGER item_tags_no_delete BEFORE DELETE ON item_tags FOR EACH ROW EXECUTE FUNCTION reject_change();

-- One scanning job by one reader or handheld at one place.
CREATE TABLE scan_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants (id),
  purpose      text NOT NULL CHECK (purpose IN ('registration', 'dispatch', 'stocktake', 'audit')),
  location_id  uuid NOT NULL REFERENCES locations (id),
  -- The device that opened it. Only that device may send reads to it. NULL when opened on the web.
  device_id    uuid REFERENCES devices (id),
  note         text CHECK (note IS NULL OR length(note) <= 200),
  opened_by    uuid NOT NULL REFERENCES users (id),
  opened_at    timestamptz NOT NULL DEFAULT now(),
  closed_by    uuid REFERENCES users (id),
  closed_at    timestamptz,
  CHECK ((closed_at IS NULL) = (closed_by IS NULL))
);
CREATE INDEX scan_sessions_open_idx ON scan_sessions (tenant_id, opened_at DESC);

-- Each upload carries a batch id chosen by the reader, so a retried upload (after a dropped connection)
-- is recognised and not stored twice.
CREATE TABLE scan_batches (
  session_id   uuid NOT NULL REFERENCES scan_sessions (id),
  batch_id     uuid NOT NULL,
  tenant_id    uuid NOT NULL REFERENCES tenants (id),
  read_count   integer NOT NULL CHECK (read_count >= 0),
  received_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, batch_id)
);

-- Raw reads exactly as the reader sent them, duplicates and strays included. Append-only evidence.
CREATE TABLE scan_reads (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants (id),
  session_id   uuid NOT NULL REFERENCES scan_sessions (id),
  batch_id     uuid NOT NULL,
  epc          text NOT NULL CHECK (epc ~ '^[0-9A-F]{8,64}$'),
  rssi         numeric(5, 1) CHECK (rssi IS NULL OR rssi BETWEEN -127 AND 20),
  antenna      smallint CHECK (antenna IS NULL OR antenna BETWEEN 0 AND 64),
  read_at      timestamptz NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (session_id, batch_id) REFERENCES scan_batches (session_id, batch_id)
);
CREATE INDEX scan_reads_session_idx ON scan_reads (session_id, epc);

CREATE TRIGGER scan_reads_append_only
  BEFORE UPDATE OR DELETE ON scan_reads FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER scan_reads_no_truncate
  BEFORE TRUNCATE ON scan_reads FOR EACH STATEMENT EXECUTE FUNCTION reject_change();
CREATE TRIGGER scan_batches_append_only
  BEFORE UPDATE OR DELETE ON scan_batches FOR EACH ROW EXECUTE FUNCTION reject_change();

-- Row-level security on every tenant table, forced for the owner too.
ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_settings
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE cylinder_sizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE cylinder_sizes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cylinder_sizes
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE tracked_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracked_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tracked_items
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE item_security ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_security FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON item_security
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE cylinders ENABLE ROW LEVEL SECURITY;
ALTER TABLE cylinders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cylinders
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE item_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_tags FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON item_tags
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE scan_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON scan_sessions
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE scan_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON scan_batches
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE scan_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_reads FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON scan_reads
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- Least privilege. Nothing here can be deleted by the application.
GRANT SELECT, INSERT ON tenant_settings TO lpg_app;
GRANT UPDATE (retest_interval_months, updated_at, updated_by) ON tenant_settings TO lpg_app;
GRANT SELECT, INSERT ON cylinder_sizes TO lpg_app;
GRANT UPDATE (retired_at, retired_by) ON cylinder_sizes TO lpg_app;
GRANT SELECT, INSERT ON tracked_items TO lpg_app;
GRANT UPDATE (owner_kind, physical_state, custody_kind, custody_location_id, custody_holder_id, updated_at)
  ON tracked_items TO lpg_app;
GRANT SELECT, INSERT ON item_security TO lpg_app;
GRANT UPDATE (state, updated_at) ON item_security TO lpg_app;
GRANT SELECT, INSERT ON cylinders TO lpg_app;
GRANT UPDATE (serial, manufacturer, manufactured_on, tare_kg, last_test_on, next_test_due, safety_hold)
  ON cylinders TO lpg_app;
GRANT SELECT, INSERT ON item_tags TO lpg_app;
GRANT UPDATE (retired_at, retired_by, retire_reason) ON item_tags TO lpg_app;
GRANT SELECT, INSERT ON scan_sessions TO lpg_app;
GRANT UPDATE (closed_at, closed_by) ON scan_sessions TO lpg_app;
GRANT SELECT, INSERT ON scan_batches TO lpg_app;
GRANT SELECT, INSERT ON scan_reads TO lpg_app;

-- Existing organisations get the default sizes and an empty settings row. Row-level security applies
-- to the owner too, so each tenant is written inside its own scope. tenant_directory (no RLS) lists them.
DO $$
DECLARE
  t uuid;
BEGIN
  FOR t IN SELECT tenant_id FROM tenant_directory LOOP
    PERFORM set_config('app.tenant_id', t::text, true);
    INSERT INTO tenant_settings (tenant_id) VALUES (t) ON CONFLICT DO NOTHING;
    INSERT INTO cylinder_sizes (tenant_id, name, nominal_fill_kg)
      VALUES (t, '6 kg', 6), (t, '13 kg', 13), (t, '50 kg', 50)
      ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
