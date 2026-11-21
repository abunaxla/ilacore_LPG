import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Auth, RequirePermission } from '../access/decorators.js';
import { requestMeta } from '../http/request.js';
import { parseBody } from '../http/validation.js';
import type { AuthContext } from '../identity/auth-context.js';
import { CustomersService } from './customers.service.js';

const uuid = new ParseUUIDPipe();

const RegisterBody = z.object({
  kind: z.enum(['retailer', 'wholesaler']),
  name: z.string().max(200),
  area: z.string().max(400).optional(),
  phone: z.string().min(1).max(30),
  billedThrough: z.uuid().optional(),
});
const VerifyBody = z.object({ code: z.string().regex(/^\d{6}$/) });
const ListQuery = z.object({ search: z.string().max(80).optional(), kind: z.enum(['retailer', 'wholesaler']).optional() });

/**
 * Retailers and wholesalers. The office (customer.manage) registers them and checks their number; drivers
 * (handover.perform) look them up to pick the shop, without seeing numbers. Customers aren't at a location.
 */
@Controller()
export class CustomersController {
  constructor(@Inject(CustomersService) private readonly customers: CustomersService) {}

  @Get('customers')
  @RequirePermission(['customer.manage', 'handover.perform'], { anyLocation: true })
  list(@Auth() ctx: AuthContext, @Query() raw: unknown) {
    return this.customers.list(ctx, parseBody(ListQuery, raw));
  }

  @Post('customers')
  @RequirePermission('customer.manage')
  register(@Auth() ctx: AuthContext, @Req() req: Request, @Body() raw: unknown) {
    return this.customers.register(ctx, parseBody(RegisterBody, raw), requestMeta(req));
  }

  @Get('customers/by-label/:code')
  @RequirePermission(['customer.manage', 'handover.perform'], { anyLocation: true })
  byLabel(@Auth() ctx: AuthContext, @Param('code') code: string) {
    return this.customers.byLabel(ctx, code);
  }

  @Get('customers/:id')
  @RequirePermission('customer.manage')
  get(@Auth() ctx: AuthContext, @Param('id', uuid) id: string) {
    return this.customers.get(ctx, id);
  }

  @Post('customers/:id/phone-check')
  @HttpCode(204)
  @RequirePermission('customer.manage')
  async resend(@Auth() ctx: AuthContext, @Param('id', uuid) id: string) {
    await this.customers.resendPhoneCheck(ctx, id);
  }

  @Post('customers/:id/phone-check/verify')
  @HttpCode(204)
  @RequirePermission('customer.manage')
  async verify(@Auth() ctx: AuthContext, @Req() req: Request, @Param('id', uuid) id: string, @Body() raw: unknown) {
    await this.customers.verifyPhone(ctx, id, parseBody(VerifyBody, raw).code, requestMeta(req));
  }

  /** Test screen for the SMS stand-in: what would have been sent. */
  @Get('sms/stand-in')
  @RequirePermission(['settings.manage', 'customer.manage'])
  standIn(@Auth() ctx: AuthContext) {
    return this.customers.standInMessages(ctx);
  }
}
