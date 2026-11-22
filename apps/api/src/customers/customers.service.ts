import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { normalizeKenyanPhone } from '@ilacore/domain';
import { randomInt } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { canAt } from '../access/require-at.js';
import { PG_POOL } from '../db/database.module.js';
import { withTenant } from '../db/tenant-transaction.js';
import { recordAudit } from '../events/record-audit.js';
import type { RequestMeta } from '../http/request.js';
import type { AuthContext } from '../identity/auth-context.js';
import { apiError } from '../identity/errors.js';
import { hashSecret, verifySecret } from '../identity/hashing.js';
import { CODE_WINDOW_MS, deliveryOf, MAX_CODE_ATTEMPTS, SmsService, type SmsDelivery } from './sms.js';

export type CustomerKind = 'retailer' | 'wholesaler';

export interface CustomerSummary {
  id: string;
  kind: CustomerKind;
  name: string;
  area: string | null;
  labelCode: string;
  phoneVerified: boolean;
  /** Only for holders of customer.manage. */
  phone?: string;
  billedThrough: { id: string; name: string } | null;
  emptiesOwed: number;
  /** One shop, office only, number not yet checked: what became of the check code's SMS. */
  checkSms?: SmsDelivery | null;
}

interface CustomerRow {
  id: string;
  kind: CustomerKind;
  name: string;
  area: string | null;
  label_code: string;
  phone: string;
  phone_verified_at: Date | null;
  billed_through: string | null;
  billed_through_name: string | null;
  empties_owed: string;
}

/**
 * Empties a customer owes: approved "empties owed" on confirmed handovers, less extra empties they handed back
 * later (empties beyond what covered that handover's fulls).
 */
const EMPTIES_OWED = `
  greatest(0, coalesce((SELECT sum(CASE WHEN h.owed_approved_at IS NOT NULL THEN h.owed_count ELSE 0 END)
                                 - sum(greatest(0, h.empty_in - (h.full_out - h.sold_out)))
                        FROM handovers h WHERE h.customer_id = cu.id AND h.status = 'confirmed'), 0))`;

const CUSTOMERS = `
  SELECT cu.id, cu.kind, cu.name, cu.area, cu.label_code, cu.phone, cu.phone_verified_at,
         cu.billed_through, w.name AS billed_through_name, ${EMPTIES_OWED} AS empties_owed
  FROM customers cu
  LEFT JOIN customers w ON w.id = cu.billed_through`;

