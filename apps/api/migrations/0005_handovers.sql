-- 0005 handovers: customers (retailers and wholesalers) and the driver's handover to them from a trip.
-- docs/design/custody-and-liability.md, docs/design/sms-confirmation.md, docs/agreed-decisions.md (21 Nov 2026).
-- Custody moves only when the customer confirms (the code they were sent, read to the driver).

-- Retailers and wholesalers. One registered number each, verified by an SMS code before any handover.
CREATE TABLE customers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants (id),
  kind                   text NOT NULL CHECK (kind IN ('retailer', 'wholesaler')),
  name                   text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  -- Where to find them, in words ("Kayole, next to the stage").
  area                   text CHECK (area IS NULL OR length(area) <= 120),
  -- International format, for example +254712345678.
  phone                  text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  phone_verified_at      timestamptz,
  phone_code_hash        text,
  phone_code_expires_at  timestamptz,
  phone_code_attempts    integer NOT NULL DEFAULT 0 CHECK (phone_code_attempts >= 0),
  -- Billing link: NULL is direct; otherwise the wholesaler that is invoiced for this retailer.
  billed_through         uuid REFERENCES customers (id),
  -- Printed on the shop's QR label; identifies the shop during a handover.
  label_code             text NOT NULL CHECK (label_code ~ '^[A-Z0-9]{6}$'),
  created_by             uuid NOT NULL REFERENCES users (id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'retailer' OR billed_through IS NULL),
  CHECK (billed_through IS NULL OR billed_through <> id)
);
CREATE UNIQUE INDEX customers_phone_idx ON customers (tenant_id, phone);
CREATE UNIQUE INDEX customers_label_idx ON customers (tenant_id, label_code);
CREATE INDEX customers_name_idx ON customers (tenant_id, lower(name));

-- One handover from a driver's truck to one customer. 'open' while scanning; 'awaiting_confirmation' once the
-- code is sent (counts frozen); then 'confirmed', 'unconfirmed' (window passed), 'disputed' or 'cancelled'.
CREATE TABLE handovers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants (id),
  trip_id             uuid NOT NULL REFERENCES trips (id),
  customer_id         uuid NOT NULL REFERENCES customers (id),
  giver_id            uuid NOT NULL REFERENCES users (id),
  status              text NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'awaiting_confirmation', 'confirmed', 'unconfirmed', 'disputed', 'cancelled')),
  -- Short reference quoted in the SMS.
  ref                 text NOT NULL CHECK (ref ~ '^[0-9]{4}$'),
  opened_at           timestamptz NOT NULL DEFAULT now(),
  -- "Empties owed": requested by the driver, approved by a depot supervisor.
  owed_count          integer CHECK (owed_count IS NULL OR owed_count > 0),
  owed_due_on         date,
  owed_requested_at   timestamptz,
  owed_approved_by    uuid REFERENCES users (id),
  owed_approved_at    timestamptz,
  -- Frozen when the code is sent.
  full_out            integer CHECK (full_out IS NULL OR full_out >= 0),
  empty_in            integer CHECK (empty_in IS NULL OR empty_in >= 0),
  sold_out            integer CHECK (sold_out IS NULL OR sold_out >= 0),
  shortfall           integer CHECK (shortfall IS NULL OR shortfall >= 0),
  -- The confirmation code (hashed), its window and tries. One fresh code may be sent (codes_sent <= 2).
  code_hash           text,
  code_sent_at        timestamptz,
  code_expires_at     timestamptz,
  code_attempts       integer NOT NULL DEFAULT 0 CHECK (code_attempts >= 0),
  codes_sent          integer NOT NULL DEFAULT 0 CHECK (codes_sent BETWEEN 0 AND 2),
  closed_at           timestamptz,
  dispute_note        text CHECK (dispute_note IS NULL OR length(dispute_note) <= 300),
  CHECK ((owed_count IS NULL) = (owed_due_on IS NULL) AND (owed_count IS NULL) = (owed_requested_at IS NULL)),
  CHECK ((owed_approved_at IS NULL) = (owed_approved_by IS NULL)),
  CHECK (owed_approved_at IS NULL OR owed_count IS NOT NULL),
  CHECK (status = 'open' OR status = 'cancelled' OR (code_sent_at IS NOT NULL AND full_out IS NOT NULL)),
  CHECK ((status IN ('open', 'awaiting_confirmation')) = (closed_at IS NULL))
);
-- One handover in progress per truck at a time.
CREATE UNIQUE INDEX handovers_live_idx ON handovers (trip_id) WHERE status IN ('open', 'awaiting_confirmation');
CREATE INDEX handovers_customer_idx ON handovers (tenant_id, customer_id, opened_at DESC);

