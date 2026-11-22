-- 0006 SMS delivery reports (Africa's Talking calls back when a message is delivered or fails).

ALTER TABLE sms_messages
  ADD COLUMN provider_message_id text CHECK (length(provider_message_id) <= 100),
  -- The provider's word as given (Success, Failed, AbsentSubscriber...) and its reason; NULL until it reports.
  ADD COLUMN delivery_status     text CHECK (length(delivery_status) <= 40),
  ADD COLUMN delivery_reason     text CHECK (length(delivery_reason) <= 80),
  ADD COLUMN delivery_at         timestamptz;
CREATE UNIQUE INDEX sms_messages_provider_idx ON sms_messages (provider_message_id) WHERE provider_message_id IS NOT NULL;

-- Only the delivery columns can change; the message itself stays as written.
GRANT UPDATE (provider_message_id, delivery_status, delivery_reason, delivery_at) ON sms_messages TO lpg_app;

-- A delivery report carries no tenant, so this directory (no row-level security, like tenant_directory) says whose
-- message a provider id is. It holds nothing else.
CREATE TABLE sms_provider_ids (
  provider_message_id text PRIMARY KEY CHECK (length(provider_message_id) <= 100),
  tenant_id           uuid NOT NULL REFERENCES tenants (id),
  sms_id              bigint NOT NULL REFERENCES sms_messages (id)
);
CREATE TRIGGER sms_provider_ids_no_change BEFORE UPDATE OR DELETE ON sms_provider_ids FOR EACH ROW EXECUTE FUNCTION reject_change();
GRANT SELECT, INSERT ON sms_provider_ids TO lpg_app;
