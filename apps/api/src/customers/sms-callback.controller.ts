import { Body, Controller, HttpCode, HttpStatus, Inject, NotFoundException, Param, Post } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Public } from '../access/decorators.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { SmsService } from './sms.js';

/** What Africa's Talking posts (form-encoded) when a message's delivery status changes. Other fields are ignored. */
const DeliveryReport = z.object({
  id: z.string().min(1).max(100),
  status: z.string().min(1).max(40),
  failureReason: z.string().max(80).optional(),
});

/**
 * Delivery reports from Africa's Talking. They don't sign their callbacks, so the address itself carries a secret
 * (AT_CALLBACK_TOKEN); any other address is "not found". A report for a message we don't know is accepted and
 * dropped, so the provider stops retrying it.
 */
@Controller('sms/africastalking')
export class SmsCallbackController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(SmsService) private readonly sms: SmsService,
  ) {}

  @Post('delivery/:token')
  @Public()
  @HttpCode(HttpStatus.OK)
  async delivery(@Param('token') token: string, @Body() raw: unknown): Promise<{ ok: true }> {
    if (!this.tokenMatches(token)) throw new NotFoundException();
    const report = DeliveryReport.safeParse(raw);
    if (report.success) await this.sms.recordDelivery(report.data.id, report.data.status, report.data.failureReason);
    return { ok: true };
  }

  private tokenMatches(token: string): boolean {
    const want = this.env.AT_CALLBACK_TOKEN;
    if (!want) return false;
    const a = Buffer.from(token);
    const b = Buffer.from(want);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