-- The cylinders in a handover: fulls going to the customer ('out', some sold outright) and empties coming back ('in').
CREATE TABLE handover_lines (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants (id),
  handover_id    uuid NOT NULL REFERENCES handovers (id),
  item_id        uuid NOT NULL REFERENCES tracked_items (id),
  epc            text NOT NULL CHECK (epc ~ '^[0-9A-F]{8,64}$'),
  direction      text NOT NULL CHECK (direction IN ('out', 'in')),
  sold_outright  boolean NOT NULL DEFAULT false,
  added_at       timestamptz NOT NULL DEFAULT now(),
  removed_at     timestamptz,
  CHECK (direction = 'out' OR NOT sold_outright)
);
CREATE UNIQUE INDEX handover_lines_live_idx ON handover_lines (handover_id, item_id) WHERE removed_at IS NULL;

-- Tags offered as empties that aren't ours. They don't count as cover; they are kept as a record.
CREATE TABLE handover_foreign_tags (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants (id),
  handover_id  uuid NOT NULL REFERENCES handovers (id),
  tag          text NOT NULL CHECK (length(tag) BETWEEN 1 AND 80),
  seen_at      timestamptz NOT NULL DEFAULT now()
);

-- A trip line is closed by a delivery as well as by a return. Empties collected on the round get a line too,
-- so they can be returned to the depot like the rest of the load.
ALTER TABLE trip_lines ADD COLUMN delivered_at timestamptz;
ALTER TABLE trip_lines ADD COLUMN delivered_in uuid REFERENCES handovers (id);
ALTER TABLE trip_lines ADD COLUMN collected_in uuid REFERENCES handovers (id);
ALTER TABLE trip_lines ADD CONSTRAINT trip_lines_delivered_check
  CHECK ((delivered_at IS NULL) = (delivered_in IS NULL) AND (delivered_at IS NULL OR (returned_at IS NULL AND removed_at IS NULL)));
DROP INDEX trip_lines_live_idx;
CREATE UNIQUE INDEX trip_lines_live_idx ON trip_lines (item_id)
  WHERE removed_at IS NULL AND returned_at IS NULL AND delivered_at IS NULL;

-- Messages to customers. With the stand-in nothing is sent ('stand_in'); a provider worker will send 'pending' ones.
CREATE TABLE sms_messages (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants (id),
  customer_id  uuid NOT NULL REFERENCES customers (id),
  handover_id  uuid REFERENCES handovers (id),
  purpose      text NOT NULL CHECK (purpose IN ('phone_check', 'handover_code')),
  to_phone     text NOT NULL,
  body         text NOT NULL CHECK (length(body) <= 480),
  status       text NOT NULL CHECK (status IN ('stand_in', 'pending', 'sent', 'failed')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sms_messages_created_idx ON sms_messages (tenant_id, created_at DESC);

CREATE TRIGGER customers_no_delete BEFORE DELETE ON customers FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER handovers_no_delete BEFORE DELETE ON handovers FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER handover_lines_no_delete BEFORE DELETE ON handover_lines FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER handover_foreign_tags_no_change BEFORE UPDATE OR DELETE ON handover_foreign_tags
  FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER sms_messages_no_delete BEFORE DELETE ON sms_messages FOR EACH ROW EXECUTE FUNCTION reject_change();

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customers
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
ALTER TABLE handovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE handovers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON handovers
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
ALTER TABLE handover_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE handover_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON handover_lines
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
ALTER TABLE handover_foreign_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE handover_foreign_tags FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON handover_foreign_tags
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
ALTER TABLE sms_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sms_messages
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT ON customers TO lpg_app;
GRANT UPDATE (name, area, billed_through, phone_verified_at, phone_code_hash, phone_code_expires_at, phone_code_attempts)
  ON customers TO lpg_app;
GRANT SELECT, INSERT ON handovers TO lpg_app;
GRANT UPDATE (status, owed_count, owed_due_on, owed_requested_at, owed_approved_by, owed_approved_at,
              full_out, empty_in, sold_out, shortfall, code_hash, code_sent_at, code_expires_at, code_attempts,
              codes_sent, closed_at, dispute_note)
  ON handovers TO lpg_app;
GRANT SELECT, INSERT ON handover_lines TO lpg_app;
GRANT UPDATE (removed_at, sold_outright) ON handover_lines TO lpg_app;
GRANT SELECT, INSERT ON handover_foreign_tags TO lpg_app;
GRANT UPDATE (delivered_at, delivered_in) ON trip_lines TO lpg_app;
GRANT SELECT, INSERT ON sms_messages TO lpg_app;
