import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { PG_POOL } from '../db/database.module.js';
import { withTenant } from '../db/tenant-transaction.js';
import { apiError } from '../identity/errors.js';
import { AfricasTalkingSms, toGsm } from './africastalking.js';

export type SmsPurpose = 'phone_check' | 'handover_code';

export interface OutgoingSms {
  customerId: string;
  handoverId?: string;
  purpose: SmsPurpose;
  to: string;
  body: string;
  /** The code inside the body. Not kept in the stored copy of a message really sent. */
  secret?: string;
}

/**
 * Every message to a customer goes through here, inside the caller's transaction.
 *
 * Stand-in (the default, and always in tests): the message is kept with status 'stand_in' and shown on the test
 * screen; nothing leaves the system.
 *
 * Africa's Talking (SMS_PROVIDER=africastalking): the message is sent while the caller's transaction is still open,
 * and kept as 'sent' with its code blanked out. If it can't be sent, this throws, the whole transaction rolls back,
 * and nothing changed: no code is stored, the "send once more" allowance is not used up, and the driver (or the
 * office) can simply press send again. There is deliberately no queue: a code sent minutes late is useless, because
 * the driver is standing at the shop waiting for it.
 */
@Injectable()
export class SmsService {
  private readonly log = new Logger('Sms');
  private readonly provider: AfricasTalkingSms | null;

  constructor(
    @Inject(ENV) env: Env,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {
    // Tests never send anything real, whatever the environment says.
    this.provider =
      env.SMS_PROVIDER === 'africastalking' && env.NODE_ENV !== 'test'
        ? new AfricasTalkingSms({ username: env.AT_USERNAME!, apiKey: env.AT_API_KEY!, from: env.AT_SENDER_ID })
        : null;
  }

  async send(c: PoolClient, m: OutgoingSms): Promise<void> {
    const body = toGsm(m.body);
    if (!this.provider) {
      await this.store(c, m, body, 'stand_in');
      return;
    }
    // Stored first so the table's own checks (length, tenant) refuse a bad message before it costs anything.
    const id = await this.store(c, m, m.secret ? body.replaceAll(m.secret, '[code]') : body, 'sent');
    const out = await this.provider.send(m.to, body);
    if (out.ok) {
      // Kept so the delivery report can find this message (see recordDelivery).
      if (out.messageId) {
        await c.query('UPDATE sms_messages SET provider_message_id = $2 WHERE id = $1', [id, out.messageId]);
        await c.query('INSERT INTO sms_provider_ids (provider_message_id, tenant_id, sms_id) VALUES ($1, current_tenant_id(), $2)', [out.messageId, id]);
      }
      return;
    }
    // The reason is a provider status such as "InvalidPhoneNumber"; never log the number or the text.
    this.log.warn(`SMS ${m.purpose} not sent: ${out.reason}`);
    if (out.badNumber) throw apiError(HttpStatus.BAD_GATEWAY, 'sms_refused', "This number can't receive our SMS. Check the number with the office.");
    if (out.retryable) throw apiError(HttpStatus.BAD_GATEWAY, 'sms_failed', 'The SMS could not be sent just now. Try again.');
    // Wrong key, no balance, sender ID not approved: only the office can fix it.
    throw apiError(HttpStatus.BAD_GATEWAY, 'sms_unavailable', 'SMS sending is not working. Tell the office.');
  }

  /**
   * A delivery report from the provider. Unknown ids are ignored (a message whose request rolled back after sending,
   * or another app's). A final word (delivered or failed) is never overwritten by a late "still on its way".
   */
  async recordDelivery(providerMessageId: string, status: string, reason: string | undefined): Promise<void> {
    const r = await this.pool.query<{ tenant_id: string; sms_id: string }>(
      'SELECT tenant_id, sms_id FROM sms_provider_ids WHERE provider_message_id = $1',
      [providerMessageId],
    );
    const ref = r.rows[0];
    if (!ref) return;
    await withTenant(this.pool, ref.tenant_id, (c) =>
      c.query(
        `UPDATE sms_messages SET delivery_status = $2, delivery_reason = $3, delivery_at = now()
         WHERE id = $1 AND (delivery_status IS NULL OR NOT (delivery_status = ANY ($4::text[])))`,
        [ref.sms_id, status, reason || null, FINAL],
      ),
    );
  }

  private async store(c: PoolClient, m: OutgoingSms, body: string, status: 'stand_in' | 'sent'): Promise<string> {
    const r = await c.query<{ id: string }>(
      `INSERT INTO sms_messages (tenant_id, customer_id, handover_id, purpose, to_phone, body, status)
       VALUES (current_tenant_id(), $1, $2, $3, $4, $5, $6) RETURNING id`,
      [m.customerId, m.handoverId ?? null, m.purpose, m.to, body, status],
    );
    return r.rows[0]!.id;
  }
}

/** Africa's Talking delivery statuses that are the last word on a message. */
const FINAL = ['Success', 'Failed', 'Rejected', 'AbsentSubscriber', 'Expired'];
const FAILED = ['Failed', 'Rejected', 'AbsentSubscriber', 'Expired'];

export type SmsDelivery = { state: 'stand_in' | 'sent' | 'delivered' | 'not_delivered'; reason: string | null; at: Date | null };

/** What became of the latest message of a kind, for the screens: SQL columns in, a plain state out. */
export function deliveryOf(row: { status: string; delivery_status: string | null; delivery_reason: string | null; delivery_at: Date | null } | undefined): SmsDelivery | null {
  if (!row) return null;
  if (row.status === 'stand_in') return { state: 'stand_in', reason: null, at: null };
  if (row.delivery_status === 'Success') return { state: 'delivered', reason: null, at: row.delivery_at };
  if (row.delivery_status && FAILED.includes(row.delivery_status)) {
    // AbsentSubscriber has no failureReason; the status itself is the reason (phone off or out of coverage).
    return { state: 'not_delivered', reason: row.delivery_reason ?? row.delivery_status, at: row.delivery_at };
  }
  return { state: 'sent', reason: null, at: null };
}

/** How long an SMS code works, from when it is sent (agreed: 15 minutes). */
export const CODE_WINDOW_MS = 15 * 60 * 1000;

/** Wrong tries allowed on one code. */
export const MAX_CODE_ATTEMPTS = 5;
