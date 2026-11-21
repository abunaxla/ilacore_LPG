import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Permission } from '@ilacore/domain';
import type { Request } from 'express';
import { z } from 'zod';
import { Auth, RequirePermission } from '../access/decorators.js';
import { requestMeta } from '../http/request.js';
import { parseBody } from '../http/validation.js';
import type { AuthContext } from '../identity/auth-context.js';
import { HandoversService, MAX_TAGS_PER_CALL } from './handovers.service.js';

const uuid = new ParseUUIDPipe();
const VIEW: Permission[] = ['handover.perform', 'dispatch.scan', 'dispatch.approve_exception', 'handover.approve_exception', 'route.settle', 'item.view_position'];

const OpenBody = z.object({ customerId: z.uuid() });
const TagsBody = z.object({ epcs: z.array(z.string().max(80)).min(1).max(MAX_TAGS_PER_CALL) });
const SoldBody = z.object({ sold: z.boolean() });
const OwedBody = z.object({ dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const RequestBody = z.object({ acceptShortfall: z.boolean().default(false) });
const ConfirmBody = z.object({ code: z.string().regex(/^\d{6}$/) });
const DisputeBody = z.object({ note: z.string().max(300).optional() });

/**
 * Handovers from a driver's truck to a customer. Everything but the approval is the trip's own driver
 * (handover.perform); "empties owed" is approved by a depot supervisor (handover.approve_exception).
 * Each is checked at the trip's depot by the service.
 */
@Controller()
export class HandoversController {
  constructor(@Inject(HandoversService) private readonly handovers: HandoversService) {}

  @Post('trips/:tripId/handovers')
  @RequirePermission('handover.perform', { anyLocation: true })
  open(@Auth() ctx: AuthContext, @Req() req: Request, @Param('tripId', uuid) tripId: string, @Body() raw: unknown) {
    return this.handovers.open(ctx, tripId, parseBody(OpenBody, raw).customerId, requestMeta(req));
  }

  @Get('handovers/:id')
  @RequirePermission(VIEW, { anyLocation: true })
  get(@Auth() ctx: AuthContext, @Param('id', uuid) id: string) {
    return this.handovers.get(ctx, id);
  }

  @Post('handovers/:id/out')
  @HttpCode(200)
  @RequirePermission('handover.perform', { anyLocation: true })
  out(@Auth() ctx: AuthContext, @Param('id', uuid) id: string, @Body() raw: unknown) {
    return this.handovers.scanOut(ctx, id, parseBody(TagsBody, raw).epcs);
  }

  @Post('handovers/:id/in')
  @HttpCode(200)
  @RequirePermission('handover.perform', { anyLocation: true })
  in(@Auth() ctx: AuthContext, @Param('id', uuid) id: string, @Body() raw: unknown) {
    return this.handovers.scanIn(ctx, id, parseBody(TagsBody, raw).epcs);
  }

  @Post('handovers/:id/lines/:itemId/remove')
  @HttpCode(200)
  @RequirePermission('handover.perform', { anyLocation: true })
  remove(@Auth() ctx: AuthContext, @Param('id', uuid) id: string, @Param('itemId', uuid) itemId: string) {
    return this.handovers.removeLine(ctx, id, itemId);
  }

  @Post('handovers/:id/lines/:itemId/sold')
  @HttpCode(200)
  @RequirePermission('handover.perform', { anyLocation: true })
  sold(@Auth() ctx: AuthContext, @Param('id', uuid) id: string, @Param('itemId', uuid) itemId: string, @Body() raw: unknown) {
    return this.handovers.setSold(ctx, id, itemId, parseBody(SoldBody, raw).sold);
  }

  @Post('handovers/:id/owed')
  @HttpCode(200)
  @RequirePermission('handover.perform', { anyLocation: true })
  owed(@Auth() ctx: AuthContext, @Param('id', uuid) id: string, @Body() raw: unknown) {
    return this.handovers.requestOwed(ctx, id, parseBody(OwedBody, raw).dueOn);
  }

  @Post('handovers/:id/owed/approve')
  @HttpCode(204)
  @RequirePermission('handover.approve_exception', { anyLocation: true })
  async approveOwed(@Auth() ctx: AuthContext, @Req() req: Request, @Param('id', uuid) id: string) {
    await this.handovers.approveOwed(ctx, id, requestMeta(req));
  }

  @Post('handovers/:id/request-confirmation')
  @HttpCode(200)
  @RequirePermission('handover.perform', { anyLocation: true })
  requestConfirmation(@Auth() ctx: AuthContext, @Req() req: Request, @Param('id', uuid) id: string, @Body() raw: unknown) {
    return this.handovers.requestConfirmation(ctx, id, parseBody(RequestBody, raw ?? {}).acceptShortfall, requestMeta(req));
  }

  @Post('handovers/:id/resend-code')
  @HttpCode(200)
  @RequirePermission('handover.perform', { anyLocation: true })
  resend(@Auth() ctx: AuthContext, @Param('id', uuid) id: string) {
    return this.handovers.resendCode(ctx, id);
  }

  @Post('handovers/:id/confirm')
  @HttpCode(200)
  @RequirePermission('handover.perform', { anyLocation: true })
  confirm(@Auth() ctx: AuthContext, @Req() req: Request, @Param('id', uuid) id: string, @Body() raw: unknown) {
    return this.handovers.confirm(ctx, id, parseBody(ConfirmBody, raw).code, requestMeta(req));
  }

  @Post('handovers/:id/dispute')
  @HttpCode(204)
  @RequirePermission('handover.perform', { anyLocation: true })
  async dispute(@Auth() ctx: AuthContext, @Req() req: Request, @Param('id', uuid) id: string, @Body() raw: unknown) {
    await this.handovers.dispute(ctx, id, parseBody(DisputeBody, raw ?? {}).note, requestMeta(req));
  }

  @Post('handovers/:id/cancel')
  @HttpCode(204)
  @RequirePermission('handover.perform', { anyLocation: true })
  async cancel(@Auth() ctx: AuthContext, @Param('id', uuid) id: string) {
    await this.handovers.cancel(ctx, id);
  }
}
