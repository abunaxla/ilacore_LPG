-- 0004 trips: dispatch from a depot onto a truck, and returns back into the depot.
-- docs/design/custody-and-liability.md. A scan is an observation; custody moves only when the driver signs for
-- the load (depot -> truck) or when a returning cylinder is scanned back in at the depot.

-- One truck leaving one depot with one driver. 'loading' until the driver signs, then 'out'.
-- Settlement (loaded = delivered + returned + shortfall) comes with handovers to customers.
CREATE TABLE trips (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id),
  depot_id      uuid NOT NULL REFERENCES locations (id),
  driver_id     uuid NOT NULL REFERENCES users (id),
  -- Number plate without spaces, upper case, for example KCA123A.
  vehicle_reg   text NOT NULL CHECK (vehicle_reg ~ '^[A-Z0-9]{2,12}$'),
  status        text NOT NULL DEFAULT 'loading' CHECK (status IN ('loading', 'out', 'cancelled')),
  note          text CHECK (note IS NULL OR length(note) <= 200),
  opened_by     uuid NOT NULL REFERENCES users (id),
  opened_at     timestamptz NOT NULL DEFAULT now(),
  signed_at     timestamptz,
  cancelled_by  uuid REFERENCES users (id),
  cancelled_at  timestamptz,
  CHECK (status = 'loading' OR status = 'cancelled' OR signed_at IS NOT NULL),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK ((cancelled_at IS NULL) = (cancelled_by IS NULL))
);
CREATE INDEX trips_depot_idx ON trips (tenant_id, depot_id, opened_at DESC);
CREATE INDEX trips_driver_idx ON trips (tenant_id, driver_id, opened_at DESC);

-- The load. A line is added while loading; it can be taken off again until the driver signs (removed_at),
-- and it is closed when the cylinder comes back (returned_at). Lines are never deleted.
CREATE TABLE trip_lines (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants (id),
  trip_id         uuid NOT NULL REFERENCES trips (id),
  item_id         uuid NOT NULL REFERENCES tracked_items (id),
  -- The tag as it was scanned (a retired tag still identifies the cylinder, and is an exception).
  epc             text NOT NULL CHECK (epc ~ '^[0-9A-F]{8,64}$'),
  physical_state  text NOT NULL CHECK (physical_state IN ('empty', 'full')),
  -- Why a supervisor must approve this line before the driver can sign. NULL when nothing is odd.
  exception       text CHECK (exception IS NULL OR exception IN ('not_at_depot', 'not_full', 'retired_tag')),
  approved_by     uuid REFERENCES users (id),
  approved_at     timestamptz,
  added_by        uuid NOT NULL REFERENCES users (id),
  added_at        timestamptz NOT NULL DEFAULT now(),
  removed_by      uuid REFERENCES users (id),
  removed_at      timestamptz,
  returned_by     uuid REFERENCES users (id),
  returned_at     timestamptz,
  returned_state  text CHECK (returned_state IS NULL OR returned_state IN ('empty', 'full')),
  CHECK ((approved_at IS NULL) = (approved_by IS NULL)),
  CHECK (approved_at IS NULL OR exception IS NOT NULL),
  CHECK ((removed_at IS NULL) = (removed_by IS NULL)),
  CHECK ((returned_at IS NULL) = (returned_by IS NULL)),
  CHECK ((returned_at IS NULL) = (returned_state IS NULL)),
  CHECK (removed_at IS NULL OR returned_at IS NULL)
);
-- A cylinder is on at most one live line anywhere: never on two trucks, never twice on one.
CREATE UNIQUE INDEX trip_lines_live_idx ON trip_lines (item_id) WHERE removed_at IS NULL AND returned_at IS NULL;
CREATE INDEX trip_lines_trip_idx ON trip_lines (trip_id);

CREATE TRIGGER trip_lines_no_delete BEFORE DELETE ON trip_lines FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER trips_no_delete BEFORE DELETE ON trips FOR EACH ROW EXECUTE FUNCTION reject_change();

ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON trips
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE trip_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON trip_lines
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT ON trips TO lpg_app;
GRANT UPDATE (status, signed_at, cancelled_by, cancelled_at) ON trips TO lpg_app;
GRANT SELECT, INSERT ON trip_lines TO lpg_app;
GRANT UPDATE (approved_by, approved_at, removed_by, removed_at, returned_by, returned_at, returned_state)
  ON trip_lines TO lpg_app;
