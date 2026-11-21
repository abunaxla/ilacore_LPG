import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
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

  constructor(@Inject(ENV) env: Env) {
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
    await this.store(c, m, m.secret ? body.replaceAll(m.secret, '[code]') : body, 'sent');
    const out = await this.provider.send(m.to, body);
    if (out.ok) return;
    // The reason is a provider status such as "InvalidPhoneNumber"; never log the number or the text.
    this.log.warn(`SMS ${m.purpose} not sent: ${out.reason}`);
    if (out.badNumber) throw apiError(HttpStatus.BAD_GATEWAY, 'sms_refused', "This number can't receive our SMS. Check the number with the office.");
    if (out.retryable) throw apiError(HttpStatus.BAD_GATEWAY, 'sms_failed', 'The SMS could not be sent just now. Try again.');
    // Wrong key, no balance, sender ID not approved: only the office can fix it.
    throw apiError(HttpStatus.BAD_GATEWAY, 'sms_unavailable', 'SMS sending is not working. Tell the office.');
  }

  private async store(c: PoolClient, m: OutgoingSms, body: string, status: 'stand_in' | 'sent'): Promise<void> {
    await c.query(
      `INSERT INTO sms_messages (tenant_id, customer_id, handover_id, purpose, to_phone, body, status)
       VALUES (current_tenant_id(), $1, $2, $3, $4, $5, $6)`,
      [m.customerId, m.handoverId ?? null, m.purpose, m.to, body, status],
    );
  }
}

/** How long an SMS code works, from when it is sent (agreed: 15 minutes). */
export const CODE_WINDOW_MS = 15 * 60 * 1000;

/** Wrong tries allowed on one code. */
export const MAX_CODE_ATTEMPTS = 5;