/** Unambiguous characters for QR label codes (no 0/O, 1/I). */
const LABEL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newLabelCode = () => Array.from({ length: 6 }, () => LABEL_ALPHABET[randomInt(LABEL_ALPHABET.length)]).join('');
export const newSmsCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** Retailers and wholesalers, their registered number (verified by SMS code) and their billing link. */
@Injectable()
export class CustomersService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(SmsService) private readonly sms: SmsService,
  ) {}

  /** Registers a customer and sends the check code to their number (the guard checked customer.manage). */
  async register(
    actor: AuthContext,
    input: { kind: CustomerKind; name: string; area?: string | undefined; phone: string; billedThrough?: string | undefined },
    meta: RequestMeta,
  ): Promise<{ id: string }> {
    const name = input.name.trim();
    const area = input.area?.trim() || null;
    const phone = normalizeKenyanPhone(input.phone);
    const fields = [
      ...(name.length >= 1 && name.length <= 80 ? [] : ['name']),
      ...(area && area.length > 120 ? ['area'] : []),
      ...(phone ? [] : ['phone']),
      ...(input.kind === 'wholesaler' && input.billedThrough ? ['billedThrough'] : []),
    ];
    if (fields.length > 0) throw apiError(HttpStatus.BAD_REQUEST, 'invalid_request', 'Check the customer details.', { fields });

    return withTenant(this.pool, actor.tenantId, async (c) => {
      if (input.billedThrough) {
        const w = await c.query<{ kind: string }>('SELECT kind FROM customers WHERE id = $1', [input.billedThrough]);
        if (w.rows[0]?.kind !== 'wholesaler') {
          throw apiError(HttpStatus.BAD_REQUEST, 'not_a_wholesaler', 'Billing can only go through a wholesaler.', { fields: ['billedThrough'] });
        }
      }
      const taken = await c.query('SELECT 1 FROM customers WHERE phone = $1', [phone]);
      if ((taken.rowCount ?? 0) > 0) {
        throw apiError(HttpStatus.CONFLICT, 'phone_taken', 'Another customer already has this number.', { fields: ['phone'] });
      }
      let id: string | undefined;
      for (let attempt = 0; !id && attempt < 5; attempt++) {
        const r = await c.query<{ id: string }>(
          `INSERT INTO customers (tenant_id, kind, name, area, phone, billed_through, label_code, created_by)
           SELECT current_tenant_id(), $1, $2, $3, $4, $5, $6, $7
           WHERE NOT EXISTS (SELECT 1 FROM customers WHERE label_code = $6)
           RETURNING id`,
          [input.kind, name, area, phone, input.billedThrough ?? null, newLabelCode(), actor.userId],
        );
        id = r.rows[0]?.id;
      }
      if (!id) throw new Error('could not allocate a label code');
      await this.sendPhoneCheck(c, id, name, phone!);
      await recordAudit(c, { action: 'customer.registered', actorId: actor.userId, targetType: 'customer', targetId: id, details: { kind: input.kind }, ...meta });
      return { id };
    });
  }

  /** Sends a fresh check code to a customer whose number isn't verified yet. */
  async resendPhoneCheck(actor: AuthContext, id: string): Promise<void> {
    await withTenant(this.pool, actor.tenantId, async (c) => {
      const cu = await this.row(c, id, true);
      if (cu.phone_verified_at) throw apiError(HttpStatus.CONFLICT, 'already_verified', 'This number is already verified.');
      await this.sendPhoneCheck(c, id, cu.name, cu.phone);
    });
  }

  /** Checks the code the customer received. Wrong tries count even though the request fails. */
  async verifyPhone(actor: AuthContext, id: string, code: string, meta: RequestMeta): Promise<void> {
    const outcome = await withTenant(this.pool, actor.tenantId, async (c) => {
      const r = await c.query<{
        phone_verified_at: Date | null; phone_code_hash: string | null; phone_code_expires_at: Date | null; phone_code_attempts: number;
      }>('SELECT phone_verified_at, phone_code_hash, phone_code_expires_at, phone_code_attempts FROM customers WHERE id = $1 FOR UPDATE', [id]);
      const cu = r.rows[0];
      if (!cu) throw apiError(HttpStatus.NOT_FOUND, 'not_found', 'No such customer.');
      if (cu.phone_verified_at) return 'ok' as const;
      if (!cu.phone_code_hash || !cu.phone_code_expires_at || cu.phone_code_expires_at.getTime() < Date.now()) return 'expired' as const;
      if (cu.phone_code_attempts >= MAX_CODE_ATTEMPTS) return 'too_many' as const;
      if (!(await verifySecret(cu.phone_code_hash, code))) {
        await c.query('UPDATE customers SET phone_code_attempts = phone_code_attempts + 1 WHERE id = $1', [id]);
        return 'wrong' as const;
      }
      await c.query(
        `UPDATE customers SET phone_verified_at = now(), phone_code_hash = NULL, phone_code_expires_at = NULL WHERE id = $1`,
        [id],
      );
      await recordAudit(c, { action: 'customer.phone_verified', actorId: actor.userId, targetType: 'customer', targetId: id, ...meta });
      return 'ok' as const;
    });
    if (outcome === 'expired') throw apiError(HttpStatus.CONFLICT, 'code_expired', 'That code has expired. Send a new one.');
    if (outcome === 'too_many') throw apiError(HttpStatus.CONFLICT, 'too_many_attempts', 'Too many wrong tries. Send a new code.');
    if (outcome === 'wrong') throw apiError(HttpStatus.BAD_REQUEST, 'wrong_code', 'That code is not right.', { fields: ['code'] });
  }

  /** Customers, for the office (customer.manage) or for drivers choosing a shop (handover.perform, no numbers). */
  async list(actor: AuthContext, f: { search?: string | undefined; kind?: CustomerKind | undefined }): Promise<CustomerSummary[]> {
    const search = f.search?.trim() ? `%${f.search.trim().toLowerCase().replace(/[%_\\]/g, '')}%` : null;
    return withTenant(this.pool, actor.tenantId, async (c) => {
      const r = await c.query<CustomerRow>(
        `${CUSTOMERS}
         WHERE ($1::text IS NULL OR lower(cu.name) LIKE $1 OR lower(coalesce(cu.area, '')) LIKE $1 OR cu.label_code = upper(btrim($2)))
           AND ($3::text IS NULL OR cu.kind = $3)
         ORDER BY lower(cu.name) LIMIT 200`,
        [search, f.search ?? '', f.kind ?? null],
      );
      return r.rows.map((x) => this.summary(actor, x));
    });
  }

  async get(actor: AuthContext, id: string): Promise<CustomerSummary> {
    return withTenant(this.pool, actor.tenantId, async (c) => {
      const s = this.summary(actor, await this.row(c, id));
      if (s.phoneVerified || !canAt(actor, ['customer.manage'], null)) return s;
      const m = await c.query<Parameters<typeof deliveryOf>[0] & object>(
        `SELECT status, delivery_status, delivery_reason, delivery_at FROM sms_messages
       WHERE customer_id = $1 AND purpose = 'phone_check' ORDER BY id DESC LIMIT 1`,
        [id],
      );
      return { ...s, checkSms: deliveryOf(m.rows[0]) };
    });
  }

  /** The shop behind a QR label. */
  async byLabel(actor: AuthContext, code: string): Promise<CustomerSummary> {
    return withTenant(this.pool, actor.tenantId, async (c) => {
      const r = await c.query<CustomerRow>(`${CUSTOMERS} WHERE cu.label_code = $1`, [code.trim().toUpperCase()]);
      if (!r.rows[0]) throw apiError(HttpStatus.NOT_FOUND, 'not_found', 'No customer has that label.');
      return this.summary(actor, r.rows[0]);
    });
  }

  /** Messages kept by the SMS stand-in, newest first. Test screen only: nothing is really sent. */
  async standInMessages(actor: AuthContext): Promise<{ id: string; to: string; customer: string; purpose: string; body: string; createdAt: Date }[]> {
    return withTenant(this.pool, actor.tenantId, async (c) => {
      const r = await c.query<{ id: string; to_phone: string; name: string; purpose: string; body: string; created_at: Date }>(
        `SELECT m.id, m.to_phone, cu.name, m.purpose, m.body, m.created_at
         FROM sms_messages m JOIN customers cu ON cu.id = m.customer_id
         WHERE m.status = 'stand_in' ORDER BY m.id DESC LIMIT 100`,
      );
      return r.rows.map((m) => ({ id: String(m.id), to: m.to_phone, customer: m.name, purpose: m.purpose, body: m.body, createdAt: m.created_at }));
    });
  }

  private async sendPhoneCheck(c: PoolClient, id: string, name: string, phone: string): Promise<void> {
    const code = newSmsCode();
    await c.query(
      `UPDATE customers SET phone_code_hash = $2, phone_code_expires_at = $3, phone_code_attempts = 0 WHERE id = $1`,
      [id, await hashSecret(code), new Date(Date.now() + CODE_WINDOW_MS)],
    );
    await this.sms.send(c, {
      customerId: id,
      purpose: 'phone_check',
      to: phone,
      body: `ILACORE: ${name} is being registered for gas deliveries. Give this code to the person registering you: ${code}. It works for 15 minutes.`,
      secret: code,
    });
  }

  private async row(c: PoolClient, id: string, lock = false): Promise<CustomerRow> {
    const r = await c.query<CustomerRow>(`${CUSTOMERS} WHERE cu.id = $1${lock ? ' FOR UPDATE OF cu' : ''}`, [id]);
    if (!r.rows[0]) throw apiError(HttpStatus.NOT_FOUND, 'not_found', 'No such customer.');
    return r.rows[0];
  }

  private summary(actor: AuthContext, r: CustomerRow): CustomerSummary {
    return {
      id: r.id,
      kind: r.kind,
      name: r.name,
      area: r.area,
      labelCode: r.label_code,
      phoneVerified: r.phone_verified_at !== null,
      ...(canAt(actor, ['customer.manage'], null) ? { phone: r.phone } : {}),
      billedThrough: r.billed_through ? { id: r.billed_through, name: r.billed_through_name! } : null,
      emptiesOwed: Number(r.empties_owed),
    };
  }
}
