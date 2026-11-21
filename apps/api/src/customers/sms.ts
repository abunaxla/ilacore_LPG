import type { PoolClient } from 'pg';

export type SmsPurpose = 'phone_check' | 'handover_code';

export interface OutgoingSms {
  customerId: string;
  handoverId?: string;
  purpose: SmsPurpose;
  to: string;
  body: string;
}

/**
 * Every message to a customer goes through here, inside the caller's transaction.
 *
 * Until an SMS provider is chosen this is the stand-in (docs/agreed-decisions.md, 21 Nov 2026): the message is
 * kept with status 'stand_in' and shown on the test screen; nothing leaves the system. When a provider is added,
 * messages are written 'pending' and a worker sends them, and bodies holding codes stop being kept in full.
 */
export async function sendSms(c: PoolClient, m: OutgoingSms): Promise<void> {
  await c.query(
    `INSERT INTO sms_messages (tenant_id, customer_id, handover_id, purpose, to_phone, body, status)
     VALUES (current_tenant_id(), $1, $2, $3, $4, $5, 'stand_in')`,
    [m.customerId, m.handoverId ?? null, m.purpose, m.to, m.body],
  );
}

/** How long an SMS code works, from when it is sent (agreed: 15 minutes). */
export const CODE_WINDOW_MS = 15 * 60 * 1000;

/** Wrong tries allowed on one code. */
export const MAX_CODE_ATTEMPTS = 5;
