import type { PoolClient } from 'pg';

export interface NewBusinessEvent {
  /** Dotted lower-case name, for example "handover.completed". */
  readonly type: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly actorId?: string;
  readonly deviceId?: string;
  /** When it happened in the field (may be earlier than recording, for offline devices). */
  readonly occurredAt: Date;
  /** Outbox topics for background work triggered by this event (SMS, alerts...). */
  readonly outboxTopics?: readonly string[];
}

/**
 * Appends a business event and its outbox rows.
 *
 * Must be called inside withTenant(): the tenant comes from the transaction setting, never from
 * the caller, so code can't write an event for another tenant. Because it shares the caller's
 * transaction, the event, the outbox rows and the state change all commit or roll back together.
 */
export async function recordEvent(client: PoolClient, event: NewBusinessEvent): Promise<{ eventId: string }> {
  const { rows } = await client.query<{ event_id: string }>(
    `INSERT INTO business_events
       (tenant_id, event_type, aggregate_type, aggregate_id, payload, actor_id, device_id, occurred_at)
     VALUES (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7)
     RETURNING event_id`,
    [
      event.type,
      event.aggregateType,
      event.aggregateId,
      JSON.stringify(event.payload),
      event.actorId ?? null,
      event.deviceId ?? null,
      event.occurredAt,
    ],
  );
  const eventId = rows[0]?.event_id;
  if (!eventId) {
    throw new Error('Event insert returned no id');
  }

  for (const topic of event.outboxTopics ?? []) {
    await client.query(
      `INSERT INTO outbox (tenant_id, event_id, topic, payload)
       VALUES (current_tenant_id(), $1, $2, $3)`,
      [eventId, topic, JSON.stringify({ eventId, type: event.type, aggregateId: event.aggregateId })],
    );
  }

  return { eventId };
}
